using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The automation tick (R18A A04, contract A00 §12.6) through <c>POST /api/internal/automation/tick</c>, signed with the
/// fake <c>test-secret</c> exactly as the notifier would (the A00 §12.6 body). The tick scans global tables other
/// classes fill, so every database test runs against its own scratch database migrated to the latest version, with
/// <c>PGDATABASE</c> switched for the handler and restored in <c>finally</c>. Notifier, QA and publish sends are captured
/// through the test seams; no network is touched.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationTickTests
{
  private const string ScratchName = "it_a04_tick";
  private readonly PostgresFixture _db;

  public AutomationTickTests(PostgresFixture db) => _db = db;

  /// <summary>Runs <paramref name="body"/> with the handlers pointed at a fresh scratch database migrated to <paramref name="maxVersion"/>.</summary>
  private async Task InScratchAsync(A04Kit.Scope scope, Func<A04Kit.Sql, Task> body, int maxVersion = int.MaxValue)
  {
    // Unpooled: each test drops and recreates the scratch database, which kills any pooled connection to the old one.
    var connectionString = new NpgsqlConnectionStringBuilder(await _db.CreateScratchDatabaseAsync(ScratchName)) { Pooling = false }.ConnectionString;
    await using (var conn = new NpgsqlConnection(connectionString))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion);
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

  private static async Task<JsonElement> TickDataAsync(string job = "tick")
  {
    var tickId = Guid.NewGuid();
    var data = AutomationTestKit.Data(await A04Kit.TickAsync(job, tickId));
    Assert.Equal(tickId, data.GetProperty("tickId").GetGuid());
    return data;
  }

  private static int Action(JsonElement data, string name) => data.GetProperty("actions").GetProperty(name).GetInt32();

  private static async Task<Dictionary<string, object?>?> NotificationAsync(A04Kit.Sql sql, string dedupeKey) =>
    (await sql.QueryAsync("select * from automation_notifications where dedupe_key = $1", dedupeKey)).SingleOrDefault();

  private static string Today() => DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

  private static async Task<long> DeckAsync(A04Kit.Sql sql, string tag) =>
    A04Kit.Long(await sql.ScalarAsync("insert into decks (slug, title, author) values ($1, 'deck a04 tick', 'tests') returning id", A04Kit.Tag(tag)));

  // ---------------------------------------------------------------- auth, body, skips

  [Fact]
  public async Task Tick_BadSignature_Returns403()
  {
    await using var scope = new A04Kit.Scope();
    var response = await A04Kit.TickAsync(secret: "not-the-secret");
    Assert.Equal(403, response.StatusCode);
    Assert.Contains("Internal auth failed", response.Body);

    var req = A04Kit.SignedRequest(A04Kit.TickPath, new { v = 1, tickId = Guid.NewGuid(), job = "tick" }, method: "GET");
    Assert.Equal(405, (await AutomationTick.HandleTick(req, new RecallSmith.Lambda.Common.Res(req.TraceId))).StatusCode);
  }

  [Fact]
  public async Task Tick_RouteSecretUnset_Returns403()
  {
    await using var scope = new A04Kit.Scope();
    // INTERNAL_SHARED_SECRET is "test-secret" in the scope; the tick never falls back to it.
    scope.Set(AutomationEnv.NotifierSecretEnv, null);
    var response = await A04Kit.TickAsync();
    Assert.Equal(403, response.StatusCode);
    Assert.Contains("Missing INTERNAL_SECRET_NOTIFIER", response.Body);
  }

  [Fact]
  public async Task Tick_InvalidBody_Returns400ValidationError()
  {
    await using var scope = new A04Kit.Scope();
    object[] bodies =
    [
      new { v = 2, tickId = Guid.NewGuid(), job = "tick" },
      new { v = 1, tickId = "not-a-uuid", job = "tick" },
      new { v = 1, tickId = Guid.NewGuid(), job = "weekly" },
      new { v = 1, tickId = Guid.NewGuid() },
      new { tickId = Guid.NewGuid(), job = "tick" },
      "[1,2]",
    ];
    foreach (var body in bodies)
    {
      var req = A04Kit.SignedRequest(A04Kit.TickPath, body);
      AutomationTestKit.AssertError(await AutomationTick.HandleTick(req, new RecallSmith.Lambda.Common.Res(req.TraceId)), 400, "VALIDATION_ERROR");
    }
  }

  [Fact]
  public async Task Tick_ModeOff_IsSkipped()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Off);
    await InScratchAsync(scope, async sql =>
    {
      var deckId = await DeckAsync(sql, "off");
      var itemId = A04Kit.Long(await sql.ScalarAsync(
        """
        insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, attempts, claimed_by_runner, claimed_at, lease_expires_at)
        values ('manual', 'https://docs.example.com/off', $1, 'it-a04:off', 'owner:it-a04', 'claimed', 1, 'r', now() - interval '2 hours', now() - interval '1 hour')
        returning id
        """, deckId));
      await sql.QueryAsync("insert into automation_runners (runner_id, owner_sub, last_heartbeat_at) values ('it-a04-off', 'sub', now() - interval '10 days')");

      var data = await TickDataAsync("digest");

      using var contract = JsonDocument.Parse(A04Kit.ContractTickResponseJson);
      Assert.Equal(A04Kit.Keys(contract.RootElement), A04Kit.Keys(data));
      Assert.Equal(A04Kit.Keys(contract.RootElement.GetProperty("actions")), A04Kit.Keys(data.GetProperty("actions")));
      Assert.Equal(("off", "off", "off"), (data.GetProperty("mode").GetString(), data.GetProperty("effectiveMode").GetString(), data.GetProperty("skipped").GetString()));
      Assert.False(data.GetProperty("actions").GetProperty("digest").GetBoolean());
      Assert.All(data.GetProperty("actions").EnumerateObject().Where(p => p.Name != "digest"), p => Assert.Equal(0, p.Value.GetInt32()));
      Assert.Equal("claimed", await sql.ScalarAsync("select status from authoring_queue_items where id = $1", itemId));
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_notifications"));
      Assert.Empty(scope.NotifySent);
    });
  }

  [Fact]
  public async Task Tick_HeldLock_IsSkippedLocked()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      await using var holder = await sql.OpenAsync();
      Assert.Equal(true, await DbUtil.ExecuteScalarAsync(holder, null, "select pg_try_advisory_lock($1)", [AutomationTick.LockKey]));
      try
      {
        var data = await TickDataAsync();
        Assert.Equal("locked", data.GetProperty("skipped").GetString());
        Assert.Equal("dry_run", data.GetProperty("effectiveMode").GetString());
      }
      finally
      {
        await DbUtil.ExecuteScalarAsync(holder, null, "select pg_advisory_unlock($1)", [AutomationTick.LockKey]);
      }

      // Released: the next tick runs, and releases the lock itself afterwards.
      var ran = await TickDataAsync();
      Assert.Equal(JsonValueKind.Null, ran.GetProperty("skipped").ValueKind);
      Assert.Equal(true, await DbUtil.ExecuteScalarAsync(holder, null, "select pg_try_advisory_lock($1)", [AutomationTick.LockKey]));
      await DbUtil.ExecuteScalarAsync(holder, null, "select pg_advisory_unlock($1)", [AutomationTick.LockKey]);
    });
  }

  // ---------------------------------------------------------------- steps 2–5

  [Fact]
  public async Task Tick_ExpiredLease_RequeuesThenFails()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      var deckId = await DeckAsync(sql, "lease");
      async Task<(long ItemId, Guid RunId)> ClaimedAsync(int attempts)
      {
        var runId = Guid.NewGuid();
        var itemId = A04Kit.Long(await sql.ScalarAsync(
          """
          insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, attempts, claimed_by_runner, claimed_at, lease_expires_at, last_run_id)
          values ('manual', $1, $2, $3, 'owner:it-a04', 'claimed', $4, 'it-a04-runner', now() - interval '3 hours', now() - interval '1 minute', $5)
          returning id
          """, $"https://docs.example.com/lease/{Guid.NewGuid():N}", deckId, $"it-a04:{Guid.NewGuid()}", attempts, runId));
        await sql.QueryAsync(
          "insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status) values ($1, $2, 'it-a04-runner', 'sub', $3, 'running')",
          runId, itemId, deckId);
        return (itemId, runId);
      }
      var retry = await ClaimedAsync(1);
      var last = await ClaimedAsync(3);

      var data = await TickDataAsync();

      Assert.Equal(2, Action(data, "leasesExpired"));
      Assert.True(Action(data, "runsAbandoned") >= 2);
      var requeued = (await sql.QueryAsync("select status, lease_expires_at, not_before > now() + interval '29 minutes' as later from authoring_queue_items where id = $1", retry.ItemId)).Single();
      Assert.Equal(("queued", true), ((string)requeued["status"]!, (bool)requeued["later"]!));
      Assert.Null(requeued["lease_expires_at"]);
      Assert.Equal("failed", await sql.ScalarAsync("select status from authoring_queue_items where id = $1", last.ItemId));
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_runs where run_id = any($1) and status <> 'abandoned'", new[] { retry.RunId, last.RunId }));
      var alert = (await NotificationAsync(sql, $"exception:queue_item_failed:{last.ItemId}"))!;
      Assert.Equal(("exception", "queue_item_failed"), ((string)alert["kind"]!, (string)alert["subkind"]!));
      Assert.Null(await NotificationAsync(sql, $"exception:queue_item_failed:{retry.ItemId}"));
      Assert.True(Action(data, "alerts") >= 1);
    });
  }

  [Fact]
  public async Task Tick_QaPending_IsRetried()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      var sub = AutomationTestKit.Sub("retry");
      var deckId = await DeckAsync(sql, "retry");
      var runId = await A04Kit.RunAsync(sql, sub, deckId);
      var failing = new AutomationTestKit.Scope();
      try
      {
        failing.FailSends = true;
        var draftId = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deckId, runId, AutomationTestKit.Card(AutomationTestKit.Uid("retry"))))[0];
        Assert.Equal(("qa_pending", "ENQUEUE_RETRY"),
          ((string)(await sql.ScalarAsync("select state from automation_draft_decisions where draft_id = $1", draftId))!,
           (string)(await sql.ScalarAsync("select reason from automation_draft_decisions where draft_id = $1", draftId))!));
        failing.FailSends = false;

        var data = await TickDataAsync();

        Assert.Equal(1, Action(data, "qaRetried"));
        Assert.Equal("qa_queued", await sql.ScalarAsync("select state from automation_draft_decisions where draft_id = $1", draftId));
        Assert.Single(failing.QaSent);
      }
      finally
      {
        failing.Dispose();
      }
    });
  }

  [Fact]
  public async Task Tick_QaQueuedTimeout_RoutesHumanQaTimeout()
  {
    await using var scope = new A04Kit.Scope();
    scope.Set(AutomationEnv.QaTimeoutMinutesEnv, "30");
    await InScratchAsync(scope, async sql =>
    {
      var sub = AutomationTestKit.Sub("timeout");
      var deckId = await DeckAsync(sql, "timeout");
      var runId = await A04Kit.RunAsync(sql, sub, deckId);
      var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deckId, runId,
        AutomationTestKit.Card(AutomationTestKit.Uid("timeout1")), AutomationTestKit.Card(AutomationTestKit.Uid("timeout2"), "Which synthetic reviewer is still on time?"));
      await sql.QueryAsync("update automation_draft_decisions set qa_enqueued_at = now() - interval '31 minutes' where draft_id = $1", ids[0]);

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "qaTimedOut"));
      var d = (await sql.QueryAsync("select state, reason, decided_at from automation_draft_decisions where draft_id = $1", ids[0])).Single();
      Assert.Equal(("human", "QA_TIMEOUT"), ((string)d["state"]!, (string)d["reason"]!));
      Assert.NotNull(d["decided_at"]);
      var ev = (await sql.QueryAsync("select from_state, to_state, reason, actor from automation_decision_events where draft_id = $1 order by id desc limit 1", ids[0])).Single();
      Assert.Equal(("qa_queued", "human", "QA_TIMEOUT", "automation"), ((string)ev["from_state"]!, (string)ev["to_state"]!, (string)ev["reason"]!, (string)ev["actor"]!));
      Assert.Equal("qa_queued", await sql.ScalarAsync("select state from automation_draft_decisions where draft_id = $1", ids[1]));
      // dry_run writes no ledger row.
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_events where dedupe_key = $1", $"auto-route:{ids[0]}"));
    });
  }

  [Fact]
  public async Task Tick_StaleRunningRun_IsAbandonedAndFinalized()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      var deckId = await DeckAsync(sql, "stale");
      var stale = await A04Kit.RunAsync(sql, "sub", deckId);
      var fresh = await A04Kit.RunAsync(sql, "sub", deckId);
      await sql.QueryAsync("update automation_runs set started_at = now() - interval '7 hours' where run_id = $1", stale);

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "runsAbandoned"));
      Assert.Equal(1, Action(data, "runsFinalized"));
      var run = (await sql.QueryAsync("select status, finalized_at, completed_at from automation_runs where run_id = $1", stale)).Single();
      Assert.Equal("abandoned", run["status"]);
      Assert.NotNull(run["finalized_at"]);
      Assert.NotNull(run["completed_at"]);
      Assert.Equal("running", await sql.ScalarAsync("select status from automation_runs where run_id = $1", fresh));

      // Finalisation happens once.
      Assert.Equal(0, Action(await TickDataAsync(), "runsFinalized"));
    });
  }

  // ---------------------------------------------------------------- step 6

  private static async Task<(long DeckId, string JobId, long PublishId, Guid RunId)> PublishingAsync(A04Kit.Sql sql, string jobStatus, string? error = null)
  {
    var deck = await A04Kit.PublishedDeckAsync(sql, "recon");
    var runId = await A04Kit.RunAsync(sql, "sub", deck.Id, "completed");
    var jobId = Guid.NewGuid().ToString();
    await sql.QueryAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, error_message, published_by_admin_sub) values ($1, $2, $3, 'content/x', $4, $5, $6, 'automation')",
      deck.Id, deck.Slug, $"b-{Guid.NewGuid():N}"[..20], jobId, jobStatus, error);
    var publishId = A04Kit.Long(await sql.ScalarAsync(
      "insert into automation_publishes (deck_id, run_id, mode, state, job_id, card_ids) values ($1, $2, 'live', 'publishing', $3, '{}') returning id",
      deck.Id, runId, jobId));
    return (deck.Id, jobId, publishId, runId);
  }

  [Fact]
  public async Task Tick_ReconcilesPublishingSuccess()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(scope, async sql =>
    {
      await scope.GateAsync(sql);
      var p = await PublishingAsync(sql, "SUCCESS");
      var active = await PublishingAsync(sql, "PROCESSING");

      var data = await TickDataAsync();

      Assert.Equal("live", data.GetProperty("effectiveMode").GetString());
      Assert.Equal(1, Action(data, "publishesReconciled"));
      var row = await A04Kit.PublishRowAsync(sql, p.PublishId);
      Assert.Equal("published", row["state"]);
      Assert.NotNull(row["finished_at"]);
      var ledger = (await sql.QueryAsync("select automation, units, outcome, deck_id, ref from automation_events where dedupe_key = $1", $"auto-publish:{p.JobId}")).Single();
      Assert.Equal(("auto_publish", 1, "success", p.DeckId, p.JobId),
        ((string)ledger["automation"]!, Convert.ToInt32(ledger["units"], CultureInfo.InvariantCulture), (string)ledger["outcome"]!, A04Kit.Long(ledger["deck_id"]), (string)ledger["ref"]!));
      Assert.Equal("publishing", (await A04Kit.PublishRowAsync(sql, active.PublishId))["state"]);
    });
  }

  [Fact]
  public async Task Tick_ReconcilesPublishingFailure()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(scope, async sql =>
    {
      await scope.GateAsync(sql);
      var error = "AI_QA_STALE: " + new string('x', 400);
      var p = await PublishingAsync(sql, "FAILED", error);

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "publishesReconciled"));
      var row = await A04Kit.PublishRowAsync(sql, p.PublishId);
      Assert.Equal(("human", "PUBLISH_FAILED"), ((string)row["state"]!, (string)row["reason"]!));
      Assert.StartsWith("AI_QA_STALE: xxx", (string)row["reason_detail"]!);
      Assert.True(((string)row["reason_detail"]!).Length <= 300);
      var alert = (await NotificationAsync(sql, $"exception:publish_failed:{p.JobId}"))!;
      Assert.Equal(("publish_failed", p.RunId), ((string)alert["subkind"]!, (Guid)alert["run_id"]!));
      Assert.EndsWith("failed", (string)alert["subject"]!);
      var ledger = (await sql.QueryAsync("select units, outcome from automation_events where dedupe_key = $1", $"auto-publish-fail:{p.JobId}")).Single();
      Assert.Equal((0, "failure"), (Convert.ToInt32(ledger["units"], CultureInfo.InvariantCulture), (string)ledger["outcome"]!));
    });
  }

  [Fact]
  public async Task Tick_WaitingPublish_TimesOut()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      var deck = await A04Kit.PublishedDeckAsync(sql, "wait");
      var runId = await A04Kit.RunAsync(sql, "sub", deck.Id, "completed");
      await sql.QueryAsync(
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1, $2, $3, 'content/x', $4, 'PROCESSING')",
        deck.Id, deck.Slug, $"b-{Guid.NewGuid():N}"[..20], Guid.NewGuid().ToString());
      var fresh = A04Kit.Long(await sql.ScalarAsync(
        "insert into automation_publishes (deck_id, run_id, mode, state, reason) values ($1, $2, 'dry_run', 'waiting', 'PUBLISH_IN_PROGRESS') returning id",
        deck.Id, runId));

      // Within the wait: still waiting.
      await TickDataAsync();
      Assert.Equal(("waiting", "PUBLISH_IN_PROGRESS"),
        ((string)(await A04Kit.PublishRowAsync(sql, fresh))["state"]!, (string)(await A04Kit.PublishRowAsync(sql, fresh))["reason"]!));

      await sql.QueryAsync("update automation_publishes set created_at = now() - interval '121 minutes' where id = $1", fresh);
      await TickDataAsync();

      var row = await A04Kit.PublishRowAsync(sql, fresh);
      Assert.Equal(("human", "PUBLISH_WAIT_TIMEOUT"), ((string)row["state"]!, (string)row["reason"]!));
      Assert.NotNull(row["finished_at"]);
      Assert.Equal("publish_blocked", (await NotificationAsync(sql, $"exception:publish_blocked:{fresh}"))!["subkind"]);
    });
  }

  // ---------------------------------------------------------------- step 7

  [Fact]
  public async Task Tick_FinalRun_EnqueuesOneBatchSummary()
  {
    await using var scope = new A04Kit.Scope();
    scope.Set(WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
    await InScratchAsync(scope, async sql =>
    {
      var subscriptionId = A04Kit.Long(await sql.ScalarAsync(
        "insert into webhook_subscriptions (name, url, events, is_active) values ('it-a04-batch', 'https://hooks.example.com/it-a04/batch', $1, true) returning id",
        (object)new[] { "automation.batch_completed" }));
      var sub = AutomationTestKit.Sub("batch");
      var deck = await A04Kit.PublishedDeckAsync(sql, "batch");
      var runId = await A04Kit.RunAsync(sql, sub, deck.Id);
      var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId,
        AutomationTestKit.Card(AutomationTestKit.Uid("batch1"), "Which synthetic batch queue passes review?"),
        AutomationTestKit.Card(AutomationTestKit.Uid("batch2"), "Which synthetic batch flag gets flagged?"));
      var jobs = await sql.QueryAsync("select draft_id, qa_job_id, qa_content_sha256 from automation_draft_decisions where run_id = $1 order by draft_id", runId);
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport((Guid)jobs[0]["qa_job_id"]!, ids[0], (string)jobs[0]["qa_content_sha256"]!)));
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport((Guid)jobs[1]["qa_job_id"]!, ids[1], (string)jobs[1]["qa_content_sha256"]!,
        findings: [AutomationTestKit.Finding("major", "ambiguous_stem")])));
      await sql.QueryAsync("update automation_runs set status = 'completed', outcome = 'done', completed_at = now() where run_id = $1", runId);

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "runsFinalized"));
      Assert.Equal(1, Action(data, "summaries"));
      var publish = (await sql.QueryAsync("select state from automation_publishes where run_id = $1", runId)).Single();
      Assert.Equal("would_publish", publish["state"]);
      var n = (await NotificationAsync(sql, $"batch:{runId:D}"))!;
      Assert.Equal(("batch_summary", "dry_run", runId), ((string)n["kind"]!, (string)n["mode"]!, (Guid)n["run_id"]!));
      Assert.Equal($"[DeveloperCards] (dry run) Batch {runId.ToString("D")[..8]} {deck.Slug}: 1 auto-accepted, 1 need you, would publish", n["subject"]);
      var body = (string)n["body_text"]!;
      Assert.Contains($"https://console.example.com/review?deckId={deck.Id}", body);
      Assert.Contains("QA_FLAGGED", body);
      Assert.Equal(n["notification_id"], await sql.ScalarAsync("select summary_notification_id from automation_runs where run_id = $1", runId));

      var delivery = (await sql.QueryAsync("select body from webhook_deliveries where subscription_id = $1", subscriptionId)).Single();
      using (var doc = JsonDocument.Parse((string)delivery["body"]!))
      {
        var d = doc.RootElement.GetProperty("data");
        Assert.Equal(["runId", "queueItemId", "kind", "url", "deckId", "deckSlug", "mode", "counts", "humanReasons", "publishes", "consoleUrl"], A04Kit.Keys(d));
        Assert.Equal(["submitted", "autoAccepted", "wouldAccept", "human", "superseded"], A04Kit.Keys(d.GetProperty("counts")));
        Assert.Equal((2, 1, 1), (d.GetProperty("counts").GetProperty("submitted").GetInt32(), d.GetProperty("counts").GetProperty("wouldAccept").GetInt32(),
          d.GetProperty("counts").GetProperty("human").GetInt32()));
        Assert.Equal(1, d.GetProperty("humanReasons").GetProperty("QA_FLAGGED").GetInt32());
        var p = Assert.Single(d.GetProperty("publishes").EnumerateArray());
        Assert.Equal(["deckId", "deckSlug", "state", "reason", "jobId", "buildId"], A04Kit.Keys(p));
        Assert.Equal($"https://console.example.com/automation?runId={runId:D}", d.GetProperty("consoleUrl").GetString());
      }

      // Exactly one summary per run.
      Assert.Equal(0, Action(await TickDataAsync(), "summaries"));
      Assert.Equal(1, await sql.CountAsync("select count(*) from automation_notifications where kind = 'batch_summary'"));
      Assert.Single(A04Kit.Messages(scope, "Batch "));
    });
  }

  // ---------------------------------------------------------------- steps 9–11

  [Fact]
  public async Task Tick_RunnerStalled_Alerts()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      await sql.QueryAsync(
        "insert into automation_runners (runner_id, owner_sub, last_heartbeat_at, login_expires_at) values ('it-a04-mac', 'sub', now() - interval '2 days', now() + interval '30 days')");
      await sql.QueryAsync("insert into automation_runners (runner_id, owner_sub, last_heartbeat_at) values ('it-a04-fresh', 'sub', now())");

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "alerts"));
      var n = (await NotificationAsync(sql, $"exception:runner_stalled:it-a04-mac:{Today()}"))!;
      Assert.StartsWith("[DeveloperCards] (dry run) Action needed: authoring runner it-a04-mac silent since ", (string)n["subject"]!);
      Assert.Null(await NotificationAsync(sql, $"exception:runner_stalled:it-a04-fresh:{Today()}"));
      // Once per runner per UTC day.
      Assert.Equal(0, Action(await TickDataAsync(), "alerts"));
    });
  }

  [Fact]
  public async Task Tick_LoginExpiring_Alerts()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      await sql.QueryAsync(
        "insert into automation_runners (runner_id, owner_sub, last_heartbeat_at, login_expires_at) values ('it-a04-login', 'sub', now(), now() + interval '2 days 1 hour')");
      await sql.QueryAsync(
        "insert into automation_runners (runner_id, owner_sub, last_heartbeat_at, login_expires_at) values ('it-a04-later', 'sub', now(), now() + interval '20 days')");

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "alerts"));
      var n = (await NotificationAsync(sql, $"exception:runner_login_expiring:it-a04-login:{Today()}"))!;
      Assert.Equal("[DeveloperCards] (dry run) Action needed: runner login expires in 2 day(s)", n["subject"]);
      Assert.Contains("node tools/mcp-server/dist/index.js login", (string)n["body_text"]!);
      Assert.Null(await NotificationAsync(sql, $"exception:runner_login_expiring:it-a04-later:{Today()}"));
    });
  }

  [Fact]
  public async Task Tick_LiveWithoutGate_AlertsEvalGateMissing()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(scope, async sql =>
    {
      var data = await TickDataAsync();

      Assert.Equal(("live", "dry_run"), (data.GetProperty("mode").GetString(), data.GetProperty("effectiveMode").GetString()));
      var n = (await NotificationAsync(sql, $"exception:eval_gate_missing:{Today()}"))!;
      Assert.Equal("[DeveloperCards] (dry run) AUTOMATION_MODE=live is blocked: no passed eval gate", n["subject"]);
      Assert.Equal(1, Action(data, "alerts"));

      // With a gate the mode is live and nothing more is raised.
      await scope.GateAsync(sql);
      var live = await TickDataAsync();
      Assert.Equal("live", live.GetProperty("effectiveMode").GetString());
      Assert.Equal(0, Action(live, "alerts"));
    });
  }

  [Fact]
  public async Task Tick_Digest_EnqueuesWeeklyDigest()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      await using (var conn = await sql.OpenAsync())
      {
        await AutomationLedger.RecordAsync(conn, new AutomationEvent("source_watch", 12, "success", DedupeKey: "it-a04-digest", OccurredAt: DateTimeOffset.UtcNow.AddDays(-2)));
      }
      var today = DateOnly.FromDateTime(DateTime.UtcNow);

      var plain = await TickDataAsync();
      Assert.False(plain.GetProperty("actions").GetProperty("digest").GetBoolean());

      var data = await TickDataAsync("digest");

      Assert.True(data.GetProperty("actions").GetProperty("digest").GetBoolean());
      var n = (await NotificationAsync(sql, $"digest:{Today()}"))!;
      var from = today.AddDays(-7).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
      var to = today.AddDays(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
      Assert.Equal("weekly_digest", n["kind"]);
      Assert.Equal($"[DeveloperCards] (dry run) Weekly automation digest {from}–{to}: 0.1 h saved", n["subject"]);
      Assert.Contains("Ledger source_watch: 1 run(s), 12 unit(s)", (string)n["body_text"]!);
      Assert.Contains("Source watch: 12 check(s)", (string)n["body_text"]!);

      // A repeated digest call the same day sends nothing new.
      Assert.False((await TickDataAsync("digest")).GetProperty("actions").GetProperty("digest").GetBoolean());
      Assert.Single(A04Kit.Messages(scope, "Weekly automation digest"));
    });
  }

  [Fact]
  public async Task Tick_ResendsEnqueueFailedNotifications()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      scope.Set(AutomationEnv.NotifyQueueUrlEnv, null);
      Guid failed, exhausted;
      await using (var conn = await sql.OpenAsync())
      {
        failed = (await Notifications.EnqueueAsync(conn, new NotificationRequest("test", null, "it-a04:resend", "dry_run",
          EmailTemplates.Test("dry_run", "https://console.example.com"))))!.NotificationId;
        exhausted = (await Notifications.EnqueueAsync(conn, new NotificationRequest("test", null, "it-a04:exhausted", "dry_run",
          EmailTemplates.Test("dry_run", "https://console.example.com"))))!.NotificationId;
      }
      await sql.QueryAsync("update automation_notifications set attempts = 5 where notification_id = $1", exhausted);
      Assert.Equal("enqueue_failed", await sql.ScalarAsync("select status from automation_notifications where notification_id = $1", failed));
      scope.Set(AutomationEnv.NotifyQueueUrlEnv, A04Kit.FakeNotifyQueueUrl);

      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "notificationsResent"));
      var row = (await sql.QueryAsync("select status, attempts, error_code from automation_notifications where notification_id = $1", failed)).Single();
      Assert.Equal(("queued", 1), ((string)row["status"]!, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture)));
      Assert.Null(row["error_code"]);
      Assert.Equal("enqueue_failed", await sql.ScalarAsync("select status from automation_notifications where notification_id = $1", exhausted));
      var message = Assert.Single(A04Kit.Messages(scope));
      Assert.Equal(failed, message.GetProperty("notificationId").GetGuid());
    });
  }

  // ---------------------------------------------------------------- step 8

  [Fact]
  public async Task Tick_SourceEventStarted_BecomesDoneAndEmails()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(scope, async sql =>
    {
      var deckId = await DeckAsync(sql, "source");
      var slug = (string)(await sql.ScalarAsync("select slug from decks where id = $1", deckId))!;
      var flaggedCard = A04Kit.Long(await sql.ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, 'src-flagged', 'Q1?', 'E', 2, 10) returning id", deckId));
      var missingCard = A04Kit.Long(await sql.ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, 'src-missing', 'Q2?', 'E', 2, 20) returning id", deckId));
      const string url = "https://docs.aws.amazon.com/synthetic/latest/userguide/changed-page.html";
      var targetId = A04Kit.Long(await sql.ScalarAsync(
        "insert into source_watch_targets (kind, url, check_interval_minutes) values ('page', $1, 360) returning id", url));
      var qaRun = Guid.NewGuid();
      await sql.QueryAsync(
        "insert into ai_qa_runs (id, deck_id, scope, status, requested_by_sub, card_count, chunk_count) values ($1, $2, 'cards', 'running', 'automation', 2, 1)",
        qaRun, deckId);
      await sql.QueryAsync(
        "insert into ai_qa_findings (run_id, card_id, content_sha256, severity, category, message) values ($1, $2, $3, 'major', 'outdated_fact', 'Synthetic finding.')",
        qaRun, flaggedCard, new string('d', 64));
      var eventId = A04Kit.Long(await sql.ScalarAsync(
        """
        insert into source_watch_events (target_id, watch_run_id, kind, recheck_state, recheck_run_ids, details)
        values ($1, $2, 'changed', 'started', $3, $4::jsonb) returning id
        """, targetId, Guid.NewGuid(), new[] { qaRun }, JsonSerializer.Serialize(new { missingQuoteCardIds = new[] { missingCard } })));
      var itemId = A04Kit.Long(await sql.ScalarAsync(
        "insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, source_target_id, source_event_id) values ('source_changed', $1, $2, 'it-a04:source', 'system', $3, $4) returning id",
        url, deckId, targetId, eventId));

      // The re-check run is still running: nothing moves.
      var first = await TickDataAsync();
      Assert.Equal(0, Action(first, "rechecksDone"));
      Assert.Equal("started", await sql.ScalarAsync("select recheck_state from source_watch_events where id = $1", eventId));

      await sql.QueryAsync("update ai_qa_runs set status = 'done', finished_at = now() where id = $1", qaRun);
      var data = await TickDataAsync();

      Assert.Equal(1, Action(data, "rechecksDone"));
      var ev = (await sql.QueryAsync("select recheck_state, notification_id from source_watch_events where id = $1", eventId)).Single();
      Assert.Equal("done", ev["recheck_state"]);
      var n = (await NotificationAsync(sql, $"source:{eventId}"))!;
      Assert.Equal(n["notification_id"], ev["notification_id"]);
      Assert.Equal("source_changed", n["kind"]);
      Assert.Equal("[DeveloperCards] (dry run) Source changed: docs.aws.amazon.com/synthetic/latest/userguide/changed-page.html — 2 card(s) re-checked, 1 flagged",
        n["subject"]);
      var body = (string)n["body_text"]!;
      Assert.Contains($"- src-flagged — open major finding — https://console.example.com/decks/qa?deckId={deckId}&runId={qaRun:D}", body);
      Assert.Contains($"- card {missingCard} — its quote is no longer on the page", body);
      Assert.Contains($"- queue item {itemId} added for the authoring runner", body);
      Assert.Contains($"Deck {slug}: 2 card(s) re-checked, 1 flagged", body);

      // One email per event.
      await TickDataAsync();
      Assert.Equal(1, await sql.CountAsync("select count(*) from automation_notifications where kind = 'source_changed'"));
    });
  }

  [Fact]
  public async Task Tick_MissingTables_Returns503ServerNotReadyAutomation()
  {
    foreach (var mode in new[] { AutomationMode.DryRun, AutomationMode.Off })
    {
      await using var scope = new A04Kit.Scope(mode);
      await InScratchAsync(scope, async _ =>
      {
        AutomationTestKit.AssertError(await A04Kit.TickAsync(), 503, "SERVER_NOT_READY_AUTOMATION");
      }, maxVersion: 33);
    }
  }
}
