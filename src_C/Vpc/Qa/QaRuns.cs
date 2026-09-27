using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Pagination;

namespace RecallSmith.Lambda.Vpc.Qa;

/// <summary>
/// Pre-publish AI QA runs (R18 J13, contract §7.2). core-vpc never calls a model: starting a run records
/// <c>ai_qa_runs</c>/<c>ai_qa_items</c> and enqueues SQS messages of at most <see cref="ChunkSize"/> cards for the
/// ai-qa Lambda (§7.4), which reports back through <c>POST /api/internal/ai-qa/results</c>. Editors then resolve
/// findings here. Every flag and cap is read per request.
/// </summary>
public static class QaRuns
{
  public const string PromptVersion = "qa-v1";
  public const int ChunkSize = 5;
  public const int MaxChunkBytes = 200_000;
  public const int MaxCardIds = 200;
  public const string QueueUrlEnv = "AI_QA_QUEUE_URL";
  public const string MaxCardsEnv = "AI_QA_MAX_CARDS";      // default 200
  public const string DailyCapEnv = "AI_QA_DAILY_USD_CAP";  // default 10
  public static readonly TimeSpan StaleAfter = TimeSpan.FromHours(2);

  /// <summary>EMF gauge emitted once per QA run whose SQS send failed.</summary>
  public const string EnqueueFailuresMetric = "AiQaEnqueueFailures";

  /// <summary>Test seam (InternalsVisibleTo): when non-null it replaces the SQS send. Always null in production.</summary>
  internal static Func<SendMessageRequest, Task>? TestSendSeam;

  public const int DefaultMaxCards = 200;
  public const decimal DefaultDailyCapUsd = 10m;
  public const int DefaultListLimit = 50;
  public const int MaxListLimit = 100;
  public const int MaxNoteLength = 500;
  public const int MaxStatusEntries = 50;

  private static readonly string[] Scopes = ["changed", "all", "cards"];
  private static readonly string[] Resolutions = ["fixed", "dismissed"];

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS()
  {
    if (_sqs is not null) return _sqs;
    // Bounded timeout and retries (backend-design-4): an unreachable SQS endpoint fails the run fast.
    _sqs = new AmazonSQSClient(WebhookEvents.BoundedSqsConfig());
    return _sqs;
  }

  private static string StaleInterval => $"interval '{(int)StaleAfter.TotalMinutes} minutes'";

  private static string RunColumns => $"""
    r.id, r.deck_id, r.scope, r.status,
    case when r.status in ('queued','running') and r.updated_at < now() - {StaleInterval} then 'failed' else r.status end as effective_status,
    r.provider, r.model, r.prompt_version, r.requested_by_sub, r.card_count, r.chunk_count, r.cards_done, r.error_count,
    r.blocker_count, r.major_count, r.minor_count, r.input_tokens, r.output_tokens, r.cache_read_tokens,
    r.estimated_cost_usd, r.error_code, r.created_at, r.updated_at, r.finished_at
    """;

  private const string FindingColumns = """
    f.id, f.run_id, f.card_id, i.stable_uid, f.content_sha256, f.severity, f.category, f.message, f.suggested_fix,
    f.resolution, f.resolved_by_sub, f.resolved_at, f.resolution_note, f.created_at
    """;

  // ---------------------------------------------------------------------------------------------
  // /api/v1/authoring/qa/runs
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleRuns(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return await Start(req, res, auth);
    if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return await List(req, res, auth);
    return res.MethodNotAllowed("Method not allowed");
  }

  private sealed record StartBody(long DeckId, string Scope, long[]? CardIds);

