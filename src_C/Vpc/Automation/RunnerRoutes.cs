using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The local authoring runner's three routes (R18A A02, contract A00 §8.5): heartbeat, claim and complete. Only a
/// super_admin token minted for an agent client reaches them (RUNNER; an SPA token of the same pool is 403
/// <see cref="RunnerClientRequired"/>). Claim and complete each run in one transaction: claim locks due queue items
/// with <c>for update skip locked</c>, so two runners never share an item; complete locks the run row, so a run
/// leaves <c>running</c> exactly once and a repeated report with the same outcome replays. Exception emails and run
/// finalisation run after the commit in <see cref="AfterCompleteAsync"/> (A04).
/// </summary>
public static class RunnerRoutes
{
  public const string RunnerClientRequired = "RUNNER_CLIENT_REQUIRED";
  public const int MaxItemAttempts = 3;
  public const int PollAfterSeconds = 3600;
  public const int MaxCardsPerItem = 5;
  public const int MaxClaim = 5;
  public const int DefaultLeaseMinutes = 90;
  public const int MinLeaseMinutes = 15;
  public const int MaxLeaseMinutes = 240;
  public const int RetryBackoffMinutes = 60;

  private static readonly string[] RunnerStates = ["idle", "running", "error", "login_expired"];
  private static readonly string[] Outcomes = ["done", "nothing_new", "failed"];

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/authoring/automation/runner/heartbeat
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleHeartbeat(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = RequireRunner(req, res, auth);
    if (deny is not null) return deny;

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);

      var runnerId = AutomationBody.RunnerId(body);
      var host = AutomationBody.OptionalString(body, "host", 64);
      var runnerVersion = AutomationBody.RequiredString(body, "runnerVersion", 40);
      var claudeVersion = AutomationBody.OptionalString(body, "claudeVersion", 80);
      var state = AutomationBody.RequiredEnum(body, "state", RunnerStates);
      var loginExpiresAt = AutomationBody.OptionalTimestamp(body, "loginExpiresAt");
      var lastRunId = AutomationBody.OptionalUuid(body, "lastRunId");
      var lastRunAt = AutomationBody.OptionalTimestamp(body, "lastRunAt");
      var lastRunOutcome = AutomationBody.OptionalEnum(body, "lastRunOutcome", Outcomes);
      var lastError = AutomationBody.OptionalString(body, "lastError", 500);

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      // One statement: a runner id held by another owner matches the conflict but not the where, so no row returns.
      var upserted = await DbUtil.QueryAsync(conn, null,
        """
        insert into automation_runners (runner_id, owner_sub, host, runner_version, claude_version, state, login_expires_at,
          last_heartbeat_at, last_run_id, last_run_at, last_run_outcome, last_error)
        values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11)
        on conflict (runner_id) do update set
          host = excluded.host,
          runner_version = excluded.runner_version,
          claude_version = excluded.claude_version,
          state = excluded.state,
          login_expires_at = excluded.login_expires_at,
          last_heartbeat_at = now(),
          last_run_id = coalesce(excluded.last_run_id, automation_runners.last_run_id),
          last_run_at = coalesce(excluded.last_run_at, automation_runners.last_run_at),
          last_run_outcome = coalesce(excluded.last_run_outcome, automation_runners.last_run_outcome),
          last_error = excluded.last_error,
          updated_at = now()
        where automation_runners.owner_sub = excluded.owner_sub
        returning runner_id
        """,
        [runnerId, auth.UserSub, host, runnerVersion, claudeVersion, state, loginExpiresAt, lastRunId, lastRunAt, lastRunOutcome, lastError]);
      if (upserted.Count == 0) return RunnerMismatch(res);

      var counts = await DbUtil.QueryAsync(conn, null,
        """
        select
          count(*) filter (where status = 'queued') as queued,
          count(*) filter (where status = 'queued' and not_before <= now() and deck_id is not null) as due
        from authoring_queue_items
        """, []);
      var mode = await AutomationMode.EffectiveAsync(conn);

