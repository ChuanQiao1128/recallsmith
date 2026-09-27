using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Pagination;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The Automation page's read API (R18A A06, contract A00 §16.2): status (mode, eval gate, runners, queue, decisions,
/// shadow agreement, publishes, spend, watch, email), runs with counts and publishes, decisions with filters and the
/// detail with card, findings and events; the time-ordered cursors; editor access, the agent-token denial and the
/// pre-034 503. Tests of global counts run against their own freshly migrated scratch database; the others share this
/// class's scratch database and isolate by deck. Every env variable and the <c>PGDATABASE</c> switch are restored.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AutomationStatusRoutesTests
{
  private const string ScratchName = "it_a06_status";
  private const string NotReadyName = "it_a06_status_notready";
  private const string StatusPath = "/api/v1/admin/automation/status";
  private const string RunsPath = "/api/v1/admin/automation/runs";
  private const string DecisionsPath = "/api/v1/admin/automation/decisions";

  // A00 §16.2, verbatim except that the runner item (whose keys carry no values there) is listed in RunnerKeys, plus
  // the R18C additions: shadow.blindDecided/blindAccepted (automation-4) and backlog.humanPublishItems (L4).
  private const string StatusContractJson = """
    { "serverTime": "ISO",
      "mode": { "configured": "dry_run", "effective": "dry_run", "liveBlockedReason": null, "autoPublish": true },
      "evalGate": null,
      "runners": [],
      "queue": { "queued": 0, "due": 0, "claimed": 0, "failed": 0, "doneLast7d": 0 },
      "decisions24h": { "byState": { "<state>": 0 }, "byReason": { "<REASON>": 0 } },
      "shadow": { "wouldAccept": 0, "humanDecided": 0, "humanAccepted": 0, "humanEditedAccepted": 0, "humanRejected": 0, "agreementRate": null,
                  "blindDecided": 0, "blindAccepted": 0 },
      "publishes7d": { "byState": { "<state>": 0 } },
      "spend": { "todayUsd": 0, "automationTodayUsd": 0, "reservedUsd": 0, "dailyCapUsd": 10 },
      "watch": { "targets": 0, "active": 0, "failing": 0, "lastCheckedAt": null, "changes7d": 0 },
      "notifications": { "sent24h": 0, "failed24h": 0, "queued": 0, "unconfirmed": 0, "lastSentAt": null },
      "backlog": { "humanPending": 0, "oldestHumanPendingAt": null, "humanPublishes": 0, "humanPublishItems": [] } }
    """;

  private static readonly string[] RunnerKeys =
  [
    "runnerId", "host", "runnerVersion", "claudeVersion", "state", "lastHeartbeatAt", "stale", "loginExpiresAt", "loginExpiresInDays",
    "lastRunId", "lastRunAt", "lastRunOutcome", "lastError",
  ];

  private static readonly string[] RunKeys =
  [
    "runId", "queueItemId", "kind", "url", "title", "deckId", "deckSlug", "runnerId", "status", "outcome", "startedAt", "completedAt",
    "finalizedAt", "counts", "publishes", "summaryNotificationId", "error", "summary",
  ];

  private static readonly string[] RunCountKeys = ["submitted", "qaPending", "qaQueued", "wouldAccept", "autoAccepted", "human", "superseded"];

  private static readonly string[] PublishKeys =
    ["publishId", "deckId", "deckSlug", "mode", "state", "reason", "reasonDetail", "jobId", "buildId", "updatedAt"];

  private static readonly string[] DecisionKeys =
  [
    "draftId", "runId", "deckId", "deckSlug", "stableUid", "question", "mode", "state", "reason", "reasonDetail", "qa", "acceptedCardId",
    "humanAction", "humanReason", "createdAt", "updatedAt", "decidedAt",
  ];

  private static readonly string[] QaKeys =
    ["jobId", "status", "errorCode", "provider", "model", "promptVersion", "blocker", "major", "minor", "estimatedCostUsd", "attempts"];

  private static readonly string[] EnvNames =
  [
    AutomationMode.EnvName, AutomationEnv.AutoPublishEnv, AutomationEnv.RunnerStaleMinutesEnv, QaRuns.DailyCapEnv, QaRuns.EstUsdPerCardEnv,
  ];

  private static readonly SemaphoreSlim ScratchGate = new(1, 1);
  private static string? _scratch;

  private readonly PostgresFixture _db;
  public AutomationStatusRoutesTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- scratch databases

  private async Task<string> ScratchAsync()
  {
    await ScratchGate.WaitAsync();
    try
    {
      _scratch ??= await FreshAsync(ScratchName);
      return _scratch;
    }
    finally
    {
      ScratchGate.Release();
    }
  }

  private async Task<string> FreshAsync(string name)
  {
    var cs = await _db.CreateScratchDatabaseAsync(name);
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
    return cs;
  }

  /// <summary>Runs <paramref name="body"/> with <c>PGDATABASE</c> = the database of <paramref name="cs"/>; restores it and every automation env key.</summary>
  private static async Task InDatabaseAsync(string cs, Func<Db, Task> body, IDictionary<string, string?>? env = null)
  {
    var saved = EnvNames.Append("PGDATABASE").ToDictionary(n => n, Environment.GetEnvironmentVariable);
    try
    {
      foreach (var n in EnvNames) Environment.SetEnvironmentVariable(n, null);
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, AutomationMode.DryRun);
      foreach (var (k, v) in env ?? new Dictionary<string, string?>()) Environment.SetEnvironmentVariable(k, v);
      Environment.SetEnvironmentVariable("PGDATABASE", new NpgsqlConnectionStringBuilder(cs).Database);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await body(new Db(cs));
    }
    finally
    {
      foreach (var (k, v) in saved) Environment.SetEnvironmentVariable(k, v);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  private async Task InScratchAsync(Func<Db, Task> body, IDictionary<string, string?>? env = null) =>
    await InDatabaseAsync(await ScratchAsync(), body, env);

  private async Task InFreshAsync(string name, Func<Db, Task> body, IDictionary<string, string?>? env = null) =>
    await InDatabaseAsync(await FreshAsync(name), body, env);

  /// <summary>SQL helpers and fixtures against one scratch database.</summary>
  private sealed class Db(string cs)
  {
    public string ConnectionString { get; } = cs;

    public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params object?[] parameters)
    {
      await using var conn = new NpgsqlConnection(ConnectionString);
      await conn.OpenAsync();
      return await DbUtil.QueryAsync(conn, null, sql, parameters);
    }

    public async Task<object?> ScalarAsync(string sql, params object?[] parameters)
    {
      await using var conn = new NpgsqlConnection(ConnectionString);
      await conn.OpenAsync();
      return await DbUtil.ExecuteScalarAsync(conn, null, sql, parameters);
    }

    public async Task<(long Id, string Slug)> NewDeckAsync(string tag)
    {
      var slug = $"it-a06-{tag}-{Guid.NewGuid():N}";
      var id = await ScalarAsync("insert into decks (slug, title, author) values ($1, $2, $3) returning id", slug, $"deck a06 {tag}", "tests");
      return (Long(id), slug);
    }

    public async Task<long> NewCardAsync(long deckId, string uid) =>
      Long(await ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) " +
        "values ($1, $2, 'Synthetic accepted question?', 'synthetic explanation', 2, " +
        "(select coalesce(max(order_in_deck), 0) + 10 from cards where deck_id = $1)) returning id", deckId, uid));

    public async Task<long> NewQueueItemAsync(long? deckId, string status = "done", string notBefore = "now()", string finishedAt = "now()",
      string title = "Synthetic queue item")
    {
      var claimed = status == "claimed";
      var finished = status is "done" or "failed" or "skipped";
      return Long(await ScalarAsync(
        $"""
        insert into authoring_queue_items (kind, url, deck_id, title, dedupe_key, created_by, status, not_before, finished_at,
          claimed_by_runner, claimed_at, lease_expires_at)
        values ('manual', $1, $2::bigint, $3, $4, 'owner:it-a06', $5, {notBefore}, {(finished ? finishedAt : "null")},
          {(claimed ? "'it-a06-runner'" : "null")}, {(claimed ? "now()" : "null")}, {(claimed ? "now() + interval '1 hour'" : "null")})
        returning id
        """, $"https://docs.example.com/a06/{Guid.NewGuid():N}", deckId, title, $"it-a06:{Guid.NewGuid()}", status));
    }

    public async Task<Guid> NewRunAsync(long? deckId, string status = "completed", string startedAt = "now()")
    {
      var item = await NewQueueItemAsync(deckId);
      var runId = Guid.NewGuid();
      await QueryAsync(
        $"""
        insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status, outcome, started_at, completed_at, error)
        values ($1, $2, 'it-a06-runner', 'it-a06-owner', $3::bigint, $4,
          case when $4 = 'running' then null when $4 = 'failed' then 'failed' else 'done' end,
          {startedAt}, case when $4 = 'running' then null else now() end, case when $4 = 'failed' then 'synthetic failure' end)
        """, runId, item, deckId, status);
      return runId;
    }

    public async Task<long> NewDraftAsync(long deckId, string uid, string? question = null)
    {
      var card = JsonSerializer.Serialize(AutomationTestKit.Card(uid, question));
      return Long(await ScalarAsync(
        """
        insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, card, submitted_by_sub)
        values ($1, $2, $3, $4, $5::jsonb, 'it-a06-agent') returning id
        """, deckId, Guid.NewGuid(), Guid.NewGuid().ToString("N"), uid, card));
    }

    /// <summary>A draft and its decision; <paramref name="qa"/> gives it a QA job. Returns the draft id.</summary>
    public async Task<long> NewDecisionAsync(long deckId, Guid runId, string state, string? reason = null, bool qa = false,
      string? humanAction = null, decimal cost = 0m, string createdAt = "now()", long? acceptedCardId = null, string? question = null,
      string mode = "dry_run")
    {
      var uid = Uid(state);
      var draftId = await NewDraftAsync(deckId, uid, question);
      await QueryAsync(
        $"""
        insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, reason, reason_detail, qa_job_id, qa_content_sha256,
          qa_attempts, qa_enqueued_at, qa_status, qa_provider, qa_model, qa_prompt_version, blocker_count, major_count, minor_count,
          estimated_cost_usd, accepted_card_id, accepted_content_sha256, human_action, human_reason, human_decided_at, created_at, updated_at,
          decided_at)
        values ($1, $2, $3, $4, $5, $6::text, case when $6::text is not null then 'synthetic detail' end,
          $7::uuid, case when $7::uuid is not null then repeat('c', 64) end, case when $7::uuid is not null then 1 else 0 end,
          case when $7::uuid is not null then now() end,
          case when $7::uuid is not null and $5 <> 'qa_queued' then 'done' end,
          case when $7::uuid is not null then 'bedrock-converse' end, case when $7::uuid is not null then 'global.openai.gpt-5.5' end,
          case when $7::uuid is not null then 'qa-v4' end,
          case when $5 = 'human' and $6::text = 'QA_FLAGGED' then 1 else 0 end, 0, case when $7::uuid is not null then 2 else 0 end,
          $8, $9::bigint, case when $5 = 'auto_accepted' then repeat('d', 64) end,
          $10::text, case when $10::text is not null then 'synthetic human reason' end, case when $10::text is not null then now() end,
          {createdAt}, {createdAt}, case when $5 in ('would_accept', 'auto_accepted', 'human', 'superseded') then {createdAt} end)
        """,
        draftId, runId, deckId, mode, state, reason, qa ? Guid.NewGuid() : null, cost, acceptedCardId, humanAction);
      // The spend, dated like the decision (R18B backend-design-4: spend is read from automation_qa_spend).
      if (cost > 0)
      {
        await QueryAsync(
          $"insert into automation_qa_spend (qa_job_id, request_key, draft_id, estimated_cost_usd, spent_at) values ($1, '', $2, $3, {createdAt})",
          Guid.NewGuid(), draftId, cost);
      }
      return draftId;
    }
  }

  // ---------------------------------------------------------------- helpers

  private static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);
  private static string Uid(string tag) => $"a06-{tag.Replace('_', '-')}-{Guid.NewGuid():N}"[..40];

  private static AuthContext Ctx(bool superAdmin = false, bool admin = true) => new(
    Claims: new Dictionary<string, JsonElement>(),
    UserSub: $"it-a06-{Guid.NewGuid():N}",
    Username: null,
    Groups: superAdmin ? ["super_admin"] : admin ? ["editor"] : [],
    IsSuperAdmin: superAdmin,
    IsEditor: admin && !superAdmin,
    IsAdmin: admin,
    IsAgentClient: false);

  private static async Task<APIGatewayProxyResponse> CallAsync(string path, IDictionary<string, string>? query = null, AuthContext? auth = null,
    string method = "GET")
  {
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
      headers = new Dictionary<string, string> { ["content-type"] = "application/json" },
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    }));
    var res = new Res(req.TraceId);
    auth ??= Ctx();
    if (path == StatusPath) return await StatusRoutes.HandleStatus(req, res, auth);
    if (path == RunsPath) return await StatusRoutes.HandleRuns(req, res, auth);
    if (path == DecisionsPath) return await StatusRoutes.HandleDecisions(req, res, auth);
    return await StatusRoutes.HandleDecision(req, res, auth, path[(DecisionsPath.Length + 1)..]);
  }

  private static async Task<JsonElement> DataAsync(string path, IDictionary<string, string>? query = null, AuthContext? auth = null) =>
    AutomationTestKit.Data(await CallAsync(path, query, auth));

  private static string[] Keys(JsonElement el) => el.EnumerateObject().Select(p => p.Name).ToArray();

  private static string Cursor(string json) => CursorCodec.ToBase64Url(Encoding.UTF8.GetBytes(json));

  // ---------------------------------------------------------------- status

  [Fact]
  public async Task Status_ReportsModeRunnersQueueAndSpend()
  {
    await InFreshAsync("it_a06_status_main", async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("status");

      await db.QueryAsync(
        """
        insert into automation_runners (runner_id, owner_sub, host, runner_version, claude_version, state, login_expires_at, last_heartbeat_at,
          last_run_at, last_run_outcome)
        values ('it-a06-mac', 'it-a06-owner', 'synthetic-host', '1.0.0', '2.0.0 (Claude Code)', 'idle',
          now() + interval '10 days 12 hours 1 minute', now(), now() - interval '1 hour', 'done')
        """);

      await db.NewQueueItemAsync(deckId, "queued");                                            // due
      await db.NewQueueItemAsync(deckId, "queued", notBefore: "now() + interval '1 hour'");    // queued, not due
      await db.NewQueueItemAsync(null, "queued");                                              // queued, no deck: never due
      await db.NewQueueItemAsync(deckId, "claimed");
      await db.NewQueueItemAsync(deckId, "failed");
      await db.NewQueueItemAsync(deckId, "skipped");
      var oldDone = await db.NewQueueItemAsync(deckId, "done", finishedAt: "now() - interval '10 days'");

      // Every run adds one finished `done` item of its own (NewRunAsync): one run ⇒ doneLast7d = 1.
      var run = await db.NewRunAsync(deckId);
      await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED", qa: true, cost: 0.02m);
      await db.NewDecisionAsync(deckId, run, "qa_queued", qa: true);
      await db.NewDecisionAsync(deckId, run, "human", "UNGROUNDED");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, cost: 0.5m, createdAt: "now() - interval '2 days'");

      await db.QueryAsync(
        """
        insert into automation_publishes (deck_id, run_id, mode, state, created_at) values
          ($1, $2, 'dry_run', 'would_publish', now()),
          ($1, $2, 'dry_run', 'human', now() - interval '10 days')
        """, deckId, run);

      await db.QueryAsync(
        """
        insert into source_watch_targets (kind, url, feed_format, deck_id, active, check_interval_minutes, last_checked_at, consecutive_failures)
        values ('page', 'https://docs.example.com/a06/watch/failing', null, $1, true, 360, now() - interval '5 minutes', 3),
               ('page', 'https://docs.example.com/a06/watch/inactive', null, $1, false, 360, now() - interval '1 day', 0)
        """, deckId);
      var targetId = Long(await db.ScalarAsync("select id from source_watch_targets where url = 'https://docs.example.com/a06/watch/failing'"));
      await db.QueryAsync(
        """
        insert into source_watch_events (target_id, watch_run_id, kind, created_at) values
          ($1, gen_random_uuid(), 'changed', now()), ($1, gen_random_uuid(), 'gone', now()),
          ($1, gen_random_uuid(), 'baseline', now()), ($1, gen_random_uuid(), 'changed', now() - interval '10 days')
        """, targetId);

      await db.QueryAsync(
        """
        insert into automation_notifications (notification_id, kind, subject, body_text, mode, status, sent_at, created_at, updated_at) values
          (gen_random_uuid(), 'test', 'Synthetic sent', 'body', 'dry_run', 'sent', now() - interval '1 hour', now(), now()),
          (gen_random_uuid(), 'test', 'Synthetic old sent', 'body', 'dry_run', 'sent', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days'),
          (gen_random_uuid(), 'test', 'Synthetic failed', 'body', 'dry_run', 'failed', null, now(), now()),
          (gen_random_uuid(), 'test', 'Synthetic queued', 'body', 'dry_run', 'queued', null, now(), now()),
          (gen_random_uuid(), 'test', 'Synthetic enqueue failed', 'body', 'dry_run', 'enqueue_failed', null, now(), now())
        """);
      // R18B K6: sent to SQS two hours ago (attempts 1) and never reported: unconfirmed, and still counted as queued.
      await db.QueryAsync(
        """
        insert into automation_notifications (notification_id, kind, subject, body_text, mode, status, attempts, created_at, updated_at)
        values (gen_random_uuid(), 'test', 'Synthetic unconfirmed', 'body', 'dry_run', 'queued', 1, now() - interval '2 hours', now() - interval '2 hours')
        """);

      var data = await DataAsync(StatusPath);

      using var contract = JsonDocument.Parse(StatusContractJson);
      var c = contract.RootElement;
      Assert.Equal(Keys(c), Keys(data));
      foreach (var key in new[] { "mode", "queue", "shadow", "spend", "watch", "notifications", "backlog" })
      {
        Assert.Equal(Keys(c.GetProperty(key)), Keys(data.GetProperty(key)));
      }
      Assert.Equal(Keys(c.GetProperty("decisions24h")), Keys(data.GetProperty("decisions24h")));
      Assert.Equal(Keys(c.GetProperty("publishes7d")), Keys(data.GetProperty("publishes7d")));
      Assert.EndsWith("Z", data.GetProperty("serverTime").GetString());

      var mode = data.GetProperty("mode");
      Assert.Equal("dry_run", mode.GetProperty("configured").GetString());
      Assert.Equal("dry_run", mode.GetProperty("effective").GetString());
      Assert.Equal(JsonValueKind.Null, mode.GetProperty("liveBlockedReason").ValueKind);
      Assert.True(mode.GetProperty("autoPublish").GetBoolean());
      Assert.Equal(JsonValueKind.Null, data.GetProperty("evalGate").ValueKind);

      var runner = Assert.Single(data.GetProperty("runners").EnumerateArray());
      Assert.Equal(RunnerKeys, Keys(runner));
      Assert.Equal("it-a06-mac", runner.GetProperty("runnerId").GetString());
      Assert.Equal("synthetic-host", runner.GetProperty("host").GetString());
      Assert.Equal("idle", runner.GetProperty("state").GetString());
      Assert.False(runner.GetProperty("stale").GetBoolean());
      Assert.Equal(10.5m, runner.GetProperty("loginExpiresInDays").GetDecimal());
      Assert.Equal("done", runner.GetProperty("lastRunOutcome").GetString());
      Assert.Equal(JsonValueKind.Null, runner.GetProperty("lastError").ValueKind);

      var queue = data.GetProperty("queue");
      Assert.Equal(3, queue.GetProperty("queued").GetInt64());
      Assert.Equal(1, queue.GetProperty("due").GetInt64());
      Assert.Equal(1, queue.GetProperty("claimed").GetInt64());
      Assert.Equal(1, queue.GetProperty("failed").GetInt64());
      Assert.Equal(1, queue.GetProperty("doneLast7d").GetInt64());
      Assert.True(oldDone > 0);

      var byState = data.GetProperty("decisions24h").GetProperty("byState");
      Assert.Equal(["qa_pending", "qa_queued", "would_accept", "auto_accepted", "human", "superseded"], Keys(byState));
      Assert.Equal(2, byState.GetProperty("human").GetInt64());
      Assert.Equal(1, byState.GetProperty("qa_queued").GetInt64());
      Assert.Equal(0, byState.GetProperty("would_accept").GetInt64());
      var byReason = data.GetProperty("decisions24h").GetProperty("byReason");
      Assert.Equal(["QA_FLAGGED", "UNGROUNDED"], Keys(byReason));
      Assert.Equal(1, byReason.GetProperty("QA_FLAGGED").GetInt64());

      var publishes = data.GetProperty("publishes7d").GetProperty("byState");
      Assert.Equal(["waiting", "publishing", "published", "would_publish", "human"], Keys(publishes));
      Assert.Equal(1, publishes.GetProperty("would_publish").GetInt64());
      Assert.Equal(0, publishes.GetProperty("human").GetInt64());

      // Spend: today's decision cost (0.02; the 2-day-old 0.5 is not today), one open qa_queued card × 0.05, the default cap.
      var spend = data.GetProperty("spend");
      Assert.Equal(0.02m, spend.GetProperty("todayUsd").GetDecimal());
      Assert.Equal(0.02m, spend.GetProperty("automationTodayUsd").GetDecimal());
      Assert.Equal(0.05m, spend.GetProperty("reservedUsd").GetDecimal());
      Assert.Equal(10m, spend.GetProperty("dailyCapUsd").GetDecimal());

      // Migration 034 seeds two inactive feed targets when their decks do not exist: 2 + 2 targets.
      var watch = data.GetProperty("watch");
      Assert.Equal(4, watch.GetProperty("targets").GetInt64());
      Assert.Equal(1, watch.GetProperty("active").GetInt64());
      Assert.Equal(1, watch.GetProperty("failing").GetInt64());
      Assert.EndsWith("Z", watch.GetProperty("lastCheckedAt").GetString());
      Assert.Equal(2, watch.GetProperty("changes7d").GetInt64());

      var notifications = data.GetProperty("notifications");
      Assert.Equal(1, notifications.GetProperty("sent24h").GetInt64());
      Assert.Equal(1, notifications.GetProperty("failed24h").GetInt64());
      Assert.Equal(3, notifications.GetProperty("queued").GetInt64());
      Assert.Equal(1, notifications.GetProperty("unconfirmed").GetInt64());
      Assert.EndsWith("Z", notifications.GetProperty("lastSentAt").GetString());
      Assert.DoesNotContain("@", data.GetProperty("notifications").GetRawText());

      // R18B K7: both human drafts are still pending; the only human publish is a dry run's.
      var backlog = data.GetProperty("backlog");
      Assert.Equal(2, backlog.GetProperty("humanPending").GetInt64());
      Assert.EndsWith("Z", backlog.GetProperty("oldestHumanPendingAt").GetString());
      Assert.Equal(0, backlog.GetProperty("humanPublishes").GetInt64());

      // The cap and per-card estimate follow the env, read per call; AUTOMATION_AUTO_PUBLISH=0 is reported.
      Environment.SetEnvironmentVariable(QaRuns.DailyCapEnv, "25");
      Environment.SetEnvironmentVariable(QaRuns.EstUsdPerCardEnv, "0.1");
      Environment.SetEnvironmentVariable(AutomationEnv.AutoPublishEnv, "0");
      var again = await DataAsync(StatusPath);
      Assert.Equal(25m, again.GetProperty("spend").GetProperty("dailyCapUsd").GetDecimal());
      Assert.Equal(0.1m, again.GetProperty("spend").GetProperty("reservedUsd").GetDecimal());
      Assert.False(again.GetProperty("mode").GetProperty("autoPublish").GetBoolean());

      // A runner whose login expiry is unknown reports null days.
      await db.QueryAsync("update automation_runners set login_expires_at = null");
      var unknown = Assert.Single((await DataAsync(StatusPath)).GetProperty("runners").EnumerateArray());
      Assert.Equal(JsonValueKind.Null, unknown.GetProperty("loginExpiresInDays").ValueKind);
      Assert.Equal(JsonValueKind.Null, unknown.GetProperty("loginExpiresAt").ValueKind);
    });
  }

  [Fact]
  public async Task Status_ShadowAgreement_CountsHumanDecisions()
  {
    await InFreshAsync("it_a06_status_shadow", async db =>
    {
      var empty = (await DataAsync(StatusPath)).GetProperty("shadow");
      Assert.Equal(0, empty.GetProperty("wouldAccept").GetInt64());
      Assert.Equal(JsonValueKind.Null, empty.GetProperty("agreementRate").ValueKind);

      var (deckId, _) = await db.NewDeckAsync("shadow");
      var run = await db.NewRunAsync(deckId);
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "accepted");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "accepted", createdAt: "now() - interval '20 days'");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "edited_accepted");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true);
      // Outside the window or not would_accept: not counted.
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected", createdAt: "now() - interval '40 days'");
      await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED", qa: true, humanAction: "accepted");
      // R18C automation-4: the agreement counts only decisions made blind; every decision here was.
      async Task MarkAllBlindAsync() => await db.QueryAsync(
        """
        insert into automation_decision_events (draft_id, from_state, to_state, reason, actor, mode, details)
        select dd.draft_id, dd.state, dd.state, 'HUMAN_ACTION', 'human:it-c02', 'dry_run', '{"blinded":true}'::jsonb
        from automation_draft_decisions dd
        where dd.human_action is not null
          and not exists (select 1 from automation_decision_events e where e.draft_id = dd.draft_id and e.reason = 'HUMAN_ACTION')
        """);
      await MarkAllBlindAsync();

      var shadow = (await DataAsync(StatusPath)).GetProperty("shadow");
      Assert.Equal(5, shadow.GetProperty("wouldAccept").GetInt64());
      Assert.Equal(4, shadow.GetProperty("humanDecided").GetInt64());
      Assert.Equal(2, shadow.GetProperty("humanAccepted").GetInt64());
      Assert.Equal(1, shadow.GetProperty("humanEditedAccepted").GetInt64());
      Assert.Equal(1, shadow.GetProperty("humanRejected").GetInt64());
      Assert.Equal(0.5m, shadow.GetProperty("agreementRate").GetDecimal());

      // Four decimal places: 2 / 3.
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected");
      await MarkAllBlindAsync();
      var third = (await DataAsync(StatusPath)).GetProperty("shadow");
      Assert.Equal(10, third.GetProperty("humanDecided").GetInt64());
      Assert.Equal(0.2m, third.GetProperty("agreementRate").GetDecimal());
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "accepted");
      await MarkAllBlindAsync();
      var eleventh = (await DataAsync(StatusPath)).GetProperty("shadow");
      Assert.Equal(0.2727m, eleventh.GetProperty("agreementRate").GetDecimal());
    });
  }

  [Fact]
  public async Task Status_StaleRunner_IsFlagged()
  {
    await InScratchAsync(async db =>
    {
      var fresh = $"it-a06-fresh-{Guid.NewGuid():N}"[..40];
      var old = $"it-a06-old-{Guid.NewGuid():N}"[..40];
      var recent = $"it-a06-recent-{Guid.NewGuid():N}"[..40];
      await db.QueryAsync(
        """
        insert into automation_runners (runner_id, owner_sub, state, last_heartbeat_at) values
          ($1, 'it-a06-owner', 'idle', now()),
          ($2, 'it-a06-owner', 'running', now() - interval '25 hours'),
          ($3, 'it-a06-owner', 'idle', now() - interval '2 hours')
        """, fresh, old, recent);

      JsonElement Runner(JsonElement data, string id) =>
        data.GetProperty("runners").EnumerateArray().Single(r => r.GetProperty("runnerId").GetString() == id);

      // Default AUTOMATION_RUNNER_STALE_MINUTES = 1440.
      var data = await DataAsync(StatusPath);
      Assert.False(Runner(data, fresh).GetProperty("stale").GetBoolean());
      Assert.True(Runner(data, old).GetProperty("stale").GetBoolean());
      Assert.False(Runner(data, recent).GetProperty("stale").GetBoolean());

      Environment.SetEnvironmentVariable(AutomationEnv.RunnerStaleMinutesEnv, "60");
      data = await DataAsync(StatusPath);
      Assert.False(Runner(data, fresh).GetProperty("stale").GetBoolean());
      Assert.True(Runner(data, old).GetProperty("stale").GetBoolean());
      Assert.True(Runner(data, recent).GetProperty("stale").GetBoolean());
    });
  }

  [Fact]
  public async Task Status_LiveWithoutGate_ReportsEvalGateMissing()
  {
    await InScratchAsync(async db =>
    {
      var mode = (await DataAsync(StatusPath)).GetProperty("mode");
      Assert.Equal("live", mode.GetProperty("configured").GetString());
      Assert.Equal("dry_run", mode.GetProperty("effective").GetString());
      Assert.Equal("EVAL_GATE_MISSING", mode.GetProperty("liveBlockedReason").GetString());

      long gateId = 0;
      try
      {
        gateId = Long(await db.ScalarAsync(
          "insert into automation_eval_gates (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report, created_by_sub) " +
          "values ('bedrock-converse', 'global.openai.gpt-5.5', $1, true, '{\"seededRecall\":0.92}'::jsonb, $2, '{}'::jsonb, 'it-a06') returning id",
          QaRuns.PromptVersion, new string('e', 64)));

        var live = await DataAsync(StatusPath);
        Assert.Equal("live", live.GetProperty("mode").GetProperty("effective").GetString());
        Assert.Equal(JsonValueKind.Null, live.GetProperty("mode").GetProperty("liveBlockedReason").ValueKind);
        var gate = live.GetProperty("evalGate");
        Assert.Equal(gateId, gate.GetProperty("gateId").GetInt64());
        Assert.Equal("bedrock-converse", gate.GetProperty("reviewer").GetProperty("provider").GetString());
        Assert.Equal(0.92, gate.GetProperty("metrics").GetProperty("seededRecall").GetDouble());
      }
      finally
      {
        await db.QueryAsync("update automation_eval_gates set revoked_at = now(), revoked_by_sub = 'it-a06' where revoked_at is null");
      }

      var revoked = await DataAsync(StatusPath);
      Assert.Equal("dry_run", revoked.GetProperty("mode").GetProperty("effective").GetString());
      Assert.Equal("EVAL_GATE_MISSING", revoked.GetProperty("mode").GetProperty("liveBlockedReason").GetString());
      Assert.Equal(JsonValueKind.Null, revoked.GetProperty("evalGate").ValueKind);
      Assert.True(gateId > 0);
    }, new Dictionary<string, string?> { [AutomationMode.EnvName] = AutomationMode.Live });
  }

  [Fact]
  public async Task Status_Backlog_CountsOnlyOpenExceptions_WhenEverRaised()
  {
    // R18B K7 (automation-10): the open-exception backlog, not the last 24 h.
    await InFreshAsync("it_b02_status_backlog", async db =>
    {
      var (deckId, slug) = await db.NewDeckAsync("backlog");
      var (otherDeck, otherSlug) = await db.NewDeckAsync("backlog-other");
      var run = await db.NewRunAsync(deckId);

      var empty = (await DataAsync(StatusPath)).GetProperty("backlog");
      Assert.Equal((0L, JsonValueKind.Null, 0L), (empty.GetProperty("humanPending").GetInt64(), empty.GetProperty("oldestHumanPendingAt").ValueKind,
        empty.GetProperty("humanPublishes").GetInt64()));

      // Open: routed 20 days ago and still pending; routed today.
      await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED", createdAt: "now() - interval '20 days'");
      await db.NewDecisionAsync(deckId, run, "human", "UNGROUNDED");
      // Handled by a person (the draft left 'pending' with it), or a draft decided outside the decision: not open.
      var handled = await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED", humanAction: "rejected");
      await db.QueryAsync("update ai_drafts set status = 'rejected', decided_at = now(), decided_by_sub = 'it-b02' where id = $1", handled);
      var gone = await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED");
      await db.QueryAsync("update ai_drafts set status = 'rejected', decided_at = now(), decided_by_sub = 'it-b02' where id = $1", gone);
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true);

      // Publishes: an unresolved live human row; a live human row the person resolved by publishing the deck later;
      // a dry-run human row (nothing was accepted).
      await db.QueryAsync(
        """
        insert into automation_publishes (deck_id, run_id, mode, state, reason, created_at, updated_at) values
          ($1, $3, 'live', 'human', 'DECK_HAS_HUMAN_CHANGES', now() - interval '12 days', now() - interval '12 days'),
          ($2, $3, 'live', 'human', 'DECK_HAS_HUMAN_CHANGES', now() - interval '3 hours', now() - interval '3 hours'),
          ($1, $3, 'dry_run', 'human', 'DECK_HAS_HUMAN_CHANGES', now(), now())
        """, deckId, otherDeck, run);
      await db.QueryAsync(
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, status, created_at) values ($1, $2, 'b02-build', 'decks/b02', 'SUCCESS', now() - interval '1 hour')",
        otherDeck, otherSlug);
      // A successful publish of the first deck from before its row went human does not resolve it.
      await db.QueryAsync(
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, status, created_at) values ($1, $2, 'b02-old', 'decks/b02-old', 'SUCCESS', now() - interval '13 days')",
        deckId, slug);

      var backlog = (await DataAsync(StatusPath)).GetProperty("backlog");
      Assert.Equal(2, backlog.GetProperty("humanPending").GetInt64());
      var oldest = DateTimeOffset.Parse(backlog.GetProperty("oldestHumanPendingAt").GetString()!, CultureInfo.InvariantCulture);
      Assert.InRange(DateTimeOffset.UtcNow - oldest, TimeSpan.FromDays(19.9), TimeSpan.FromDays(20.1));
      Assert.Equal(1, backlog.GetProperty("humanPublishes").GetInt64());
    });
  }

  // ---------------------------------------------------------------- runs

  [Fact]
  public async Task Runs_ListWithCountsAndPublishes()
  {
    await InScratchAsync(async db =>
    {
      var (deckId, slug) = await db.NewDeckAsync("runs");
      var (otherDeck, _) = await db.NewDeckAsync("runs-other");
      var runA = await db.NewRunAsync(deckId, startedAt: "now() - interval '1 minute'");
      var runB = await db.NewRunAsync(deckId, "failed");
      // R18B K3 (automation-3): the runner's final-message notes are readable.
      await db.QueryAsync("update automation_runs set summary = $2 where run_id = $1", runA, "Card synthetic-07 looks outdated.");

      var cardId = await db.NewCardAsync(deckId, Uid("card"));
      await db.NewDecisionAsync(deckId, runA, "qa_pending", "AI_QA_DAILY_CAP");
      await db.NewDecisionAsync(deckId, runA, "qa_queued", qa: true);
      await db.NewDecisionAsync(deckId, runA, "would_accept", qa: true);
      await db.NewDecisionAsync(deckId, runA, "auto_accepted", qa: true, acceptedCardId: cardId, mode: "live");
      await db.NewDecisionAsync(deckId, runA, "human", "QA_FLAGGED", qa: true);
      await db.NewDecisionAsync(deckId, runA, "human", "UNGROUNDED");
      await db.NewDecisionAsync(deckId, runA, "superseded", "DECIDED_BY_HUMAN");

      var own = Long(await db.ScalarAsync(
        "insert into automation_publishes (deck_id, run_id, mode, state, job_id, build_id) values ($1, $2, 'live', 'published', 'job-a06', 'build-a06') returning id",
        deckId, runA));
      var byCard = Long(await db.ScalarAsync(
        "insert into automation_publishes (deck_id, run_id, mode, state, reason, reason_detail, card_ids) " +
        "values ($1, null, 'live', 'human', 'DECK_HAS_HUMAN_CHANGES', 'synthetic detail', $2) returning id",
        deckId, new[] { cardId }));
      await db.ScalarAsync("insert into automation_publishes (deck_id, mode, state) values ($1, 'dry_run', 'would_publish') returning id", otherDeck);

      var data = await DataAsync(RunsPath, new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) });
      Assert.Equal(["items", "nextCursor"], Keys(data));
      Assert.Equal(JsonValueKind.Null, data.GetProperty("nextCursor").ValueKind);
      var items = data.GetProperty("items").EnumerateArray().ToList();
      Assert.Equal([runB, runA], items.Select(i => i.GetProperty("runId").GetGuid()).ToList());

      var a = items[1];
      Assert.Equal(RunKeys, Keys(a));
      Assert.Equal("manual", a.GetProperty("kind").GetString());
      Assert.StartsWith("https://docs.example.com/a06/", a.GetProperty("url").GetString());
      Assert.Equal("Synthetic queue item", a.GetProperty("title").GetString());
      Assert.Equal(deckId, a.GetProperty("deckId").GetInt64());
      Assert.Equal(slug, a.GetProperty("deckSlug").GetString());
      Assert.Equal("it-a06-runner", a.GetProperty("runnerId").GetString());
      Assert.Equal("completed", a.GetProperty("status").GetString());
      Assert.Equal("done", a.GetProperty("outcome").GetString());
      Assert.EndsWith("Z", a.GetProperty("startedAt").GetString());
      Assert.Equal(JsonValueKind.Null, a.GetProperty("finalizedAt").ValueKind);
      Assert.Equal(JsonValueKind.Null, a.GetProperty("summaryNotificationId").ValueKind);
      Assert.Equal("Card synthetic-07 looks outdated.", a.GetProperty("summary").GetString());

      var counts = a.GetProperty("counts");
      Assert.Equal(RunCountKeys, Keys(counts));
      Assert.Equal(7, counts.GetProperty("submitted").GetInt64());
      Assert.Equal(1, counts.GetProperty("qaPending").GetInt64());
      Assert.Equal(1, counts.GetProperty("qaQueued").GetInt64());
      Assert.Equal(1, counts.GetProperty("wouldAccept").GetInt64());
      Assert.Equal(1, counts.GetProperty("autoAccepted").GetInt64());
      Assert.Equal(2, counts.GetProperty("human").GetInt64());
      Assert.Equal(1, counts.GetProperty("superseded").GetInt64());

      var publishes = a.GetProperty("publishes").EnumerateArray().ToList();
      Assert.Equal([own, byCard], publishes.Select(p => p.GetProperty("publishId").GetInt64()).ToList());
      Assert.Equal(PublishKeys, Keys(publishes[0]));
      Assert.Equal("published", publishes[0].GetProperty("state").GetString());
      Assert.Equal("job-a06", publishes[0].GetProperty("jobId").GetString());
      Assert.Equal("build-a06", publishes[0].GetProperty("buildId").GetString());
      Assert.Equal(slug, publishes[0].GetProperty("deckSlug").GetString());
      Assert.Equal("DECK_HAS_HUMAN_CHANGES", publishes[1].GetProperty("reason").GetString());
      Assert.Equal("synthetic detail", publishes[1].GetProperty("reasonDetail").GetString());

      var b = items[0];
      Assert.Equal("failed", b.GetProperty("status").GetString());
      Assert.Equal("synthetic failure", b.GetProperty("error").GetString());
      Assert.Equal(JsonValueKind.Null, b.GetProperty("summary").ValueKind);
      Assert.All(RunCountKeys, k => Assert.Equal(0, b.GetProperty("counts").GetProperty(k).GetInt64()));
      Assert.Empty(b.GetProperty("publishes").EnumerateArray());

      var failed = await DataAsync(RunsPath, new Dictionary<string, string>
      {
        ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
        ["status"] = "failed",
      });
      Assert.Equal([runB], failed.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("runId").GetGuid()).ToList());

      AutomationTestKit.AssertError(await CallAsync(RunsPath, new Dictionary<string, string> { ["status"] = "done" }), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(RunsPath, new Dictionary<string, string> { ["deckId"] = "x" }), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(RunsPath, new Dictionary<string, string> { ["limit"] = "0" }), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(RunsPath, new Dictionary<string, string> { ["limit"] = "101" }), 400, "VALIDATION_ERROR");
    });
  }

  [Fact]
  public async Task Runs_PaginateWithCursor()
  {
    await InScratchAsync(async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("pages");
      const string same = "'2026-09-01 10:20:30.123456+00'::timestamptz";
      var created = new List<Guid>
      {
        await db.NewRunAsync(deckId, startedAt: same),
        await db.NewRunAsync(deckId, startedAt: same),
        await db.NewRunAsync(deckId, startedAt: same),
        await db.NewRunAsync(deckId, startedAt: "'2026-09-01 10:20:30.123455+00'::timestamptz"),
      };
      var expected = (await db.QueryAsync("select run_id from automation_runs where deck_id = $1 order by started_at desc, run_id", deckId))
        .Select(r => (Guid)r["run_id"]!).ToList();
      Assert.Equal(created[3], expected[^1]);

      var seen = new List<Guid>();
      string? cursor = null;
      var pages = 0;
      do
      {
        var query = new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture), ["limit"] = "2" };
        if (cursor is not null) query["cursor"] = cursor;
        var page = await DataAsync(RunsPath, query);
        var ids = page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("runId").GetGuid()).ToList();
        Assert.InRange(ids.Count, 1, 2);
        seen.AddRange(ids);
        cursor = page.GetProperty("nextCursor").GetString();
        if (cursor is not null)
        {
          using var doc = JsonDocument.Parse(CursorCodec.FromBase64Url(cursor)!);
          Assert.Equal(["v", "at", "id"], Keys(doc.RootElement));
          Assert.Equal(1, doc.RootElement.GetProperty("v").GetInt32());
          Assert.Equal(ids[^1].ToString("D"), doc.RootElement.GetProperty("id").GetString());
        }
        pages++;
      } while (cursor is not null && pages < 10);

      Assert.Equal(2, pages);
      Assert.Equal(expected, seen);

      // Page size 1 walks the same-timestamp batch one row at a time: no repeat, no gap.
      seen.Clear();
      cursor = null;
      pages = 0;
      do
      {
        var query = new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture), ["limit"] = "1" };
        if (cursor is not null) query["cursor"] = cursor;
        var page = await DataAsync(RunsPath, query);
        seen.AddRange(page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("runId").GetGuid()));
        cursor = page.GetProperty("nextCursor").GetString();
        pages++;
      } while (cursor is not null && pages < 10);
      Assert.Equal(expected, seen);
    });
  }

  [Fact]
  public async Task Runs_InvalidCursor_Returns400ValidationError()
  {
    await InScratchAsync(async _ =>
    {
      var bad = new[]
      {
        "not-a-cursor!",
        "a",
        Cursor("[]"),
        Cursor("{\"v\":2,\"at\":\"2026-09-01T10:20:30.123456Z\",\"id\":\"" + Guid.NewGuid() + "\"}"),
        Cursor("{\"at\":\"2026-09-01T10:20:30.123456Z\",\"id\":\"" + Guid.NewGuid() + "\"}"),
        Cursor("{\"v\":1,\"at\":\"yesterday\",\"id\":\"" + Guid.NewGuid() + "\"}"),
        Cursor("{\"v\":1,\"at\":\"2026-09-01T10:20:30.123456Z\",\"id\":\"not-a-uuid\"}"),
        Cursor("{\"v\":1,\"at\":\"2026-09-01T10:20:30.123456Z\"}"),
        Cursor("{\"v\":1,\"id\":1}"),
        Cursor("{\"v\":1,\"u\":1790000000000}"),
      };
      foreach (var cursor in bad)
      {
        AutomationTestKit.AssertError(await CallAsync(RunsPath, new Dictionary<string, string> { ["cursor"] = cursor }), 400, "VALIDATION_ERROR");
      }

      // A decisions cursor carries a draft id, never a uuid.
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, new Dictionary<string, string>
      {
        ["cursor"] = Cursor("{\"v\":1,\"at\":\"2026-09-01T10:20:30.123456Z\",\"id\":\"" + Guid.NewGuid() + "\"}"),
      }), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, new Dictionary<string, string> { ["cursor"] = "%%%" }), 400, "VALIDATION_ERROR");

      // A well-formed cursor is accepted.
      var ok = await CallAsync(RunsPath, new Dictionary<string, string>
      {
        ["cursor"] = Cursor("{\"v\":1,\"at\":\"2026-09-01T10:20:30.123456Z\",\"id\":\"" + Guid.NewGuid() + "\"}"),
      });
      Assert.Equal(200, ok.StatusCode);
    });
  }

  // ---------------------------------------------------------------- decisions

  [Fact]
  public async Task Decisions_FilterByRunStateAndReason()
  {
    await InScratchAsync(async db =>
    {
      var (deckId, slug) = await db.NewDeckAsync("decisions");
      var runA = await db.NewRunAsync(deckId);
      var runB = await db.NewRunAsync(deckId);
      const string same = "'2026-09-02 08:00:00.654321+00'::timestamptz";
      var longQuestion = "Synthetic long question " + new string('q', 240) + "?";
      var flagged = await db.NewDecisionAsync(deckId, runA, "human", "QA_FLAGGED", qa: true, cost: 0.0123m, createdAt: same);
      var ungrounded = await db.NewDecisionAsync(deckId, runA, "human", "UNGROUNDED", createdAt: same, question: longQuestion);
      var would = await db.NewDecisionAsync(deckId, runA, "would_accept", qa: true, createdAt: same);
      var otherFlagged = await db.NewDecisionAsync(deckId, runB, "human", "QA_FLAGGED", qa: true);

      static Dictionary<string, string> Q(params (string K, string V)[] kv) => kv.ToDictionary(x => x.K, x => x.V);
      static List<long> Ids(JsonElement data) =>
        data.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("draftId").GetInt64()).ToList();
      var deck = deckId.ToString(CultureInfo.InvariantCulture);

      var byRun = await DataAsync(DecisionsPath, Q(("runId", runA.ToString())));
      Assert.Equal([flagged, ungrounded, would], Ids(byRun));
      Assert.Equal(JsonValueKind.Null, byRun.GetProperty("nextCursor").ValueKind);
      Assert.Equal([flagged, ungrounded], Ids(await DataAsync(DecisionsPath, Q(("runId", runA.ToString()), ("state", "human")))));
      Assert.Equal([otherFlagged, flagged], Ids(await DataAsync(DecisionsPath, Q(("deckId", deck), ("reason", "QA_FLAGGED")))));
      Assert.Equal([flagged], Ids(await DataAsync(DecisionsPath, Q(("runId", runA.ToString()), ("reason", "QA_FLAGGED")))));
      Assert.Equal([would], Ids(await DataAsync(DecisionsPath, Q(("deckId", deck), ("state", "would_accept")))));
      Assert.Empty(Ids(await DataAsync(DecisionsPath, Q(("deckId", deck), ("state", "auto_accepted")))));
      Assert.Equal([otherFlagged, flagged, ungrounded, would], Ids(await DataAsync(DecisionsPath, Q(("deckId", deck)))));

      // One-row pages through the same-timestamp batch.
      var seen = new List<long>();
      string? cursor = null;
      for (var i = 0; i < 5; i++)
      {
        var query = Q(("runId", runA.ToString()), ("limit", "1"));
        if (cursor is not null) query["cursor"] = cursor;
        var page = await DataAsync(DecisionsPath, query);
        seen.AddRange(Ids(page));
        cursor = page.GetProperty("nextCursor").GetString();
        if (cursor is null) break;
      }
      Assert.Equal([flagged, ungrounded, would], seen);

      var items = byRun.GetProperty("items").EnumerateArray().ToList();
      var f = items[0];
      Assert.Equal(DecisionKeys, Keys(f));
      Assert.Equal(runA, f.GetProperty("runId").GetGuid());
      Assert.Equal(deckId, f.GetProperty("deckId").GetInt64());
      Assert.Equal(slug, f.GetProperty("deckSlug").GetString());
      Assert.StartsWith("a06-human-", f.GetProperty("stableUid").GetString());
      Assert.Equal("dry_run", f.GetProperty("mode").GetString());
      Assert.Equal("human", f.GetProperty("state").GetString());
      Assert.Equal("QA_FLAGGED", f.GetProperty("reason").GetString());
      Assert.Equal("synthetic detail", f.GetProperty("reasonDetail").GetString());
      var qa = f.GetProperty("qa");
      Assert.Equal(QaKeys, Keys(qa));
      Assert.Equal("done", qa.GetProperty("status").GetString());
      Assert.Equal("bedrock-converse", qa.GetProperty("provider").GetString());
      Assert.Equal("global.openai.gpt-5.5", qa.GetProperty("model").GetString());
      Assert.Equal(QaRuns.PromptVersion, qa.GetProperty("promptVersion").GetString());
      Assert.Equal(1, qa.GetProperty("blocker").GetInt32());
      Assert.Equal(2, qa.GetProperty("minor").GetInt32());
      Assert.Equal(0.0123m, qa.GetProperty("estimatedCostUsd").GetDecimal());
      Assert.Equal(1, qa.GetProperty("attempts").GetInt32());
      Assert.EndsWith("Z", f.GetProperty("createdAt").GetString());
      Assert.EndsWith("Z", f.GetProperty("decidedAt").GetString());

      // No QA was enqueued ⇒ qa is null; the question is cut to 200 characters.
      var u = items[1];
      Assert.Equal(JsonValueKind.Null, u.GetProperty("qa").ValueKind);
      Assert.Equal(longQuestion[..200], u.GetProperty("question").GetString());

      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, Q(("state", "pending"))), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, Q(("reason", "HUMAN_ACTION"))), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, Q(("reason", "qa_flagged"))), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, Q(("runId", "run-1"))), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, Q(("deckId", "-1"))), 400, "VALIDATION_ERROR");
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, Q(("limit", "abc"))), 400, "VALIDATION_ERROR");
    });
  }

  [Fact]
  public async Task Decision_Detail_HasCardFindingsAndEvents()
  {
    await InScratchAsync(async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("detail");
      var run = await db.NewRunAsync(deckId);
      var draftId = await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED", qa: true);
      var jobId = (Guid)(await db.ScalarAsync("select qa_job_id from automation_draft_decisions where draft_id = $1", draftId))!;
      await db.QueryAsync(
        """
        insert into automation_draft_findings (draft_id, qa_job_id, severity, category, message, suggested_fix) values
          ($1, $2, 'blocker', 'incorrect_answer', 'Synthetic blocker finding.', 'Synthetic fix.'),
          ($1, $2, 'minor', 'weak_distractor', 'Synthetic minor finding.', null)
        """, draftId, jobId);
      await db.QueryAsync(
        """
        insert into automation_decision_events (draft_id, from_state, to_state, reason, actor, mode, details, created_at) values
          ($1, null, 'qa_pending', null, 'automation', 'dry_run', null, now() - interval '2 minutes'),
          ($1, 'qa_pending', 'qa_queued', null, 'automation', 'dry_run', '{"qaJobId":"synthetic"}'::jsonb, now() - interval '1 minute'),
          ($1, 'qa_queued', 'human', 'QA_FLAGGED', 'automation', 'dry_run', '{"blocker":1}'::jsonb, now())
        """, draftId);

      var data = await DataAsync($"{DecisionsPath}/{draftId}");
      Assert.Equal(DecisionKeys.Concat(["card", "findings", "events"]).ToArray(), Keys(data));
      Assert.Equal(draftId, data.GetProperty("draftId").GetInt64());
      Assert.Equal(jobId, data.GetProperty("qa").GetProperty("jobId").GetGuid());

      var card = data.GetProperty("card");
      Assert.Equal(["stableUid", "difficulty", "topic", "question", "explanation", "codeSnippet", "codeLanguage", "realWorldUsage", "mcq", "source"],
        Keys(card));
      Assert.Equal(data.GetProperty("stableUid").GetString(), card.GetProperty("stableUid").GetString());
      Assert.Equal(AutomationTestKit.SourceUrl, card.GetProperty("source").GetProperty("url").GetString());
      Assert.Equal(AutomationTestKit.SourceQuote, card.GetProperty("source").GetProperty("quote").GetString());
      Assert.False(card.GetProperty("source").TryGetProperty("grounding", out _));
      Assert.DoesNotContain("grounding", data.GetRawText());
      // The stored draft still has its grounding: only the read drops it.
      Assert.True(await db.ScalarAsync("select card->'source' ? 'grounding' from ai_drafts where id = $1", draftId) is true);

      var findings = data.GetProperty("findings").EnumerateArray().ToList();
      Assert.Equal(2, findings.Count);
      Assert.Equal(["severity", "category", "message", "suggestedFix"], Keys(findings[0]));
      Assert.Equal("blocker", findings[0].GetProperty("severity").GetString());
      Assert.Equal("incorrect_answer", findings[0].GetProperty("category").GetString());
      Assert.Equal("Synthetic fix.", findings[0].GetProperty("suggestedFix").GetString());
      Assert.Equal(JsonValueKind.Null, findings[1].GetProperty("suggestedFix").ValueKind);

      var events = data.GetProperty("events").EnumerateArray().ToList();
      Assert.Equal(3, events.Count);
      Assert.Equal(["fromState", "toState", "reason", "actor", "mode", "details", "createdAt"], Keys(events[0]));
      Assert.Equal(JsonValueKind.Null, events[0].GetProperty("fromState").ValueKind);
      Assert.Equal(JsonValueKind.Null, events[0].GetProperty("details").ValueKind);
      Assert.Equal(["qa_pending", "qa_queued", "human"], events.Select(e => e.GetProperty("toState").GetString()).ToList());
      Assert.Equal("QA_FLAGGED", events[2].GetProperty("reason").GetString());
      Assert.Equal("automation", events[2].GetProperty("actor").GetString());
      Assert.Equal(1, events[2].GetProperty("details").GetProperty("blocker").GetInt32());

      // A decision with no findings or events answers empty arrays.
      var bare = await db.NewDecisionAsync(deckId, run, "qa_pending", "ENQUEUE_RETRY");
      var bareData = await DataAsync($"{DecisionsPath}/{bare}");
      Assert.Empty(bareData.GetProperty("findings").EnumerateArray());
      Assert.Empty(bareData.GetProperty("events").EnumerateArray());
      Assert.Equal(JsonValueKind.Null, bareData.GetProperty("qa").ValueKind);
    });
  }

  [Fact]
  public async Task Decision_Unknown_Returns404DraftDecisionNotFound()
  {
    await InScratchAsync(async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("unknown");
      var plainDraft = await db.NewDraftAsync(deckId, Uid("plain"));   // a review-queue draft with no decision
      foreach (var id in new[] { "abc", "0", "-1", "1.5", (long.MaxValue - 3).ToString(CultureInfo.InvariantCulture),
                                 plainDraft.ToString(CultureInfo.InvariantCulture) })
      {
        AutomationTestKit.AssertError(await CallAsync($"{DecisionsPath}/{id}"), 404, "DRAFT_DECISION_NOT_FOUND");
      }
    });
  }

  // ---------------------------------------------------------------- access

  [Fact]
  public async Task ReadRoutes_Editor_IsAllowed()
  {
    await InScratchAsync(async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("editor");
      var run = await db.NewRunAsync(deckId);
      var draftId = await db.NewDecisionAsync(deckId, run, "human", "UNGROUNDED");
      var paths = new[] { StatusPath, RunsPath, DecisionsPath, $"{DecisionsPath}/{draftId}" };

      var editor = Ctx(superAdmin: false);
      Assert.True(editor.IsEditor && !editor.IsSuperAdmin);
      foreach (var path in paths)
      {
        var response = await CallAsync(path, auth: editor);
        Assert.True(response.StatusCode == 200, $"{path}: {response.StatusCode} {response.Body}");
      }
      foreach (var path in paths) Assert.Equal(200, (await CallAsync(path, auth: Ctx(superAdmin: true))).StatusCode);

      // Not an admin ⇒ 403; the read routes are GET only.
      foreach (var path in paths) AutomationTestKit.AssertError(await CallAsync(path, auth: Ctx(admin: false)), 403, "FORBIDDEN");
      foreach (var path in paths) Assert.Equal(405, (await CallAsync(path, auth: Ctx(superAdmin: true), method: "POST")).StatusCode);
    });
  }

  [Fact]
  public async Task ReadRoutes_AgentToken_IsForbidden()
  {
    const string kid = "cognito-kid-a06";
    const string spaClient = "spa-client-a06";
    const string agentClient = "agent-client-a06";
    using var key = TestJwt.NewKey();
    Auth.Configure(
      AuthOptions.Parse(null, null, "production", null, $"{spaClient},{agentClient}", agentClient),
      new StubJwks(TestJwt.Jwks((kid, key))));
    try
    {
      var payload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, sub: $"it-a06-agent-{Guid.NewGuid():N}", groups: ["super_admin"]);
      payload["client_id"] = agentClient;
      var token = TestJwt.Sign(key, kid, payload);

      var routes = new (string Method, string Path)[]
      {
        ("GET", StatusPath), ("GET", RunsPath), ("GET", DecisionsPath), ("GET", $"{DecisionsPath}/1"),
        ("GET", "/api/v1/admin/automation/eval-gate"), ("POST", "/api/v1/admin/automation/eval-gate"),
        ("POST", "/api/v1/admin/automation/eval-gate/1/revoke"),
      };
      foreach (var (method, path) in routes)
      {
        var evt = JsonSerializer.SerializeToElement(new
        {
          rawPath = path,
          requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
          headers = new Dictionary<string, string> { ["content-type"] = "application/json", ["authorization"] = "Bearer " + token },
          queryStringParameters = new Dictionary<string, string>(),
          body = method == "POST" ? "{}" : null,
          isBase64Encoded = false,
        });
        var response = await new VpcFunction().Handler(evt);
        Assert.True(response.StatusCode == 403, $"{method} {path}: {response.StatusCode} {response.Body}");
        using var doc = JsonDocument.Parse(response.Body!);
        Assert.Equal(AgentClientPolicy.ErrorCode, doc.RootElement.GetProperty("error").GetProperty("code").GetString());
      }
    }
    finally
    {
      Auth.ResetToEnvironment();
    }
  }

  // ---------------------------------------------------------------- schema not ready

  [Fact]
  public async Task ReadRoutes_MissingTables_Return503ServerNotReadyAutomation()
  {
    var cs = await _db.CreateScratchDatabaseAsync(NotReadyName);
    await using (var conn = new NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 33);
    }

    foreach (var mode in new[] { AutomationMode.Off, AutomationMode.DryRun, AutomationMode.Live })
    {
      await InDatabaseAsync(cs, async _ =>
      {
        foreach (var path in new[] { StatusPath, RunsPath, DecisionsPath, $"{DecisionsPath}/1" })
        {
          AutomationTestKit.AssertError(await CallAsync(path), 503, "SERVER_NOT_READY_AUTOMATION");
        }
      }, new Dictionary<string, string?> { [AutomationMode.EnvName] = mode });
    }
  }

  // ---------------------------------------------------------------- R18C (C02)

  [Fact]
  public async Task Status_ShadowAgreement_CountsOnlyBlindDecisions()
  {
    // R18C automation-4: a person who saw the would_accept verdict before deciding measures nothing.
    await InFreshAsync("it_c02_status_blind", async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("blind");
      var run = await db.NewRunAsync(deckId);
      async Task EventAsync(long draftId, string details) => await db.QueryAsync(
        "insert into automation_decision_events (draft_id, from_state, to_state, reason, actor, mode, details) " +
        "values ($1, 'would_accept', 'would_accept', 'HUMAN_ACTION', 'human:it-c02', 'dry_run', $2::jsonb)", draftId, details);

      await EventAsync(await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "accepted"), "{\"blinded\":true}");
      await EventAsync(await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected"), "{\"blinded\":true}");
      await EventAsync(await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "rejected"), "{\"blinded\":true}");
      // Decided with the verdict visible, or before blindness was recorded: counted as decided, not in the agreement.
      await EventAsync(await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "accepted"), "{\"blinded\":false}");
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true, humanAction: "accepted");

      var shadow = (await DataAsync(StatusPath)).GetProperty("shadow");
      Assert.Equal(5, shadow.GetProperty("humanDecided").GetInt64());
      Assert.Equal(3, shadow.GetProperty("humanAccepted").GetInt64());
      Assert.Equal(3, shadow.GetProperty("blindDecided").GetInt64());
      Assert.Equal(1, shadow.GetProperty("blindAccepted").GetInt64());
      Assert.Equal(0.3333m, shadow.GetProperty("agreementRate").GetDecimal());
    });
  }

  [Fact]
  public async Task Decisions_OpenTrue_ListsOnlyOpenExceptions_WithTheBacklogPredicate()
  {
    // R18C L4 (backend-design-13): handled rows newer than the open ones no longer hide them behind a page.
    await InFreshAsync("it_c02_decisions_open", async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("open");
      var run = await db.NewRunAsync(deckId);
      var openOld = await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED", createdAt: "now() - interval '3 days'");
      var openNew = await db.NewDecisionAsync(deckId, run, "human", "UNGROUNDED", createdAt: "now() - interval '2 days'");
      for (var i = 0; i < 3; i++)
      {
        var handled = await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED", humanAction: "rejected");
        await db.QueryAsync("update ai_drafts set status = 'rejected', decided_at = now(), decided_by_sub = 'it-c02' where id = $1", handled);
      }
      var gone = await db.NewDecisionAsync(deckId, run, "human", "QA_FLAGGED");
      await db.QueryAsync("update ai_drafts set status = 'accepted', decided_at = now(), decided_by_sub = 'it-c02' where id = $1", gone);
      await db.NewDecisionAsync(deckId, run, "would_accept", qa: true);

      static List<long> Ids(JsonElement data) =>
        data.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("draftId").GetInt64()).ToList();

      // Without the flag the first page of human rows shows no open exception.
      var firstHuman = await DataAsync(DecisionsPath, new Dictionary<string, string> { ["state"] = "human", ["limit"] = "3" });
      Assert.DoesNotContain(openNew, Ids(firstHuman));

      var open = await DataAsync(DecisionsPath, new Dictionary<string, string> { ["open"] = "true" });
      Assert.Equal([openNew, openOld], Ids(open));
      Assert.Equal(Ids(open), Ids(await DataAsync(DecisionsPath, new Dictionary<string, string> { ["open"] = "1", ["state"] = "human" })));
      Assert.Equal((await DataAsync(StatusPath)).GetProperty("backlog").GetProperty("humanPending").GetInt64(), Ids(open).Count);

      // The same keyset cursor pages through the open list.
      var page1 = await DataAsync(DecisionsPath, new Dictionary<string, string> { ["open"] = "true", ["limit"] = "1" });
      Assert.Equal([openNew], Ids(page1));
      var page2 = await DataAsync(DecisionsPath, new Dictionary<string, string>
        { ["open"] = "true", ["limit"] = "1", ["cursor"] = page1.GetProperty("nextCursor").GetString()! });
      Assert.Equal([openOld], Ids(page2));
      Assert.Equal(JsonValueKind.Null, page2.GetProperty("nextCursor").ValueKind);

      // open=false (or absent) filters nothing; anything else is a validation error.
      Assert.Equal(7, Ids(await DataAsync(DecisionsPath, new Dictionary<string, string> { ["open"] = "false" })).Count);
      AutomationTestKit.AssertError(await CallAsync(DecisionsPath, new Dictionary<string, string> { ["open"] = "yes" }), 400, "VALIDATION_ERROR");
    });
  }

  [Fact]
  public async Task Status_Backlog_ListsHumanPublishItems()
  {
    // R18C L4: the publishes counted in humanPublishes, listed (oldest first, at most 20).
    await InFreshAsync("it_c02_status_publish_items", async db =>
    {
      var (deckId, slug) = await db.NewDeckAsync("items");
      var (resolvedDeck, resolvedSlug) = await db.NewDeckAsync("items-resolved");
      var run = await db.NewRunAsync(deckId);
      await db.QueryAsync(
        """
        insert into automation_publishes (deck_id, run_id, mode, state, reason, created_at, updated_at) values
          ($1, $3, 'live', 'human', 'DECK_HAS_HUMAN_CHANGES', now() - interval '5 days', now() - interval '5 days'),
          ($2, $3, 'live', 'human', 'PUBLISH_FAILED', now() - interval '3 hours', now() - interval '3 hours'),
          ($1, $3, 'dry_run', 'human', 'AI_QA_REQUIRED', now(), now())
        """, deckId, resolvedDeck, run);
      await db.QueryAsync(
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, status, created_at) values ($1, $2, 'c02-build', 'decks/c02', 'SUCCESS', now() - interval '1 hour')",
        resolvedDeck, resolvedSlug);

      var backlog = (await DataAsync(StatusPath)).GetProperty("backlog");
      Assert.Equal(1, backlog.GetProperty("humanPublishes").GetInt64());
      var item = Assert.Single(backlog.GetProperty("humanPublishItems").EnumerateArray());
      Assert.Equal(["deckId", "deckSlug", "reason", "since"], Keys(item));
      Assert.Equal(deckId, item.GetProperty("deckId").GetInt64());
      Assert.Equal(slug, item.GetProperty("deckSlug").GetString());
      Assert.Equal("DECK_HAS_HUMAN_CHANGES", item.GetProperty("reason").GetString());
      var since = DateTimeOffset.Parse(item.GetProperty("since").GetString()!, CultureInfo.InvariantCulture);
      Assert.InRange(DateTimeOffset.UtcNow - since, TimeSpan.FromDays(4.9), TimeSpan.FromDays(5.1));

      // Capped at 20, oldest first.
      for (var i = 0; i < 25; i++)
      {
        var (d, _) = await db.NewDeckAsync($"items-{i}");
        await db.QueryAsync(
          "insert into automation_publishes (deck_id, run_id, mode, state, reason, created_at, updated_at) " +
          "values ($1, $2, 'live', 'human', 'PUBLISH_FAILED', now() - make_interval(hours => $3), now() - make_interval(hours => $3))", d, run, i + 1);
      }
      var full = (await DataAsync(StatusPath)).GetProperty("backlog");
      Assert.Equal(26, full.GetProperty("humanPublishes").GetInt64());
      var listed = full.GetProperty("humanPublishItems").EnumerateArray().ToList();
      Assert.Equal(StatusRoutes.MaxHumanPublishItems, listed.Count);
      Assert.Equal(deckId, listed[0].GetProperty("deckId").GetInt64());
      var times = listed.Select(l => DateTimeOffset.Parse(l.GetProperty("since").GetString()!, CultureInfo.InvariantCulture)).ToList();
      Assert.Equal(times.Order().ToList(), times);
    });
  }

  [Fact]
  public async Task Runs_DeferredCards_MatchThePublishLikeTheBatchSummary()
  {
    // R18C backend-design-17: a run whose accepted cards wait on another run's in-flight row shows that row.
    await InFreshAsync("it_c02_runs_deferred", async db =>
    {
      var (deckId, _) = await db.NewDeckAsync("deferred");
      var first = await db.NewRunAsync(deckId, startedAt: "now() - interval '5 minutes'");
      var second = await db.NewRunAsync(deckId);
      var firstCard = await db.NewCardAsync(deckId, Uid("card"));
      var secondCard = await db.NewCardAsync(deckId, Uid("card"));
      await db.NewDecisionAsync(deckId, first, "auto_accepted", qa: true, acceptedCardId: firstCard, mode: "live");
      await db.NewDecisionAsync(deckId, second, "auto_accepted", qa: true, acceptedCardId: secondCard, mode: "live");
      var inFlight = Long(await db.ScalarAsync(
        "insert into automation_publishes (deck_id, run_id, mode, state, card_ids, deferred_card_ids, job_id) " +
        "values ($1, $2, 'live', 'publishing', $3, $4, 'job-c02') returning id",
        deckId, first, new[] { firstCard }, new[] { secondCard }));

      var items = (await DataAsync(RunsPath, new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) }))
        .GetProperty("items").EnumerateArray().ToList();
      Assert.Equal([second, first], items.Select(i => i.GetProperty("runId").GetGuid()).ToList());
      Assert.Equal([inFlight], items[0].GetProperty("publishes").EnumerateArray().Select(p => p.GetProperty("publishId").GetInt64()).ToList());
      Assert.Equal([inFlight], items[1].GetProperty("publishes").EnumerateArray().Select(p => p.GetProperty("publishId").GetInt64()).ToList());
    });
  }
}
