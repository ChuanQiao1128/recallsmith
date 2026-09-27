using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Shared fixtures of the R18A A04 test classes (AutoPublisherTests, AutomationTickTests, AutomationNotificationsTests,
/// PublishExtractionTests), on top of <see cref="AutomationTestKit"/>: an env scope that also captures notifier and
/// publish sends and revokes every eval gate it inserted, a small SQL helper that works against the shared or a scratch
/// database, decks with a live build, auto-accepted cards through the real draft-QA path, and signed internal calls
/// with the fake <c>test-secret</c>. No recipient address exists anywhere.
/// </summary>
internal static class A04Kit
{
  public const string FakeNotifyQueueUrl = "https://sqs.test/000000000000/developercards-notify-test";
  public const string FakePublishQueueUrl = "https://sqs.test/000000000000/developercards-publish-jobs-test";
  public const string FakeContentBucket = "developercards-content-test";
  public const string TickPath = "/api/internal/automation/tick";
  public const string ReportPath = "/api/internal/automation/notifications/report";
  public const string FakeSecret = "test-secret";

  // A00 §12.5, verbatim: the notifier message every cross-wave shape is asserted against.
  public const string ContractNotifyMessageJson = """
    { "v": 1, "notificationId": "uuid", "kind": "batch_summary", "subkind": null,
      "subject": "[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 2 auto-accepted, 1 need you, would publish",
      "text": "DRY RUN — …", "mode": "dry_run" }
    """;

  // A00 §12.3, verbatim: the notifier's report call.
  public const string ContractReportJson = """
    { "v": 1, "notificationId": "uuid", "status": "sent", "sesMessageId": null, "errorCode": null, "error": null, "attempt": 1 }
    """;

  // A00 §12.6, verbatim: the tick request and its response (plus "failedSteps", R18B K4).
  public const string ContractTickRequestJson = """{ "v": 1, "tickId": "uuid", "job": "tick" }""";
  public const string ContractTickResponseJson = """
    { "tickId": "uuid", "mode": "dry_run", "effectiveMode": "dry_run", "skipped": null, "actions": { "digest": false, "leasesExpired": 0, "qaRetried": 0,
      "qaTimedOut": 0, "runsAbandoned": 0, "runsFinalized": 0, "publishesReconciled": 0, "publishesStarted": 0, "summaries": 0,
      "rechecksStarted": 0, "rechecksDone": 0, "alerts": 0, "notificationsResent": 0 }, "failedSteps": [] }
    """;

  /// <summary>SQL against one database (the shared fixture or a scratch one).</summary>
  public sealed class Sql(string connectionString)
  {
    public string ConnectionString { get; } = connectionString;

    public async Task<NpgsqlConnection> OpenAsync()
    {
      var conn = new NpgsqlConnection(ConnectionString);
      await conn.OpenAsync();
      return conn;
    }

    public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params object?[] parameters)
    {
      await using var conn = await OpenAsync();
      return await DbUtil.QueryAsync(conn, null, sql, parameters);
    }

    public async Task<object?> ScalarAsync(string sql, params object?[] parameters)
    {
      await using var conn = await OpenAsync();
      return await DbUtil.ExecuteScalarAsync(conn, null, sql, parameters);
    }

    public async Task<long> CountAsync(string sql, params object?[] parameters) => Long(await ScalarAsync(sql, parameters));
  }

  /// <summary>
  /// The A03 scope plus the A04 env keys and seams, restored on dispose; every gate inserted through
  /// <see cref="GateAsync"/> is revoked on dispose.
  /// </summary>
  public sealed class Scope : IAsyncDisposable
  {
    private static readonly string[] Names =
    [
      AutomationEnv.NotifyQueueUrlEnv, AutomationEnv.NotifierSecretEnv, AutomationEnv.NotifierSecretEnv + "_PREVIOUS", AutomationEnv.AutoPublishEnv,
      AutomationEnv.RunnerStaleMinutesEnv, AutomationEnv.LoginWarnDaysEnv, AutomationEnv.QaTimeoutMinutesEnv,
    ];

    private readonly AutomationTestKit.Scope _inner;
    private readonly Dictionary<string, string?> _saved = Names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    private readonly Func<SendMessageRequest, Task>? _savedNotifySeam = Notifications.TestSendSeam;
    private readonly Publish.EnqueueSeam? _savedPublishSeam = Publish.TestEnqueueSeam;
    private readonly List<(Sql Db, long Id)> _gates = [];

    public List<SendMessageRequest> NotifySent { get; } = [];
    public List<SendMessageRequest> PublishSent { get; } = [];
    public List<SendMessageRequest> WebhookSent => _inner.WebhookSent;
    public List<SendMessageRequest> QaSent => _inner.QaSent;
    public bool FailNotify { get; set; }

    public Scope(string mode = AutomationMode.DryRun)
    {
      _inner = new AutomationTestKit.Scope(mode);
      Set(AutomationEnv.NotifyQueueUrlEnv, FakeNotifyQueueUrl);
      Set(AutomationEnv.NotifierSecretEnv, FakeSecret);
      Set(AutomationEnv.NotifierSecretEnv + "_PREVIOUS", null);
      Set(AutomationEnv.AutoPublishEnv, null);
      Set(AutomationEnv.RunnerStaleMinutesEnv, null);
      Set(AutomationEnv.LoginWarnDaysEnv, null);
      Set(AutomationEnv.QaTimeoutMinutesEnv, null);
      Notifications.TestSendSeam = r =>
      {
        if (FailNotify) throw new InvalidOperationException("synthetic SQS failure");
        lock (NotifySent) NotifySent.Add(r);
        return Task.CompletedTask;
      };
      Publish.TestEnqueueSeam = new Publish.EnqueueSeam(FakePublishQueueUrl, FakeContentBucket, r =>
      {
        lock (PublishSent) PublishSent.Add(r);
        return Task.CompletedTask;
      });
    }

    public void Set(string name, string? value) => _inner.Set(name, value);

    /// <summary>A passed eval gate for the automation reviewer in <paramref name="db"/>, so configured live is effective live.</summary>
    public async Task<long> GateAsync(Sql db)
    {
      var id = Long(await db.ScalarAsync(
        "insert into automation_eval_gates (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report, created_by_sub) " +
        "values ($1, $2, $3, true, '{}'::jsonb, $4, '{}'::jsonb, 'it-a04') returning id",
        AutomationTestKit.ReviewerProvider, AutomationTestKit.ReviewerModel, RecallSmith.Lambda.Vpc.Qa.QaRuns.AutomationPromptVersion, new string('c', 64)));
      _gates.Add((db, id));
      return id;
    }

    public async ValueTask DisposeAsync()
    {
      foreach (var (db, id) in _gates)
      {
        try
        {
          await db.QueryAsync("update automation_eval_gates set revoked_at = now(), revoked_by_sub = 'it-a04' where id = $1 and revoked_at is null", id);
        }
        catch (PostgresException)
        {
          // A dropped scratch database has nothing left to revoke.
        }
        catch (NpgsqlException)
        {
          // Same: the scratch database is gone.
        }
      }
      foreach (var (name, value) in _saved) Environment.SetEnvironmentVariable(name, value);
      Notifications.TestSendSeam = _savedNotifySeam;
      Publish.TestEnqueueSeam = _savedPublishSeam;
      _inner.Dispose();
    }
  }

  public static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  public static string Tag(string tag) => $"it-a04-{tag}-{Guid.NewGuid():N}"[..40];

  /// <summary>A deck whose live build predates its cards and settings: one old human card, a SUCCESS publish an hour ago.</summary>
  public static async Task<(long Id, string Slug, string BuildId, string OldUid)> PublishedDeckAsync(Sql db, string tag)
  {
    var slug = Tag(tag);
    var deckId = Long(await db.ScalarAsync("insert into decks (slug, title, author) values ($1, $2, 'tests') returning id", slug, $"deck a04 {tag}"));
    var oldUid = $"old-{Guid.NewGuid():N}"[..30];
    await db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, updated_at) " +
      "values ($1, $2, 'An old synthetic question about lighthouses?', 'Synthetic explanation.', 2, 10, now() - interval '2 hours')",
      deckId, oldUid);
    var buildId = $"20260901T000000Z-{Guid.NewGuid():N}"[..25];
    await db.QueryAsync(
      """
      insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, published_by_admin_sub, created_at, updated_at)
      values ($1, $2, $3, $4, $5, 'SUCCESS', 'it-a04', now() - interval '1 hour', now() - interval '1 hour')
      """, deckId, slug, buildId, $"content/decks/{slug}/builds/{buildId}/deck.json", Guid.NewGuid().ToString());
    await db.QueryAsync("update decks set live_build_id = $2, updated_at = now() - interval '90 minutes' where id = $1", deckId, buildId);
    return (deckId, slug, buildId, oldUid);
  }

  /// <summary>An automation run on <paramref name="deckId"/> in <paramref name="db"/> (with its finished queue item).</summary>
  public static async Task<Guid> RunAsync(Sql db, string ownerSub, long? deckId, string status = "running")
  {
    var item = await db.ScalarAsync(
      """
      insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, finished_at)
      values ('manual', $1, $2::bigint, $3, 'owner:it-a04', 'done', now())
      returning id
      """, $"https://docs.example.com/a04/{Guid.NewGuid():N}", deckId, $"it-a04:{Guid.NewGuid()}");
    var runId = Guid.NewGuid();
    await db.QueryAsync(
      """
      insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status, completed_at, duration_ms, outcome)
      values ($1, $2, 'it-a04-runner', $3, $4::bigint, $5, case when $5 = 'running' then null else now() end, 1000,
              case when $5 = 'completed' then 'done' when $5 = 'failed' then 'failed' end)
      """, runId, Long(item), ownerSub, deckId, status);
    return runId;
  }

  /// <summary>
  /// A card auto-accepted by the real path (submit as the run's agent, then a passing draft-QA report); the scope must be
  /// effective live. Returns the draft and card ids.
  /// </summary>
  public static async Task<(long DraftId, long CardId, string Uid)> AutoAcceptedCardAsync(PostgresFixture db, string ownerSub, long deckId, Guid runId,
    string question)
  {
    var uid = AutomationTestKit.Uid("a04");
    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(ownerSub), deckId, runId, AutomationTestKit.Card(uid, question));
    var (jobId, hash) = await AutomationTestKit.QueuedJobAsync(db, ids[0]);
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(jobId, ids[0], hash)));
    var d = (await AutomationTestKit.DecisionAsync(db, ids[0]))!;
    Assert.Equal("auto_accepted", d["state"]);
    return (ids[0], Long(d["accepted_card_id"]), uid);
  }

  public static async Task<Dictionary<string, object?>> PublishRowAsync(Sql db, long publishId) =>
    (await db.QueryAsync("select * from automation_publishes where id = $1", publishId)).Single();

  // ---------------------------------------------------------------- signed internal calls (A00 §8.3)

  public static string Sign(string secret, long timestampMs, string body)
  {
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    return "v1=" + Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes($"{timestampMs.ToString(CultureInfo.InvariantCulture)}.{body}"))).ToLowerInvariant();
  }

  public static LambdaRequest SignedRequest(string path, object body, string secret = FakeSecret, string method = "POST")
  {
    var raw = body as string ?? JsonSerializer.Serialize(body);
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
      headers = new Dictionary<string, string>
      {
        ["content-type"] = "application/json",
        ["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture),
        ["x-internal-signature"] = Sign(secret, ts, raw),
      },
      queryStringParameters = new Dictionary<string, string>(),
      body = raw,
      isBase64Encoded = false,
    }));
  }

  public static Task<APIGatewayProxyResponse> TickAsync(string job = "tick", Guid? tickId = null, string secret = FakeSecret)
  {
    var req = SignedRequest(TickPath, new { v = 1, tickId = tickId ?? Guid.NewGuid(), job }, secret);
    return AutomationTick.HandleTick(req, new Res(req.TraceId));
  }

  public static Task<APIGatewayProxyResponse> ReportAsync(object body, string secret = FakeSecret)
  {
    var req = SignedRequest(ReportPath, body, secret);
    return Notifications.HandleReport(req, new Res(req.TraceId));
  }

  public static JsonElement Body(APIGatewayProxyResponse response)
  {
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.Clone();
  }

  public static string[] Keys(JsonElement el) => el.EnumerateObject().Select(p => p.Name).ToArray();

  /// <summary>The notifier messages captured by the scope whose subject contains <paramref name="text"/>.</summary>
  public static List<JsonElement> Messages(Scope scope, string? text = null)
  {
    lock (scope.NotifySent)
    {
      return scope.NotifySent.Select(r => JsonDocument.Parse(r.MessageBody).RootElement.Clone())
        .Where(m => text is null || m.GetProperty("subject").GetString()!.Contains(text, StringComparison.Ordinal)).ToList();
    }
  }
}

