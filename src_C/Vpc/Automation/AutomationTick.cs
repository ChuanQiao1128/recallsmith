using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Ledger;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// <c>POST /api/internal/automation/tick</c> (R18A A04, contract A00 §12.6): the housekeeping that keeps the automated
/// flow moving, called by the notifier Lambda every 15 minutes (<c>job: "tick"</c>) and on Monday 08:00 NZ
/// (<c>job: "digest"</c>). The tick steps are single-flight through a session advisory lock (the digest, deduped per
/// day, runs whether or not a tick holds it); effective <c>off</c> does nothing; every
/// step, and every item of a step's loop, checks the time budget first and leaves the rest for the next tick (the tick
/// then lists <see cref="BudgetExhausted"/> in <c>failedSteps</c>). Each step is idempotent, so a crashed or skipped tick
/// is caught up by the next one. A failing step, or a failure a step swallows, emits <c>AutomationStepFailures</c> and
/// is named in the response's <c>failedSteps</c> (R18B K4).
/// </summary>
public static class AutomationTick
{
  /// <summary>"AUTO_TIK".</summary>
  public const long LockKey = 0x4155544F5F54494B;

  /// <summary>The total budget, under the 30 s gateway integration timeout. Internal so a test can shorten it.</summary>
  internal static TimeSpan Budget = TimeSpan.FromSeconds(20);

  public const int MaxLeaseAttempts = 3;
  public const int LeaseRetryMinutes = 30;
  public const int StaleRunHours = 6;
  public const int StepBatch = 50;
  public const int SummaryAfterMinutes = 120;
  public const int NoRunnerQueueHours = 24;

  /// <summary>A runner in <c>error</c> that started no run for this long while items are due is stalled (R18G P1).</summary>
  public const int ErrorRunnerIdleHours = 2;

  /// <summary>
  /// A <c>qa_pending</c> decision untouched for this many draft-QA timeouts (other than one waiting for the daily cap)
  /// keeps failing before its enqueue can even start; it goes to a human with <c>ENQUEUE_FAILED</c> (R18C,
  /// backend-design-10), so its run can finalise.
  /// </summary>
  public const int QaPendingTimeoutFactor = 2;

  /// <summary>The <c>failedSteps</c> entry of a tick that stopped at its budget with work left for the next tick.</summary>
  public const string BudgetExhausted = "budget_exhausted";

  private sealed class Actions
  {
    public bool Digest;
    public int LeasesExpired, QaRetried, QaTimedOut, RunsAbandoned, RunsFinalized, PublishesReconciled, PublishesStarted, Summaries,
      RechecksDone, Alerts, NotificationsResent;

    /// <summary>Re-check runs started for <c>waiting</c> source events: A05's part of step 8, always 0 until then.</summary>
    public int RechecksStarted { get; set; }

    public object ToJson() => new
    {
      digest = Digest,
      leasesExpired = LeasesExpired,
      qaRetried = QaRetried,
      qaTimedOut = QaTimedOut,
      runsAbandoned = RunsAbandoned,
      runsFinalized = RunsFinalized,
      publishesReconciled = PublishesReconciled,
      publishesStarted = PublishesStarted,
      summaries = Summaries,
      rechecksStarted = RechecksStarted,
      rechecksDone = RechecksDone,
      alerts = Alerts,
      notificationsResent = NotificationsResent,
    };
  }

  public static async Task<APIGatewayProxyResponse> HandleTick(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    var v = Auth.VerifyInternalSignatureStrict(req, AutomationEnv.NotifierSecretEnv);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);
      if (!body.TryGetProperty("v", out var ver) || ver.ValueKind != JsonValueKind.Number || !ver.TryGetInt32(out var version) || version != 1)
      {
        throw new ValidationError("v must be 1", "v");
      }
      var tickId = AutomationBody.OptionalUuid(body, "tickId") ?? throw new ValidationError("tickId must be a uuid", "tickId");
      var job = AutomationBody.RequiredEnum(body, "job", ["tick", "digest"]);

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var ready = await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.automation_runs') is not null", []);
      if (ready is not true) return RunnerRoutes.NotReady(res);

      var actions = new Actions();
      var sink = new AutomationFailures.TickSink();
      var mode = await AutomationMode.EffectiveAsync(conn);
      if (mode.LiveBlockedReason == AutomationMode.ServerNotReady) return RunnerRoutes.NotReady(res);
      if (mode.Effective == AutomationMode.Off) return Answer(res, tickId, mode, "off", actions, sink);

      // A digest job whose Monday slot collides with a running tick still sends the digest (R18D
      // cloud-security-resilience-13): the digest is idempotent on its own dedupe key and needs no single-flight, so
      // only the tick steps wait for the lock; the answer still says "locked" for them.
      var locked = await DbUtil.ExecuteScalarAsync(conn, null, "select pg_try_advisory_lock($1)", [LockKey]) is true;
      if (!locked && job != "digest") return Answer(res, tickId, mode, "locked", actions, sink);
      try
      {
        await RunStepsAsync(conn, job, mode, actions, sink, tickSteps: locked);
      }
      finally
      {
        if (locked) await DbUtil.ExecuteAsync(conn, null, "select pg_advisory_unlock($1)", [LockKey]);
      }

      Log.Event(sink.Failed.Count == 0 ? "info" : "warn", new { tag = "automation", outcome = "tick", tickId, job, mode = mode.Effective,
        skipped = locked ? null : "locked", actions = actions.ToJson(), failedSteps = sink.Failed });
      return Answer(res, tickId, mode, locked ? null : "locked", actions, sink);
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  private static APIGatewayProxyResponse Answer(Res res, Guid tickId, EffectiveMode mode, string? skipped, Actions actions,
    AutomationFailures.TickSink sink) =>
    res.Ok(new { tickId, mode = mode.Configured, effectiveMode = mode.Effective, skipped, actions = actions.ToJson(), failedSteps = sink.Failed });

