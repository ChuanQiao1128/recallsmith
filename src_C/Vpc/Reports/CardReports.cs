using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Reports;

/// <summary>
/// Card reports (R20 V05, contract R20-00 §4): a learner reports a problem with a card from the mobile app
/// (<c>/api/v1/user/card-reports</c>, the only prefix API Gateway lets mobile tokens through) and a console admin
/// triages the reports of the decks they may read (<c>/api/v1/admin/card-reports</c>). The learner's note is untrusted
/// text: length-capped, stored as is, returned only to console admins with deck read, and never logged or sent to a
/// model. No response carries a user sub or an email. Every route answers <c>503 NOT_READY</c> until migration 037 ran.
/// </summary>
public static class CardReports
{
  public const string EnabledEnv = "CARD_REPORTS_ENABLED";
  public const string DailyLimitEnv = "CARD_REPORT_DAILY_LIMIT";
  public const string AiTriageEnv = "CARD_REPORT_AI_TRIAGE";

  public const int DefaultDailyLimit = 5;
  public const int MaxKeyLength = 128;
  public const int MaxNoteLength = 500;
  public const int MaxClientVersionLength = 64;
  public const int MaxQuestionLength = 200;
  public const int DefaultListLimit = 50;
  public const int MaxListLimit = 100;

  /// <summary>The <c>requested_by_sub</c> of a triage QA run and its log trigger: never the learner's sub.</summary>
  public const string TriageTrigger = "card_report";

  public static readonly IReadOnlyList<string> Reasons = ["wrong_answer", "outdated", "unclear", "typo", "other"];
  public static readonly IReadOnlyList<string> Resolutions = ["fixed", "wont_fix", "duplicate", "invalid"];
  private static readonly string[] StatusFilters = ["open", "resolved", "all"];

  /// <summary><c>CARD_REPORTS_ENABLED</c>, read per call; unset means the contract default <c>"1"</c>.</summary>
  public static bool Enabled() => Env.IsTruthy(Environment.GetEnvironmentVariable(EnabledEnv) ?? "1");

  /// <summary><c>CARD_REPORT_DAILY_LIMIT</c>, read per call; unset or not a non-negative integer means 5.</summary>
  public static int DailyLimit() =>
    int.TryParse(Environment.GetEnvironmentVariable(DailyLimitEnv)?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var n)
      ? n
      : DefaultDailyLimit;