      return res.Ok(new
      {
        mode = mode.Configured,
        effectiveMode = mode.Effective,
        liveBlockedReason = mode.LiveBlockedReason,
        serverTime = WebhookEvents.FormatTimestamp(DateTimeOffset.UtcNow),
        queue = new { queued = Long(counts[0]["queued"]), due = Long(counts[0]["due"]) },
        pollAfterSeconds = PollAfterSeconds,
      });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/authoring/automation/runner/claim
  // ---------------------------------------------------------------------------------------------

  private sealed record ClaimedItem(long ItemId, Guid RunId, string Kind, string Url, long DeckId, string DeckSlug, string? Title,
    string? SectionHint, string? Note, int Attempts, DateTime LeaseExpiresAt);

  public static async Task<APIGatewayProxyResponse> HandleClaim(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = RequireRunner(req, res, auth);
    if (deny is not null) return deny;

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);

      var runnerId = AutomationBody.RunnerId(body);
      var max = AutomationBody.OptionalInt(body, "max", 1, MaxClaim) ?? 1;
      var leaseMinutes = AutomationBody.OptionalInt(body, "leaseMinutes", MinLeaseMinutes, MaxLeaseMinutes) ?? DefaultLeaseMinutes;

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var mode = await AutomationMode.EffectiveAsync(conn);
      if (mode.LiveBlockedReason == AutomationMode.ServerNotReady) return NotReady(res);
      if (mode.Effective == AutomationMode.Off)
      {
        return res.Ok(new { mode = mode.Configured, effectiveMode = mode.Effective, items = Array.Empty<object>() });
      }

      var claimed = new List<ClaimedItem>();
      await using (var tx = await conn.BeginTransactionAsync())
      {
        // Touch the runner; a first claim without a heartbeat registers it. Another owner's runner id returns no row.
        var touched = await DbUtil.QueryAsync(conn, tx,
          """
          insert into automation_runners (runner_id, owner_sub, state, runner_version, last_heartbeat_at)
          values ($1, $2, 'running', null, now())
          on conflict (runner_id) do update set last_heartbeat_at = now(), updated_at = now()
          where automation_runners.owner_sub = excluded.owner_sub
          returning runner_id
          """, [runnerId, auth.UserSub]);
        if (touched.Count == 0)
        {
          await tx.RollbackAsync();
          return RunnerMismatch(res);
        }

        var due = await DbUtil.QueryAsync(conn, tx,
          """
          select id, kind, url, deck_id, title, section_hint, note
          from authoring_queue_items
          where status = 'queued' and not_before <= now() and deck_id is not null
          order by id
          limit $1
          for update skip locked
          """, [max]);

        var deckIds = due.Select(r => Long(r["deck_id"])).Distinct().ToArray();
        var liveDecks = new Dictionary<long, string>();
        if (deckIds.Length > 0)
        {
          var decks = await DbUtil.QueryAsync(conn, tx, "select id, slug from decks where id = any($1) and is_deleted = 0", [deckIds]);
          foreach (var d in decks) liveDecks[Long(d["id"])] = (string)d["slug"]!;
        }

        foreach (var item in due)
        {
          var itemId = Long(item["id"]);
          var deckId = Long(item["deck_id"]);
          if (!liveDecks.TryGetValue(deckId, out var deckSlug))
          {
            await DbUtil.ExecuteAsync(conn, tx,
              """
              update authoring_queue_items
              set status = 'skipped', last_error = 'DECK_MISSING', finished_at = now(), updated_at = now()
              where id = $1
              """, [itemId]);
            continue;
          }

          var runId = Guid.NewGuid();
          var updated = await DbUtil.QueryAsync(conn, tx,
            """
            update authoring_queue_items
            set status = 'claimed', claimed_by_runner = $2, claimed_at = now(), lease_expires_at = now() + make_interval(mins => $3),
                attempts = attempts + 1, last_run_id = $4, updated_at = now()
            where id = $1
            returning attempts, lease_expires_at
            """, [itemId, runnerId, leaseMinutes, runId]);
          await DbUtil.ExecuteAsync(conn, tx,
            """
            insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status)
            values ($1, $2, $3, $4, $5, 'running')
            """, [runId, itemId, runnerId, auth.UserSub, deckId]);

          claimed.Add(new ClaimedItem(itemId, runId, (string)item["kind"]!, (string)item["url"]!, deckId, deckSlug,
            (string?)item["title"], (string?)item["section_hint"], (string?)item["note"],
            Convert.ToInt32(updated[0]["attempts"], CultureInfo.InvariantCulture), (DateTime)updated[0]["lease_expires_at"]!));
        }

        await tx.CommitAsync();
      }