  /// <summary>The digest (job <c>digest</c>), then, when <paramref name="tickSteps"/> (this call holds the tick lock), the tick steps.</summary>
  private static async Task RunStepsAsync(NpgsqlConnection conn, string job, EffectiveMode mode, Actions a, AutomationFailures.TickSink sink,
    bool tickSteps)
  {
    var clock = Stopwatch.StartNew();
    AutomationFailures.Collect(sink);

    // Checked before every step and every item of a step's loop: the rest is left for the next tick.
    bool Spent()
    {
      if (clock.Elapsed < Budget) return false;
      sink.Add(BudgetExhausted);
      return true;
    }

    // One failing step is logged and counted and does not stop the others; each is retried by the next tick.
    async Task Step(string name, Func<Task> body)
    {
      if (Spent()) return;
      sink.Step = name;
      try
      {
        await body();
      }
      catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
      {
        throw;
      }
      catch (Exception ex)
      {
        Log.Event("warn", new { tag = "automation", reason = "tick_step_failed", step = name, error = ex.Message });
        AutomationFailures.Record();
      }
      finally
      {
        sink.Step = string.Empty;
      }
    }

    if (job == "digest") await Step("digest", async () => a.Digest = await DigestAsync(conn, mode.Effective));
    if (!tickSteps) return;
    await Step("leases", () => ExpireLeasesAsync(conn, a, Spent));
    // Before the QA steps and finalisation: a draft whose submit hook was lost gets its decision first.
    await Step("decision_sweep", () => DraftDecisions.SweepMissingAsync(conn, StepBatch, Spent));
    await Step("qa_retry", () => RetryQaAsync(conn, a, Spent));
    await Step("qa_timeout", () => TimeOutQaAsync(conn, a, Spent));
    // Reconcile before finalising: a job that already ended frees its deck before the runs finalised now are evaluated.
    await Step("reconcile", async () => a.PublishesReconciled += await AutoPublisher.ReconcileAsync(conn, StepBatch, stop: Spent));
    await Step("finalize", () => FinalizeRunsAsync(conn, a, Spent));
    await Step("publishes", () => PublishesAsync(conn, a, Spent));
    await Step("summaries", () => SummariesAsync(conn, mode.Effective, a, Spent));
    await Step("source_events", () => SourceEventsAsync(conn, mode.Effective, a, Spent));
    await Step("runner_health", () => RunnerHealthAsync(conn, a, Spent));
    await Step("eval_gate", () => EvalGateAsync(conn, mode, a));
    await Step("live_quality", () => LiveQualityAsync(conn, a));
    await Step("resend", async () => a.NotificationsResent = await Notifications.ResendAsync(conn, StepBatch));
    // R20 V08: once per UTC day, the usage rollups of the last 8 complete days (skips with a log line before 040).
    // R20X F02 (§10.8): deferred to the next tick when less than half the budget remains; statement_timeout inside.
    // R24 A01: the same daily run deletes anonymous funnel rows received more than 400 days ago.
    await Step("analytics_daily", () => Analytics.UsageAnalytics.RunIfDueAsync(conn, Budget - clock.Elapsed, Budget));
  }

  private static string UtcDate() => DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

  private static string Id(object? v) => Convert.ToString(v, CultureInfo.InvariantCulture) ?? string.Empty;

  private static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  // ---------------------------------------------------------------------------------------------
  // step 2 — expired leases
  // ---------------------------------------------------------------------------------------------

