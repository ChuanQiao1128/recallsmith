using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Models;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Automation fix round 2 (R18C C01, docs/delivery/r18-issues/C01-fixes.md): the never-sent email of a dying process
/// (backend-design-9, automation-17), the K4 signal of every swallowed automation failure and the sweeps that repair
/// what those failures left (backend-design-10, automation-18), the escalation of a stuck auto-publish job
/// (backend-design-14, automation-11), build coverage by the job's recorded card set (backend-design-12) and the deck
/// settings bound to an automation publish (backend-design-11). Tick tests run against their own scratch database, as
/// in <see cref="AutomationTickTests"/>; SQS sends go through the test seams and the Worker runs in-process.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationRound2Tests
{
  private const string ScratchName = "it_c01_tick";
  private readonly PostgresFixture _db;
  private readonly A04Kit.Sql _sql;

  public AutomationRound2Tests(PostgresFixture db)
  {
    _db = db;
    _sql = new A04Kit.Sql(db.ConnectionString);
  }

  private async Task InScratchAsync(A04Kit.Scope scope, Func<A04Kit.Sql, Task> body)
  {
    var connectionString = new NpgsqlConnectionStringBuilder(await _db.CreateScratchDatabaseAsync(ScratchName)) { Pooling = false }.ConnectionString;
    await using (var conn = new NpgsqlConnection(connectionString))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
    }
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", ScratchName);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await body(new A04Kit.Sql(connectionString));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  private static async Task<JsonElement> TickDataAsync() => AutomationTestKit.Data(await A04Kit.TickAsync("tick", Guid.NewGuid()));

  private static int Action(JsonElement data, string name) => data.GetProperty("actions").GetProperty(name).GetInt32();

  private static string[] FailedSteps(JsonElement data) => data.GetProperty("failedSteps").EnumerateArray().Select(e => e.GetString()!).ToArray();

  private static int Int(object? v) => Convert.ToInt32(v, CultureInfo.InvariantCulture);

  /// <summary>A connection that was never opened: every statement on it throws, as a dropped connection would.</summary>
  private NpgsqlConnection Broken() => new(_db.ConnectionString);

  private sealed class CapturingUploader : IS3DeckUploader
  {
    public DeckExportData? Captured;
    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data)
    {
      Captured = data;
      return Task.FromResult(new S3UploadResult());
    }
    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl) => Task.FromResult(new S3UploadResult());
    public Task<string> DownloadJsonAsync(string s3Key) => Task.FromResult("{}");
  }

  private sealed class NoopArtifacts : IContentArtifactsGenerator
  {
    public Task GenerateAsync(JobInfo job, DeckExportData deckData, S3UploadResult deckUpload) => Task.CompletedTask;
  }

  /// <summary>A card auto-accepted through the real submit + draft-QA path.</summary>
  private static async Task<long> AutoAcceptAsync(A04Kit.Sql sql, string sub, long deckId, Guid runId, string question)
  {
    var draftId = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deckId, runId,
      AutomationTestKit.Card(AutomationTestKit.Uid("c01"), question)))[0];
    var job = (await sql.QueryAsync("select state, reason, qa_job_id, qa_content_sha256 from automation_draft_decisions where draft_id = $1", draftId)).Single();
    Assert.True(job["qa_job_id"] is Guid, $"draft not queued for QA: {job["state"]} {job["reason"]}");
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport((Guid)job["qa_job_id"]!, draftId, (string)job["qa_content_sha256"]!)));
    var d = (await sql.QueryAsync("select state, accepted_card_id from automation_draft_decisions where draft_id = $1", draftId)).Single();
    Assert.Equal("auto_accepted", d["state"]);
    return A04Kit.Long(d["accepted_card_id"]);
  }

  private static async Task<bool> CompleteAndFinalizeAsync(A04Kit.Sql sql, Guid runId)
  {
    await sql.QueryAsync("update automation_runs set status = 'completed', outcome = 'done', completed_at = now() where run_id = $1", runId);
    await using var conn = await sql.OpenAsync();
    return await AutomationRuns.TryFinalizeAsync(conn, runId);
  }

  /// <summary>What the Worker's CompleteJobAsync does on success: the job is SUCCESS and the deck's live build is its build.</summary>
  private static async Task WorkerSucceedsAsync(A04Kit.Sql sql, string jobId)
  {
    await sql.QueryAsync("update deck_publishes set status = 'SUCCESS', updated_at = now() where job_id = $1", jobId);
    await sql.QueryAsync("update decks d set live_build_id = p.build_id from deck_publishes p where p.job_id = $1 and d.id = p.deck_id", jobId);
  }

  // =============================================================================================
  // backend-design-9 / automation-17: a row inserted 'queued' whose process died before the send
  // =============================================================================================

  private static Task InsertQueuedAsync(A04Kit.Sql sql, Guid id, string dedupeKey, string age) =>
    sql.QueryAsync(
      $"""
      insert into automation_notifications (notification_id, kind, subkind, dedupe_key, subject, body_text, mode, status, created_at, updated_at)
      values ($1, 'batch_summary', null, $2, '[DeveloperCards] (dry run) synthetic summary', 'Synthetic body.', 'dry_run', 'queued',
              now() - interval '{age}', now() - interval '{age}')
      """, id, dedupeKey);

  [Fact]
  public async Task Tick_NeverSentQueuedNotification_IsSentExactlyOnce()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      // The process died between the insert and the SQS send: queued, 0 attempts, never handed to SQS.
      var lost = Guid.NewGuid();
      await InsertQueuedAsync(sql, lost, "it-c01:lost", $"{Notifications.NeverSentAfterMinutes + 1} minutes");
      // An enqueue that may still be in flight in another process is left to it.
      var fresh = Guid.NewGuid();
      await InsertQueuedAsync(sql, fresh, "it-c01:fresh", "1 minute");

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "notificationsResent"));
      var message = Assert.Single(A04Kit.Messages(scope));
      Assert.Equal(lost, message.GetProperty("notificationId").GetGuid());
      var row = (await sql.QueryAsync("select status, attempts from automation_notifications where notification_id = $1", lost)).Single();
      Assert.Equal(("queued", 1), ((string)row["status"]!, Int(row["attempts"])));
      Assert.Equal(0, Int(await sql.ScalarAsync("select attempts from automation_notifications where notification_id = $1", fresh)));

      // Handed to SQS now: never sent a second time (R18B K6 still holds for it).
      await sql.QueryAsync("update automation_notifications set created_at = now() - interval '3 hours' where notification_id = $1", lost);
      data = await TickDataAsync();
      Assert.Equal(0, Action(data, "notificationsResent"));
      Assert.Single(A04Kit.Messages(scope));
    });
  }

  [Fact]
  public async Task Tick_SummaryDedupedOntoANeverSentRow_IsStillEmailed()
  {
    // The dedupe path returns the existing row as if it had been handled: the resend is what gets the email out.
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      var key = $"it-c01:dedupe:{Guid.NewGuid():N}";
      var lost = Guid.NewGuid();
      await InsertQueuedAsync(sql, lost, key, "20 minutes");
      await using (var conn = await sql.OpenAsync())
      {
        var again = await Notifications.EnqueueAsync(conn, new NotificationRequest("batch_summary", null, key, "dry_run",
          EmailTemplates.BatchSummary("dry_run", EmailTemplatesTests.Batch(), "https://console.example.com")));
        Assert.False(again!.Created);
        Assert.Equal(lost, again.NotificationId);
      }
      Assert.Empty(A04Kit.Messages(scope));

      await TickDataAsync();

      Assert.Equal(lost, Assert.Single(A04Kit.Messages(scope)).GetProperty("notificationId").GetGuid());
    });
  }

  [Fact]
  public async Task Enqueue_Exception_SendsTheEmailBeforeTheWebhook()
  {
    await using var scope = new A04Kit.Scope();
    scope.Set(WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
    var subscriptionId = A04Kit.Long(await _sql.ScalarAsync(
      "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, true) returning id",
      $"it-c01-{Guid.NewGuid():N}"[..20], $"https://hooks.example.com/it-c01/{Guid.NewGuid():N}", new[] { "automation.exception" }));
    var inner = Notifications.TestSendSeam!;
    var webhooksAtSend = -1;
    Notifications.TestSendSeam = r =>
    {
      lock (scope.WebhookSent) webhooksAtSend = scope.WebhookSent.Count;
      return inner(r);
    };
    try
    {
      await using var conn = await _db.OpenAsync();
      var result = await Notifications.RaiseExceptionAsync(conn, "publish_blocked", $"exception:publish_blocked:it-c01-{Guid.NewGuid():N}",
        new Dictionary<string, string> { ["publishId"] = "7", ["deckId"] = "3", ["deckSlug"] = "it-c01", ["reason"] = "AI_QA_BLOCKED" });

      Assert.Equal("queued", result!.Status);
      Assert.Equal(0, webhooksAtSend);
      Assert.Contains(scope.WebhookSent, r => r.QueueUrl == AutomationTestKit.FakeWebhookQueueUrl);
    }
    finally
    {
      await _sql.QueryAsync("update webhook_subscriptions set is_active = false where id = $1", subscriptionId);
    }
  }

  // =============================================================================================
  // backend-design-10 / automation-18: every swallowed automation failure emits AutomationStepFailures
  // =============================================================================================

  private static double StepFailures(string stdout) => EmfCapture.GaugeSum(stdout, AutomationFailures.StepFailuresMetric);

  [Fact]
  public async Task SwallowedFailures_EachEmitAutomationStepFailures()
  {
    await using var scope = new A04Kit.Scope();
    var agentJson = JsonSerializer.Serialize(new { runId = Guid.NewGuid() });
    var auth = AutomationTestKit.Ctx(AutomationTestKit.Sub("k4"));

    await using (var conn = Broken())
    {
      Assert.Equal(1, StepFailures(await EmfCapture.StdoutAsync(() =>
        DraftDecisions.OnSubmittedAsync(conn, auth, 1, "it-c01", agentJson, [1]))));
      Assert.Equal(1, StepFailures(await EmfCapture.StdoutAsync(async () =>
        Assert.Equal("unknown", await DraftDecisions.EnqueueQaAsync(conn, 1)))));
      Assert.Equal(1, StepFailures(await EmfCapture.StdoutAsync(() =>
        DraftDecisions.OnHumanDecisionAsync(conn, 1, "accepted", null, auth.UserSub))));
      Assert.Equal(1, StepFailures(await EmfCapture.StdoutAsync(async () =>
        Assert.Null(await Notifications.EnqueueAsync(conn, new NotificationRequest("batch_summary", null, "it-c01:k4", "dry_run",
          EmailTemplates.BatchSummary("dry_run", EmailTemplatesTests.Batch(), "https://console.example.com")))))));
      Assert.Equal(1, StepFailures(await EmfCapture.StdoutAsync(async () =>
        Assert.Null(await Notifications.RaiseExceptionAsync(conn, "publish_blocked", "it-c01:k4-raise", new Dictionary<string, string>())))));
      Assert.Equal(1, StepFailures(await EmfCapture.StdoutAsync(() =>
        RunnerRoutes.AfterCompleteAsync(conn, Guid.NewGuid(), 1, "failed", "failed"))));
    }

    // The schema_not_ready branches stay as they were: a missing table is not a failure of a running automation.
    await using (var conn = await _db.OpenAsync())
    {
      Assert.Equal(0, StepFailures(await EmfCapture.StdoutAsync(() =>
        DraftDecisions.OnHumanDecisionAsync(conn, long.MaxValue, "accepted", null, auth.UserSub))));
    }
  }

  [Fact]
  public async Task Tick_DraftWhoseSubmitHookWasLost_GetsItsDecisionFromTheSweep()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Off);
    await InScratchAsync(scope, async sql =>
    {
      var sub = AutomationTestKit.Sub("sweep");
      var deck = await A04Kit.PublishedDeckAsync(sql, "sweep");
      var running = await A04Kit.RunAsync(sql, sub, deck.Id);
      var ended = await A04Kit.RunAsync(sql, sub, deck.Id, "completed");

      // The submit commits, but its decision hook never ran (effective off at submit time stands in for a crash).
      var lost = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, running,
        AutomationTestKit.Card(AutomationTestKit.Uid("sweep"), "Which synthetic harbour crane lifts the heaviest load?")))[0];
      var lostOfEndedRun = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, ended,
        AutomationTestKit.Card(AutomationTestKit.Uid("sweep"), "What does a synthetic dredger remove from a channel?")))[0];
      var recent = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, running,
        AutomationTestKit.Card(AutomationTestKit.Uid("sweep"), "How does a synthetic breakwater calm a bay?")))[0];
      var otherSubmitter = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(AutomationTestKit.Sub("other")), deck.Id, running,
        AutomationTestKit.Card(AutomationTestKit.Uid("sweep"), "Why does a synthetic buoy carry a bell?")))[0];
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_draft_decisions"));
      await sql.QueryAsync("update ai_drafts set created_at = now() - make_interval(mins => $2) where id = any($1)",
        new[] { lost, lostOfEndedRun, otherSubmitter }, DraftDecisions.MissingDecisionGraceMinutes + 1);
      scope.Set(AutomationMode.EnvName, AutomationMode.DryRun);

      var data = await TickDataAsync();

      // The running run's draft goes through the normal prechecks and is queued for draft QA.
      var d = (await sql.QueryAsync("select run_id, state, reason from automation_draft_decisions where draft_id = $1", lost)).Single();
      Assert.Equal((running, "qa_queued"), ((Guid)d["run_id"]!, (string)d["state"]!));
      Assert.Contains(scope.QaSent, r => r.MessageBody.Contains($"\"cardId\":{lost}", StringComparison.Ordinal));
      // A run that already ended never decides late automatically.
      var late = (await sql.QueryAsync("select state, reason from automation_draft_decisions where draft_id = $1", lostOfEndedRun)).Single();
      Assert.Equal(("human", "RUN_NOT_RUNNING"), ((string)late["state"]!, (string)late["reason"]!));
      Assert.Equal(1, await sql.CountAsync("select count(*) from automation_decision_events where draft_id = $1 and from_state is null", lostOfEndedRun));
      // Within the grace period, or not submitted by the run's owner: left alone.
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_draft_decisions where draft_id = any($1)", new[] { recent, otherSubmitter }));
      Assert.DoesNotContain("decision_sweep", FailedSteps(data));

      // Idempotent: a second tick creates nothing more.
      await TickDataAsync();
      Assert.Equal(2, await sql.CountAsync("select count(*) from automation_draft_decisions"));
    });
  }

  [Fact]
  public async Task Tick_QaPendingThatNeverEnqueues_RoutesHumanAfterTheTimeout()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      var deck = await A04Kit.PublishedDeckAsync(sql, "pending");
      var runId = await A04Kit.RunAsync(sql, "it-c01", deck.Id, "completed");

      // A draft whose QA enqueue throws on every retry (its stored card no longer parses), and one waiting for the cap.
      async Task<long> DecisionAsync(string reason, int ageMinutes)
      {
        var draftId = A04Kit.Long(await sql.ScalarAsync(
          """
          insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, card, "similar", agent, submitted_by_sub)
          values ($1, gen_random_uuid(), $2, $3, '{}'::jsonb, '[]'::jsonb, null, 'it-c01')
          returning id
          """, deck.Id, Guid.NewGuid().ToString("N"), AutomationTestKit.Uid("pending")));
        await sql.QueryAsync(
          """
          insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, reason, created_at, updated_at)
          values ($1, $2, $3, 'dry_run', 'qa_pending', $4, now() - make_interval(mins => $5), now() - make_interval(mins => $5))
          """, draftId, runId, deck.Id, reason, ageMinutes);
        return draftId;
      }
      var limit = AutomationEnv.QaTimeoutMinutes() * AutomationTick.QaPendingTimeoutFactor;
      var stuck = await DecisionAsync("ENQUEUE_RETRY", limit + 1);
      var young = await DecisionAsync("ENQUEUE_RETRY", limit - 5);
      var capped = await DecisionAsync("AI_QA_DAILY_CAP", limit + 60);

      var data = await TickDataAsync();

      // The retry failed (K4: the qa_retry step is named), then the timeout routed the stuck one.
      Assert.Contains("qa_retry", FailedSteps(data));
      Assert.Equal(1, Action(data, "qaTimedOut"));
      var row = (await sql.QueryAsync("select state, reason, decided_at from automation_draft_decisions where draft_id = $1", stuck)).Single();
      Assert.Equal(("human", "ENQUEUE_FAILED"), ((string)row["state"]!, (string)row["reason"]!));
      Assert.NotNull(row["decided_at"]);
      Assert.Equal(1, await sql.CountAsync(
        "select count(*) from automation_decision_events where draft_id = $1 and from_state = 'qa_pending' and to_state = 'human' and reason = 'ENQUEUE_FAILED'", stuck));
      Assert.Equal("qa_pending", await sql.ScalarAsync("select state from automation_draft_decisions where draft_id = $1", young));
      Assert.Equal("qa_pending", await sql.ScalarAsync("select state from automation_draft_decisions where draft_id = $1", capped));
    });
  }

  // =============================================================================================
  // backend-design-14 / automation-11: a stuck auto-publish job escalates
  // =============================================================================================

  private static async Task<(long DeckId, string JobId, long PublishId, Guid RunId)> PublishingAsync(A04Kit.Sql sql, string? jobStatus)
  {
    var deck = await A04Kit.PublishedDeckAsync(sql, "stuck");
    var runId = await A04Kit.RunAsync(sql, "sub", deck.Id, "completed");
    var jobId = Guid.NewGuid().ToString();
    if (jobStatus is not null)
    {
      await sql.QueryAsync(
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, published_by_admin_sub) values ($1, $2, $3, 'content/x', $4, $5, 'automation')",
        deck.Id, deck.Slug, $"b-{Guid.NewGuid():N}"[..20], jobId, jobStatus);
    }
    var publishId = A04Kit.Long(await sql.ScalarAsync(
      "insert into automation_publishes (deck_id, run_id, mode, state, job_id, card_ids) values ($1, $2, 'live', 'publishing', $3, '{}') returning id",
      deck.Id, runId, jobId));
    return (deck.Id, jobId, publishId, runId);
  }

  [Fact]
  public async Task Tick_StuckPublishingJob_RoutesHumanAfterStuckMinutes()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(scope, async sql =>
    {
      await scope.GateAsync(sql);
      var stuck = await PublishingAsync(sql, "PROCESSING");
      var pending = await PublishingAsync(sql, "PENDING");
      var active = await PublishingAsync(sql, "PROCESSING");
      await sql.QueryAsync("update deck_publishes set updated_at = now() - make_interval(mins => $2) where job_id = any($1)",
        new[] { stuck.JobId, pending.JobId }, AutoPublisher.StuckJobMinutes + 1);
      await sql.QueryAsync("update deck_publishes set updated_at = now() - make_interval(mins => $2) where job_id = $1",
        active.JobId, AutoPublisher.StuckJobMinutes - 5);

      var data = await TickDataAsync();

      Assert.Equal(2, Action(data, "publishesReconciled"));
      Assert.Contains("reconcile", FailedSteps(data));
      foreach (var p in new[] { stuck, pending })
      {
        var job = (await sql.QueryAsync("select status, error_message from deck_publishes where job_id = $1", p.JobId)).Single();
        Assert.Equal(("FAILED", AutoPublisher.StuckJobError), ((string)job["status"]!, (string)job["error_message"]!));
        var row = await A04Kit.PublishRowAsync(sql, p.PublishId);
        Assert.Equal(("human", "PUBLISH_FAILED", AutoPublisher.StuckJobError), ((string)row["state"]!, (string)row["reason"]!, (string)row["reason_detail"]!));
        Assert.NotNull(row["finished_at"]);
        var alert = (await sql.QueryAsync("select subkind, run_id from automation_notifications where dedupe_key = $1", $"exception:publish_failed:{p.JobId}")).Single();
        Assert.Equal(("publish_failed", p.RunId), ((string)alert["subkind"]!, (Guid)alert["run_id"]!));
        Assert.Equal(1, await sql.CountAsync("select count(*) from automation_events where dedupe_key = $1", $"auto-publish-fail:{p.JobId}"));
      }

      // A job that is still moving is left alone.
      Assert.Equal("PROCESSING", await sql.ScalarAsync("select status from deck_publishes where job_id = $1", active.JobId));
      Assert.Equal("publishing", (await A04Kit.PublishRowAsync(sql, active.PublishId))["state"]);
    });
  }

  [Fact]
  public async Task Tick_PublishingRowWithoutItsJobRow_RoutesHuman()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(scope, async sql =>
    {
      await scope.GateAsync(sql);
      var orphan = await PublishingAsync(sql, null);

      var stdout = await EmfCapture.StdoutAsync(async () => await TickDataAsync());

      Assert.True(StepFailures(stdout) >= 1);
      var row = await A04Kit.PublishRowAsync(sql, orphan.PublishId);
      Assert.Equal(("human", "PUBLISH_FAILED", "the publish job row is missing"),
        ((string)row["state"]!, (string)row["reason"]!, (string)row["reason_detail"]!));
      Assert.Equal("publish_failed",
        await sql.ScalarAsync("select subkind from automation_notifications where dedupe_key = $1", $"exception:publish_failed:{orphan.JobId}"));
    });
  }

  // =============================================================================================
  // backend-design-12: build coverage by the job's recorded card set, not by timestamps
  // =============================================================================================

  [Fact]
  public async Task Tick_CardAcceptedWhileTheBuildRan_IsPublishedByTheNextJob()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(scope, async sql =>
    {
      await scope.GateAsync(sql);
      var sub = AutomationTestKit.Sub("cover");
      var deck = await A04Kit.PublishedDeckAsync(sql, "cover");
      var runA = await A04Kit.RunAsync(sql, sub, deck.Id);
      var runB = await A04Kit.RunAsync(sql, sub, deck.Id);
      var cardA = await AutoAcceptAsync(sql, sub, deck.Id, runA, "Which synthetic signal box controls the junction?");
      Assert.True(await CompleteAndFinalizeAsync(sql, runA));
      var rowA = (await sql.QueryAsync("select id, job_id from automation_publishes where run_id = $1", runA)).Single();
      var jobA = (string)rowA["job_id"]!;
      var recorded = (long[])(await sql.ScalarAsync("select card_ids from deck_publishes where job_id = $1", jobA))!;
      Assert.Contains(cardA, recorded);

      // B's accept transaction started before A's job row was inserted and committed after the Worker read the deck:
      // the card's updated_at (its transaction start) is older than the job, yet the build does not contain it.
      var cardB = await AutoAcceptAsync(sql, sub, deck.Id, runB, "What does a synthetic level crossing gate protect?");
      await sql.QueryAsync("update cards set updated_at = (select created_at - interval '1 second' from deck_publishes where job_id = $1) where id = $2",
        jobA, cardB);
      await WorkerSucceedsAsync(sql, jobA);

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "publishesStarted"));
      Assert.Equal(new[] { cardA }, (long[])(await A04Kit.PublishRowAsync(sql, A04Kit.Long(rowA["id"])))["card_ids"]!);
      var next = (await sql.QueryAsync("select * from automation_publishes where deck_id = $1 and id <> $2", deck.Id, A04Kit.Long(rowA["id"]))).Single();
      Assert.Equal(("publishing", runB), ((string)next["state"]!, (Guid)next["run_id"]!));
      Assert.Equal(new[] { cardB }, (long[])next["card_ids"]!);
      Assert.Contains(cardB, (long[])(await sql.ScalarAsync("select card_ids from deck_publishes where job_id = $1", (string)next["job_id"]!))!);
      Assert.Equal(2, scope.PublishSent.Count);
    });
  }

  [Fact]
  public async Task Evaluate_AcceptedCardMissingFromTheLiveBuild_IsPublishedNotAssumedShipped()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await scope.GateAsync(_sql);
    var sub = AutomationTestKit.Sub("check8");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "check8");
    var oldCard = A04Kit.Long(await _sql.ScalarAsync("select id from cards where deck_id = $1", deck.Id));
    // The live build recorded only the old card.
    await _sql.QueryAsync("update deck_publishes set card_ids = $2 where deck_id = $1 and build_id = $3", deck.Id, new[] { oldCard }, deck.BuildId);
    var runId = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var card = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, runId, "Which synthetic weir keeps the millpond level?");
    // Its accept transaction started before the live build's job: by timestamp alone it looks shipped.
    await _sql.QueryAsync("update cards set updated_at = now() - interval '2 hours' where id = $1", card.CardId);
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = $1", runId);

    await using var conn = await _db.OpenAsync();
    var outcome = await AutoPublisher.EvaluateAsync(conn, deck.Id, runId);

    Assert.Equal(("publishing", null), (outcome!.State, outcome.Reason));
    Assert.Single(scope.PublishSent);
  }

  // =============================================================================================
  // backend-design-11: the deck settings check 5 passed are bound to the automation's job
  // =============================================================================================

  [Fact]
  public async Task StartPublish_DeckSettingsChangedSinceTheCheck_IsRefusedStale()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    var deck = await A04Kit.PublishedDeckAsync(_sql, "settings-start");
    await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("settings"), "A synthetic question about sluice gates?");
    var checkedAt = (DateTime)(await _sql.ScalarAsync("select updated_at from decks where id = $1", deck.Id))!;
    await _sql.QueryAsync("update decks set title = 'renamed by a human', updated_at = now() where id = $1", deck.Id);

    await using var conn = await _db.OpenAsync();
    var refused = await Publish.StartPublishAsync(conn, deck.Id, AutoPublisher.Actor, "it-c01", bindSnapshot: true, expectedSnapshot: null,
      allowResume: false, expectedDeckUpdatedAt: checkedAt);
    Assert.Equal((Publish.Refused, PublishSnapshot.StaleErrorCode), (refused.Outcome, refused.Code));
    Assert.Empty(scope.PublishSent);

    var current = (DateTime)(await _sql.ScalarAsync("select updated_at from decks where id = $1", deck.Id))!;
    var queued = await Publish.StartPublishAsync(conn, deck.Id, AutoPublisher.Actor, "it-c01", bindSnapshot: true, expectedSnapshot: null,
      allowResume: false, expectedDeckUpdatedAt: current);
    Assert.Equal(Publish.Queued, queued.Outcome);
    var job = (await _sql.QueryAsync("select deck_updated_at = (select updated_at from decks where id = $2) as bound, card_ids from deck_publishes where job_id = $1",
      queued.JobId, deck.Id)).Single();
    Assert.Equal(true, job["bound"]);
    Assert.Equal(2, ((long[])job["card_ids"]!).Length);
  }

  [Fact]
  public async Task ConsolePublish_RecordsCardIdsButNoDeckSettings()
  {
    await using var scope = new A04Kit.Scope();
    var deck = await A04Kit.PublishedDeckAsync(_sql, "console");
    var deleted = await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("gone"), "A synthetic deleted question?", isDeleted: 1);

    await using var conn = await _db.OpenAsync();
    var start = await Publish.StartPublishAsync(conn, deck.Id, "it-c01-editor", null, bindSnapshot: false, expectedSnapshot: null, allowResume: true);

    Assert.Equal(Publish.Queued, start.Outcome);
    var job = (await _sql.QueryAsync("select deck_updated_at, card_ids from deck_publishes where job_id = $1", start.JobId)).Single();
    Assert.Null(job["deck_updated_at"]);
    var ids = (long[])job["card_ids"]!;
    Assert.Single(ids);
    Assert.DoesNotContain(deleted, ids);
    Assert.False(await PublishJobProcessor.DeckSettingsChangedAsync(start.JobId!));
  }

  [Fact]
  public async Task Tick_DeckSettingsEditedBeforeTheBuild_FailsStaleThenRoutesHuman()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(scope, async sql =>
    {
      await scope.GateAsync(sql);
      var sub = AutomationTestKit.Sub("deckedit");
      var deck = await A04Kit.PublishedDeckAsync(sql, "deckedit");
      var runId = await A04Kit.RunAsync(sql, sub, deck.Id);
      await AutoAcceptAsync(sql, sub, deck.Id, runId, "Which synthetic ferry ramp lowers at low tide?");
      Assert.True(await CompleteAndFinalizeAsync(sql, runId));
      var row = (await sql.QueryAsync("select id, state, job_id from automation_publishes where run_id = $1", runId)).Single();
      Assert.Equal("publishing", row["state"]);
      var jobId = (string)row["job_id"]!;
      Assert.Equal(true, await sql.ScalarAsync(
        "select p.deck_updated_at = d.updated_at from deck_publishes p join decks d on d.id = p.deck_id where p.job_id = $1", jobId));
      Assert.False(await PublishJobProcessor.DeckSettingsChangedAsync(jobId));

      // A human renames the deck between the automation's check 5 and the Worker's build.
      await sql.QueryAsync("update decks set title = 'renamed by a human', updated_at = now() where id = $1", deck.Id);
      Assert.True(await PublishJobProcessor.DeckSettingsChangedAsync(jobId));

      var uploader = new CapturingUploader();
      var processor = new PublishJobProcessor(new JobRepository(), uploader, new NoopArtifacts());
      var ex = await Assert.ThrowsAsync<BusinessException>(() => processor.ProcessAsync(jobId, 1));
      Assert.StartsWith($"{PublishSnapshot.StaleErrorCode}: deck settings changed", ex.Message);
      Assert.Null(uploader.Captured);
      await processor.FailAsync(jobId, ex.Message);

      await TickDataAsync();

      var done = await A04Kit.PublishRowAsync(sql, A04Kit.Long(row["id"]));
      Assert.Equal(("human", "DECK_HAS_HUMAN_CHANGES", "deck settings changed"),
        ((string)done["state"]!, (string)done["reason"]!, (string)done["reason_detail"]!));
      Assert.Single(scope.PublishSent);
      Assert.Null(await sql.ScalarAsync("select 1 from deck_publishes where deck_id = $1 and status = 'SUCCESS' and published_by_admin_sub = 'automation'", deck.Id));
    });
  }
}