      var items = claimed.Select(c => new
      {
        itemId = c.ItemId,
        runId = c.RunId,
        kind = c.Kind,
        url = c.Url,
        deckId = c.DeckId,
        deckSlug = c.DeckSlug,
        title = c.Title,
        sectionHint = c.SectionHint,
        note = c.Note,
        attempts = c.Attempts,
        leaseExpiresAt = Timestamp(c.LeaseExpiresAt),
        maxCards = MaxCardsPerItem,
      }).ToList();
      return res.Ok(new { mode = mode.Configured, effectiveMode = mode.Effective, items });
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/v1/authoring/automation/runner/complete
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleComplete(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = RequireRunner(req, res, auth);
    if (deny is not null) return deny;

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);

      var runnerId = AutomationBody.RunnerId(body);
      var runId = AutomationBody.OptionalUuid(body, "runId") ?? throw new ValidationError("runId must be a uuid", "runId");
      var outcome = AutomationBody.RequiredEnum(body, "outcome", Outcomes);
      var exitCode = AutomationBody.OptionalInt(body, "exitCode", int.MinValue, int.MaxValue);
      var durationMs = AutomationBody.OptionalInt(body, "durationMs", 0, int.MaxValue)
        ?? throw new ValidationError("durationMs must be an integer >= 0", "durationMs");
      var numTurns = AutomationBody.OptionalInt(body, "numTurns", int.MinValue, int.MaxValue);
      var error = AutomationBody.OptionalString(body, "error", 500);
      var summary = AutomationBody.OptionalString(body, "summary", 2000);

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      long itemId;
      string runStatus;
      string itemStatus;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        var runs = await DbUtil.QueryAsync(conn, tx,
          "select queue_item_id, runner_id, status, outcome from automation_runs where run_id = $1 for update", [runId]);
        if (runs.Count == 0)
        {
          await tx.RollbackAsync();
          return Helpers.ErrorEnvelope(res, 404, "RUN_NOT_FOUND", "Run not found");
        }
        var run = runs[0];
        if (!string.Equals((string)run["runner_id"]!, runnerId, StringComparison.Ordinal))
        {
          await tx.RollbackAsync();
          return RunnerMismatch(res);
        }
        itemId = Long(run["queue_item_id"]);

        if ((string)run["status"]! != "running")
        {
          if (!string.Equals(run["outcome"] as string, outcome, StringComparison.Ordinal))
          {
            await tx.RollbackAsync();
            return Helpers.ErrorEnvelope(res, 409, "RUN_NOT_RUNNING", "The run already completed with a different outcome");
          }
          var currentItem = await DbUtil.ExecuteScalarAsync(conn, tx, "select status from authoring_queue_items where id = $1", [itemId]);
          await tx.CommitAsync();
          return res.Ok(await CompleteResponseAsync(conn, runId, (string)run["status"]!, (string)currentItem!, replayed: true));
        }

        runStatus = outcome == "failed" ? "failed" : "completed";
        await DbUtil.ExecuteAsync(conn, tx,
          """
          update automation_runs
          set status = $2, outcome = $3, completed_at = now(), exit_code = $4, duration_ms = $5, num_turns = $6,
              error = $7, summary = $8, updated_at = now()
          where run_id = $1
          """, [runId, runStatus, outcome, exitCode, durationMs, numTurns, error, summary]);

