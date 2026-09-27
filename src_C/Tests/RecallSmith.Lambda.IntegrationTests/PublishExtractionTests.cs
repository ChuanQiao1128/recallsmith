using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Ledger;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The two A04 extractions (R18A A04, contract A00 §6.4, §12.5): <see cref="Publish.StartPublishAsync"/> keeps every
/// console publish response exactly as before (envelopes, codes, messages, the chained-run extras, the resume) and
/// gives the automation its snapshot-bound, never-resuming, <c>automation</c>-actor path; <see cref="LedgerRoutes.ComputeAsync"/>
/// returns exactly what <c>GET /ledger</c> answers. The existing publish/ledger test classes stay unchanged beside these.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishExtractionTests
{
  private const string PublishPath = "/api/v1/authoring/publish";
  private const string ValidMcq =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  private readonly PostgresFixture _db;
  private readonly A04Kit.Sql _sql;

  public PublishExtractionTests(PostgresFixture db)
  {
    _db = db;
    _sql = new A04Kit.Sql(db.ConnectionString);
  }

  private static Task<APIGatewayProxyResponse> ConsolePublishAsync(long deckId, string sub, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync(Publish.HandleAuthoringPublish, "POST", PublishPath, new { deckId, note = "console note" },
      AutomationTestKit.Ctx(sub, agent: false), query);

  private async Task<Publish.PublishStart> StartAsync(long deckId, string actor, bool bindSnapshot, string? expected, bool allowResume)
  {
    await using var conn = await _db.OpenAsync();
    return await Publish.StartPublishAsync(conn, deckId, actor, "auto-publish run test", bindSnapshot, expected, allowResume);
  }

  private async Task<string> DigestAsync(long deckId)
  {
    await using var conn = await _db.OpenAsync();
    return PublishSnapshot.Digest((await DbUtil.QueryAsync(conn, null, Publish.CardsSql, [deckId])).Select(PublishSnapshot.FromRow));
  }

  private static void AssertErrorEnvelope(APIGatewayProxyResponse response, int status, string code, string message, string[]? errorKeys = null)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    var body = A04Kit.Body(response);
    Assert.Equal(["success", "data", "error", "traceId", "version"], A04Kit.Keys(body));
    Assert.False(body.GetProperty("success").GetBoolean());
    Assert.Equal(JsonValueKind.Null, body.GetProperty("data").ValueKind);
    var error = body.GetProperty("error");
    Assert.Equal(errorKeys ?? ["code", "message"], A04Kit.Keys(error));
    Assert.Equal(code, error.GetProperty("code").GetString());
    Assert.Equal(message, error.GetProperty("message").GetString());
  }

  [Fact]
  public async Task ConsolePublish_ResponsesAreUnchanged()
  {
    await using var scope = new A04Kit.Scope();
    var sub = AutomationTestKit.Sub("console");

    // 404 and DECK_DELETED.
    AssertErrorEnvelope(await ConsolePublishAsync(9_000_000_000_000, sub), 404, "NOT_FOUND", "Deck not found");
    var deleted = await AutomationTestKit.NewDeckAsync(_db, "a04-console-del");
    await _sql.QueryAsync("update decks set is_deleted = 1 where id = $1", deleted.Id);
    AssertErrorEnvelope(await ConsolePublishAsync(deleted.Id, sub), 400, "DECK_DELETED", "Deck is deleted (cannot publish)");

    // MCQ_PUBLISH_GATE.
    var mcq = await AutomationTestKit.NewDeckAsync(_db, "a04-console-mcq");
    await _sql.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, mcq) values ($1, 'hard-mcq', 'Which service buffers a burst', 'queue it', 4, 10, $2::jsonb)",
      mcq.Id, ValidMcq);
    AssertErrorEnvelope(await ConsolePublishAsync(mcq.Id, sub), 400, "MCQ_PUBLISH_GATE", "hard-mcq: MCQ_DIFFICULTY_RANGE");

    // Queued, then the 15-minute resume of the same job.
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-console-ok");
    await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("ok"), "A synthetic console question about harbours?");
    var queued = AutomationTestKit.Data(await ConsolePublishAsync(deck.Id, sub));
    Assert.Equal(["mode", "jobId"], A04Kit.Keys(queued));
    Assert.Equal("async", queued.GetProperty("mode").GetString());
    var jobId = queued.GetProperty("jobId").GetString();
    var resumed = AutomationTestKit.Data(await ConsolePublishAsync(deck.Id, sub));
    Assert.Equal(["mode", "jobId", "note"], A04Kit.Keys(resumed));
    Assert.Equal(jobId, resumed.GetProperty("jobId").GetString());
    Assert.Equal("Resumed existing job", resumed.GetProperty("note").GetString());
    var job = (await _sql.QueryAsync("select published_by_admin_sub, note, qa_snapshot_sha256 from deck_publishes where job_id = $1", jobId)).Single();
    Assert.Equal((sub, "console note"), ((string)job["published_by_admin_sub"]!, (string)job["note"]!));
    Assert.Null(job["qa_snapshot_sha256"]);
    using (var message = JsonDocument.Parse(Assert.Single(scope.PublishSent).MessageBody))
    {
      Assert.Equal(["jobId", "deckId", "adminSub", "note"], A04Kit.Keys(message.RootElement));
      Assert.Equal(sub, message.RootElement.GetProperty("adminSub").GetString());
    }

    // An older active job is not resumed: the unique index answers PUBLISH_IN_PROGRESS as before.
    await _sql.QueryAsync("update deck_publishes set updated_at = now() - interval '20 minutes' where job_id = $1", jobId);
    AssertErrorEnvelope(await ConsolePublishAsync(deck.Id, sub), 409, "PUBLISH_IN_PROGRESS",
      "A publish for this deck is still PENDING or PROCESSING. Wait for the worker, or run POST /api/v1/admin/publish/reap and retry.");

    // The preview is untouched by the extraction.
    var preview = AutomationTestKit.Data(await ConsolePublishAsync(deck.Id, sub, new Dictionary<string, string> { ["mode"] = "preview" }));
    Assert.Equal(["mode", "deckId", "deckSlug", "tier", "cardCount", "export"], A04Kit.Keys(preview));

    // AI QA enforced: the refusal carries the chained run (error.runId / error.qaRun), and the bound snapshot is stored.
    scope.Set(QaGate.RequiredEnv, "1");
    var gated = await AutomationTestKit.NewDeckAsync(_db, "a04-console-qa");
    var gatedUid = A04Kit.Tag("qa");
    await AutomationTestKit.NewCardAsync(_db, gated.Id, gatedUid, "A synthetic unreviewed question about locks?");
    var refused = await ConsolePublishAsync(gated.Id, sub);
    AssertErrorEnvelope(refused, 409, "AI_QA_REQUIRED", $"AI QA required for 1 card(s): {gatedUid}", ["code", "message", "runId", "qaRun"]);
    var qaRun = A04Kit.Body(refused).GetProperty("error").GetProperty("qaRun");
    Assert.Equal(["status", "runId", "code", "message"], A04Kit.Keys(qaRun));
    Assert.Equal(A04Kit.Body(refused).GetProperty("error").GetProperty("runId").GetGuid(), qaRun.GetProperty("runId").GetGuid());
    Assert.Equal(sub, await _sql.ScalarAsync("select requested_by_sub from ai_qa_runs where id = $1", qaRun.GetProperty("runId").GetGuid()));
  }

  [Fact]
  public async Task AutomationPublish_BindsTheSnapshot()
  {
    await using var scope = new A04Kit.Scope();
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-bind");
    await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("bind"), "A synthetic question about bound snapshots?");
    var digest = await DigestAsync(deck.Id);

    var start = await StartAsync(deck.Id, AutoPublisher.Actor, bindSnapshot: true, expected: digest, allowResume: false);

    Assert.Equal((Publish.Queued, 200), (start.Outcome, start.HttpStatus));
    Assert.Null(start.Code);
    Assert.Equal(digest, start.SnapshotSha256);
    Assert.NotNull(start.BuildId);
    var job = (await _sql.QueryAsync("select build_id, qa_snapshot_sha256, status from deck_publishes where job_id = $1", start.JobId)).Single();
    Assert.Equal((start.BuildId, digest, "PENDING"), ((string)job["build_id"]!, (string)job["qa_snapshot_sha256"]!, (string)job["status"]!));
    Assert.Single(scope.PublishSent);
  }

  [Fact]
  public async Task AutomationPublish_StaleSnapshot_IsRefusedAiQaStale()
  {
    await using var scope = new A04Kit.Scope();
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-stale");
    var cardId = await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("stale"), "A synthetic question about stale snapshots?");
    var checkedDigest = await DigestAsync(deck.Id);
    // A human edit between the automation's checks and the enqueue.
    await _sql.QueryAsync("update cards set question = 'Edited by a human in between?', updated_at = now() where id = $1", cardId);

    Publish.PublishStart start = null!;
    var stdout = await EmfCapture.StdoutAsync(async () =>
      start = await StartAsync(deck.Id, AutoPublisher.Actor, bindSnapshot: true, expected: checkedDigest, allowResume: false));

    Assert.Equal((Publish.Refused, 409, PublishSnapshot.StaleErrorCode), (start.Outcome, start.HttpStatus, start.Code));
    Assert.Null(start.JobId);
    Assert.Equal(1, EmfCapture.GaugeSum(stdout, PublishSnapshot.StaleMetric));
    Assert.Equal(0, await _sql.CountAsync("select count(*) from deck_publishes where deck_id = $1", deck.Id));
    Assert.Empty(scope.PublishSent);
  }

  [Fact]
  public async Task AutomationPublish_ActiveJob_IsRefusedPublishInProgress()
  {
    await using var scope = new A04Kit.Scope();
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-active");
    await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("active"), "A synthetic question about active jobs?");
    var console = AutomationTestKit.Data(await ConsolePublishAsync(deck.Id, AutomationTestKit.Sub("active")));
    var consoleJob = console.GetProperty("jobId").GetString();

    // A fresh active job: the console would resume it, the automation refuses and inserts nothing.
    var start = await StartAsync(deck.Id, AutoPublisher.Actor, bindSnapshot: true, expected: null, allowResume: false);
    Assert.Equal((Publish.Refused, 409, "PUBLISH_IN_PROGRESS"), (start.Outcome, start.HttpStatus, start.Code));

    // Any age: an old active job refuses it too.
    await _sql.QueryAsync("update deck_publishes set updated_at = now() - interval '3 hours' where job_id = $1", consoleJob);
    var old = await StartAsync(deck.Id, AutoPublisher.Actor, bindSnapshot: true, expected: null, allowResume: false);
    Assert.Equal("PUBLISH_IN_PROGRESS", old.Code);
    Assert.Equal(1, await _sql.CountAsync("select count(*) from deck_publishes where deck_id = $1", deck.Id));
    Assert.Single(scope.PublishSent);

    // With resume allowed a recent job is returned, not refused.
    await _sql.QueryAsync("update deck_publishes set updated_at = now() where job_id = $1", consoleJob);
    var resumed = await StartAsync(deck.Id, "someone", bindSnapshot: false, expected: null, allowResume: true);
    Assert.Equal((Publish.Resumed, consoleJob), (resumed.Outcome, resumed.JobId));
  }

  [Fact]
  public async Task AutomationPublish_RecordsAutomationActor()
  {
    await using var scope = new A04Kit.Scope();
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-actor");
    await AutomationTestKit.NewCardAsync(_db, deck.Id, A04Kit.Tag("actor"), "A synthetic question about actors?");
    var runId = Guid.NewGuid();

    Publish.PublishStart start;
    await using (var conn = await _db.OpenAsync())
    {
      start = await Publish.StartPublishAsync(conn, deck.Id, AutoPublisher.Actor, $"auto-publish run {runId:D}", true, await DigestAsync(deck.Id), false);
    }

    Assert.Equal(Publish.Queued, start.Outcome);
    var job = (await _sql.QueryAsync("select published_by_admin_sub, note from deck_publishes where job_id = $1", start.JobId)).Single();
    Assert.Equal(("automation", $"auto-publish run {runId:D}"), ((string)job["published_by_admin_sub"]!, (string)job["note"]!));
    using (var message = JsonDocument.Parse(Assert.Single(scope.PublishSent).MessageBody))
    {
      Assert.Equal("automation", message.RootElement.GetProperty("adminSub").GetString());
      Assert.Equal($"auto-publish run {runId:D}", message.RootElement.GetProperty("note").GetString());
      Assert.Equal(deck.Id, message.RootElement.GetProperty("deckId").GetInt64());
    }

    // The AI QA gate is evaluated for the automation: its chained run is requested by "automation".
    scope.Set(QaGate.RequiredEnv, "1");
    var gated = await AutomationTestKit.NewDeckAsync(_db, "a04-actor-qa");
    await AutomationTestKit.NewCardAsync(_db, gated.Id, A04Kit.Tag("actor-qa"), "A synthetic unreviewed question about actors?");
    var refused = await StartAsync(gated.Id, AutoPublisher.Actor, bindSnapshot: true, expected: null, allowResume: false);
    Assert.Equal((Publish.Refused, 409, "AI_QA_REQUIRED"), (refused.Outcome, refused.HttpStatus, refused.Code));
    var chained = Assert.IsType<QaRuns.ChainedRun>(refused.ErrorExtras);
    Assert.Equal("automation", await _sql.ScalarAsync("select requested_by_sub from ai_qa_runs where id = $1", chained.RunId));
  }

  [Fact]
  public async Task LedgerCompute_MatchesTheLedgerRoute()
  {
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-ledger");
    await using (var conn = await _db.OpenAsync())
    {
      var at = new DateTimeOffset(2004, 3, 10, 12, 0, 0, TimeSpan.Zero);
      await AutomationLedger.RecordAsync(conn, new AutomationEvent("auto_publish", 1, "success", DeckId: deck.Id, Ref: "job",
        DedupeKey: $"it-a04-ledger:{Guid.NewGuid()}", OccurredAt: at));
      await AutomationLedger.RecordAsync(conn, new AutomationEvent("auto_accept", 2, "success", ActualMinutes: 1.5m, DeckId: deck.Id,
        DedupeKey: $"it-a04-ledger:{Guid.NewGuid()}", OccurredAt: at.AddDays(9)));
    }

    foreach (var granularity in new[] { "day", "week", "month" })
    {
      var response = await AutomationTestKit.CallAsync(LedgerRoutes.HandleLedger, "GET", "/api/v1/admin/automation/ledger", null,
        AutomationTestKit.Ctx(AutomationTestKit.Sub("ledger"), agent: false),
        new Dictionary<string, string> { ["from"] = "2004-03-01", ["to"] = "2004-03-31", ["granularity"] = granularity });
      var data = AutomationTestKit.Data(response);

      object computed;
      await using (var conn = await _db.OpenAsync())
      {
        computed = await LedgerRoutes.ComputeAsync(conn, new DateOnly(2004, 3, 1), new DateOnly(2004, 3, 31), granularity);
      }
      var json = JsonSerializer.Serialize(computed, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
      Assert.Equal(data.GetRawText(), json);
      Assert.Equal(granularity, data.GetProperty("granularity").GetString());
      Assert.True(data.GetProperty("totals").GetProperty("units").GetInt64() >= 3);
    }
  }
}