  private static async Task<APIGatewayProxyResponse> Start(LambdaRequest req, Res res, AuthContext auth)
  {
    if (!Env.Flag(QaGate.EnabledEnv)) return Helpers.ErrorEnvelope(res, 503, "AI_QA_DISABLED", "AI QA is disabled (AI_QA_ENABLED is off)");

    var queueUrl = Environment.GetEnvironmentVariable(QueueUrlEnv);
    if (string.IsNullOrWhiteSpace(queueUrl)) return Helpers.ConfigError(res, $"Missing env {QueueUrlEnv}");
    queueUrl = queueUrl.Trim();

    Guid? runId = null;
    try
    {
      StartBody body;
      using (var doc = Validation.ParseJsonBody(req))
      {
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        body = ParseStartBody(doc.RootElement);
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var deckRows = await DbUtil.QueryAsync(conn, null, "select id, slug, title from decks where id = $1 and is_deleted = 0", [body.DeckId]);
      if (deckRows.Count == 0) return DeckNotFound(res);
      var deck = deckRows[0];
      var deckSlug = Convert.ToString(deck["slug"], CultureInfo.InvariantCulture) ?? string.Empty;
      var deckTitle = Convert.ToString(deck["title"], CultureInfo.InvariantCulture) ?? string.Empty;

      var denyDeck = await Helpers.RequireDeckWrite(conn, auth.UserSub, body.DeckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;
      if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");

      var reaped = await DbUtil.ExecuteAsync(conn, null,
        $"""
        update ai_qa_runs
        set status = 'failed', error_code = 'TIMEOUT', finished_at = now(), updated_at = now()
        where deck_id = $1 and status in ('queued','running') and updated_at < now() - {StaleInterval}
        """,
        [body.DeckId]);
      if (reaped > 0) Log.Event("warn", new { tag = "ai_qa", reason = "stale_run_reaped", deckId = body.DeckId, reaped });

      var active = await DbUtil.ExecuteScalarAsync(conn, null,
        "select id from ai_qa_runs where deck_id = $1 and status in ('queued','running') limit 1", [body.DeckId]);
      if (active is not null) return RunInProgress(res);

      var rows = await SelectCardsAsync(conn, body);
      if (rows.Count == 0) return Helpers.ErrorEnvelope(res, 400, "AI_QA_NOTHING_TO_REVIEW", "No cards need AI QA for this scope");

      var maxCards = IntEnv(MaxCardsEnv, DefaultMaxCards);
      if (rows.Count > maxCards)
      {
        return Helpers.ErrorEnvelope(res, 400, "AI_QA_TOO_MANY_CARDS", $"{rows.Count} cards exceed the per-run cap of {maxCards}");
      }

      var cap = DecimalEnv(DailyCapEnv, DefaultDailyCapUsd);
      var spent = Convert.ToDecimal(await DbUtil.ExecuteScalarAsync(conn, null,
        "select coalesce(sum(estimated_cost_usd), 0) from ai_qa_runs where created_at >= date_trunc('day', now(), 'UTC')", []),
        CultureInfo.InvariantCulture);
      if (spent >= cap)
      {
        return Helpers.ErrorEnvelope(res, 429, "AI_QA_DAILY_CAP",
          $"Today's AI QA spend {spent.ToString(CultureInfo.InvariantCulture)} USD has reached the daily cap of {cap.ToString(CultureInfo.InvariantCulture)} USD");
      }

      var cards = rows.Select(QaCard.FromRow).ToList();
      var chunks = Chunk(cards);

      var id = Guid.NewGuid();
      await using (var tx = await conn.BeginTransactionAsync())
      {
        await DbUtil.ExecuteAsync(conn, tx,
          """
          insert into ai_qa_runs (id, deck_id, scope, status, prompt_version, requested_by_sub, card_count, chunk_count)
          values ($1, $2, $3, 'queued', $4, $5, $6, $7)
          """,
          [id, body.DeckId, body.Scope, PromptVersion, auth.UserSub, cards.Count, chunks.Count]);

        await DbUtil.ExecuteAsync(conn, tx,
          """
          insert into ai_qa_items (run_id, card_id, stable_uid, content_sha256, status)
          select $1, x.card_id, x.stable_uid, x.content_sha256, 'queued'
          from unnest($2::bigint[], $3::text[], $4::text[]) as x(card_id, stable_uid, content_sha256)
          """,
          [id, cards.Select(c => c.CardId).ToArray(), cards.Select(c => c.StableUid).ToArray(), cards.Select(c => c.ContentSha256).ToArray()]);

        await tx.CommitAsync();
      }
      runId = id;

      var reviewDate = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
      for (var i = 0; i < chunks.Count; i++)
      {
        var message = JsonSerializer.Serialize(new
        {
          v = 1,
          runId = id,
          chunk = i,
          chunkCount = chunks.Count,
          promptVersion = PromptVersion,
          deck = new { id = body.DeckId, slug = deckSlug, title = deckTitle },
          reviewDate,
          cards = chunks[i].Select(c => c.Wire).ToList(),
        });
        var request = new SendMessageRequest { QueueUrl = queueUrl, MessageBody = message };

        try
        {
          if (TestSendSeam is not null) await TestSendSeam(request);
          else await SQS().SendMessageAsync(request);
        }
        catch (Exception ex)
        {
          Log.Event("error", new { tag = "ai_qa", outcome = "enqueue_failed", runId = id, deckId = body.DeckId, chunk = i, error = ex.Message });
          RouteMetrics.EmitGauge(EnqueueFailuresMetric, 1);
          await DbUtil.ExecuteAsync(conn, null,
            """
            update ai_qa_runs set status = 'failed', error_code = 'ENQUEUE_FAILED', finished_at = now(), updated_at = now()
            where id = $1
            """,
            [id]);
          return res.Error500(ex);
        }
      }

      Log.Event("info", new { tag = "ai_qa", outcome = "enqueued", runId = id, deckId = body.DeckId, cardCount = cards.Count, chunkCount = chunks.Count });
      return res.Ok(new { runId = id, status = "queued", cardCount = cards.Count, chunkCount = chunks.Count });
    }
    catch (PostgresException pg) when (pg is { SqlState: "23505", ConstraintName: "uq_ai_qa_runs_active" } && runId is null)
    {
      return RunInProgress(res);
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  private static StartBody ParseStartBody(JsonElement body)
  {
    if (body.ValueKind != JsonValueKind.Object) throw new ValidationError("Body must be a JSON object", "body");

    if (!body.TryGetProperty("deckId", out var deckIdEl) || deckIdEl.ValueKind != JsonValueKind.Number || !deckIdEl.TryGetInt64(out var deckId))
    {
      throw new ValidationError("deckId must be an integer", "deckId");
    }

    if (!body.TryGetProperty("scope", out var scopeEl) || scopeEl.ValueKind != JsonValueKind.String || !Scopes.Contains(scopeEl.GetString()!))
    {
      throw new ValidationError("scope must be one of changed, all, cards", "scope");
    }
    var scope = scopeEl.GetString()!;

    var hasCardIds = body.TryGetProperty("cardIds", out var idsEl) && idsEl.ValueKind != JsonValueKind.Null;
    if (scope != "cards")
    {
      if (hasCardIds) throw new ValidationError("cardIds is only allowed with scope cards", "cardIds");
      return new StartBody(deckId, scope, null);
    }

    var message = $"cardIds must be an array of 1..{MaxCardIds} distinct integers";
    if (!hasCardIds || idsEl.ValueKind != JsonValueKind.Array || idsEl.GetArrayLength() is < 1 or > MaxCardIds)
    {
      throw new ValidationError(message, "cardIds");
    }
    var ids = new List<long>();
    foreach (var el in idsEl.EnumerateArray())
    {
      if (el.ValueKind != JsonValueKind.Number || !el.TryGetInt64(out var cardId)) throw new ValidationError(message, "cardIds");
      if (ids.Contains(cardId)) throw new ValidationError(message, "cardIds");
      ids.Add(cardId);
    }
    return new StartBody(deckId, scope, [.. ids]);
  }

  private static async Task<List<Dictionary<string, object?>>> SelectCardsAsync(NpgsqlConnection conn, StartBody body)
  {
    switch (body.Scope)
    {
      case "changed":
      {
        var changed = await QaGate.LoadChangedCardRowsAsync(conn, body.DeckId);
        var ids = changed.Select(r => Convert.ToInt64(r["id"], CultureInfo.InvariantCulture)).ToArray();
        var hashes = changed.Select(CardContentHash.Compute).ToArray();
        var reviewed = await QaGate.ReviewedCardIdsAsync(conn, ids, hashes);
        return changed.Where(r => !reviewed.Contains(Convert.ToInt64(r["id"], CultureInfo.InvariantCulture))).ToList();
      }
      case "all":
        return await DbUtil.QueryAsync(conn, null,
          $"select {CardContentHash.CardColumnsSql} from cards c where c.deck_id = $1 and c.is_deleted = 0 order by c.order_in_deck, c.id",
          [body.DeckId]);
      default:
      {
        var rows = await DbUtil.QueryAsync(conn, null,
          $"""
          select {CardContentHash.CardColumnsSql} from cards c
          where c.deck_id = $1 and c.is_deleted = 0 and c.id = any($2::bigint[])
          order by c.order_in_deck, c.id
          """,
          [body.DeckId, body.CardIds!]);
        var found = rows.Select(r => Convert.ToInt64(r["id"], CultureInfo.InvariantCulture)).ToHashSet();
        var outside = body.CardIds!.Where(cid => !found.Contains(cid)).ToList();
        if (outside.Count > 0)
        {
          throw new ValidationError(
            $"cardIds not live in this deck: {string.Join(", ", outside.Select(o => o.ToString(CultureInfo.InvariantCulture)))}", "cardIds");
        }
        return rows;
      }
    }
  }

  /// <summary>One card of the §7.4 message (QaCard); <see cref="Wire"/> is what the message carries.</summary>
  private sealed record QaCard(long CardId, string StableUid, string ContentSha256, object Wire)
  {
    public static QaCard FromRow(Dictionary<string, object?> r)
    {
      var cardId = Convert.ToInt64(r["id"], CultureInfo.InvariantCulture);
      var stableUid = Convert.ToString(r["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty;
      var contentSha256 = CardContentHash.Compute(r);
      var wire = new
      {
        cardId,
        stableUid,
        contentSha256,
        difficulty = Convert.ToInt32(r["difficulty"] ?? 2, CultureInfo.InvariantCulture),
        topic = r["topic"] as string,
        question = r["question"] as string ?? string.Empty,
        explanation = r["explanation"] as string ?? string.Empty,
        codeSnippet = r["codeSnippet"] as string,
        codeLanguage = r["codeLanguage"] as string,
        realWorldUsage = r["realWorldUsage"] as string,
        mcq = Helpers.JsonbElement(r, "mcq"),
        source = Helpers.JsonbElement(r, "source"),
      };
      return new QaCard(cardId, stableUid, contentSha256, wire);
    }
  }

  /// <summary>
  /// Deck-order chunks of at most <see cref="ChunkSize"/> cards; a new chunk starts when adding a card would push
  /// the chunk's serialized <c>cards</c> array over <see cref="MaxChunkBytes"/> (a single larger card goes alone).
  /// </summary>
  private static List<List<QaCard>> Chunk(IReadOnlyList<QaCard> cards)
  {
    var chunks = new List<List<QaCard>>();
    var current = new List<QaCard>();
    var bytes = 2; // "[]"
    foreach (var card in cards)
    {
      var size = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(card.Wire));
      var added = current.Count == 0 ? size : size + 1; // "," between elements
      if (current.Count > 0 && (current.Count >= ChunkSize || bytes + added > MaxChunkBytes))
      {
        chunks.Add(current);
        current = [];
        bytes = 2;
        added = size;
      }
      current.Add(card);
      bytes += added;
    }
    if (current.Count > 0) chunks.Add(current);
    return chunks;
  }

  private static int IntEnv(string name, int fallback)
  {
    var raw = Environment.GetEnvironmentVariable(name);
    return int.TryParse(raw?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : fallback;
  }

  private static decimal DecimalEnv(string name, decimal fallback)
  {
    var raw = Environment.GetEnvironmentVariable(name);
    return decimal.TryParse(raw?.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) && v >= 0 ? v : fallback;
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/authoring/qa/runs?deckId=&limit=&cursor=
  // ---------------------------------------------------------------------------------------------

  private static async Task<APIGatewayProxyResponse> List(LambdaRequest req, Res res, AuthContext auth)
  {
    try
    {
      var deckId = Validation.ParseOptionalInteger(req.Query.TryGetValue("deckId", out var did) ? did : null, "deckId")
        ?? throw new ValidationError("deckId is required", "deckId");

      var limit = DefaultListLimit;
      if (req.Query.TryGetValue("limit", out var lim) && !string.IsNullOrEmpty(lim))
      {
        if (!int.TryParse(lim, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > MaxListLimit)
        {
          throw new ValidationError($"limit must be an integer in 1..{MaxListLimit}", "limit");
        }
      }

      (long Micros, Guid Id)? cursor = null;
      if (req.Query.TryGetValue("cursor", out var cursorRaw) && !string.IsNullOrEmpty(cursorRaw))
      {
        if (!TryDecodeCursor(cursorRaw, out var micros, out var lastId)) throw new ValidationError("Invalid cursor", "cursor");
        cursor = (micros, lastId);
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      if (!await IsLiveDeckAsync(conn, deckId)) return DeckNotFound(res);
      var denyDeck = await Helpers.RequireDeckRead(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      var parameters = new List<object?> { deckId };
      var where = "r.deck_id = $1";
      if (cursor is not null)
      {
        parameters.Add(cursor.Value.Micros);
        parameters.Add(cursor.Value.Id);
        where += " and ((extract(epoch from r.created_at) * 1000000)::bigint, r.id) < ($2::bigint, $3::uuid)";
      }
      parameters.Add(limit + 1);

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select {RunColumns}, (extract(epoch from r.created_at) * 1000000)::bigint as created_us
        from ai_qa_runs r
        where {where}
        order by r.created_at desc, r.id desc
        limit ${parameters.Count}
        """,
        parameters);

      var page = rows.Take(limit).ToList();
      var items = page.Select(RunDto).ToList();
      var nextCursor = rows.Count > limit
        ? EncodeCursor(Convert.ToInt64(page[^1]["created_us"], CultureInfo.InvariantCulture), (Guid)page[^1]["id"]!)
        : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  /// <summary>base64url of UTF-8 <c>{"v":1,"t":&lt;created_at in epoch microseconds&gt;,"id":"&lt;uuid&gt;"}</c>.</summary>
  internal static string EncodeCursor(long createdMicros, Guid id) =>
    CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { v = 1, t = createdMicros, id })));

  internal static bool TryDecodeCursor(string raw, out long createdMicros, out Guid id)
  {
    createdMicros = 0;
    id = Guid.Empty;

    var bytes = CursorCodec.FromBase64Url(raw);
    if (bytes is null) return false;

    try
    {
      using var doc = JsonDocument.Parse(bytes);
      var root = doc.RootElement;
      if (root.ValueKind != JsonValueKind.Object || !CursorCodec.TryReadVersion(root)) return false;
      if (!root.TryGetProperty("t", out var t) || t.ValueKind != JsonValueKind.Number || !t.TryGetInt64(out createdMicros)) return false;
      return root.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String && Guid.TryParse(idEl.GetString(), out id);
    }
    catch (JsonException)
    {
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/authoring/qa/runs/:runId
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleRun(LambdaRequest req, Res res, AuthContext auth, string runId)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    if (!Guid.TryParse(runId, out var id)) return RunNotFound(res);

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      var runRows = await DbUtil.QueryAsync(conn, null, $"select {RunColumns} from ai_qa_runs r where r.id = $1", [id]);
      if (runRows.Count == 0) return RunNotFound(res);
      var deckId = Convert.ToInt64(runRows[0]["deck_id"], CultureInfo.InvariantCulture);

      if (!await IsLiveDeckAsync(conn, deckId)) return DeckNotFound(res);
      var denyDeck = await Helpers.RequireDeckRead(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      var itemRows = await DbUtil.QueryAsync(conn, null,
        """
        select i.card_id, i.stable_uid, i.content_sha256, i.status, i.error_code, i.latency_ms, i.input_tokens, i.output_tokens,
          i.cache_read_tokens, i.estimated_cost_usd, i.request_id, i.updated_at
        from ai_qa_items i
        join cards c on c.id = i.card_id
        where i.run_id = $1
        order by c.order_in_deck, i.card_id
        """,
        [id]);

      var findingRows = await DbUtil.QueryAsync(conn, null,
        $"""
        select {FindingColumns}
        from ai_qa_findings f
        join ai_qa_items i on i.run_id = f.run_id and i.card_id = f.card_id
        join cards c on c.id = f.card_id
        where f.run_id = $1
        order by c.order_in_deck, f.card_id,
          case f.severity when 'blocker' then 0 when 'major' then 1 else 2 end, f.id
        """,
        [id]);

      return res.Ok(new
      {
        run = RunDto(runRows[0]),
        items = itemRows.Select(i => new
        {
          cardId = Convert.ToInt64(i["card_id"], CultureInfo.InvariantCulture),
          stableUid = i["stable_uid"],
          contentSha256 = i["content_sha256"],
          status = i["status"],
          errorCode = i["error_code"],
          latencyMs = i["latency_ms"],
          inputTokens = i["input_tokens"],
          outputTokens = i["output_tokens"],
          cacheReadTokens = i["cache_read_tokens"],
          estimatedCostUsd = i["estimated_cost_usd"],
          requestId = i["request_id"],
          updatedAt = i["updated_at"],
        }).ToList(),
        findings = findingRows.Select(FindingDto).ToList(),
      });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/authoring/qa/status?deckId=
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleStatus(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      var deckId = Validation.ParseOptionalInteger(req.Query.TryGetValue("deckId", out var did) ? did : null, "deckId")
        ?? throw new ValidationError("deckId is required", "deckId");

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      if (!await IsLiveDeckAsync(conn, deckId)) return DeckNotFound(res);
      var denyDeck = await Helpers.RequireDeckRead(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      var state = await QaGate.ComputeAsync(conn, deckId);
      var enabled = Env.Flag(QaGate.EnabledEnv);
      var required = Env.Flag(QaGate.RequiredEnv);
      var missing = state.Changed.Where(c => !c.ReviewedAtCurrentHash).ToList();

      return res.Ok(new
      {
        enabled,
        required,
        changedCards = state.Changed.Count,
        reviewedCurrent = state.Changed.Count - missing.Count,
        missing = missing.Take(MaxStatusEntries).Select(c => new { cardId = c.CardId, stableUid = c.StableUid }).ToList(),
        openBlockers = state.OpenBlockers.Take(MaxStatusEntries).Select(b => new
        {
          findingId = b.FindingId,
          cardId = b.CardId,
          stableUid = b.StableUid,
          category = b.Category,
          message = b.Message,
        }).ToList(),
        wouldBlock = enabled && required && (missing.Count > 0 || state.OpenBlockers.Count > 0),
      });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/authoring/qa/findings/:findingId/resolve
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleResolveFinding(LambdaRequest req, Res res, AuthContext auth, string findingId)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    if (!long.TryParse(findingId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0) return FindingNotFound(res);

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      var found = await DbUtil.QueryAsync(conn, null,
        "select r.deck_id, f.severity from ai_qa_findings f join ai_qa_runs r on r.id = f.run_id where f.id = $1", [id]);
      if (found.Count == 0) return FindingNotFound(res);
      var deckId = Convert.ToInt64(found[0]["deck_id"], CultureInfo.InvariantCulture);
      var severity = Convert.ToString(found[0]["severity"], CultureInfo.InvariantCulture);

      string resolution;
      string? note;
      using (var doc = Validation.ParseJsonBody(req))
      {
        if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
        (resolution, note) = ParseResolveBody(doc.RootElement);
      }

      if (!await IsLiveDeckAsync(conn, deckId)) return DeckNotFound(res);
      var denyDeck = await Helpers.RequireDeckWrite(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      var updated = await DbUtil.ExecuteAsync(conn, null,
        """
        update ai_qa_findings
        set resolution = $2, resolved_by_sub = $3::text, resolved_at = now(), resolution_note = $4::text
        where id = $1 and resolution = 'open'
        """,
        [id, resolution, auth.UserSub, note]);
      if (updated == 0)
      {
        return Helpers.ErrorEnvelope(res, 409, "FINDING_ALREADY_RESOLVED", $"Finding {id.ToString(CultureInfo.InvariantCulture)} has already been resolved");
      }

      if (resolution == "fixed" && severity is "blocker" or "major")
      {
        await AutomationLedger.RecordAsync(conn, new AutomationEvent(
          Automation: "ai_qa_review", Units: 0, Outcome: "success", DefectsCaught: 1,
          DeckId: deckId, Ref: id.ToString(CultureInfo.InvariantCulture), DedupeKey: $"qa-fix:{id.ToString(CultureInfo.InvariantCulture)}"));
      }

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select {FindingColumns}
        from ai_qa_findings f
        left join ai_qa_items i on i.run_id = f.run_id and i.card_id = f.card_id
        where f.id = $1
        """,
        [id]);
      return res.Ok(FindingDto(rows[0]));
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  private static (string Resolution, string? Note) ParseResolveBody(JsonElement body)
  {
    if (body.ValueKind != JsonValueKind.Object) throw new ValidationError("Body must be a JSON object", "body");

    if (!body.TryGetProperty("resolution", out var resEl) || resEl.ValueKind != JsonValueKind.String || !Resolutions.Contains(resEl.GetString()!))
    {
      throw new ValidationError("resolution must be fixed or dismissed", "resolution");
    }

    string? note = null;
    if (body.TryGetProperty("note", out var noteEl) && noteEl.ValueKind != JsonValueKind.Null)
    {
      if (noteEl.ValueKind != JsonValueKind.String) throw new ValidationError("note must be a string or null", "note");
      var n = (noteEl.GetString() ?? string.Empty).Trim();
      if (n.Length > MaxNoteLength) throw new ValidationError($"note too long (max {MaxNoteLength})", "note");
      note = n.Length == 0 ? null : n;
    }

    return (resEl.GetString()!, note);
  }

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------

  private static object RunDto(Dictionary<string, object?> r) => new
  {
    runId = r["id"],
    deckId = Convert.ToInt64(r["deck_id"], CultureInfo.InvariantCulture),
    scope = r["scope"],
    status = r["status"],
    effectiveStatus = r["effective_status"],
    provider = r["provider"],
    model = r["model"],
    promptVersion = r["prompt_version"],
    requestedBySub = r["requested_by_sub"],
    cardCount = r["card_count"],
    chunkCount = r["chunk_count"],
    cardsDone = r["cards_done"],
    errorCount = r["error_count"],
    blockerCount = r["blocker_count"],
    majorCount = r["major_count"],
    minorCount = r["minor_count"],
    inputTokens = r["input_tokens"],
    outputTokens = r["output_tokens"],
    cacheReadTokens = r["cache_read_tokens"],
    estimatedCostUsd = r["estimated_cost_usd"],
    errorCode = r["error_code"],
    createdAt = r["created_at"],
    updatedAt = r["updated_at"],
    finishedAt = r["finished_at"],
  };

  private static object FindingDto(Dictionary<string, object?> f) => new
  {
    findingId = Convert.ToInt64(f["id"], CultureInfo.InvariantCulture),
    runId = f["run_id"],
    cardId = Convert.ToInt64(f["card_id"], CultureInfo.InvariantCulture),
    stableUid = f["stable_uid"],
    contentSha256 = f["content_sha256"],
    severity = f["severity"],
    category = f["category"],
    message = f["message"],
    suggestedFix = f["suggested_fix"],
    resolution = f["resolution"],
    resolvedBySub = f["resolved_by_sub"],
    resolvedAt = f["resolved_at"],
    resolutionNote = f["resolution_note"],
    createdAt = f["created_at"],
  };

  private static async Task<bool> IsLiveDeckAsync(NpgsqlConnection conn, long deckId) =>
    await DbUtil.ExecuteScalarAsync(conn, null, "select id from decks where id = $1 and is_deleted = 0", [deckId]) is not null;

  private static APIGatewayProxyResponse DeckNotFound(Res res) => Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");

  private static APIGatewayProxyResponse RunNotFound(Res res) => Helpers.ErrorEnvelope(res, 404, "RUN_NOT_FOUND", "AI QA run not found");

  private static APIGatewayProxyResponse FindingNotFound(Res res) => Helpers.ErrorEnvelope(res, 404, "FINDING_NOT_FOUND", "AI QA finding not found");

  private static APIGatewayProxyResponse RunInProgress(Res res) =>
    Helpers.ErrorEnvelope(res, 409, "AI_QA_RUN_IN_PROGRESS", "An AI QA run for this deck is still queued or running");

  private static APIGatewayProxyResponse HandleError(Exception ex, Res res)
  {
    switch (ex)
    {
      case ValidationError:
        return res.BadRequest("VALIDATION_ERROR", ex.Message);
      case PostgresException { SqlState: "42P01" }:
        return QaGate.NotReady(res);
    }
    var handled = Helpers.HandlePgError(ex, res);
    if (handled is not null) return handled;
    return res.Error500(ex);
  }
}
