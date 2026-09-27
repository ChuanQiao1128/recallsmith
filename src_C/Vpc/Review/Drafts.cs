using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Pagination;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.Vpc.Review;

/// <summary>
/// AI draft review queue (R18 J11, contract §8.3). Drafts posted by the local authoring agent wait in
/// <c>ai_drafts</c> until an editor accepts (a normal <c>cards</c> row is inserted) or rejects them; every
/// step appends one <c>ai_review_events</c> row. Accept and reject lock the draft row, so a draft leaves
/// <c>pending</c> exactly once. The <c>review.queued</c> webhook and the ledger rows run after commit and are
/// best-effort (contract §0.8).
/// </summary>
public static class Drafts
{
  public const int MaxDraftsPerSubmit = 50;
  public const int SimilarLimit = 3;
  public const double SimilarThreshold = 0.3;
  public static readonly IReadOnlyList<string> RejectReasons = ["incorrect", "ambiguous", "duplicate", "unsupported_source", "off_topic", "low_value", "other"];
  public static readonly IReadOnlyList<string> DefectReasons = ["incorrect", "ambiguous", "duplicate", "unsupported_source"];

  public const int MaxClientDraftKeyLength = 128;
  public const int MaxAgentFieldLength = 200;
  public const int MaxNoteLength = 500;
  public const int DefaultListLimit = 50;
  public const int MaxListLimit = 100;
  public const string DefaultConsoleBaseUrl = "https://console.developercards.app";

  /// <summary>The runner's author configuration id in <c>agent.authorConfigId</c> (R18D M1) is at most this long.</summary>
  public const int MaxAuthorConfigIdLength = 128;

  private static readonly string[] AgentKeys = ["name", "model", "skillVersion", "runId", "queueItemId", "authorConfigId"];
  private static readonly string[] ListStatuses = ["pending", "accepted", "rejected", "all"];

  private const string DraftColumns = """
    d.id, d.deck_id, d.batch_id, d.client_draft_key, d.stable_uid, d.status, d.agent, d.submitted_by_sub,
    d.created_at, d.updated_at, d.decided_at, d.decided_by_sub, d.accepted_card_id
    """;

  // ---------------------------------------------------------------------------------------------
  // /api/v1/authoring/drafts
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleDrafts(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return await Submit(req, res, auth);
    if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return await List(req, res, auth);
    return res.MethodNotAllowed("Method not allowed");
  }

  private sealed record SubmitEntry(int Index, string ClientDraftKey, JsonElement Card);