  private static async Task ExpireLeasesAsync(NpgsqlConnection conn, Actions a, Func<bool> spent)
  {
    var failed = new List<(long ItemId, string Url, string LastError)>();
    var partial = new List<(long ItemId, string Url, string LastError, Guid RunId)>();
    await using (var tx = await conn.BeginTransactionAsync())
    {
      var items = await DbUtil.QueryAsync(conn, tx,
        """
        select id, url, attempts, last_error, last_run_id from authoring_queue_items
        where status = 'claimed' and lease_expires_at < now()
        order by id
        limit $1
        for update skip locked
        """, [StepBatch]);
      foreach (var item in items)
      {
        if (spent()) break;
        var itemId = Long(item["id"]);
        var leaseRetry = Convert.ToInt32(item["attempts"], CultureInfo.InvariantCulture) < MaxLeaseAttempts;
        if (leaseRetry && item["last_run_id"] is Guid lastRun && await RunnerRoutes.RunSubmittedDraftsAsync(conn, tx, lastRun))
        {
          // The expired run got as far as submit_draft (R18G backend-design-25): the item is done with its attempt kept,
          // not requeued, because a new run would author the page again next to the pending drafts it cannot see.
          var lastError = RunnerRoutes.RunFailedAfterDraftsError("LEASE_EXPIRED");
          await DbUtil.ExecuteAsync(conn, tx,
            """
            update authoring_queue_items
            set status = 'done', lease_expires_at = null, finished_at = now(), last_error = $2, updated_at = now()
            where id = $1
            """, [itemId, lastError]);
          partial.Add((itemId, (string)item["url"]!, lastError, lastRun));
        }
        else if (leaseRetry)
        {
          await DbUtil.ExecuteAsync(conn, tx,
            """
            update authoring_queue_items
            set status = 'queued', lease_expires_at = null, not_before = now() + make_interval(mins => $2), updated_at = now()
            where id = $1
            """, [itemId, LeaseRetryMinutes]);
        }
        else
        {
          await DbUtil.ExecuteAsync(conn, tx,
            """
            update authoring_queue_items
            set status = 'failed', lease_expires_at = null, finished_at = now(), last_error = coalesce(last_error, 'LEASE_EXPIRED'), updated_at = now()
            where id = $1
            """, [itemId]);
          failed.Add((itemId, (string)item["url"]!, item["last_error"] as string ?? "LEASE_EXPIRED"));
        }
        a.RunsAbandoned += await DbUtil.ExecuteAsync(conn, tx,
          "update automation_runs set status = 'abandoned', completed_at = now(), updated_at = now() where queue_item_id = $1 and status = 'running'",
          [itemId]);
        a.LeasesExpired++;
      }
      await tx.CommitAsync();
    }

    foreach (var (itemId, url, lastError, runId) in partial)
    {
      var raised = await RunnerRoutes.RaiseItemPartialAsync(conn, itemId.ToString(CultureInfo.InvariantCulture), url, lastError, runId);
      if (raised?.Created == true) a.Alerts++;
    }
    foreach (var (itemId, url, lastError) in failed)
    {
      var id = itemId.ToString(CultureInfo.InvariantCulture);
      var raised = await Notifications.RaiseExceptionAsync(conn, "queue_item_failed", $"exception:queue_item_failed:{id}",
        new Dictionary<string, string> { ["itemId"] = id, ["url"] = url, ["lastError"] = lastError });
      if (raised?.Created == true) a.Alerts++;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // steps 3–4 — draft QA retries and timeouts
  // ---------------------------------------------------------------------------------------------

  private static async Task RetryQaAsync(NpgsqlConnection conn, Actions a, Func<bool> spent)
  {
    var pending = await DbUtil.QueryAsync(conn, null,
      "select draft_id from automation_draft_decisions where state = 'qa_pending' order by updated_at, draft_id limit $1", [StepBatch]);
    foreach (var row in pending)
    {
      if (spent()) break;
      await DraftDecisions.EnqueueQaAsync(conn, Long(row["draft_id"]));
      a.QaRetried++;
    }
  }

  private static async Task TimeOutQaAsync(NpgsqlConnection conn, Actions a, Func<bool> spent)
  {
    var stale = await DbUtil.QueryAsync(conn, null,
      """
      select draft_id from automation_draft_decisions
      where state = 'qa_queued' and qa_enqueued_at < now() - make_interval(mins => $1)
      order by qa_enqueued_at, draft_id
      limit $2
      """, [AutomationEnv.QaTimeoutMinutes(), StepBatch]);
    foreach (var row in stale)
    {
      if (spent()) break;
      var draftId = Long(row["draft_id"]);
      var mode = await AutomationMode.EffectiveAsync(conn);
      string decisionMode;
      long deckId;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        var locked = await DbUtil.QueryAsync(conn, tx,
          """
          select state, mode, deck_id from automation_draft_decisions
          where draft_id = $1 and state = 'qa_queued' and qa_enqueued_at < now() - make_interval(mins => $2)
          for update
          """, [draftId, AutomationEnv.QaTimeoutMinutes()]);
        if (locked.Count == 0) continue;
        deckId = Long(locked[0]["deck_id"]);
        // The ledger follows the mode this transition applied (R18C backend-design-16).
        decisionMode = await DraftDecisions.TransitionAsync(conn, tx, draftId, DraftDecisions.QaQueued, DraftDecisions.Human, "QA_TIMEOUT", null,
          DraftDecisions.AutomationEventActor, mode.Effective, new { timeoutMinutes = AutomationEnv.QaTimeoutMinutes() }, CancellationToken.None);
        await tx.CommitAsync();
      }
      a.QaTimedOut++;
      if (decisionMode == AutomationMode.Live)
      {
        await AutomationLedger.RecordAsync(conn, DraftDecisions.RouteLedgerEvent(draftId, deckId, "QA_TIMEOUT", null));
      }
    }

    // A qa_pending decision whose enqueue fails on every retry before it can change anything (R18C, backend-design-10):
    // after QaPendingTimeoutFactor draft-QA timeouts without an update it goes to a human, so its run can finalise.
    // A decision waiting for the daily cap is not stuck; it is re-checked on every retry and waits for the next day.
    var pendingMinutes = AutomationEnv.QaTimeoutMinutes() * QaPendingTimeoutFactor;
    var stuck = await DbUtil.QueryAsync(conn, null,
      """
      select draft_id from automation_draft_decisions
      where state = 'qa_pending' and reason is distinct from 'AI_QA_DAILY_CAP' and updated_at < now() - make_interval(mins => $1)
      order by updated_at, draft_id
      limit $2
      """, [pendingMinutes, StepBatch]);
    foreach (var row in stuck)
    {
      if (spent()) break;
      var draftId = Long(row["draft_id"]);
      var mode = await AutomationMode.EffectiveAsync(conn);
      string decisionMode;
      long deckId;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        var locked = await DbUtil.QueryAsync(conn, tx,
          """
          select mode, deck_id from automation_draft_decisions
          where draft_id = $1 and state = 'qa_pending' and reason is distinct from 'AI_QA_DAILY_CAP'
            and updated_at < now() - make_interval(mins => $2)
          for update
          """, [draftId, pendingMinutes]);
        if (locked.Count == 0) continue;
        deckId = Long(locked[0]["deck_id"]);
        decisionMode = await DraftDecisions.TransitionAsync(conn, tx, draftId, DraftDecisions.QaPending, DraftDecisions.Human, "ENQUEUE_FAILED",
          $"draft QA could not be enqueued for {pendingMinutes} minutes", DraftDecisions.AutomationEventActor, mode.Effective,
          new { pendingMinutes }, CancellationToken.None);
        await tx.CommitAsync();
      }
      a.QaTimedOut++;
      Log.Event("warn", new { tag = "automation", outcome = "qa_pending_timed_out", draftId, pendingMinutes });
      if (decisionMode == AutomationMode.Live)
      {
        await AutomationLedger.RecordAsync(conn, DraftDecisions.RouteLedgerEvent(draftId, deckId, "ENQUEUE_FAILED", null));
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // step 5 — stale runs and finalisation
  // ---------------------------------------------------------------------------------------------

  private static async Task FinalizeRunsAsync(NpgsqlConnection conn, Actions a, Func<bool> spent)
  {
    a.RunsAbandoned += await DbUtil.ExecuteAsync(conn, null,
      """
      update automation_runs set status = 'abandoned', completed_at = now(), updated_at = now()
      where status = 'running' and started_at < now() - make_interval(hours => $1)
      """, [StaleRunHours]);

    var open = await DbUtil.QueryAsync(conn, null,
      """
      select run_id from automation_runs
      where finalized_at is null and status in ('completed', 'failed', 'abandoned')
      order by started_at, run_id
      limit $1
      """, [StepBatch]);
    foreach (var row in open)
    {
      if (spent()) break;
      if (await AutomationRuns.TryFinalizeAsync(conn, (Guid)row["run_id"]!)) a.RunsFinalized++;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // step 6 — publishes (the reconcile of publishing rows runs before step 5, then again here for what finalisation started)
  // ---------------------------------------------------------------------------------------------

  private static async Task PublishesAsync(NpgsqlConnection conn, Actions a, Func<bool> spent)
  {
    a.PublishesReconciled += await AutoPublisher.ReconcileAsync(conn, StepBatch, stop: spent);
    var waiting = await DbUtil.QueryAsync(conn, null,
      "select id from automation_publishes where state = 'waiting' order by id limit $1", [StepBatch]);
    foreach (var row in waiting)
    {
      if (spent()) break;
      var outcome = await AutoPublisher.ReevaluateAsync(conn, Long(row["id"]));
      if (outcome?.State == AutoPublisher.Publishing) a.PublishesStarted++;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // step 7 — batch summaries
  // ---------------------------------------------------------------------------------------------

  private static async Task SummariesAsync(NpgsqlConnection conn, string mode, Actions a, Func<bool> spent)
  {
    var runs = await DbUtil.QueryAsync(conn, null,
      """
      select r.run_id
      from automation_runs r
      where r.finalized_at is not null and r.summary_notification_id is null
        and exists (select 1 from automation_draft_decisions d where d.run_id = r.run_id)
        and (r.finalized_at < now() - make_interval(mins => $1)
             or not exists (
               select 1 from automation_publishes p
               where (p.run_id = r.run_id or (p.card_ids || p.deferred_card_ids) && coalesce((select array_agg(d.accepted_card_id) from automation_draft_decisions d
                                                                     where d.run_id = r.run_id and d.accepted_card_id is not null), '{}'))
                 and p.state not in ('published', 'would_publish', 'human')))
      order by r.finalized_at, r.run_id
      limit $2
      """, [SummaryAfterMinutes, StepBatch]);
    foreach (var row in runs)
    {
      if (spent()) break;
      if (await SummaryAsync(conn, (Guid)row["run_id"]!, mode)) a.Summaries++;
    }

    // A finalised run with agent notes and no decisions sends no batch summary, so its notes (the only channel for a
    // wrong existing card) go out as an agent_note exception, one per run (R18B K3).
    var noted = await DbUtil.QueryAsync(conn, null,
      """
      select r.run_id, r.queue_item_id, r.summary, q.url
      from automation_runs r
      join authoring_queue_items q on q.id = r.queue_item_id
      where r.finalized_at is not null and nullif(btrim(r.summary), '') is not null
        and not exists (select 1 from automation_draft_decisions d where d.run_id = r.run_id)
        and not exists (select 1 from automation_notifications n where n.dedupe_key = 'exception:agent_note:' || r.run_id::text)
      order by r.finalized_at, r.run_id
      limit $1
      """, [StepBatch]);
    foreach (var row in noted)
    {
      if (spent()) break;
      var runId = (Guid)row["run_id"]!;
      var raised = await Notifications.RaiseExceptionAsync(conn, "agent_note", $"exception:agent_note:{runId:D}",
        new Dictionary<string, string>
        {
          ["runId"] = runId.ToString("D"),
          ["itemId"] = Long(row["queue_item_id"]).ToString(CultureInfo.InvariantCulture),
          ["url"] = (string)row["url"]!,
          ["notes"] = (string)row["summary"]!,
        }, runId);
      if (raised?.Created == true) a.Alerts++;
    }
  }

  private static async Task<bool> SummaryAsync(NpgsqlConnection conn, Guid runId, string mode)
  {
    try
    {
      var runRows = await DbUtil.QueryAsync(conn, null,
        """
        select r.queue_item_id, r.runner_id, r.deck_id, r.outcome, r.duration_ms, r.summary, d.slug as deck_slug, q.kind, q.url, q.title
        from automation_runs r
        join authoring_queue_items q on q.id = r.queue_item_id
        left join decks d on d.id = r.deck_id
        where r.run_id = $1
        """, [runId]);
      if (runRows.Count == 0) return false;
      var run = runRows[0];

      var decisions = await DbUtil.QueryAsync(conn, null,
        $"""
        select dd.deck_id, dd.state, dd.reason, dd.reason_detail, dd.estimated_cost_usd, a.stable_uid, a.card->>'question' as question,
          not {StatusRoutes.UndecidedDraftSql("dd")} as decided
        from automation_draft_decisions dd
        join ai_drafts a on a.id = dd.draft_id
        where dd.run_id = $1
        order by dd.created_at, dd.draft_id
        """, [runId]);
      var publishes = await DbUtil.QueryAsync(conn, null,
        """
        select p.deck_id, d.slug as deck_slug, p.state, p.reason, p.reason_detail, p.job_id, p.build_id
        from automation_publishes p
        left join decks d on d.id = p.deck_id
        where p.run_id = $1 or (p.card_ids || p.deferred_card_ids) && coalesce((select array_agg(x.accepted_card_id) from automation_draft_decisions x
                                                       where x.run_id = $1 and x.accepted_card_id is not null), '{}')
        order by p.id
        """, [runId]);

      var deckSlug = run["deck_slug"] as string ?? "(deleted deck)";
      var data = new BatchSummaryData(runId, run["deck_id"] is null ? null : Long(run["deck_id"]), deckSlug, (string)run["kind"]!,
        (string)run["url"]!, run["title"] as string,
        decisions.Select(d => new BatchDraft((string)d["stable_uid"]!, d["question"] as string ?? string.Empty, (string)d["state"]!,
          d["reason"] as string, d["reason_detail"] as string, Long(d["deck_id"]), d["decided"] is true)).ToList(),
        decisions.Sum(d => Convert.ToDecimal(d["estimated_cost_usd"], CultureInfo.InvariantCulture)),
        publishes.Select(p => new BatchPublish(Long(p["deck_id"]), p["deck_slug"] as string ?? "(deleted deck)", (string)p["state"]!,
          p["reason"] as string, p["reason_detail"] as string, p["job_id"] as string, p["build_id"] as string)).ToList(),
        (string)run["runner_id"]!, run["duration_ms"] is null ? null : Convert.ToInt32(run["duration_ms"], CultureInfo.InvariantCulture),
        run["outcome"] as string, run["summary"] as string);

      var baseUrl = Notifications.ConsoleBaseUrl();
      var consoleUrl = EmailTemplates.AutomationUrl(baseUrl, $"runId={runId:D}");
      var email = EmailTemplates.BatchSummary(mode, data, baseUrl);
      var result = await Notifications.EnqueueAsync(conn,
        new NotificationRequest("batch_summary", null, $"batch:{runId:D}", mode, email, runId, ConsoleUrl: consoleUrl));
      if (result is null) return false;

      await DbUtil.ExecuteAsync(conn, null,
        "update automation_runs set summary_notification_id = $2, updated_at = now() where run_id = $1 and summary_notification_id is null",
        [runId, result.NotificationId]);
      if (!result.Created) return false;

      int CountState(string state) => data.Drafts.Count(d => d.State == state);
      await WebhookEvents.EnqueueAsync(conn, "automation.batch_completed", new
      {
        runId,
        queueItemId = Long(run["queue_item_id"]),
        kind = data.SourceKind,
        url = data.SourceUrl,
        deckId = data.DeckId,
        deckSlug = data.DeckSlug,
        mode,
        counts = new
        {
          submitted = data.Drafts.Count,
          autoAccepted = CountState(DraftDecisions.AutoAccepted),
          wouldAccept = CountState(DraftDecisions.WouldAccept),
          human = CountState(DraftDecisions.Human),
          superseded = CountState(DraftDecisions.Superseded),
        },
        humanReasons = data.Drafts.Where(d => d.State == DraftDecisions.Human && d.Reason is not null)
          .GroupBy(d => d.Reason!, StringComparer.Ordinal).OrderBy(g => g.Key, StringComparer.Ordinal)
          .ToDictionary(g => g.Key, g => g.Count()),
        publishes = data.Publishes.Select(p => new { deckId = p.DeckId, deckSlug = p.DeckSlug, state = p.State, reason = p.Reason, jobId = p.JobId, buildId = p.BuildId }).ToArray(),
        consoleUrl,
      });
      return true;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "batch_summary_failed", runId, error = ex.Message });
      AutomationFailures.Record();
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // step 8 — source events (A05 adds the retry of waiting events here)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Step 8: a <c>started</c> event becomes <c>done</c> once every re-check run is <c>done</c>/<c>failed</c>; a
  /// <c>done</c>/<c>unavailable</c> event without a notification gets its <c>source_changed</c> email. A05 extends this
  /// step with the retry of <c>waiting</c> events (<c>rechecksStarted</c>, and <c>unavailable</c> after 24 h).
  /// </summary>
  private static async Task SourceEventsAsync(NpgsqlConnection conn, string mode, Actions a, Func<bool> spent)
  {
    a.RechecksStarted += await SourceWatchRoutes.RetryWaitingRechecksAsync(conn, 20);

    a.RechecksDone += await DbUtil.ExecuteAsync(conn, null,
      """
      update source_watch_events e set recheck_state = 'done', updated_at = now()
      where e.recheck_state = 'started'
        and (select count(*) from ai_qa_runs r where r.id = any(e.recheck_run_ids) and r.status in ('done', 'failed'))
            = cardinality(e.recheck_run_ids)
      """, []);

    var events = await DbUtil.QueryAsync(conn, null,
      """
      select e.id, e.target_id, e.kind, e.recheck_state, e.recheck_run_ids, e.details::text as details, t.url
      from source_watch_events e
      join source_watch_targets t on t.id = e.target_id
      where e.recheck_state in ('done', 'unavailable') and e.notification_id is null
      order by e.id
      limit $1
      """, [StepBatch]);
    foreach (var ev in events)
    {
      if (spent()) break;
      if (await SourceChangedAsync(conn, ev, mode)) a.Summaries++;
    }
  }

  private static async Task<bool> SourceChangedAsync(NpgsqlConnection conn, Dictionary<string, object?> ev, string mode)
  {
    var eventId = Long(ev["id"]);
    try
    {
      var runIds = ev["recheck_run_ids"] as Guid[] ?? [];
      var runs = await DbUtil.QueryAsync(conn, null,
        """
        select r.id, r.deck_id, r.card_count, d.slug from ai_qa_runs r left join decks d on d.id = r.deck_id
        where r.id = any($1) order by r.deck_id, r.created_at, r.id
        """, [runIds]);
      var flagged = await DbUtil.QueryAsync(conn, null,
        """
        select f.run_id, f.card_id, c.stable_uid, min(case f.severity when 'blocker' then 0 else 1 end) as rank
        from ai_qa_findings f join cards c on c.id = f.card_id
        where f.run_id = any($1) and f.severity in ('blocker', 'major') and f.resolution = 'open'
        group by f.run_id, f.card_id, c.stable_uid
        order by f.card_id
        """, [runIds]);
      var decks = runs.GroupBy(r => Long(r["deck_id"])).Select(g =>
      {
        var ids = g.Select(r => (Guid)r["id"]!).ToList();
        var cards = flagged.Where(f => ids.Contains((Guid)f["run_id"]!))
          .GroupBy(f => Long(f["card_id"]))
          .Select(f => new SourceFlaggedCard(f.Key, (string)f.First()["stable_uid"]!, f.Min(x => Convert.ToInt32(x["rank"], CultureInfo.InvariantCulture)) == 0 ? "blocker" : "major"))
          .ToList();
        return new SourceDeck(g.Key, g.First()["slug"] as string ?? "(deleted deck)", ids,
          g.Sum(r => Convert.ToInt32(r["card_count"], CultureInfo.InvariantCulture)), cards);
      }).ToList();

      var missing = new List<long>();
      var affected = new List<AffectedCard>();
      var needsHumanReview = false;
      if (ev["details"] is string detailsJson)
      {
        using var details = JsonDocument.Parse(detailsJson);
        affected = ChangeImpact.ParseAffected(details.RootElement);
        needsHumanReview = ChangeImpact.ParseNeedsHumanReview(details.RootElement);
        if (details.RootElement.ValueKind == JsonValueKind.Object &&
            details.RootElement.TryGetProperty("missingQuoteCardIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
        {
          missing.AddRange(ids.EnumerateArray().Where(i => i.ValueKind == JsonValueKind.Number && i.TryGetInt64(out _)).Select(i => i.GetInt64()));
        }
      }
      var queueItems = await DbUtil.QueryAsync(conn, null,
        "select id from authoring_queue_items where source_event_id = $1 order by id", [eventId]);

      var data = new SourceChangedData(eventId, Long(ev["target_id"]), (string)ev["url"]!, (string)ev["kind"]!, (string)ev["recheck_state"]!,
        decks, missing, queueItems.Select(q => Long(q["id"])).ToList(), affected, needsHumanReview);
      var baseUrl = Notifications.ConsoleBaseUrl();
      var email = EmailTemplates.SourceChanged(mode, data, baseUrl);
      var result = await Notifications.EnqueueAsync(conn, new NotificationRequest("source_changed", null,
        $"source:{eventId.ToString(CultureInfo.InvariantCulture)}", mode, email,
        ConsoleUrl: EmailTemplates.AutomationUrl(baseUrl, $"tab=watch&targetId={data.TargetId.ToString(CultureInfo.InvariantCulture)}")));
      if (result is null) return false;
      await DbUtil.ExecuteAsync(conn, null,
        "update source_watch_events set notification_id = $2, updated_at = now() where id = $1 and notification_id is null",
        [eventId, result.NotificationId]);
      return result.Created;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "source_changed_failed", eventId, error = ex.Message });
      AutomationFailures.Record();
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // steps 9–10 — runner health and the eval gate
  // ---------------------------------------------------------------------------------------------

  private static async Task RunnerHealthAsync(NpgsqlConnection conn, Actions a, Func<bool> spent)
  {
    var date = UtcDate();
    var queued = Long(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from authoring_queue_items where status = 'queued'", []));
    var runners = await DbUtil.QueryAsync(conn, null,
      """
      select runner_id, last_heartbeat_at, login_expires_at, last_run_id, last_run_at, state, last_error,
        last_heartbeat_at < now() - make_interval(mins => $1) as stale,
        login_expires_at is not null and login_expires_at - now() <= make_interval(days => $2) as login_expiring,
        greatest(0, floor(extract(epoch from (login_expires_at - now())) / 86400))::int as login_days,
        (select count(*) from authoring_queue_items q where q.status = 'queued' and q.not_before <= now()) as due,
        exists (select 1 from automation_runs r
                where r.runner_id = automation_runners.runner_id and r.started_at > now() - make_interval(hours => $3)) as ran_recently
      from automation_runners
      order by runner_id
      """, [AutomationEnv.RunnerStaleMinutes(), AutomationEnv.LoginWarnDays(), ErrorRunnerIdleHours]);

    async Task Raise(string subkind, string dedupeKey, Dictionary<string, string> facts)
    {
      var raised = await Notifications.RaiseExceptionAsync(conn, subkind, dedupeKey, facts);
      if (raised?.Created == true) a.Alerts++;
    }

    if (runners.Count == 0)
    {
      var oldest = await DbUtil.ExecuteScalarAsync(conn, null,
        "select min(created_at) from authoring_queue_items where status = 'queued' and created_at < now() - make_interval(hours => $1)",
        [NoRunnerQueueHours]);
      if (oldest is not null and not DBNull)
      {
        await Raise("runner_stalled", $"exception:runner_stalled:none:{date}", new Dictionary<string, string>
        {
          ["runnerId"] = "none",
          ["since"] = RunnerRoutes.Timestamp(oldest) ?? "never",
          ["loginExpiresAt"] = "unknown",
          ["lastRunId"] = "none",
          ["lastRunAt"] = "never",
          ["queued"] = queued.ToString(CultureInfo.InvariantCulture),
        });
      }
      return;
    }

    foreach (var r in runners)
    {
      if (spent()) break;
      var runnerId = (string)r["runner_id"]!;
      if (r["stale"] is true)
      {
        await Raise("runner_stalled", $"exception:runner_stalled:{runnerId}:{date}", new Dictionary<string, string>
        {
          ["runnerId"] = runnerId,
          ["since"] = RunnerRoutes.Timestamp(r["last_heartbeat_at"]) ?? "unknown",
          ["loginExpiresAt"] = RunnerRoutes.Timestamp(r["login_expires_at"]) ?? "unknown",
          ["lastRunId"] = r["last_run_id"] is Guid g ? g.ToString("D") : "none",
          ["lastRunAt"] = RunnerRoutes.Timestamp(r["last_run_at"]) ?? "never",
          ["queued"] = queued.ToString(CultureInfo.InvariantCulture),
        });
      }
      else if (IsStalledInError(r["state"] as string, r["last_error"] as string, Long(r["due"]), r["ran_recently"] is true))
      {
        // Alive but unable to work (R18G P1, automation-37): the runner heartbeats 'error' every hour, e.g. on an
        // author_config_error, and claims nothing, so no run, complete or batch summary can raise anything else.
        await Raise("runner_stalled", $"exception:runner_stalled:{runnerId}:error:{date}", new Dictionary<string, string>
        {
          ["runnerId"] = runnerId,
          ["state"] = "error",
          ["lastError"] = r["last_error"] as string ?? string.Empty,
          ["since"] = RunnerRoutes.Timestamp(r["last_heartbeat_at"]) ?? "unknown",
          ["loginExpiresAt"] = RunnerRoutes.Timestamp(r["login_expires_at"]) ?? "unknown",
          ["lastRunId"] = r["last_run_id"] is Guid lr ? lr.ToString("D") : "none",
          ["lastRunAt"] = RunnerRoutes.Timestamp(r["last_run_at"]) ?? "never",
          ["queued"] = Long(r["due"]).ToString(CultureInfo.InvariantCulture),
        });
      }
      if (r["login_expiring"] is true)
      {
        await Raise("runner_login_expiring", $"exception:runner_login_expiring:{runnerId}:{date}", new Dictionary<string, string>
        {
          ["runnerId"] = runnerId,
          ["days"] = Id(r["login_days"]),
          ["loginExpiresAt"] = RunnerRoutes.Timestamp(r["login_expires_at"]) ?? "unknown",
        });
      }
    }
  }

  /// <summary>
  /// Whether a runner with a fresh heartbeat is stalled in <c>error</c> (R18G P1): its state is <c>error</c> for another
  /// reason than <c>RUNNER_UNAVAILABLE</c> (a usage limit or hold, which its complete already reported as
  /// <c>runner_unavailable</c>), queue items are due, and it started no run in the last <see cref="ErrorRunnerIdleHours"/>.
  /// </summary>
  internal static bool IsStalledInError(string? state, string? lastError, long dueItems, bool ranRecently) =>
    state == "error" && lastError?.StartsWith("RUNNER_UNAVAILABLE", StringComparison.Ordinal) != true && dueItems > 0 && !ranRecently;

  private static async Task EvalGateAsync(NpgsqlConnection conn, EffectiveMode mode, Actions a)
  {
    if (mode.Configured != AutomationMode.Live || mode.Effective != AutomationMode.DryRun) return;
    var raised = await Notifications.RaiseExceptionAsync(conn, "eval_gate_missing", $"exception:eval_gate_missing:{UtcDate()}",
      new Dictionary<string, string>());
    if (raised?.Created == true) a.Alerts++;
  }

  /// <summary>
  /// The live quality alarm (R18D M2, automation-22): <c>live_override_high</c>, once per ISO week, when people deleted
  /// or edited more than 5 % of the cards auto-accepted in the last 30 days, over at least 20 auto-accepts.
  /// </summary>
  private static async Task LiveQualityAsync(NpgsqlConnection conn, Actions a)
  {
    var q = await StatusRoutes.LoadLiveQualityAsync(conn);
    if (!q.OverrideHigh) return;
    var now = DateTime.UtcNow;
    var week = $"{ISOWeek.GetYear(now).ToString(CultureInfo.InvariantCulture)}-W{ISOWeek.GetWeekOfYear(now).ToString("00", CultureInfo.InvariantCulture)}";
    var raised = await Notifications.RaiseExceptionAsync(conn, "live_override_high", $"exception:live_override_high:{week}",
      new Dictionary<string, string>
      {
        ["autoAccepted30d"] = q.AutoAccepted30d.ToString(CultureInfo.InvariantCulture),
        ["deletedByPerson"] = q.DeletedByPerson.ToString(CultureInfo.InvariantCulture),
        ["editedByPerson"] = q.EditedByPerson.ToString(CultureInfo.InvariantCulture),
        ["overrideRate"] = q.OverrideRate!.Value.ToString("0.0000", CultureInfo.InvariantCulture),
      });
    if (raised?.Created == true) a.Alerts++;
  }

  // ---------------------------------------------------------------------------------------------
  // step 1 — the weekly digest
  // ---------------------------------------------------------------------------------------------

  private static async Task<bool> DigestAsync(NpgsqlConnection conn, string mode)
  {
    try
    {
      var today = DateOnly.FromDateTime(DateTime.UtcNow);
      var from = today.AddDays(-7);
      var to = today.AddDays(-1);
      var start = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
      var end = today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

      var ledger = JsonSerializer.SerializeToElement(await LedgerRoutes.ComputeAsync(conn, from, to, "day"));
      var totals = ledger.GetProperty("totals");
      var automations = ledger.GetProperty("automations").EnumerateArray().Select(x => new DigestAutomation(
        x.GetProperty("automation").GetString()!, x.GetProperty("runs").GetInt64(), x.GetProperty("units").GetInt64(),
        x.GetProperty("failures").GetInt64(), x.GetProperty("minutesSaved").GetDecimal())).ToList();

      async Task<Dictionary<string, long>> CountsAsync(string sql)
      {
        var rows = await DbUtil.QueryAsync(conn, null, sql, [start, end]);
        return rows.ToDictionary(r => (string)r["k"]!, r => Long(r["n"]), StringComparer.Ordinal);
      }

      // In dry_run the decisions of a run with a draft still waiting for a person are left out of every per-state and
      // per-reason count and only counted as waiting (R18E N6): on a small run the counts would state each verdict.
      var dry = mode == AutomationMode.DryRun;
      var decided = dry
        ? $"and not exists (select 1 from automation_draft_decisions pd where pd.run_id = dd.run_id and {StatusRoutes.UndecidedDraftSql("pd")})"
        : string.Empty;
      var byState = await CountsAsync(
        $"select dd.state as k, count(*) as n from automation_draft_decisions dd where dd.created_at >= $1 and dd.created_at < $2 {decided} group by dd.state");
      var byReason = await CountsAsync(
        $"""
        select dd.reason as k, count(*) as n from automation_draft_decisions dd
        where dd.created_at >= $1 and dd.created_at < $2 and dd.reason is not null {decided}
        group by dd.reason
        """);
      var blindPending = (await DbUtil.QueryAsync(conn, null,
        $"""
        select count(*) filter (where {StatusRoutes.UndecidedDraftSql("dd")}) as drafts,
          count(distinct dd.run_id) filter (where {StatusRoutes.UndecidedDraftSql("dd")}) as runs
        from automation_draft_decisions dd
        """, []))[0];
      // The same blind rule for the publishes (R18F F01, backend-design-23): a dry-run publish row exists only when a
      // draft of its run would be accepted, so a run with a draft still waiting keeps its publishes out of the counts too.
      var publishDecided = dry
        ? $"and (p.run_id is null or not exists (select 1 from automation_draft_decisions pd where pd.run_id = p.run_id and {StatusRoutes.UndecidedDraftSql("pd")}))"
        : string.Empty;
      var publishesByState = await CountsAsync(
        $"select p.state as k, count(*) as n from automation_publishes p where p.created_at >= $1 and p.created_at < $2 {publishDecided} group by p.state");

      // The status's blind definition (R18D M3): the digest's agreement is accepted unedited over decided blind.
      var shadow = (await DbUtil.QueryAsync(conn, null,
        $"""
        select count(*) filter (where true {decided}) as would_accept,
          count(*) filter (where dd.human_action is not null) as decided,
          count(*) filter (where dd.human_action = 'accepted') as accepted,
          count(*) filter (where dd.human_action = 'edited_accepted') as edited,
          count(*) filter (where dd.human_action = 'rejected') as rejected,
          count(*) filter (where dd.human_action is not null and {StatusRoutes.BlindDecidedSql}) as blind_decided,
          count(*) filter (where dd.human_action = 'accepted' and {StatusRoutes.BlindDecidedSql}) as blind_accepted
        from automation_draft_decisions dd
        where dd.state = 'would_accept' and dd.created_at >= $1 and dd.created_at < $2
        """, [start, end]))[0];
      var liveQuality = await StatusRoutes.LoadLiveQualityAsync(conn);
      var watch = (await DbUtil.QueryAsync(conn, null,
        """
        select count(*) filter (where kind in ('changed', 'gone')) as changes, count(*) filter (where kind = 'failing') as failures
        from source_watch_events where created_at >= $1 and created_at < $2
        """, [start, end]))[0];
      var emails = (await DbUtil.QueryAsync(conn, null,
        """
        select count(*) filter (where status = 'sent') as sent, count(*) filter (where status in ('failed', 'enqueue_failed')) as failed
        from automation_notifications where created_at >= $1 and created_at < $2
        """, [start, end]))[0];
      var runners = await DbUtil.QueryAsync(conn, null,
        "select runner_id, last_heartbeat_at, login_expires_at, state, last_error from automation_runners order by runner_id", []);
      var spend = (await DbUtil.QueryAsync(conn, null,
        """
        select
          coalesce((select sum(estimated_cost_usd) from ai_qa_runs where created_at >= $1 and created_at < $2 and requested_by_sub <> 'automation'), 0) as human,
          coalesce((select sum(estimated_cost_usd) from ai_qa_runs where created_at >= $1 and created_at < $2 and requested_by_sub = 'automation'), 0)
          + coalesce((select sum(estimated_cost_usd) from automation_qa_spend where spent_at >= $1 and spent_at < $2), 0) as automation
        """, [start, end]))[0];
      // The open backlog, whenever it was raised (R18B K7): not the week's rows in state human.
      var backlog = await StatusRoutes.LoadBacklogAsync(conn);
      // The source watch's routine checks earn no ledger units (automation-9); their count is in each row's details.
      var watchChecks = Long(await DbUtil.ExecuteScalarAsync(conn, null,
        """
        select coalesce(sum(case when jsonb_typeof(details -> 'checks') = 'number' then (details ->> 'checks')::bigint else 0 end), 0)
        from automation_events
        where automation = 'source_watch' and occurred_at >= $1 and occurred_at < $2
        """, [start, end]));

      // R20 V05: learner card reports (zeros before migration 037). "New this week" is the digest's own week.
      var reportsOpen = (await Reports.CardReports.CountsAsync(conn)).Open;
      var reportsNew = await Reports.CardReports.CreatedBetweenAsync(conn, start, end);
      // R20 V07: the week's new release-notes items and those with possibly affected cards (zero before migration 039).
      var (feedItemsNew, feedItems) = await ChangeImpact.DigestFeedItemsAsync(conn, start, end);

      static DateTimeOffset Ts(object? v) => v is DateTimeOffset dto ? dto : new(DateTime.SpecifyKind((DateTime)v!, DateTimeKind.Utc));
      var data = new WeeklyDigestData(from, to, totals.GetProperty("hoursSaved").GetDecimal(), totals.GetProperty("minutesSaved").GetDecimal(),
        totals.GetProperty("runs").GetInt64(), totals.GetProperty("units").GetInt64(), totals.GetProperty("defectsCaught").GetInt64(), automations,
        byState, byReason, Long(shadow["would_accept"]), Long(shadow["decided"]), Long(shadow["accepted"]), Long(shadow["edited"]),
        Long(shadow["rejected"]), publishesByState, watchChecks, Long(watch["changes"]), Long(watch["failures"]), Long(emails["sent"]),
        Long(emails["failed"]),
        runners.Select(r => new DigestRunner((string)r["runner_id"]!, Ts(r["last_heartbeat_at"]),
          r["login_expires_at"] is null ? null : Ts(r["login_expires_at"]), (string)r["state"]!, r["last_error"] as string)).ToList(),
        Convert.ToDecimal(spend["human"], CultureInfo.InvariantCulture), Convert.ToDecimal(spend["automation"], CultureInfo.InvariantCulture),
        backlog.HumanPending, backlog.HumanPublishes, Long(shadow["blind_decided"]), Long(shadow["blind_accepted"]),
        new DigestLive(liveQuality.AutoAccepted30d, liveQuality.DeletedByPerson, liveQuality.EditedByPerson, liveQuality.OverrideRate,
          liveQuality.EditedAfterSourceChange),
        Long(blindPending["drafts"]), Long(blindPending["runs"]), reportsOpen, reportsNew, feedItemsNew, feedItems);

      var baseUrl = Notifications.ConsoleBaseUrl();
      var email = EmailTemplates.WeeklyDigest(mode, data, baseUrl);
      var result = await Notifications.EnqueueAsync(conn, new NotificationRequest("weekly_digest", null, $"digest:{UtcDate()}", mode, email,
        ConsoleUrl: EmailTemplates.AutomationUrl(baseUrl)));
      return result?.Created == true;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "weekly_digest_failed", error = ex.Message });
      AutomationFailures.Record();
      return false;
    }
  }
}