  // ---------------------------------------------------------------------------------------------
  // POST|GET /api/v1/user/card-reports
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleUser(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireUser(auth, res);
    if (deny is not null) return deny;
    if (req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return await CreateAsync(req, res, auth.UserSub!);
    if (req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return await ListOwnAsync(req, res, auth.UserSub!);
    return res.MethodNotAllowed("Method not allowed");
  }

  private sealed record NewReport(string DeckSlug, string StableUid, string Reason, string? Note, string? ClientVersion);

  private static NewReport ParseNewReport(JsonElement root)
  {
    var body = AutomationBody.Object(root);
    var deckSlug = RequiredKey(body, "deckSlug");
    var stableUid = RequiredKey(body, "stableUid");
    var reason = AutomationBody.RequiredEnum(body, "reason", Reasons);
    var note = TrimmedText(body, "note", MaxNoteLength);
    var clientVersion = TrimmedText(body, "clientVersion", MaxClientVersionLength);
    return new NewReport(deckSlug, stableUid, reason, note, clientVersion);
  }

  private static string RequiredKey(JsonElement body, string name)
  {
    var v = body.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString()!.Trim() : null;
    if (string.IsNullOrEmpty(v) || v.Length > MaxKeyLength)
    {
      throw new ValidationError($"{name} must be a non-empty string of at most {MaxKeyLength} characters", name);
    }
    return v;
  }

  /// <summary>An optional string, trimmed; empty after the trim means absent; the cap applies after the trim.</summary>
  private static string? TrimmedText(JsonElement body, string name, int maxLength)
  {
    if (!body.TryGetProperty(name, out var el) || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind != JsonValueKind.String) throw new ValidationError($"{name} must be a string or null", name);
    var s = el.GetString()!.Trim();
    if (s.Length > maxLength) throw new ValidationError($"{name} must be at most {maxLength} characters", name);
    return s.Length == 0 ? null : s;
  }

  private static async Task<APIGatewayProxyResponse> CreateAsync(LambdaRequest req, Res res, string userSub)
  {
    if (!Enabled()) return Disabled(res);

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("VALIDATION_ERROR", "Invalid JSON body");
      var input = ParseNewReport(doc.RootElement);

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      long reportId;
      long deckId, cardId;
      object? createdAt;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        // One report at a time per learner: the duplicate check, the daily count and the insert see the same rows.
        await DbUtil.ExecuteAsync(conn, tx, "select pg_advisory_xact_lock(hashtext('card_reports:' || $1))", [userSub]);

        var card = await DbUtil.QueryAsync(conn, tx,
          """
          select d.id as deck_id, c.id as card_id
          from decks d join cards c on c.deck_id = d.id
          where d.slug = $1 and d.is_deleted = 0 and c.stable_uid = $2 and c.is_deleted = 0
          order by d.id, c.id
          limit 1
          """, [input.DeckSlug, input.StableUid]);
        if (card.Count == 0) return Helpers.ErrorEnvelope(res, 404, "CARD_NOT_FOUND", "Card not found");
        deckId = RunnerRoutes.Long(card[0]["deck_id"]);
        cardId = RunnerRoutes.Long(card[0]["card_id"]);

        var open = await DbUtil.ExecuteScalarAsync(conn, tx,
          "select id from card_reports where user_sub = $1 and stable_uid = $2 and status = 'open'", [userSub, input.StableUid]);
        if (open is not null)
        {
          await tx.CommitAsync();
          var existingId = RunnerRoutes.Long(open);
          Log.Event("info", new { tag = "card_reports", outcome = "duplicate", reportId = existingId });
          return res.Ok(new { reportId = existingId, status = "open", duplicate = true });
        }

        var today = RunnerRoutes.Long(await DbUtil.ExecuteScalarAsync(conn, tx,
          "select count(*) from card_reports where user_sub = $1 and created_at >= date_trunc('day', now(), 'UTC')", [userSub]));
        if (today >= DailyLimit())
        {
          Log.Event("info", new { tag = "card_reports", outcome = "daily_limit" });
          return Helpers.ErrorEnvelope(res, 429, "REPORT_DAILY_LIMIT", "Daily report limit reached. Try again tomorrow.");
        }

        var inserted = (await DbUtil.QueryAsync(conn, tx,
          """
          insert into card_reports (user_sub, deck_id, deck_slug, card_id, stable_uid, reason, note, client_version)
          values ($1, $2, $3, $4, $5, $6, $7::text, $8::text)
          returning id, created_at
          """, [userSub, deckId, input.DeckSlug, cardId, input.StableUid, input.Reason, input.Note, input.ClientVersion]))[0];
        reportId = RunnerRoutes.Long(inserted["id"]);
        createdAt = inserted["created_at"];
        await tx.CommitAsync();
      }

      Log.Event("info", new { tag = "card_reports", outcome = "created", reportId, deckId, reason = input.Reason });

      // After commit, best-effort: no note and no user in the event.
      await WebhookEvents.EnqueueAsync(conn, "card.reported", new
      {
        reportId,
        deckSlug = input.DeckSlug,
        stableUid = input.StableUid,
        reason = input.Reason,
        createdAt = RunnerRoutes.Timestamp(createdAt),
      });
      await TriageAsync(conn, reportId, deckId, cardId);

      return res.Ok(new { reportId, status = "open", duplicate = false });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  /// <summary>
  /// The AI triage hook (contract §4): with <c>CARD_REPORT_AI_TRIAGE</c> on, a new report starts a QA re-check of
  /// that one card with the human profile. Only the card goes to the reviewer; the report note is never part of the
  /// message. With AI QA off <see cref="QaRuns.StartCardsRunAsync"/> returns null, nothing is recorded and the report
  /// waits for a person. Never throws.
  /// </summary>
  internal static async Task<QaRuns.ChainedRun?> TriageAsync(NpgsqlConnection conn, long reportId, long deckId, long cardId)
  {
    if (!Env.Flag(AiTriageEnv)) return null;
    try
    {
      var run = await QaRuns.StartCardsRunAsync(conn, deckId, [cardId], TriageTrigger, TriageTrigger, null);
      Log.Event("info", new { tag = "card_reports", outcome = "triage", reportId, status = run?.Status ?? "ai_qa_off", runId = run?.RunId });
      return run;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "card_reports", reason = "triage_failed", reportId, error = ex.GetType().Name });
      return null;
    }
  }