  private static async Task<APIGatewayProxyResponse> Submit(LambdaRequest req, Res res, AuthContext auth)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) throw new ValidationError("Body must be a JSON object", "body");

      if (!body.TryGetProperty("deckId", out var deckIdEl) || deckIdEl.ValueKind != JsonValueKind.Number || !deckIdEl.TryGetInt64(out var deckId))
      {
        throw new ValidationError("deckId must be an integer", "deckId");
      }
      var agentJson = ParseAgent(body);
      var entries = ParseEntries(body);

      var deck = await LiveDeckAsync(conn, null, deckId);
      if (deck is null) return DeckNotFound(res);
      var deckSlug = deck.Value.Slug;

      var denyDeck = await Helpers.RequireDeckWrite(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;
      if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");

      // One outcome per request position, so every response list keeps request order.
      var outcomes = new object?[entries.Count];

      var existing = new Dictionary<string, long>(StringComparer.Ordinal);
      var existingRows = await DbUtil.QueryAsync(conn, null,
        "select id, client_draft_key from ai_drafts where deck_id = $1 and client_draft_key = any($2)",
        [deckId, entries.Select(e => e.ClientDraftKey).ToArray()]);
      foreach (var row in existingRows)
      {
        existing[(string)row["client_draft_key"]!] = Convert.ToInt64(row["id"], CultureInfo.InvariantCulture);
      }

      var valid = new List<(SubmitEntry Entry, DraftCard Card, string SimilarJson)>();
      foreach (var entry in entries)
      {
        if (existing.TryGetValue(entry.ClientDraftKey, out var existingId))
        {
          outcomes[entry.Index] = new DuplicateOutcome(entry.ClientDraftKey, existingId);
          continue;
        }

        DraftCard card;
        try
        {
          card = DraftCard.Parse(entry.Card);
        }
        catch (DraftCardError ex)
        {
          outcomes[entry.Index] = new RejectedOutcome(entry.ClientDraftKey, ex.Code, ex.Message);
          continue;
        }

        valid.Add((entry, card, await SimilarJsonAsync(conn, card, deckId)));
      }

      var batchId = Guid.NewGuid();
      var created = new List<long>();
      await using (var tx = await conn.BeginTransactionAsync())
      {
        foreach (var (entry, card, similarJson) in valid)
        {
          var inserted = await DbUtil.QueryAsync(conn, tx,
            """
            insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, card, "similar", agent, submitted_by_sub)
            values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
            on conflict (deck_id, client_draft_key) do nothing
            returning id
            """,
            [deckId, batchId, entry.ClientDraftKey, card.StableUid, card.ToJson(), similarJson, agentJson, auth.UserSub]);

          if (inserted.Count == 0)
          {
            var raced = await DbUtil.ExecuteScalarAsync(conn, tx,
              "select id from ai_drafts where deck_id = $1 and client_draft_key = $2", [deckId, entry.ClientDraftKey]);
            outcomes[entry.Index] = new DuplicateOutcome(entry.ClientDraftKey, Convert.ToInt64(raced, CultureInfo.InvariantCulture));
            continue;
          }

          var draftId = Convert.ToInt64(inserted[0]["id"], CultureInfo.InvariantCulture);
          await DbUtil.ExecuteAsync(conn, tx,
            "insert into ai_review_events (draft_id, action, actor_sub) values ($1, 'submitted', $2)",
            [draftId, auth.UserSub]);
          outcomes[entry.Index] = new CreatedOutcome(draftId, entry.ClientDraftKey, card.StableUid);
          created.Add(draftId);
        }

        await tx.CommitAsync();
      }

      if (created.Count > 0)
      {
        await WebhookEvents.EnqueueAsync(conn, "review.queued", new
        {
          deckId,
          deckSlug,
          batchId,
          draftCount = created.Count,
          draftIds = created.Take(MaxDraftsPerSubmit).ToArray(),
          consoleUrl = $"{ConsoleBaseUrl()}/review?deckId={deckId.ToString(CultureInfo.InvariantCulture)}",
        });
      }

      // Drafts of an automation run get a decision (R18A A00 §5.1); never throws, never changes this response.
      await DraftDecisions.OnSubmittedAsync(conn, auth, deckId, deckSlug, agentJson, created);

      return res.Ok(new
      {
        batchId,
        created = outcomes.OfType<CreatedOutcome>().ToList(),
        duplicates = outcomes.OfType<DuplicateOutcome>().ToList(),
        rejected = outcomes.OfType<RejectedOutcome>().ToList(),
      });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  private sealed record CreatedOutcome(long DraftId, string ClientDraftKey, string StableUid);

  private sealed record DuplicateOutcome(string ClientDraftKey, long DraftId);

  private sealed record RejectedOutcome(string ClientDraftKey, string Code, string Message);

  /// <summary>
  /// null / absent → null; otherwise canonical JSON of {name?, model?, skillVersion?, runId?, queueItemId?, authorConfigId?}.
  /// <c>authorConfigId</c> (R18D M1) is the runner's author configuration, which a live auto-accept compares with the gate's.
  /// </summary>
  private static string? ParseAgent(JsonElement body)
  {
    if (!body.TryGetProperty("agent", out var el) || el.ValueKind == JsonValueKind.Null) return null;
    const string message = "agent must be an object with optional string fields name, model, skillVersion, runId, queueItemId (max 200) " +
      "and authorConfigId (max 128)";
    if (el.ValueKind != JsonValueKind.Object) throw new ValidationError(message, "agent");

    var agent = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach (var prop in el.EnumerateObject())
    {
      if (!AgentKeys.Contains(prop.Name) || prop.Value.ValueKind != JsonValueKind.String) throw new ValidationError(message, "agent");
      var value = prop.Value.GetString() ?? string.Empty;
      if (value.Length > (prop.Name == "authorConfigId" ? MaxAuthorConfigIdLength : MaxAgentFieldLength)) throw new ValidationError(message, "agent");
      agent[prop.Name] = value;
    }
    return JsonSerializer.Serialize(agent);
  }

  private static List<SubmitEntry> ParseEntries(JsonElement body)
  {
    if (!body.TryGetProperty("drafts", out var draftsEl) || draftsEl.ValueKind != JsonValueKind.Array ||
        draftsEl.GetArrayLength() is < 1 or > MaxDraftsPerSubmit)
    {
      throw new ValidationError($"drafts must be an array of 1..{MaxDraftsPerSubmit} entries", "drafts");
    }

    var entries = new List<SubmitEntry>();
    var seen = new HashSet<string>(StringComparer.Ordinal);
    var index = 0;
    foreach (var item in draftsEl.EnumerateArray())
    {
      if (item.ValueKind != JsonValueKind.Object) throw new ValidationError($"drafts[{index}] must be an object", "drafts");

      if (!item.TryGetProperty("clientDraftKey", out var keyEl) || keyEl.ValueKind != JsonValueKind.String)
      {
        throw new ValidationError($"drafts[{index}].clientDraftKey must be a string", "drafts");
      }
      var key = keyEl.GetString() ?? string.Empty;
      if (key.Length is < 1 or > MaxClientDraftKeyLength)
      {
        throw new ValidationError($"drafts[{index}].clientDraftKey must be 1..{MaxClientDraftKeyLength} characters", "drafts");
      }
      if (!seen.Add(key)) throw new ValidationError($"drafts[{index}].clientDraftKey repeats within the request", "drafts");

      if (!item.TryGetProperty("card", out var cardEl)) throw new ValidationError($"drafts[{index}].card is required", "drafts");

      entries.Add(new SubmitEntry(index, key, cardEl.Clone()));
      index++;
    }
    return entries;
  }

  private static async Task<string> SimilarJsonAsync(NpgsqlConnection conn, DraftCard card, long deckId)
  {
    try
    {
      var result = await CardSimilarity.FindAsync(conn, new SimilarityQuery(card.Question, [deckId], SimilarLimit, SimilarThreshold));
      return JsonSerializer.Serialize(result.Matches.Select(m => new
      {
        cardId = m.CardId,
        deckId = m.DeckId,
        deckSlug = m.DeckSlug,
        stableUid = m.StableUid,
        question = m.Question,
        similarity = m.Similarity,
        likelyDuplicate = m.LikelyDuplicate,
      }));
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "drafts", reason = "similarity_failed", deckId, error = ex.Message });
      return "[]";
    }
  }

  private static string ConsoleBaseUrl()
  {
    var raw = Environment.GetEnvironmentVariable("CONSOLE_BASE_URL");
    return string.IsNullOrWhiteSpace(raw) ? DefaultConsoleBaseUrl : raw.Trim().TrimEnd('/');
  }

  private static async Task<APIGatewayProxyResponse> List(LambdaRequest req, Res res, AuthContext auth)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      var deckId = Validation.ParseOptionalInteger(req.Query.TryGetValue("deckId", out var did) ? did : null, "deckId")
        ?? throw new ValidationError("deckId is required", "deckId");

      var status = req.Query.TryGetValue("status", out var st) && !string.IsNullOrEmpty(st) ? st : "pending";
      if (!ListStatuses.Contains(status)) throw new ValidationError("status must be pending, accepted, rejected or all", "status");

      var limit = DefaultListLimit;
      if (req.Query.TryGetValue("limit", out var lim) && !string.IsNullOrEmpty(lim))
      {
        if (!int.TryParse(lim, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > MaxListLimit)
        {
          throw new ValidationError($"limit must be an integer in 1..{MaxListLimit}", "limit");
        }
      }

      long? cursorId = null;
      if (req.Query.TryGetValue("cursor", out var cursorRaw) && !string.IsNullOrEmpty(cursorRaw))
      {
        if (!TryDecodeCursor(cursorRaw, out var lastId)) throw new ValidationError("Invalid cursor", "cursor");
        cursorId = lastId;
      }

      if (await LiveDeckAsync(conn, null, deckId) is null) return DeckNotFound(res);
      var denyDeck = await Helpers.RequireDeckRead(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      var parameters = new List<object?> { deckId };
      var where = new List<string> { "d.deck_id = $1" };
      if (status != "all")
      {
        parameters.Add(status);
        where.Add($"d.status = ${parameters.Count}");
      }
      if (cursorId is not null)
      {
        parameters.Add(cursorId.Value);
        where.Add($"d.id < ${parameters.Count}");
      }
      parameters.Add(limit + 1);

      var sql = $"""
        select {DraftColumns},
          d.card->>'question' as question,
          d.card->>'topic' as topic,
          exists (select 1 from jsonb_array_elements(d."similar") s where s->>'likelyDuplicate' = 'true') as likely_duplicate
        from ai_drafts d
        where {string.Join(" and ", where)}
        order by d.id desc
        limit ${parameters.Count}
        """;

      var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);
      var page = rows.Take(limit).ToList();
      var automation = await AutomationRowsAsync(conn, page.Select(r => Long(r["id"])).ToArray());
      var items = page.Select(r => new
      {
        draftId = Long(r["id"]),
        deckId = Long(r["deck_id"]),
        batchId = r["batch_id"],
        clientDraftKey = r["client_draft_key"],
        stableUid = r["stable_uid"],
        status = r["status"],
        question = r["question"],
        topic = r["topic"],
        likelyDuplicate = r["likely_duplicate"] is true,
        agent = Helpers.JsonbElement(r, "agent"),
        submittedBySub = r["submitted_by_sub"],
        createdAt = r["created_at"],
        updatedAt = r["updated_at"],
        decidedAt = r["decided_at"],
        decidedBySub = r["decided_by_sub"],
        acceptedCardId = r["accepted_card_id"],
        automation = automation.TryGetValue(Long(r["id"]), out var a)
          ? new { state = a["state"], reason = a["reason"], mode = a["mode"] }
          : null,
      }).ToList();

      var nextCursor = rows.Count > limit ? EncodeCursor(Long(page[^1]["id"])) : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  /// <summary>base64url of UTF-8 <c>{"v":1,"id":&lt;last id&gt;}</c>.</summary>
  internal static string EncodeCursor(long id) =>
    CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { v = 1, id })));

  internal static bool TryDecodeCursor(string raw, out long id)
  {
    id = 0;

    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return false;

    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object) return false;
      if (!CursorCodec.TryReadVersion(root)) return false;
      return root.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.Number && idEl.TryGetInt64(out id) && id > 0;
    }
    catch (JsonException)
    {
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // /api/v1/authoring/drafts/:draftId
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleGetDraft(LambdaRequest req, Res res, AuthContext auth, string draftId)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    var id = ParseDraftId(draftId);
    if (id is null) return DraftNotFound(res);

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        $"""select {DraftColumns}, d.card, d."similar" as similar_json from ai_drafts d where d.id = $1""", [id.Value]);
      if (rows.Count == 0) return DraftNotFound(res);
      var r = rows[0];
      // The agent client may read only the drafts its own subject submitted (AgentClientPolicy, ai-agent-6).
      if (auth.IsAgentClient && !string.Equals(r["submitted_by_sub"] as string, auth.UserSub, StringComparison.Ordinal)) return DraftNotFound(res);
      var deckId = Long(r["deck_id"]);

      if (await LiveDeckAsync(conn, null, deckId) is null) return DeckNotFound(res);
      var denyDeck = await Helpers.RequireDeckRead(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      var eventRows = await DbUtil.QueryAsync(conn, null,
        """
        select id, action, actor_sub, reason, note, before_card, after_card, review_ms, created_at
        from ai_review_events where draft_id = $1 order by id
        """,
        [id.Value]);
      var events = eventRows.Select(e => new
      {
        eventId = Long(e["id"]),
        action = e["action"],
        actorSub = e["actor_sub"],
        reason = e["reason"],
        note = e["note"],
        beforeCard = Helpers.JsonbElement(e, "before_card"),
        afterCard = Helpers.JsonbElement(e, "after_card"),
        reviewMs = e["review_ms"],
        createdAt = e["created_at"],
      }).ToList();

      var automation = await AutomationDetailAsync(conn, id.Value);

      return res.Ok(new
      {
        draftId = id.Value,
        deckId,
        batchId = r["batch_id"],
        clientDraftKey = r["client_draft_key"],
        stableUid = r["stable_uid"],
        status = r["status"],
        card = Helpers.JsonbElement(r, "card"),
        similar = Helpers.JsonbElement(r, "similar_json"),
        agent = Helpers.JsonbElement(r, "agent"),
        submittedBySub = r["submitted_by_sub"],
        createdAt = r["created_at"],
        updatedAt = r["updated_at"],
        decidedAt = r["decided_at"],
        decidedBySub = r["decided_by_sub"],
        acceptedCardId = r["accepted_card_id"],
        events,
        automation,
      });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // /api/v1/authoring/drafts/:draftId/accept
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleAccept(LambdaRequest req, Res res, AuthContext auth, string draftId)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    // A decided draft always records who decided it (ck_ai_drafts_decided, migration 033).
    if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");

    var id = ParseDraftId(draftId);
    if (id is null) return DraftNotFound(res);

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = ParseDecisionBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) throw new ValidationError("Body must be a JSON object", "body");

      DraftCard? edited = null;
      if (body.TryGetProperty("card", out var cardEl) && cardEl.ValueKind != JsonValueKind.Null) edited = DraftCard.Parse(cardEl);
      var (reviewMs, rawReviewMs) = ParseReviewMs(body);
      var runQa = ParseRunQa(body);

      var deckId = await DraftDeckIdAsync(conn, id.Value);
      if (deckId is null) return DraftNotFound(res);
      var denyDeck = await Helpers.RequireDeckWrite(conn, auth.UserSub, deckId.Value, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      long cardId;
      string action;
      string stableUid;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        DraftAcceptance.Accepted accepted;
        try
        {
          accepted = await DraftAcceptance.AcceptInTransactionAsync(conn, tx, id.Value, deckId.Value, auth.UserSub, edited, reviewMs);
        }
        catch (DraftAcceptance.DraftAcceptanceException ex)
        {
          // Each code maps to exactly the response this route gave before the extraction (A03).
          return ex.Code switch
          {
            DraftAcceptance.DraftNotFound => DraftNotFound(res),
            DraftAcceptance.DeckNotFound => DeckNotFound(res),
            _ => Helpers.ErrorEnvelope(res, 409, ex.Code, ex.Message),
          };
        }
        cardId = accepted.CardId;
        action = accepted.Action;
        stableUid = accepted.StableUid;

        await tx.CommitAsync();
      }

      await AutomationLedger.RecordAsync(conn, new AutomationEvent(
        Automation: "ai_draft_review", Units: 1, Outcome: "success",
        ActualMinutes: reviewMs is null ? null : reviewMs.Value / 60000m,
        DeckId: deckId.Value, Ref: id.Value.ToString(CultureInfo.InvariantCulture), DedupeKey: $"draft-accept:{id.Value}",
        Details: ReviewTimeDetails(reviewMs, rawReviewMs)));

      // A human decision always wins over the automation (A00 §5.7); never throws.
      await DraftDecisions.OnHumanDecisionAsync(conn, id.Value, action, null, auth.UserSub);

      if (!runQa) return res.Ok(new { draftId = id.Value, cardId, stableUid, action });

      // accept → QA chain (automation-17): queue a scope=changed run for the deck (the new card and any other
      // unreviewed change), or reuse the deck's open run. The accept has committed either way.
      var chained = await QaRuns.StartChangedRunAsync(conn, deckId.Value, auth.UserSub, "draft_accept");
      var qa = chained is null
        ? new { status = "disabled", runId = (Guid?)null, code = (string?)"AI_QA_DISABLED", message = (string?)"AI QA is disabled (AI_QA_ENABLED is off)" }
        : new { status = chained.Status, runId = chained.RunId, code = chained.Code, message = chained.Message };
      return res.Ok(new { draftId = id.Value, cardId, stableUid, action, qa });
    }
    catch (PostgresException pg) when (pg is { SqlState: "23505", ConstraintName: "uq_cards_deck_uid" })
    {
      return Helpers.ErrorEnvelope(res, 409, "STABLE_UID_TAKEN", "stableUid is already used by another card in this deck");
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // /api/v1/authoring/drafts/:draftId/reject
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleReject(LambdaRequest req, Res res, AuthContext auth, string draftId)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    // A decided draft always records who decided it (ck_ai_drafts_decided, migration 033).
    if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");

    var id = ParseDraftId(draftId);
    if (id is null) return DraftNotFound(res);

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = ParseDecisionBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) throw new ValidationError("Body must be a JSON object", "body");

      if (!body.TryGetProperty("reason", out var reasonEl) || reasonEl.ValueKind != JsonValueKind.String ||
          !RejectReasons.Contains(reasonEl.GetString()!))
      {
        throw new ValidationError($"reason must be one of {string.Join(", ", RejectReasons)}", "reason");
      }
      var reason = reasonEl.GetString()!;
      var note = ParseNote(body);
      var (reviewMs, rawReviewMs) = ParseReviewMs(body);

      var deckId = await DraftDeckIdAsync(conn, id.Value);
      if (deckId is null) return DraftNotFound(res);
      var denyDeck = await Helpers.RequireDeckWrite(conn, auth.UserSub, deckId.Value, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      await using (var tx = await conn.BeginTransactionAsync())
      {
        var draftRows = await DbUtil.QueryAsync(conn, tx, "select status from ai_drafts where id = $1 for update", [id.Value]);
        if (draftRows.Count == 0) return DraftNotFound(res);
        if ((string)draftRows[0]["status"]! != "pending") return DraftNotPending(res, id.Value);

        await DbUtil.ExecuteAsync(conn, tx,
          """
          update ai_drafts
          set status = 'rejected', decided_at = now(), decided_by_sub = $2, updated_at = now()
          where id = $1
          """,
          [id.Value, auth.UserSub]);

        await DbUtil.ExecuteAsync(conn, tx,
          """
          insert into ai_review_events (draft_id, action, actor_sub, reason, note, review_ms)
          values ($1, 'rejected', $2, $3, $4, $5)
          """,
          [id.Value, auth.UserSub, reason, note, reviewMs]);

        await tx.CommitAsync();
      }

      // Every reject charges its review time to the automation (units 0), so the ledger's savings carry the
      // human cost of the drafts the agent got wrong. A reject is the agent's own mistake, not a defect
      // caught before publish, so it records no defect; the agent's defect rate is reported separately from
      // ai_review_events (LedgerRoutes agentDrafts).
      await AutomationLedger.RecordAsync(conn, new AutomationEvent(
        Automation: "ai_draft_review", Units: 0, Outcome: "success",
        ActualMinutes: reviewMs is null ? null : reviewMs.Value / 60000m,
        DeckId: deckId.Value, Ref: id.Value.ToString(CultureInfo.InvariantCulture), DedupeKey: $"draft-reject:{id.Value}",
        Details: new { reason, defect = DefectReasons.Contains(reason), reviewTimeMeasured = reviewMs is not null, rawReviewMs = rawReviewMs != reviewMs ? rawReviewMs : null }));

      await DraftDecisions.OnHumanDecisionAsync(conn, id.Value, "rejected", reason, auth.UserSub);

      return res.Ok(new { draftId = id.Value, action = "rejected" });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------

  /// <summary>Empty or whitespace body → <c>{}</c>; invalid JSON → null.</summary>
  private static JsonDocument? ParseDecisionBody(LambdaRequest req)
  {
    var raw = Validation.GetRawBody(req);
    if (string.IsNullOrWhiteSpace(raw)) return JsonDocument.Parse("{}");
    return Validation.ParseJsonBody(req);
  }

  /// <summary>
  /// The per-draft cap on the human review time the ledger charges (automation-13): the console measures
  /// at most this much (draftReview.ts REVIEW_MS_CAP) and the ledger page says so, and a caller of the API
  /// must not be able to erase or inflate ai_draft_review savings with an absurd value.
  /// </summary>
  public const int ReviewMsCap = 30 * 60_000;

  /// <summary>
  /// The optional <c>reviewMs</c>: absent/null → (null, null); an integer in 0..2147483647 → (the value
  /// clamped to <see cref="ReviewMsCap"/>, the raw value). Anything else is a validation error. Only the
  /// clamped value is stored in ai_review_events and charged to the ledger.
  /// </summary>
  private static (int? Clamped, int? Raw) ParseReviewMs(JsonElement body)
  {
    if (!body.TryGetProperty("reviewMs", out var el) || el.ValueKind == JsonValueKind.Null) return (null, null);
    if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var ms) && ms >= 0) return (Math.Min(ms, ReviewMsCap), ms);
    throw new ValidationError("reviewMs must be an integer in 0..2147483647", "reviewMs");
  }

  /// <summary>The optional <c>runQa</c> flag of an accept: absent/null → false; anything but a boolean is a validation error.</summary>
  private static bool ParseRunQa(JsonElement body)
  {
    if (!body.TryGetProperty("runQa", out var el) || el.ValueKind == JsonValueKind.Null) return false;
    return el.ValueKind switch
    {
      JsonValueKind.True => true,
      JsonValueKind.False => false,
      _ => throw new ValidationError("runQa must be a boolean", "runQa"),
    };
  }

  /// <summary>Ledger details of an accept: whether review time was measured, and the raw value when it was clamped.</summary>
  private static object ReviewTimeDetails(int? reviewMs, int? rawReviewMs) =>
    new { reviewTimeMeasured = reviewMs is not null, rawReviewMs = rawReviewMs != reviewMs ? rawReviewMs : null };

  private static string? ParseNote(JsonElement body)
  {
    if (!body.TryGetProperty("note", out var el) || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind != JsonValueKind.String) throw new ValidationError("note must be a string or null", "note");
    var note = (el.GetString() ?? string.Empty).Trim();
    if (note.Length > MaxNoteLength) throw new ValidationError($"note too long (max {MaxNoteLength})", "note");
    return note.Length == 0 ? null : note;
  }

  private static long? ParseDraftId(string raw) =>
    long.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var id) && id > 0 ? id : null;

  private static async Task<long?> DraftDeckIdAsync(NpgsqlConnection conn, long draftId)
  {
    var v = await DbUtil.ExecuteScalarAsync(conn, null, "select deck_id from ai_drafts where id = $1", [draftId]);
    return v is null ? null : Convert.ToInt64(v, CultureInfo.InvariantCulture);
  }

  private static async Task<(long Id, string Slug)?> LiveDeckAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long deckId)
  {
    var rows = await DbUtil.QueryAsync(conn, tx, "select id, slug from decks where id = $1 and is_deleted = 0", [deckId]);
    if (rows.Count == 0) return null;
    return (Long(rows[0]["id"]), (string)rows[0]["slug"]!);
  }

  private static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  /// <summary>
  /// The automation decisions of <paramref name="draftIds"/> by draft id (A00 §5.10), read after the main query so a
  /// database without migration 034 (42P01/42703) only loses the <c>automation</c> block.
  /// </summary>
  private static async Task<Dictionary<long, Dictionary<string, object?>>> AutomationRowsAsync(NpgsqlConnection conn, long[] draftIds)
  {
    var result = new Dictionary<long, Dictionary<string, object?>>();
    if (draftIds.Length == 0) return result;
    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        "select draft_id, state, reason, mode from automation_draft_decisions where draft_id = any($1)", [draftIds]);
      foreach (var row in rows) result[Long(row["draft_id"])] = row;
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "drafts", reason = "automation_not_ready", sqlState = pg.SqlState });
      result.Clear();
    }
    return result;
  }

  /// <summary>The detail route's <c>automation</c> block (A00 §5.10), or null (no decision, or no migration 034).</summary>
  private static async Task<object?> AutomationDetailAsync(NpgsqlConnection conn, long draftId)
  {
    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select run_id, state, reason, reason_detail, mode, qa_status, qa_error_code, qa_provider, qa_model,
          qa_prompt_version, blocker_count, major_count, minor_count, accepted_card_id, human_action
        from automation_draft_decisions where draft_id = $1
        """,
        [draftId]);
      if (rows.Count == 0) return null;
      var a = rows[0];

      object? qa = null;
      if (a["qa_status"] is not null)
      {
        var findingRows = await DbUtil.QueryAsync(conn, null,
          "select severity, category, message, suggested_fix from automation_draft_findings where draft_id = $1 order by id",
          [draftId]);
        qa = new
        {
          status = a["qa_status"],
          errorCode = a["qa_error_code"],
          provider = a["qa_provider"],
          model = a["qa_model"],
          promptVersion = a["qa_prompt_version"],
          blocker = a["blocker_count"],
          major = a["major_count"],
          minor = a["minor_count"],
          findings = findingRows.Select(f => new
          {
            severity = f["severity"],
            category = f["category"],
            message = f["message"],
            suggestedFix = f["suggested_fix"],
          }).ToList(),
        };
      }

      return new
      {
        runId = a["run_id"],
        state = a["state"],
        reason = a["reason"],
        reasonDetail = a["reason_detail"],
        mode = a["mode"],
        qa,
        acceptedCardId = a["accepted_card_id"],
        humanAction = a["human_action"],
      };
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "drafts", reason = "automation_not_ready", sqlState = pg.SqlState });
      return null;
    }
  }

  private static APIGatewayProxyResponse DraftNotFound(Res res) => Helpers.ErrorEnvelope(res, 404, "DRAFT_NOT_FOUND", "Draft not found");

  private static APIGatewayProxyResponse DeckNotFound(Res res) => Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");

  private static APIGatewayProxyResponse DraftNotPending(Res res, long draftId) =>
    Helpers.ErrorEnvelope(res, 409, "DRAFT_NOT_PENDING", $"Draft {draftId} has already been decided");

  private static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "SERVER_NOT_READY_REVIEW", "Review queue tables are missing; run the database migration");

  private static APIGatewayProxyResponse HandleError(Exception ex, Res res)
  {
    switch (ex)
    {
      case DraftCardError dce:
        return res.BadRequest(dce.Code, dce.Message);
      case ValidationError:
        return res.BadRequest("VALIDATION_ERROR", ex.Message);
      case PostgresException { SqlState: "42P01" }:
        return NotReady(res);
    }
    var handled = Helpers.HandlePgError(ex, res);
    if (handled is not null) return handled;
    return res.Error500(ex);
  }
}