        // The item moves only while this run still holds it: a lease expiry may have requeued it for another run.
        var items = await DbUtil.QueryAsync(conn, tx,
          "select status, last_run_id, attempts from authoring_queue_items where id = $1 for update", [itemId]);
        var item = items[0];
        itemStatus = (string)item["status"]!;
        if (itemStatus == "claimed" && item["last_run_id"] is Guid holder && holder == runId)
        {
          var attempts = Convert.ToInt32(item["attempts"], CultureInfo.InvariantCulture);
          if (outcome != "failed")
          {
            itemStatus = "done";
            await DbUtil.ExecuteAsync(conn, tx,
              """
              update authoring_queue_items
              set status = 'done', lease_expires_at = null, finished_at = now(), updated_at = now()
              where id = $1
              """, [itemId]);
          }
          else if (attempts < MaxItemAttempts)
          {
            itemStatus = "queued";
            await DbUtil.ExecuteAsync(conn, tx,
              """
              update authoring_queue_items
              set status = 'queued', lease_expires_at = null, not_before = now() + make_interval(mins => $2), last_error = $3, updated_at = now()
              where id = $1
              """, [itemId, attempts * RetryBackoffMinutes, error]);
          }
          else
          {
            itemStatus = "failed";
            await DbUtil.ExecuteAsync(conn, tx,
              """
              update authoring_queue_items
              set status = 'failed', lease_expires_at = null, finished_at = now(), last_error = $2, updated_at = now()
              where id = $1
              """, [itemId, error]);
          }
        }

        await DbUtil.ExecuteAsync(conn, tx,
          """
          update automation_runners
          set last_run_id = $2, last_run_at = now(), last_run_outcome = $3, last_error = $4, updated_at = now()
          where runner_id = $1
          """, [runnerId, runId, outcome, error]);

        await tx.CommitAsync();
      }

      await AfterCompleteAsync(conn, runId, itemId, outcome, itemStatus);
      return res.Ok(await CompleteResponseAsync(conn, runId, runStatus, itemStatus, replayed: false));
    }
    catch (Exception ex)
    {
      return HandleError(ex, res);
    }
  }

  /// <summary>
  /// Runs after a complete commits (never on a replay). A02 only logs; A04 replaces the body with the
  /// <c>runner_run_failed</c> / <c>queue_item_failed</c> exception emails and <c>AutomationRuns.TryFinalizeAsync</c>
  /// (A00 §6.1, §8.5, §12.4). It never throws: the business commit already happened.
  /// </summary>
  internal static Task AfterCompleteAsync(NpgsqlConnection conn, Guid runId, long itemId, string outcome, string itemStatus, CancellationToken ct = default)
  {
    try
    {
      Log.Event("info", new { tag = "automation", reason = "run_completed", runId, itemId, outcome, itemStatus });
    }
    catch (Exception)
    {
      // Logging is best-effort here; the run is already committed.
    }
    return Task.CompletedTask;
  }

  private static async Task<object> CompleteResponseAsync(NpgsqlConnection conn, Guid runId, string runStatus, string itemStatus, bool replayed)
  {
    var counts = await DbUtil.QueryAsync(conn, null,
      """
      select count(*) as total, count(*) filter (where state in ('qa_pending', 'qa_queued')) as pending
      from automation_draft_decisions where run_id = $1
      """, [runId]);
    return new
    {
      runId,
      runStatus,
      itemStatus,
      decisions = new { total = Long(counts[0]["total"]), pending = Long(counts[0]["pending"]) },
      replayed,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // shared
  // ---------------------------------------------------------------------------------------------

  private static APIGatewayProxyResponse? RequireRunner(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (!auth.IsAgentClient)
    {
      return Helpers.ErrorEnvelope(res, 403, RunnerClientRequired, "The runner routes require the local authoring agent's token");
    }
    if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    return null;
  }

  private static APIGatewayProxyResponse RunnerMismatch(Res res) =>
    Helpers.ErrorEnvelope(res, 403, "RUNNER_MISMATCH", "The runner id belongs to another owner or run");

  internal static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, AutomationMode.ServerNotReady, "Automation tables are not migrated yet (migration 034)");

  internal static APIGatewayProxyResponse HandleError(Exception ex, Res res)
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

  internal static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  internal static string? Timestamp(object? v) => v switch
  {
    DateTime dt => WebhookEvents.FormatTimestamp(new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc))),
    DateTimeOffset dto => WebhookEvents.FormatTimestamp(dto),
    _ => null,
  };
}