  private static async Task<APIGatewayProxyResponse> ListOwnAsync(LambdaRequest req, Res res, string userSub)
  {
    if (!Enabled()) return Disabled(res);

    try
    {
      var limit = Limit(req);
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select r.id, r.deck_slug, r.stable_uid, left(c.question, $3) as question, r.reason, r.status, r.resolution, r.resolution_note,
          r.created_at, r.resolved_at
        from card_reports r left join cards c on c.id = r.card_id
        where r.user_sub = $1
        order by r.id desc
        limit $2
        """, [userSub, limit, MaxQuestionLength]);
      var items = rows.Select(r => new
      {
        reportId = RunnerRoutes.Long(r["id"]),
        deckSlug = r["deck_slug"],
        stableUid = r["stable_uid"],
        question = r["question"],
        reason = r["reason"],
        status = r["status"],
        resolution = r["resolution"],
        resolutionNote = r["resolution_note"],
        createdAt = RunnerRoutes.Timestamp(r["created_at"]),
        resolvedAt = RunnerRoutes.Timestamp(r["resolved_at"]),
      }).ToList();
      return res.Ok(new { items });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // GET /api/v1/admin/card-reports
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleAdminList(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      var status = "open";
      if (req.Query.TryGetValue("status", out var s) && !string.IsNullOrEmpty(s))
      {
        if (!StatusFilters.Contains(s)) throw new ValidationError("status must be open, resolved or all", "status");
        status = s;
      }
      long? deckId = null;
      if (req.Query.TryGetValue("deckId", out var d) && !string.IsNullOrEmpty(d))
      {
        if (!long.TryParse(d, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0)
        {
          throw new ValidationError("deckId must be a positive integer", "deckId");
        }
        deckId = id;
      }
      var limit = Limit(req);
      long? cursorId = null;
      if (req.Query.TryGetValue("cursor", out var cursorRaw) && !string.IsNullOrEmpty(cursorRaw))
      {
        if (!Drafts.TryDecodeCursor(cursorRaw, out var lastId)) throw new ValidationError("Invalid cursor", "cursor");
        cursorId = lastId;
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var parameters = new List<object?> { MaxQuestionLength };
      var where = new List<string> { "true" };
      if (status != "all")
      {
        parameters.Add(status);
        where.Add($"r.status = ${parameters.Count}");
      }
      if (deckId is not null)
      {
        var denied = await Helpers.RequireDeckRead(conn, auth.UserSub, deckId.Value, auth.IsSuperAdmin, res);
        if (denied is not null) return denied;
        parameters.Add(deckId.Value);
        where.Add($"r.deck_id = ${parameters.Count}");
      }
      if (!auth.IsSuperAdmin)
      {
        if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");
        parameters.Add(auth.UserSub);
        where.Add($"r.deck_id in (select deck_id from admin_deck_permissions where admin_sub = ${parameters.Count} and can_read = 1)");
      }
      if (cursorId is not null)
      {
        parameters.Add(cursorId.Value);
        where.Add($"r.id < ${parameters.Count}");
      }
      parameters.Add(limit + 1);

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select r.id, r.deck_id, r.deck_slug, r.card_id, r.stable_uid, left(c.question, $1) as question, r.reason, r.note, r.status,
          r.resolution, r.resolution_note, r.client_version, r.created_at, r.resolved_at
        from card_reports r left join cards c on c.id = r.card_id
        where {string.Join(" and ", where)}
        order by r.id desc
        limit ${parameters.Count}
        """, parameters);
      var page = rows.Take(limit).ToList();
      var items = page.Select(r => new
      {
        reportId = RunnerRoutes.Long(r["id"]),
        deckId = r["deck_id"] is null ? (long?)null : RunnerRoutes.Long(r["deck_id"]),
        deckSlug = r["deck_slug"],
        cardId = r["card_id"] is null ? (long?)null : RunnerRoutes.Long(r["card_id"]),
        stableUid = r["stable_uid"],
        question = r["question"],
        reason = r["reason"],
        note = r["note"],
        status = r["status"],
        resolution = r["resolution"],
        resolutionNote = r["resolution_note"],
        clientVersion = r["client_version"],
        createdAt = RunnerRoutes.Timestamp(r["created_at"]),
        resolvedAt = RunnerRoutes.Timestamp(r["resolved_at"]),
      }).ToList();
      var nextCursor = rows.Count > limit ? Drafts.EncodeCursor(RunnerRoutes.Long(page[^1]["id"])) : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/admin/card-reports/:reportId/resolve
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleResolve(LambdaRequest req, Res res, AuthContext auth, string reportIdRaw)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    if (!long.TryParse(reportIdRaw, NumberStyles.None, CultureInfo.InvariantCulture, out var reportId) || reportId <= 0)
    {
      return ReportNotFound(res);
    }

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("VALIDATION_ERROR", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);
      var resolution = AutomationBody.RequiredEnum(body, "resolution", Resolutions);
      var note = TrimmedText(body, "note", MaxNoteLength);

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var rows = await DbUtil.QueryAsync(conn, null, "select deck_id, status from card_reports where id = $1", [reportId]);
      if (rows.Count == 0) return ReportNotFound(res);
      if (!auth.IsSuperAdmin)
      {
        // A report whose deck is gone is triaged by a super_admin only.
        if (rows[0]["deck_id"] is null) return res.Forbidden("No permission for this deck (write)");
        var denied = await Helpers.RequireDeckWrite(conn, auth.UserSub, RunnerRoutes.Long(rows[0]["deck_id"]), auth.IsSuperAdmin, res);
        if (denied is not null) return denied;
      }

      var updated = await DbUtil.ExecuteScalarAsync(conn, null,
        """
        update card_reports set status = 'resolved', resolution = $2, resolution_note = $3::text, resolved_at = now(), resolved_by_sub = $4
        where id = $1 and status = 'open'
        returning id
        """, [reportId, resolution, note, auth.UserSub]);
      if (updated is null) return Helpers.ErrorEnvelope(res, 409, "ALREADY_RESOLVED", "This report is already resolved");

      Log.Event("info", new { tag = "card_reports", outcome = "resolved", reportId, resolution });
      return res.Ok(new { reportId, status = "resolved", resolution });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // status and digest counts
  // ---------------------------------------------------------------------------------------------

  /// <summary>The open reports and the reports created in the last 7 days.</summary>
  public sealed record Counts(long Open, long OpenedLast7d);

  /// <summary>
  /// <c>automation/status</c>'s <c>cardReports</c> and the weekly digest's line. Zeros when migration 037 has not run
  /// (the missing table is expected during the code-first deploy window).
  /// </summary>
  public static async Task<Counts> CountsAsync(NpgsqlConnection conn)
  {
    try
    {
      var row = (await DbUtil.QueryAsync(conn, null,
        """
        select count(*) filter (where status = 'open') as open,
          count(*) filter (where created_at >= now() - interval '7 days') as opened_7d
        from card_reports
        """, []))[0];
      return new Counts(RunnerRoutes.Long(row["open"]), RunnerRoutes.Long(row["opened_7d"]));
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      Log.Event("info", new { tag = "card_reports", reason = "not_migrated" });
      return new Counts(0, 0);
    }
  }

  /// <summary>The reports created in [<paramref name="start"/>, <paramref name="end"/>); zero before migration 037.</summary>
  public static async Task<long> CreatedBetweenAsync(NpgsqlConnection conn, DateTime start, DateTime end)
  {
    try
    {
      return RunnerRoutes.Long(await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from card_reports where created_at >= $1 and created_at < $2", [start, end]));
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      Log.Event("info", new { tag = "card_reports", reason = "not_migrated" });
      return 0;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------

  private static int Limit(LambdaRequest req)
  {
    var limit = DefaultListLimit;
    if (req.Query.TryGetValue("limit", out var lim) && !string.IsNullOrEmpty(lim))
    {
      if (!int.TryParse(lim, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > MaxListLimit)
      {
        throw new ValidationError($"limit must be an integer in 1..{MaxListLimit}", "limit");
      }
    }
    return limit;
  }

  private static APIGatewayProxyResponse Disabled(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "CARD_REPORTS_DISABLED", "Card reports are turned off");

  private static APIGatewayProxyResponse ReportNotFound(Res res) =>
    Helpers.ErrorEnvelope(res, 404, "REPORT_NOT_FOUND", "Report not found");

  internal static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "NOT_READY", "Run the database migration (037_card_reports)");

  private static APIGatewayProxyResponse HandleError(Exception ex, Res res)
  {
    switch (ex)
    {
      case ValidationError:
        return res.BadRequest("VALIDATION_ERROR", ex.Message);
      case PostgresException { SqlState: "42P01" or "42703" }:
        return NotReady(res);
    }
    var handled = Helpers.HandlePgError(ex, res);
    if (handled is not null) return handled;
    return res.Error500(ex);
  }
}