/// <summary>
/// Auto-publish (R18A A04, contract A00 §6.2, §6.3, §14) against the shared Postgres: every check in order, the
/// automation-owned change set (including a property test of check 6 over generated change sets), the snapshot-bound
/// publish through <see cref="Publish.StartPublishAsync"/>, the open-row reuse and the human route with its alert and
/// ledger row. Publishes are captured through <see cref="Publish.TestEnqueueSeam"/>; the Worker never runs.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutoPublisherTests
{
  private readonly PostgresFixture _db;
  private readonly A04Kit.Sql _sql;

  public AutoPublisherTests(PostgresFixture db)
  {
    _db = db;
    _sql = new A04Kit.Sql(db.ConnectionString);
  }

  private async Task<AutoPublishOutcome?> EvaluateAsync(long deckId, Guid runId)
  {
    await using var conn = await _db.OpenAsync();
    return await AutoPublisher.EvaluateAsync(conn, deckId, runId);
  }

  private async Task<A04Kit.Scope> LiveAsync()
  {
    var scope = new A04Kit.Scope(AutomationMode.Live);
    await scope.GateAsync(_sql);
    return scope;
  }

  private static void AssertOutcome(AutoPublishOutcome? outcome, string state, string? reason)
  {
    Assert.NotNull(outcome);
    Assert.Equal(state, outcome!.State);
    Assert.Equal(reason, outcome.Reason);
  }

  // ---------------------------------------------------------------- checks 1–8

  [Fact]
  public async Task Evaluate_DeckDeleted_RoutesHuman()
  {
    await using var scope = await LiveAsync();
    var deck = await A04Kit.PublishedDeckAsync(_sql, "deleted");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("deleted"), deck.Id, "completed");
    await _sql.QueryAsync("update decks set is_deleted = 1 where id = $1", deck.Id);

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "human", "DECK_DELETED");
    var row = await A04Kit.PublishRowAsync(_sql, outcome!.PublishId);
    Assert.Equal(("live", runId, deck.Id), ((string)row["mode"]!, (Guid)row["run_id"]!, A04Kit.Long(row["deck_id"])));
    Assert.NotNull(row["finished_at"]);
    Assert.Empty(scope.PublishSent);
  }

  [Fact]
  public async Task Evaluate_AutoPublishDisabled_RoutesHuman()
  {
    await using var scope = await LiveAsync();
    scope.Set(AutomationEnv.AutoPublishEnv, "0");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "disabled");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("disabled"), deck.Id, "completed");

    AssertOutcome(await EvaluateAsync(deck.Id, runId), "human", "AUTO_PUBLISH_DISABLED");
    Assert.Empty(scope.PublishSent);
  }

  [Fact]
  public async Task Evaluate_NeverPublishedDeck_RoutesHuman()
  {
    await using var scope = await LiveAsync();
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-never");
    await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("never"), "A synthetic question about first publishes?");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("never"), deck.Id, "completed");

    AssertOutcome(await EvaluateAsync(deck.Id, runId), "human", "DECK_NEVER_PUBLISHED");
    Assert.Empty(scope.PublishSent);
  }

  [Fact]
  public async Task Evaluate_PublishInProgress_Waits()
  {
    await using var scope = await LiveAsync();
    var deck = await A04Kit.PublishedDeckAsync(_sql, "inprogress");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("inprogress"), deck.Id, "completed");
    await _sql.QueryAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1, $2, $3, 'content/x', $4, 'PROCESSING')",
      deck.Id, deck.Slug, $"b-{Guid.NewGuid():N}"[..20], Guid.NewGuid().ToString());

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "waiting", "PUBLISH_IN_PROGRESS");
    var row = await A04Kit.PublishRowAsync(_sql, outcome!.PublishId);
    Assert.Null(row["finished_at"]);
    Assert.Empty(scope.PublishSent);
    Assert.Equal(0, await _sql.CountAsync("select count(*) from automation_notifications where dedupe_key = $1", $"exception:publish_blocked:{outcome.PublishId}"));
  }

  [Fact]
  public async Task Evaluate_DeckSettingsChanged_RoutesHuman()
  {
    await using var scope = await LiveAsync();
    var deck = await A04Kit.PublishedDeckAsync(_sql, "settings");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("settings"), deck.Id, "completed");
    await _sql.QueryAsync("update decks set title = 'renamed by a human', updated_at = now() where id = $1", deck.Id);

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "human", "DECK_HAS_HUMAN_CHANGES");
    Assert.Equal("deck settings changed", outcome!.ReasonDetail);
    Assert.Empty(scope.PublishSent);
  }

  [Fact]
  public async Task Evaluate_HumanEditedCard_RoutesHuman()
  {
    await using var scope = await LiveAsync();
    var sub = AutomationTestKit.Sub("edited");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "edited");
    var runId = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var card = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, runId, "Which synthetic service replicates edited widgets?");
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = $1", runId);
    // A human edits the automation's card after it was accepted: its hash no longer matches.
    await _sql.QueryAsync("update cards set explanation = 'Edited by a human.', updated_at = now() where id = $1", card.CardId);

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "human", "DECK_HAS_HUMAN_CHANGES");
    Assert.Contains(card.Uid, outcome!.ReasonDetail);
    Assert.Empty(scope.PublishSent);

    // A card a human added (no automation decision) routes the same way, and only human uids are listed.
    var deck2 = await A04Kit.PublishedDeckAsync(_sql, "edited2");
    var run2 = await A04Kit.RunAsync(_sql, sub, deck2.Id);
    var auto2 = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck2.Id, run2, "Which synthetic queue holds unedited widgets?");
    var humanUid = A04Kit.Tag("human");
    await AutomationTestKit.NewCardAsync(_db, deck2.Id, humanUid, "A human-written synthetic question about ferries?");
    var second = await EvaluateAsync(deck2.Id, run2);
    AssertOutcome(second, "human", "DECK_HAS_HUMAN_CHANGES");
    Assert.Contains(humanUid, second!.ReasonDetail);
    Assert.DoesNotContain(auto2.Uid, second.ReasonDetail);
  }

  [Fact]
  public async Task Evaluate_DeletedCard_RoutesHuman()
  {
    await using var scope = await LiveAsync();
    var deck = await A04Kit.PublishedDeckAsync(_sql, "delcard");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("delcard"), deck.Id, "completed");
    await _sql.QueryAsync("update cards set is_deleted = 1, updated_at = now() where deck_id = $1 and stable_uid = $2", deck.Id, deck.OldUid);

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "human", "DECK_HAS_HUMAN_CHANGES");
    Assert.Contains(deck.OldUid, outcome!.ReasonDetail);
    Assert.Empty(scope.PublishSent);
  }

  [Fact]
  public async Task Evaluate_DryRun_GateRefusal_RoutesHumanWithCode()
  {
    // automation-6: dry run evaluates check 9's publish gates read-only; a refusal is what live would do.
    await using var scope = new A04Kit.Scope(AutomationMode.DryRun);
    var deck = await A04Kit.PublishedDeckAsync(_sql, "drygate");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("drygate"), deck.Id, "completed");
    const string validMcq =
      """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";
    await _sql.QueryAsync("update cards set mcq = $3::jsonb, difficulty = 4, updated_at = now() - interval '2 hours' where deck_id = $1 and stable_uid = $2",
      deck.Id, deck.OldUid, validMcq);
    var defects = await _sql.CountAsync("select count(*) from automation_events");

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "human", "MCQ_PUBLISH_GATE");
    Assert.Equal($"{deck.OldUid}: MCQ_DIFFICULTY_RANGE", outcome!.ReasonDetail);
    Assert.Equal("dry_run", (await A04Kit.PublishRowAsync(_sql, outcome.PublishId))["mode"]);
    Assert.Empty(scope.PublishSent);
    Assert.Equal(0, await _sql.CountAsync("select count(*) from deck_publishes where deck_id = $1 and status = 'PENDING'", deck.Id));
    // Read-only: no gate defect is recorded for a publish that never started.
    Assert.Equal(defects, await _sql.CountAsync("select count(*) from automation_events"));
  }

  [Fact]
  public async Task Evaluate_DryRun_IsWouldPublish()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.DryRun);
    var deck = await A04Kit.PublishedDeckAsync(_sql, "dry");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("dry"), deck.Id, "completed");

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "would_publish", null);
    var row = await A04Kit.PublishRowAsync(_sql, outcome!.PublishId);
    Assert.Equal("dry_run", row["mode"]);
    Assert.NotNull(row["finished_at"]);
    Assert.Null(row["job_id"]);
    Assert.Empty(scope.PublishSent);
    Assert.Equal(0, await _sql.CountAsync("select count(*) from deck_publishes where deck_id = $1 and status = 'PENDING'", deck.Id));

    // In dry run nothing is automation-owned: any pending card goes to a human.
    await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("dry-new"), "A synthetic dry-run question about canals?");
    AssertOutcome(await EvaluateAsync(deck.Id, runId), "human", "DECK_HAS_HUMAN_CHANGES");

    // Effective off writes nothing.
    scope.Set(AutomationMode.EnvName, AutomationMode.Off);
    var before = await _sql.CountAsync("select count(*) from automation_publishes where deck_id = $1", deck.Id);
    Assert.Null(await EvaluateAsync(deck.Id, runId));
    Assert.Equal(before, await _sql.CountAsync("select count(*) from automation_publishes where deck_id = $1", deck.Id));
  }

  [Fact]
  public async Task Evaluate_Live_OnlyAutomationCards_StartsPublish()
  {
    await using var scope = await LiveAsync();
    var sub = AutomationTestKit.Sub("start");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "start");
    var runId = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var card = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, runId, "Which synthetic service starts automated publishes?");
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = $1", runId);

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "publishing", null);
    var row = await A04Kit.PublishRowAsync(_sql, outcome!.PublishId);
    Assert.Equal(new[] { card.CardId }, (long[])row["card_ids"]!);
    Assert.Null(row["finished_at"]);
    var jobId = (string)row["job_id"]!;

    var job = (await _sql.QueryAsync("select status, build_id, published_by_admin_sub, note, qa_snapshot_sha256 from deck_publishes where job_id = $1", jobId)).Single();
    Assert.Equal("PENDING", job["status"]);
    Assert.Equal("automation", job["published_by_admin_sub"]);
    Assert.Equal($"auto-publish run {runId:D}", job["note"]);
    Assert.Equal(row["build_id"], job["build_id"]);
    await using (var conn = await _db.OpenAsync())
    {
      var export = await DbUtil.QueryAsync(conn, null, Publish.CardsSql, [deck.Id]);
      var digest = PublishSnapshot.Digest(export.Select(PublishSnapshot.FromRow));
      Assert.Equal(digest, job["qa_snapshot_sha256"]);
      Assert.Equal(digest, row["snapshot_sha256"]);
    }

    var sent = Assert.Single(scope.PublishSent);
    Assert.Equal(A04Kit.FakePublishQueueUrl, sent.QueueUrl);
    using var message = JsonDocument.Parse(sent.MessageBody);
    Assert.Equal(["jobId", "deckId", "adminSub", "note"], A04Kit.Keys(message.RootElement));
    Assert.Equal(jobId, message.RootElement.GetProperty("jobId").GetString());
    Assert.Equal("automation", message.RootElement.GetProperty("adminSub").GetString());
  }

  [Fact]
  public async Task Evaluate_Live_NothingPending_IsPublishedWithoutJob()
  {
    await using var scope = await LiveAsync();
    var deck = await A04Kit.PublishedDeckAsync(_sql, "nothing");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("nothing"), deck.Id, "completed");

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "published", null);
    var row = await A04Kit.PublishRowAsync(_sql, outcome!.PublishId);
    Assert.Equal(deck.BuildId, row["build_id"]);
    Assert.Null(row["job_id"]);
    Assert.NotNull(row["finished_at"]);
    Assert.Empty(scope.PublishSent);
    Assert.Equal(1, await _sql.CountAsync("select count(*) from deck_publishes where deck_id = $1", deck.Id));
  }

  [Fact]
  public async Task Evaluate_OpenRow_IsReusedAcrossRuns()
  {
    await using var scope = await LiveAsync();
    var sub = AutomationTestKit.Sub("reuse");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "reuse");
    var run1 = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var run2 = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var card1 = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, run1, "Which synthetic bridge carries reused rows?");
    var card2 = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, run2, "Which synthetic tunnel avoids duplicate rows?");
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = any($1)", new[] { run1, run2 });
    var otherJob = Guid.NewGuid().ToString();
    await _sql.QueryAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1, $2, $3, 'content/x', $4, 'PENDING')",
      deck.Id, deck.Slug, $"b-{Guid.NewGuid():N}"[..20], otherJob);

    var first = await EvaluateAsync(deck.Id, run1);
    var second = await EvaluateAsync(deck.Id, run2);

    AssertOutcome(first, "waiting", "PUBLISH_IN_PROGRESS");
    AssertOutcome(second, "waiting", "PUBLISH_IN_PROGRESS");
    Assert.Equal(first!.PublishId, second!.PublishId);
    Assert.Equal(1, await _sql.CountAsync("select count(*) from automation_publishes where deck_id = $1", deck.Id));
    var row = await A04Kit.PublishRowAsync(_sql, first.PublishId);
    Assert.Equal(new[] { card1.CardId, card2.CardId }.Order().ToArray(), (long[])row["card_ids"]!);
    Assert.Equal(run1, row["run_id"]);

    // Once the other job is gone the same row goes on to publish both runs' cards.
    await _sql.QueryAsync("update deck_publishes set status = 'SUCCESS' where job_id = $1", otherJob);
    await _sql.QueryAsync("update decks set updated_at = now() - interval '2 hours' where id = $1", deck.Id);
    await using (var conn = await _db.OpenAsync())
    {
      AssertOutcome(await AutoPublisher.ReevaluateAsync(conn, first.PublishId), "publishing", null);
    }
    Assert.Single(scope.PublishSent);
  }

  [Fact]
  public async Task Evaluate_GateRefusal_RoutesHumanWithCode()
  {
    await using var scope = await LiveAsync();
    var sub = AutomationTestKit.Sub("gate");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "gate");
    var runId = await A04Kit.RunAsync(_sql, sub, deck.Id);
    await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, runId, "Which synthetic gate refuses broken widgets?");
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = $1", runId);
    // The old live card carries an MCQ blob the publish gate now refuses (difficulty outside 1..3); it is not pending.
    const string validMcq =
      """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";
    await _sql.QueryAsync("update cards set mcq = $3::jsonb, difficulty = 4, updated_at = now() - interval '2 hours' where deck_id = $1 and stable_uid = $2",
      deck.Id, deck.OldUid, validMcq);

    var outcome = await EvaluateAsync(deck.Id, runId);

    AssertOutcome(outcome, "human", "MCQ_PUBLISH_GATE");
    Assert.Equal($"{deck.OldUid}: MCQ_DIFFICULTY_RANGE", outcome!.ReasonDetail);
    Assert.Empty(scope.PublishSent);
    Assert.Equal(0, await _sql.CountAsync("select count(*) from deck_publishes where deck_id = $1 and status = 'PENDING'", deck.Id));
  }

  [Fact]
  public async Task Evaluate_HumanOutcome_RaisesPublishBlocked()
  {
    await using var scope = await LiveAsync();
    var deck = await A04Kit.PublishedDeckAsync(_sql, "blocked");
    var runId = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("blocked"), deck.Id, "completed");
    await _sql.QueryAsync("update decks set updated_at = now() where id = $1", deck.Id);

    var outcome = await EvaluateAsync(deck.Id, runId);
    AssertOutcome(outcome, "human", "DECK_HAS_HUMAN_CHANGES");

    var n = (await _sql.QueryAsync("select kind, subkind, mode, status, run_id, subject from automation_notifications where dedupe_key = $1",
      $"exception:publish_blocked:{outcome!.PublishId}")).Single();
    Assert.Equal(("exception", "publish_blocked", "live", "queued", runId),
      ((string)n["kind"]!, (string)n["subkind"]!, (string)n["mode"]!, (string)n["status"]!, (Guid)n["run_id"]!));
    Assert.Equal($"[DeveloperCards] Action needed: publish {deck.Slug} (DECK_HAS_HUMAN_CHANGES)", n["subject"]);
    var message = Assert.Single(A04Kit.Messages(scope, deck.Slug));
    Assert.Equal("publish_blocked", message.GetProperty("subkind").GetString());

    var ledger = (await _sql.QueryAsync("select automation, units, outcome, details::text as details from automation_events where dedupe_key = $1",
      $"auto-publish-human:{outcome.PublishId}")).Single();
    Assert.Equal(("auto_publish", 0, "success"), ((string)ledger["automation"]!, Convert.ToInt32(ledger["units"], CultureInfo.InvariantCulture), (string)ledger["outcome"]!));
    Assert.Contains("DECK_HAS_HUMAN_CHANGES", (string)ledger["details"]!);

    // Dry run: the alert (marked) but no ledger row (A00 §14).
    scope.Set(AutomationMode.EnvName, AutomationMode.DryRun);
    var dryDeck = await A04Kit.PublishedDeckAsync(_sql, "blocked-dry");
    var dryRun = await A04Kit.RunAsync(_sql, AutomationTestKit.Sub("blocked-dry"), dryDeck.Id, "completed");
    await _sql.QueryAsync("update decks set updated_at = now() where id = $1", dryDeck.Id);
    var dry = await EvaluateAsync(dryDeck.Id, dryRun);
    AssertOutcome(dry, "human", "DECK_HAS_HUMAN_CHANGES");
    Assert.Equal($"[DeveloperCards] (dry run) Action needed: publish {dryDeck.Slug} (DECK_HAS_HUMAN_CHANGES)",
      await _sql.ScalarAsync("select subject from automation_notifications where dedupe_key = $1", $"exception:publish_blocked:{dry!.PublishId}"));
    Assert.Equal(0, await _sql.CountAsync("select count(*) from automation_events where dedupe_key = $1", $"auto-publish-human:{dry.PublishId}"));
  }

  // ---------------------------------------------------------------- check 6 as a property (A00 §18.2)

  /// <summary>What a pending card is, relative to the automation: the dimensions check 6 decides on.</summary>
  public enum PendingKind
  {
    /// <summary>Auto-accepted, live, content unchanged since acceptance.</summary>
    OwnedUnchanged,
    /// <summary>Auto-accepted, then edited (its hash differs from the accepted hash).</summary>
    OwnedEdited,
    /// <summary>Auto-accepted, then deleted.</summary>
    OwnedDeleted,
    /// <summary>Auto-accepted, edited and deleted.</summary>
    OwnedEditedDeleted,
    /// <summary>No auto_accepted decision: a human added or changed it.</summary>
    NotOwned,
    /// <summary>No auto_accepted decision, deleted.</summary>
    NotOwnedDeleted,
  }

  /// <summary>
  /// The specification of check 6 (A00 §6.2, §0: only brand-new, unchanged automation cards ship without a human),
  /// written out case by case instead of derived from a predicate, so a wrong rule in the implementation shows up as a
  /// disagreement: may a pending card of this kind be auto-published in this mode?
  /// </summary>
  private static readonly Dictionary<(string Mode, PendingKind Kind), bool> MayAutoPublish = new()
  {
    [(AutomationMode.Live, PendingKind.OwnedUnchanged)] = true,
    [(AutomationMode.Live, PendingKind.OwnedEdited)] = false,
    [(AutomationMode.Live, PendingKind.OwnedDeleted)] = false,
    [(AutomationMode.Live, PendingKind.OwnedEditedDeleted)] = false,
    [(AutomationMode.Live, PendingKind.NotOwned)] = false,
    [(AutomationMode.Live, PendingKind.NotOwnedDeleted)] = false,
    [(AutomationMode.DryRun, PendingKind.OwnedUnchanged)] = false,
    [(AutomationMode.DryRun, PendingKind.OwnedEdited)] = false,
    [(AutomationMode.DryRun, PendingKind.OwnedDeleted)] = false,
    [(AutomationMode.DryRun, PendingKind.OwnedEditedDeleted)] = false,
    [(AutomationMode.DryRun, PendingKind.NotOwned)] = false,
    [(AutomationMode.DryRun, PendingKind.NotOwnedDeleted)] = false,
  };

  private static string Sha(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

  /// <summary>Adds one pending card of <paramref name="kind"/> (and its accepted hash when owned).</summary>
  private static void AddPending(PendingKind kind, long cardId, string uid, List<PendingCard> pending, Dictionary<long, string> owned)
  {
    var isOwned = kind is PendingKind.OwnedUnchanged or PendingKind.OwnedEdited or PendingKind.OwnedDeleted or PendingKind.OwnedEditedDeleted;
    var edited = kind is PendingKind.OwnedEdited or PendingKind.OwnedEditedDeleted;
    var deleted = kind is PendingKind.OwnedDeleted or PendingKind.OwnedEditedDeleted or PendingKind.NotOwnedDeleted;
    if (isOwned) owned[cardId] = Sha(uid);
    pending.Add(new PendingCard(cardId, uid, deleted, edited ? Sha(uid + ":edited") : Sha(uid)));
  }

  public static IEnumerable<object[]> TruthTable() => MayAutoPublish.Select(e => new object[] { e.Key.Mode, e.Key.Kind, e.Value });

  [Theory]
  [MemberData(nameof(TruthTable))]
  public void PendingChangeSet_OneCard_FollowsTheTruthTable(string mode, PendingKind kind, bool mayAutoPublish)
  {
    var pending = new List<PendingCard>();
    var owned = new Dictionary<long, string>();
    AddPending(kind, 7, "card-7", pending, owned);

    var (ok, humanUids) = AutoPublisher.CheckPendingChangeSet(pending, owned, mode);

    Assert.Equal(mayAutoPublish, ok);
    Assert.Equal(mayAutoPublish ? Array.Empty<string>() : new[] { "card-7" }, humanUids);
  }

  /// <summary>60 generated change sets: seeds 0..29 in both modes.</summary>
  public static IEnumerable<object[]> ChangeSets()
  {
    for (var seed = 0; seed < 30; seed++)
    {
      yield return [seed, AutomationMode.Live];
      yield return [seed, AutomationMode.DryRun];
    }
  }

  [Theory]
  [MemberData(nameof(ChangeSets))]
  public void PendingChangeSet_Property_MatchesCheck6(int seed, string mode)
  {
    var random = new Random(seed * 7919 + 17);
    var count = seed % 9 == 0 ? 0 : random.Next(1, 8);
    var kinds = Enum.GetValues<PendingKind>();
    var pending = new List<PendingCard>();
    var owned = new Dictionary<long, string>();
    var expectedHuman = new List<string>();
    for (var i = 0; i < count; i++)
    {
      var cardId = seed * 100L + i + 1;
      var uid = $"card-{seed}-{i}";
      // Mostly unchanged automation cards (so whole sets pass often enough), the other kinds uniformly.
      var kind = random.NextDouble() < 0.7 ? PendingKind.OwnedUnchanged : kinds[random.Next(kinds.Length)];
      AddPending(kind, cardId, uid, pending, owned);
      if (!MayAutoPublish[(mode, kind)]) expectedHuman.Add(uid);
    }
    // Owned hashes of cards outside the change set never matter.
    owned[-1] = "0000";

    var (ok, humanUids) = AutoPublisher.CheckPendingChangeSet(pending, owned, mode);

    Assert.Equal(expectedHuman.Count == 0, ok);
    Assert.Equal(expectedHuman, humanUids);
  }

  // ---------------------------------------------------------------- races (R18B B01)

  [Fact]
  public async Task Evaluate_ConcurrentOnOneDeck_StartsOnePublish()
  {
    await using var scope = await LiveAsync();
    var sub = AutomationTestKit.Sub("concurrent");
    var deck = await A04Kit.PublishedDeckAsync(_sql, "concurrent");
    var runId = await A04Kit.RunAsync(_sql, sub, deck.Id);
    var card = await A04Kit.AutoAcceptedCardAsync(_db, sub, deck.Id, runId, "Which synthetic relay races itself to publish?");
    await _sql.QueryAsync("update automation_runs set status = 'completed', completed_at = now() where run_id = $1", runId);

    var outcomes = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => EvaluateAsync(deck.Id, runId)));

    Assert.All(outcomes, o => Assert.NotNull(o));
    var row = (await _sql.QueryAsync("select * from automation_publishes where deck_id = $1", deck.Id)).Single();
    Assert.Equal("publishing", row["state"]);
    Assert.Equal(new[] { card.CardId }, (long[])row["card_ids"]!);
    var job = (await _sql.QueryAsync("select job_id from deck_publishes where deck_id = $1 and status = 'PENDING'", deck.Id)).Single();
    Assert.Equal(row["job_id"], job["job_id"]);
    Assert.Single(scope.PublishSent);
  }

  [Fact]
  public async Task HumanAccept_RacingAutoAccept_YieldsOneCardAndAConsistentDecision()
  {
    await using var scope = await LiveAsync();
    for (var i = 0; i < 4; i++)
    {
      var e = await AutomationTestKit.EligibleDraftAsync(_db, $"race{i}", $"Which synthetic sprinter number {"ABCD"[i]} wins the race?");
      var human = AutomationTestKit.Sub("race-human");

      var responses = await Task.WhenAll(
        AutomationTestKit.AcceptAsync(e.DraftId, AutomationTestKit.Ctx(human, agent: false)),
        AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));

      Assert.All(responses, r => Assert.True(r.StatusCode < 500, $"{r.StatusCode}: {r.Body}"));
      var cards = await _sql.QueryAsync("select id from cards where deck_id = $1 and stable_uid = $2 and is_deleted = 0", e.DeckId, e.Uid);
      var cardId = A04Kit.Long(Assert.Single(cards)["id"]);
      Assert.Equal("accepted", await _sql.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));
      var d = (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!;
      switch ((string)d["state"]!)
      {
        case "auto_accepted":
          Assert.Equal(cardId, A04Kit.Long(d["accepted_card_id"]));
          break;
        case "superseded":
          Assert.Equal(("DECIDED_BY_HUMAN", "accepted"), ((string)d["reason"]!, (string)d["human_action"]!));
          break;
        default:
          Assert.Fail($"unexpected decision state {d["state"]} after the race");
          break;
      }
    }
  }
}