/// <summary>Body field readers for the automation routes: a missing key and JSON null both mean "absent".</summary>
internal static class AutomationBody
{
  private static readonly Regex RunnerIdRegex = new("^[a-z0-9][a-z0-9-]{0,63}$", RegexOptions.Compiled);
  private static readonly Regex IsoTimestampRegex = new(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})$", RegexOptions.Compiled);

  public static JsonElement Object(JsonElement root) =>
    root.ValueKind == JsonValueKind.Object ? root : throw new ValidationError("Body must be a JSON object", "body");

  private static JsonElement? Get(JsonElement body, string name) =>
    body.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v : null;

  public static string RunnerId(JsonElement body)
  {
    var v = Get(body, "runnerId");
    var s = v is { ValueKind: JsonValueKind.String } ? v.Value.GetString() : null;
    if (s is null || s.EndsWith('\n') || !RunnerIdRegex.IsMatch(s))
    {
      throw new ValidationError("runnerId must match ^[a-z0-9][a-z0-9-]{0,63}$", "runnerId");
    }
    return s;
  }

  public static string? OptionalString(JsonElement body, string name, int maxLength)
  {
    var v = Get(body, name);
    if (v is null) return null;
    if (v.Value.ValueKind != JsonValueKind.String) throw new ValidationError($"{name} must be a string or null", name);
    var s = v.Value.GetString()!;
    if (s.Length > maxLength) throw new ValidationError($"{name} must be at most {maxLength} characters", name);
    return s;
  }

  public static string RequiredString(JsonElement body, string name, int maxLength)
  {
    var s = OptionalString(body, name, maxLength);
    if (string.IsNullOrWhiteSpace(s)) throw new ValidationError($"{name} is required", name);
    return s;
  }

  public static string? OptionalEnum(JsonElement body, string name, IReadOnlyCollection<string> allowed)
  {
    var v = Get(body, name);
    if (v is null) return null;
    var s = v.Value.ValueKind == JsonValueKind.String ? v.Value.GetString() : null;
    if (s is null || !allowed.Contains(s)) throw new ValidationError($"{name} must be one of {string.Join(", ", allowed)}", name);
    return s;
  }

  public static string RequiredEnum(JsonElement body, string name, IReadOnlyCollection<string> allowed) =>
    OptionalEnum(body, name, allowed) ?? throw new ValidationError($"{name} must be one of {string.Join(", ", allowed)}", name);

  public static int? OptionalInt(JsonElement body, string name, int min, int max)
  {
    var v = Get(body, name);
    if (v is null) return null;
    if (v.Value.ValueKind != JsonValueKind.Number || !v.Value.TryGetInt32(out var n) || n < min || n > max)
    {
      var range = min == int.MinValue && max == int.MaxValue ? "an integer" : max == int.MaxValue ? $"an integer >= {min}" : $"an integer in {min}..{max}";
      throw new ValidationError($"{name} must be {range}", name);
    }
    return n;
  }

  public static long RequiredLong(JsonElement body, string name)
  {
    var v = Get(body, name);
    if (v is not { ValueKind: JsonValueKind.Number } || !v.Value.TryGetInt64(out var n)) throw new ValidationError($"{name} must be an integer", name);
    return n;
  }

  public static DateTimeOffset? OptionalTimestamp(JsonElement body, string name)
  {
    var v = Get(body, name);
    if (v is null) return null;
    var s = v.Value.ValueKind == JsonValueKind.String ? v.Value.GetString() : null;
    if (s is null || !IsoTimestampRegex.IsMatch(s)
        || !DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var ts))
    {
      throw new ValidationError($"{name} must be an ISO-8601 timestamp or null", name);
    }
    return ts.ToUniversalTime();
  }

  public static Guid? OptionalUuid(JsonElement body, string name)
  {
    var v = Get(body, name);
    if (v is null) return null;
    var s = v.Value.ValueKind == JsonValueKind.String ? v.Value.GetString() : null;
    if (s is null || !Guid.TryParseExact(s, "D", out var id)) throw new ValidationError($"{name} must be a uuid or null", name);
    return id;
  }
}
