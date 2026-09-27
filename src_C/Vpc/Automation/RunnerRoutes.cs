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

  /// <summary>
  /// The error prefix of a run the runner could not do at all (R18D M5): claude could not start, ran off the
  /// subscription, the MCP server did not start, or a usage limit. The item goes back to <c>queued</c> without using an
  /// attempt, and one <c>runner_unavailable</c> email per UTC day tells the owner.
  /// </summary>
  public const string RunnerUnavailablePrefix = "RUNNER_UNAVAILABLE:";

  /// <summary>
  /// The error of an item whose runs the runner could not do <see cref="MaxRunnerUnavailableCompletes"/> times in a row
  /// (R18E N3, automation-31): the item is not requeued again but failed for a person, so one misclassified item never
  /// loops at the head of the queue.
  /// </summary>
  public const string RunnerUnavailableRepeated = "RUNNER_UNAVAILABLE_REPEATED";

  /// <summary>
  /// The <c>last_error</c> prefix of an item whose run stopped with <c>RUNNER_UNAVAILABLE</c> after it had submitted drafts
  /// (R18F F01, ai-agent-23): the item is finished as <c>done</c> with its attempt kept, not refunded and requeued, because
  /// the next run would author the same page again next to the pending drafts it cannot see.
  /// </summary>
  public const string RunnerUnavailableAfterDrafts = "RUNNER_UNAVAILABLE_AFTER_DRAFTS";

  /// <summary>
  /// The <c>last_error</c> prefix of an item whose run failed in another way (a timeout, an exit, a lease expiry) after it
  /// had submitted drafts (R18G, backend-design-25): the same rule as <see cref="RunnerUnavailableAfterDrafts"/>, the item
  /// is finished as <c>done</c> with its attempt kept instead of requeued for re-authoring.
  /// </summary>
  public const string RunFailedAfterDrafts = "RUN_FAILED_AFTER_DRAFTS";

  /// <summary>Whether <paramref name="lastError"/> is that of an item finished after its run submitted drafts (R18G P2).</summary>
  internal static bool IsFinishedAfterDrafts(string? lastError) =>
    lastError is not null && (lastError.StartsWith(RunnerUnavailableAfterDrafts, StringComparison.Ordinal) ||
                              lastError.StartsWith(RunFailedAfterDrafts, StringComparison.Ordinal));

  /// <summary>From this many consecutive <c>RUNNER_UNAVAILABLE</c> completes of one item on, the item fails (N3).</summary>
  public const int MaxRunnerUnavailableCompletes = 3;

  /// <summary>The first <c>RUNNER_UNAVAILABLE</c> backoff; it doubles with every consecutive one, up to a day (N3).</summary>
  public const int RunnerUnavailableBackoffMinutes = 15;
  public const int MaxRunnerUnavailableBackoffMinutes = 24 * 60;

  /// <summary>
  /// The error prefix of a run whose agent said it could not do the task (R18C L6, written by the runner as
  /// <c>AGENT_BLOCKED: &lt;reason&gt;</c>). Retrying repeats the block, so the item fails on the first such run and a
  /// person resolves it (R18D M5, automation-27): one <c>queue_item_failed</c> email carries the reason.
  /// </summary>
  public const string AgentBlockedPrefix = "AGENT_BLOCKED";

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
          // A kept complete replayed after the tick abandoned the run on lease expiry (automation-16): the runner's
          // notes and error are still worth keeping. Only they are stored; the run, its item and the item's attempts
          // stay as the lease expiry left them, and the tick's agent_note step mails notes of a run without drafts.
          if ((string)run["status"]! == "abandoned" && run["outcome"] is null)
          {
            await DbUtil.ExecuteAsync(conn, tx,
              "update automation_runs set error = coalesce($2, error), summary = coalesce($3, summary), updated_at = now() where run_id = $1",
              [runId, error, summary]);
            var abandonedItem = await DbUtil.ExecuteScalarAsync(conn, tx, "select status from authoring_queue_items where id = $1", [itemId]);
            await tx.CommitAsync();
            Log.Event("info", new { tag = "automation", reason = "abandoned_run_complete_kept", runId, itemId, outcome });
            await AutomationRuns.TryFinalizeAsync(conn, runId);
            return res.Ok(await CompleteResponseAsync(conn, runId, "abandoned", (string)abandonedItem!, replayed: true));
          }
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
          var runnerUnavailable = outcome == "failed" && IsRunnerUnavailable(error);
          var agentBlocked = outcome == "failed" && !runnerUnavailable && IsAgentBlocked(error);
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
          else if (runnerUnavailable && await RunSubmittedDraftsAsync(conn, tx, runId))
          {
            // The run got as far as submit_draft before it stopped (a usage limit mid-run, R18F F01 ai-agent-23): its
            // drafts are finalised with the run and reviewed, and the item is done with the attempt kept. A requeue would
            // author the page again, and find_similar_cards sees only live cards, not these pending drafts.
            itemStatus = "done";
            await DbUtil.ExecuteAsync(conn, tx,
              """
              update authoring_queue_items
              set status = 'done', lease_expires_at = null, finished_at = now(), last_error = $2, updated_at = now()
              where id = $1
              """, [itemId, RunnerUnavailableAfterDraftsError(error)]);
          }
          else if (runnerUnavailable)
          {
            // Not the item's failure: the claim's attempt is given back (R18D M5). The item waits 15 min × 2^(n-1), at
            // most a day, n = the item's consecutive RUNNER_UNAVAILABLE completes including this one, so the items
            // behind it run; at n >= 3 it fails for a person instead (R18E N3, automation-31). Only a run that submitted
            // no draft gets here (R18F F01).
            var n = await ConsecutiveRunnerUnavailableAsync(conn, tx, itemId);
            if (n >= MaxRunnerUnavailableCompletes)
            {
              itemStatus = "failed";
              await DbUtil.ExecuteAsync(conn, tx,
                """
                update authoring_queue_items
                set status = 'failed', lease_expires_at = null, attempts = greatest(attempts - 1, 0), finished_at = now(), last_error = $2,
                    updated_at = now()
                where id = $1
                """, [itemId, RunnerUnavailableRepeatedError(n, error)]);
            }
            else
            {
              itemStatus = "queued";
              await DbUtil.ExecuteAsync(conn, tx,
                """
                update authoring_queue_items
                set status = 'queued', lease_expires_at = null, attempts = greatest(attempts - 1, 0),
                    not_before = now() + make_interval(mins => $3), last_error = $2, updated_at = now()
                where id = $1
                """, [itemId, error, RunnerUnavailableBackoff(n)]);
            }
          }
          else if (!agentBlocked && attempts < MaxItemAttempts && await RunSubmittedDraftsAsync(conn, tx, runId))
          {
            // A retryable failure (a timeout) after submit_draft (R18G backend-design-25): the same rule as above, a
            // retry would author the page again next to the pending drafts it cannot see.
            itemStatus = "done";
            await DbUtil.ExecuteAsync(conn, tx,
              """
              update authoring_queue_items
              set status = 'done', lease_expires_at = null, finished_at = now(), last_error = $2, updated_at = now()
              where id = $1
              """, [itemId, RunFailedAfterDraftsError(error)]);
          }
          else if (!agentBlocked && attempts < MaxItemAttempts)
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
  /// The error prefixes of a failed run a person has to act on whatever the retries do (R18C L6): the agent said it
  /// could not do the task (<c>AGENT_BLOCKED</c>, written by the runner), or the runner's Claude could not start or ran
  /// off the subscription login (a Mac or login configuration problem that every retry would repeat).
  /// </summary>
  public static readonly IReadOnlyList<string> ActionableRunErrorPrefixes =
    ["AGENT_BLOCKED", "claude could not be started", "claude did not run on the subscription login"];

  /// <summary>The N3 backoff in minutes after the <paramref name="n"/>-th consecutive RUNNER_UNAVAILABLE complete (n &gt;= 1).</summary>
  internal static int RunnerUnavailableBackoff(int n) =>
    (int)Math.Min((long)RunnerUnavailableBackoffMinutes << Math.Clamp(n - 1, 0, 20), MaxRunnerUnavailableBackoffMinutes);

  /// <summary>The <c>last_error</c> of an item failed by N3: the repeated reason first, then the last run's error, capped at 500.</summary>
  internal static string RunnerUnavailableRepeatedError(int n, string? error)
  {
    var text = $"{RunnerUnavailableRepeated}: {n.ToString(CultureInfo.InvariantCulture)} runs in a row could not run; last: {error}";
    return text.Length <= 500 ? text : text[..500];
  }

  /// <summary>The <c>last_error</c> of an item finished after its run submitted drafts (F01): the reason first, capped at 500.</summary>
  internal static string RunnerUnavailableAfterDraftsError(string? error)
  {
    var text = $"{RunnerUnavailableAfterDrafts}: the run submitted draft(s) before it stopped, so the item is not authored again; last: {error}";
    return text.Length <= 500 ? text : text[..500];
  }

  /// <summary>The <c>last_error</c> of an item finished after its failed run submitted drafts (R18G): the reason first, capped at 500.</summary>
  internal static string RunFailedAfterDraftsError(string? error)
  {
    var text = $"{RunFailedAfterDrafts}: the run submitted draft(s) before it failed, so the item is not authored again; last: {error}";
    return text.Length <= 500 ? text : text[..500];
  }

  /// <summary>
  /// Whether the run submitted at least one draft: an <c>ai_drafts</c> row whose <c>agent.runId</c> names it, submitted by
  /// the run's owner (the join <see cref="DraftDecisions"/> uses for a run's drafts).
  /// </summary>
  internal static async Task<bool> RunSubmittedDraftsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid runId) =>
    await DbUtil.ExecuteScalarAsync(conn, tx,
      """
      select 1 from ai_drafts a
      join automation_runs r on r.run_id::text = lower(a.agent->>'runId') and r.owner_sub = a.submitted_by_sub
      where r.run_id = $1
      limit 1
      """, [runId]) is not null;

  /// <summary>
  /// How many of the item's newest terminal runs, newest first and up to <see cref="MaxRunnerUnavailableCompletes"/>, are
  /// RUNNER_UNAVAILABLE completes without a break (N3). Called after the current run's row was updated, so it counts it.
  /// </summary>
  private static async Task<int> ConsecutiveRunnerUnavailableAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long itemId)
  {
    var runs = await DbUtil.QueryAsync(conn, tx,
      """
      select outcome, error from automation_runs
      where queue_item_id = $1 and status <> 'running'
      order by started_at desc, run_id desc
      limit $2
      """, [itemId, MaxRunnerUnavailableCompletes]);
    return runs.TakeWhile(r => r["outcome"] as string == "failed" && IsRunnerUnavailable(r["error"] as string)).Count();
  }

  internal static bool IsRunnerUnavailable(string? error) => error?.StartsWith(RunnerUnavailablePrefix, StringComparison.Ordinal) == true;

  internal static bool IsAgentBlocked(string? error) => error?.StartsWith(AgentBlockedPrefix, StringComparison.Ordinal) == true;

  /// <summary>From this many attempts on one queue item a failed run is a repeated failure a person should look at.</summary>
  public const int RepeatedFailureAttempts = 2;

  /// <summary>
  /// Whether a failed run needs the <c>runner_run_failed</c> email (R18C L6, automation-15): not when the item failed
  /// for good (<c>queue_item_failed</c> carries that, also for <c>AGENT_BLOCKED</c>, which fails the item at once), not
  /// for <c>RUNNER_UNAVAILABLE</c> (<c>runner_unavailable</c>), otherwise for an actionable error or a repeated failure of the
  /// item. A first transient failure (a timeout, a lease release) is retried on its own and shows on the Runs tab.
  /// </summary>
  internal static bool RunFailureNeedsHuman(string? error, int itemAttempts, string itemStatus)
  {
    if (itemStatus == "failed") return false;
    // A runner that cannot work at all has its own daily email (runner_unavailable, R18D M5).
    if (IsRunnerUnavailable(error)) return false;
    if (error is { } e && ActionableRunErrorPrefixes.Any(p => e.StartsWith(p, StringComparison.Ordinal))) return true;
    return itemAttempts >= RepeatedFailureAttempts;
  }

  /// <summary>
  /// Runs after a complete commits (never on a replay): <c>runner_unavailable</c> (once per UTC day) for a runner that
  /// could not work, the <c>runner_run_failed</c> exception email for a failed run a
  /// person can act on (<see cref="RunFailureNeedsHuman"/>), <c>queue_item_failed</c> when the item failed for good,
  /// then <see cref="AutomationRuns.TryFinalizeAsync"/> (A00 §6.1, §8.5, §12.4). It never throws: the business commit
  /// already happened.
  /// </summary>
  internal static async Task AfterCompleteAsync(NpgsqlConnection conn, Guid runId, long itemId, string outcome, string itemStatus, CancellationToken ct = default)
  {
    try
    {
      Log.Event("info", new { tag = "automation", reason = "run_completed", runId, itemId, outcome, itemStatus });
      if (outcome == "failed" || itemStatus == "failed")
      {
        var rows = await DbUtil.QueryAsync(conn, null,
          """
          select q.url, q.last_error, q.attempts, r.error, r.runner_id
          from automation_runs r join authoring_queue_items q on q.id = r.queue_item_id
          where r.run_id = $1
          """, [runId]);
        var url = rows.Count == 0 ? string.Empty : (string)rows[0]["url"]!;
        var id = itemId.ToString(CultureInfo.InvariantCulture);
        var runError = rows.Count == 0 ? null : rows[0]["error"] as string;
        var attempts = rows.Count == 0 ? 0 : Convert.ToInt32(rows[0]["attempts"], CultureInfo.InvariantCulture);
        if (outcome == "failed" && IsRunnerUnavailable(runError))
        {
          var utcDate = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
          await Notifications.RaiseExceptionAsync(conn, "runner_unavailable", $"exception:runner_unavailable:{utcDate}",
            new Dictionary<string, string>
            {
              ["runnerId"] = rows.Count == 0 ? string.Empty : rows[0]["runner_id"] as string ?? string.Empty,
              ["runId"] = runId.ToString("D"),
              ["itemId"] = id,
              // The email says the item was put back only when it was (R18G P2): a finished item was not.
              ["itemStatus"] = itemStatus,
              ["error"] = runError ?? string.Empty,
            }, runId, ct);
        }
        if (outcome == "failed" && RunFailureNeedsHuman(runError, attempts, itemStatus))
        {
          await Notifications.RaiseExceptionAsync(conn, "runner_run_failed", $"exception:runner_run_failed:{runId:D}",
            new Dictionary<string, string>
            {
              ["runId"] = runId.ToString("D"),
              ["itemId"] = id,
              ["url"] = url,
              ["error"] = runError ?? string.Empty,
            }, runId, ct);
        }
        var lastError = rows.Count == 0 ? null : rows[0]["last_error"] as string;
        if (outcome == "failed" && itemStatus == "done" && IsFinishedAfterDrafts(lastError))
        {
          await RaiseItemPartialAsync(conn, id, url, lastError!, runId, ct);
        }
        if (itemStatus == "failed")
        {
          await Notifications.RaiseExceptionAsync(conn, "queue_item_failed", $"exception:queue_item_failed:{id}",
            new Dictionary<string, string>
            {
              ["itemId"] = id,
              ["url"] = url,
              ["lastError"] = rows.Count == 0 ? string.Empty : rows[0]["last_error"] as string ?? string.Empty,
            }, runId, ct);
        }
      }
      await AutomationRuns.TryFinalizeAsync(conn, runId, ct);
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "after_complete_failed", runId, error = ex.Message });
      AutomationFailures.Record();
    }
  }

  /// <summary>
  /// The per-item exception of an item finished after its run submitted drafts (R18G P2): the <c>queue_item_failed</c>
  /// subkind's partial variant, deduped per item, telling the owner the page is not authored again and how to re-add it.
  /// </summary>
  internal static Task<NotificationResult?> RaiseItemPartialAsync(NpgsqlConnection conn, string itemId, string url, string lastError,
    Guid? runId, CancellationToken ct = default) =>
    Notifications.RaiseExceptionAsync(conn, "queue_item_failed", $"exception:queue_item_partial:{itemId}",
      new Dictionary<string, string> { ["itemId"] = itemId, ["url"] = url, ["lastError"] = lastError }, runId, ct);

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
    Helpers.ErrorEnvelope(res, 503, "SERVER_NOT_READY_AUTOMATION", "Automation tables are not migrated yet (migration 034)");

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
