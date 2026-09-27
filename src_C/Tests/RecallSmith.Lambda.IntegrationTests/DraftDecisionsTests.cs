using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Internal;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Shared fixtures of the R18A A03 test classes (DraftDecisionsTests, DraftQaResultsTests, DraftAcceptanceTests,
/// AutomationSpendCapTests): the env scope that restores every variable and seam it touches, decks, runs, grounded
/// draft cards, the handler calls with a hand-built <see cref="AuthContext"/>, the signed draft-QA report and the eval
/// gate. Card text is plainly synthetic; the secret is the fake <c>test-secret</c>.
/// </summary>
internal static class AutomationTestKit
{
  public const string FakeQaQueueUrl = "https://sqs.test/000000000000/developercards-ai-qa-jobs-test";
  public const string FakeWebhookQueueUrl = "https://sqs.test/000000000000/developercards-webhook-events-test";
  public const string SourceUrl = "https://docs.aws.amazon.com/synthetic/latest/userguide/queue-buffering.html";
  public const string SourceQuote = "Synthetic quote: a queue absorbs a burst so consumers read at their own pace.";
  public const string ReviewerProvider = "bedrock-converse";
  public const string ReviewerModel = "global.openai.gpt-5.5";
  public const string DraftsPath = "/api/v1/authoring/drafts";
  public const string ResultsPath = "/api/internal/ai-qa/results";

  // A00 §9.2, verbatim: the draft-QA message every cross-wave shape is asserted against.
  public const string ContractMessageJson = """
    { "v": 1, "runId": "<qa_job_id>", "chunk": 0, "chunkCount": 1, "promptVersion": "qa-v4-auto",
      "target": "draft", "profile": "automation",
      "deck": { "id": 12, "slug": "aws-saa-c03", "title": "AWS SAA-C03" },
      "reviewDate": "2026-10-01",
      "cards": [ { "cardId": 4711, "stableUid": "aws-s3-glacier-restore-07", "contentSha256": "<qa_content_sha256>", "difficulty": 2,
                   "topic": "4.1 Cost-optimized storage", "question": "…", "explanation": "…", "codeSnippet": null, "codeLanguage": null,
                   "realWorldUsage": null, "mcq": null, "source": { "url": "https://docs.aws.amazon.com/…", "quote": "…" } } ] }
    """;

  /// <summary>
  /// Sets the automation and QA env for one test and restores every value and seam on dispose. QA sends are captured
  /// in <see cref="QaSent"/>; while <see cref="FailSends"/> is true every QA send throws.
  /// </summary>
  public sealed class Scope : IDisposable
  {
    private static readonly string[] Names =
    [
      AutomationMode.EnvName, QaGate.EnabledEnv, QaGate.RequiredEnv, QaRuns.QueueUrlEnv, QaRuns.DailyCapEnv, QaRuns.EstUsdPerCardEnv,
      QaRuns.MaxCardsEnv, AutomationEnv.SourceHostsEnv, AutomationEnv.DeckSlugsEnv, "CONSOLE_BASE_URL", WebhookEvents.QueueUrlEnv,
      "INTERNAL_SHARED_SECRET", AiQaResults.CallerSecretEnv,
    ];

    private readonly Dictionary<string, string?> _saved = Names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    private readonly Func<SendMessageRequest, Task>? _savedQaSeam = QaRuns.TestSendSeam;
    private readonly Func<SendMessageRequest, Task>? _savedWebhookSeam = WebhookEvents.TestSendSeam;

    public List<SendMessageRequest> QaSent { get; } = [];
    public List<SendMessageRequest> WebhookSent { get; } = [];
    public bool FailSends { get; set; }

    public Scope(string mode = AutomationMode.DryRun)
    {
      Set(AutomationMode.EnvName, mode);
      Set(QaGate.EnabledEnv, "1");
      Set(QaGate.RequiredEnv, "0");
      Set(QaRuns.QueueUrlEnv, FakeQaQueueUrl);
      Set(QaRuns.DailyCapEnv, "1000000");
      Set(QaRuns.EstUsdPerCardEnv, "0.05");
      Set(AutomationEnv.SourceHostsEnv, null);
      Set(AutomationEnv.DeckSlugsEnv, null);
      Set("CONSOLE_BASE_URL", "https://console.example.com");
      Set(WebhookEvents.QueueUrlEnv, null);
      Set("INTERNAL_SHARED_SECRET", "test-secret");
      Set(AiQaResults.CallerSecretEnv, null);
      QaRuns.TestSendSeam = r =>
      {
        if (FailSends) throw new InvalidOperationException("synthetic SQS failure");
        lock (QaSent) QaSent.Add(r);
        return Task.CompletedTask;
      };
      WebhookEvents.TestSendSeam = r => { lock (WebhookSent) WebhookSent.Add(r); return Task.CompletedTask; };
    }

    public void Set(string name, string? value) => Environment.SetEnvironmentVariable(name, value);

    public void Dispose()
    {
      foreach (var (name, value) in _saved) Environment.SetEnvironmentVariable(name, value);
      QaRuns.TestSendSeam = _savedQaSeam;
      WebhookEvents.TestSendSeam = _savedWebhookSeam;
    }
  }

  public static string Sub(string tag) => $"it-a03-{tag}-{Guid.NewGuid():N}";

  public static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  public static AuthContext Ctx(string sub, bool agent = true) => new(
    Claims: new Dictionary<string, JsonElement>(),
    UserSub: sub,
    Username: null,
    Groups: ["super_admin"],
    IsSuperAdmin: true,
    IsEditor: false,
    IsAdmin: true,
    IsAgentClient: agent);

  public static async Task<(long Id, string Slug)> NewDeckAsync(PostgresFixture db, string tag)
  {
    var slug = $"it-a03-{tag}-{Guid.NewGuid():N}";
    var id = await db.ScalarAsync("insert into decks (slug, title, author) values ($1, $2, $3) returning id", slug, $"deck a03 {tag}", "tests");
    return (Long(id), slug);
  }

  public static async Task<long> NewCardAsync(PostgresFixture db, long deckId, string uid, string question, int isDeleted = 0) =>
    Long(await db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, is_deleted) " +
      "values ($1, $2, $3, 'synthetic explanation', 2, (select coalesce(max(order_in_deck), 0) + 10 from cards where deck_id = $1), $4) returning id",
      deckId, uid, question, isDeleted));

  /// <summary>An automation run (and its finished queue item) owned by <paramref name="ownerSub"/> on <paramref name="deckId"/>.</summary>
  public static async Task<Guid> NewRunAsync(PostgresFixture db, string ownerSub, long? deckId, string status = "running")
  {
    var item = await db.ScalarAsync(
      """
      insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, finished_at)
      values ('manual', $1, $2::bigint, $3, 'owner:it-a03', 'done', now())
      returning id
      """,
      $"https://docs.example.com/a03/{Guid.NewGuid():N}", deckId, $"it-a03:{Guid.NewGuid()}");
    var runId = Guid.NewGuid();
    await db.QueryAsync(
      """
      insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status, completed_at)
      values ($1, $2, 'it-a03-runner', $3, $4::bigint, $5, case when $5 = 'running' then null else now() end)
      """,
      runId, Long(item), ownerSub, deckId, status);
    return runId;
  }

  public static Dictionary<string, object?> Card(string uid, string? question = null, bool grounded = true, string url = SourceUrl)
  {
    var source = new Dictionary<string, object?> { ["url"] = url, ["quote"] = SourceQuote };
    if (grounded) source["grounding"] = new { chunkId = "chunk-1", sourceId = "source-1", matched = true, quoteChars = SourceQuote.Length };
    return new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["stableUid"] = uid,
      ["difficulty"] = 2,
      ["topic"] = "Synthetic topic",
      ["question"] = question ?? $"Synthetic question about automation draft {uid}?",
      ["explanation"] = $"Synthetic explanation for draft {uid}.",
      ["codeSnippet"] = null,
      ["codeLanguage"] = null,
      ["realWorldUsage"] = "Synthetic usage note.",
      ["mcq"] = null,
      ["source"] = source,
    };
  }

  public static string Uid(string tag) => $"a03-{tag}-{Guid.NewGuid():N}"[..40];

  /// <summary>The synthetic author configuration id the runner's agent block carries and a test gate measured (R18D M1).</summary>
  public const string AuthorConfigId = "0000000000000000000000000000000000000000000000000000000000a0c1d1";

  public static object Agent(Guid? runId) => runId is null
    ? new { name = "it-agent", model = "synthetic-model", skillVersion = "1" }
    : new { name = "it-agent", model = "synthetic-model", skillVersion = "1", runId = runId.Value.ToString(), queueItemId = "1", authorConfigId = AuthorConfigId };

  public delegate Task<APIGatewayProxyResponse> Handler(LambdaRequest req, Res res, AuthContext auth);

  public static Task<APIGatewayProxyResponse> CallAsync(Handler handler, string method, string path, object? body, AuthContext auth,
    IDictionary<string, string>? query = null)
  {
    var raw = body switch { null => null, string s => s, _ => JsonSerializer.Serialize(body) };
    var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
      headers = new Dictionary<string, string> { ["content-type"] = "application/json" },
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body = raw,
      isBase64Encoded = false,
    }));
    return handler(req, new Res(req.TraceId), auth);
  }

  public static Task<APIGatewayProxyResponse> SubmitAsync(AuthContext auth, long deckId, object? agent, params Dictionary<string, object?>[] cards) =>
    CallAsync(Drafts.HandleDrafts, "POST", DraftsPath,
      new { deckId, agent, drafts = cards.Select(c => new { clientDraftKey = Guid.NewGuid().ToString("N"), card = c }).ToArray() }, auth);

  /// <summary>Submits <paramref name="cards"/> as an automation run's agent; returns the created draft ids in request order.</summary>
  public static async Task<List<long>> SubmitDraftsAsync(AuthContext auth, long deckId, Guid? runId, params Dictionary<string, object?>[] cards)
  {
    var data = Data(await SubmitAsync(auth, deckId, Agent(runId), cards));
    return data.GetProperty("created").EnumerateArray().Select(e => e.GetProperty("draftId").GetInt64()).ToList();
  }

  public static Task<APIGatewayProxyResponse> AcceptAsync(long draftId, AuthContext auth, object? body = null) =>
    CallAsync((q, r, a) => Drafts.HandleAccept(q, r, a, draftId.ToString(CultureInfo.InvariantCulture)), "POST",
      $"{DraftsPath}/{draftId}/accept", body ?? new { }, auth);

  public static Task<APIGatewayProxyResponse> RejectAsync(long draftId, AuthContext auth, string reason = "incorrect", object? body = null) =>
    CallAsync((q, r, a) => Drafts.HandleReject(q, r, a, draftId.ToString(CultureInfo.InvariantCulture)), "POST",
      $"{DraftsPath}/{draftId}/reject", body ?? new { reason }, auth);

  public static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  public static void AssertError(APIGatewayProxyResponse response, int status, string code, string? message = null)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    Assert.Equal(code, doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    if (message is not null) Assert.Equal(message, doc.RootElement.GetProperty("error").GetProperty("message").GetString());
  }

  public static async Task<Dictionary<string, object?>?> DecisionAsync(PostgresFixture db, long draftId)
  {
    var rows = await db.QueryAsync("select * from automation_draft_decisions where draft_id = $1", draftId);
    return rows.Count == 0 ? null : rows[0];
  }

  public static async Task<List<Dictionary<string, object?>>> EventsAsync(PostgresFixture db, long draftId) =>
    await db.QueryAsync("select from_state, to_state, reason, actor, mode, details::text as details from automation_decision_events where draft_id = $1 order by id", draftId);

  public static async Task<long> CountAsync(PostgresFixture db, string sql, params object?[] parameters) =>
    Long(await db.ScalarAsync(sql, parameters));

  /// <summary>A passed eval gate for the automation reviewer (the latest wins); revoke it in <c>finally</c>.</summary>
  /// <summary>A passed gate row; <paramref name="effectiveEffort"/> goes into the stored report's reviewer (R18E N2).</summary>
  public static async Task<long> InsertGateAsync(PostgresFixture db, string provider = ReviewerProvider, string model = ReviewerModel,
    string promptVersion = QaRuns.AutomationPromptVersion, string? authorConfigId = AuthorConfigId, string? effectiveEffort = null) =>
    Long(await db.ScalarAsync(
      "insert into automation_eval_gates (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report, created_by_sub, author_config_id) " +
      "values ($1, $2, $3, true, '{}'::jsonb, $4, case when $6::text is null then '{}'::jsonb " +
      "else jsonb_build_object('reviewer', jsonb_build_object('effectiveEffort', $6::text)) end, 'it-a03', $5::text) returning id",
      provider, model, promptVersion, new string('b', 64), authorConfigId, effectiveEffort));

  public static Task RevokeGateAsync(PostgresFixture db, long id) =>
    db.QueryAsync("update automation_eval_gates set revoked_at = now(), revoked_by_sub = 'it-a03' where id = $1 and revoked_at is null", id);

  // ---------------------------------------------------------------- the draft-QA report (A00 §9.4)

  public static object Finding(string severity, string category = "other", string message = "Synthetic finding.") =>
    new { severity, category, message, suggestedFix = "Synthetic fix." };

  /// <summary>A §7.7 report body with <c>target: draft</c> for one draft item.</summary>
  public static Dictionary<string, object?> DraftReport(Guid qaJobId, long draftId, string contentSha256, string status = "done",
    string? errorCode = null, object[]? findings = null, string model = ReviewerModel, string? requestId = null, string? target = "draft")
  {
    var body = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["v"] = 1,
      ["runId"] = qaJobId,
      ["chunk"] = 0,
      ["provider"] = ReviewerProvider,
      ["model"] = model,
      ["promptVersion"] = QaRuns.AutomationPromptVersion,
      ["profile"] = "automation",
      ["items"] = new object[]
      {
        new
        {
          cardId = draftId,
          contentSha256,
          status,
          errorCode,
          findings = findings ?? [],
          usage = new { inputTokens = 1200, outputTokens = 300, cacheReadInputTokens = 0 },
          latencyMs = 900,
          requestId = requestId ?? $"req-{Guid.NewGuid():N}",
          estimatedCostUsd = 0.0001m,
        },
      },
    };
    if (target is not null) body["target"] = target;
    return body;
  }

  public static async Task<APIGatewayProxyResponse> PostReportAsync(object body)
  {
    var raw = body as string ?? JsonSerializer.Serialize(body);
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes("test-secret"));
    var signature = "v1=" + Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes($"{ts.ToString(CultureInfo.InvariantCulture)}.{raw}"))).ToLowerInvariant();
    var saved = Environment.GetEnvironmentVariable("INTERNAL_SHARED_SECRET");
    try
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", "test-secret");
      var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
      {
        rawPath = ResultsPath,
        requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
        headers = new Dictionary<string, string>
        {
          ["content-type"] = "application/json",
          ["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture),
          ["x-internal-signature"] = signature,
        },
        queryStringParameters = new Dictionary<string, string>(),
        body = raw,
        isBase64Encoded = false,
      }));
      return await AiQaResults.HandleAiQaResults(req, new Res(req.TraceId));
    }
    finally
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", saved);
    }
  }

  /// <summary>The job id and content hash a <c>qa_queued</c> decision was sent with.</summary>
  public static async Task<(Guid JobId, string Hash)> QueuedJobAsync(PostgresFixture db, long draftId)
  {
    var d = (await DecisionAsync(db, draftId))!;
    Assert.Equal("qa_queued", d["state"]);
    return ((Guid)d["qa_job_id"]!, (string)d["qa_content_sha256"]!);
  }

  /// <summary>Submits one eligible draft of a fresh deck and run; returns it queued for draft QA.</summary>
  public static async Task<Eligible> EligibleDraftAsync(PostgresFixture db, string tag, string? question = null)
  {
    var sub = Sub(tag);
    var deck = await NewDeckAsync(db, tag);
    var runId = await NewRunAsync(db, sub, deck.Id);
    var uid = Uid(tag);
    var ids = await SubmitDraftsAsync(Ctx(sub), deck.Id, runId, Card(uid, question));
    var (jobId, hash) = await QueuedJobAsync(db, ids[0]);
    return new Eligible(sub, deck.Id, deck.Slug, runId, ids[0], uid, jobId, hash);
  }

  public sealed record Eligible(string Sub, long DeckId, string DeckSlug, Guid RunId, long DraftId, string Uid, Guid JobId, string Hash);
}

/// <summary>
/// Automatic draft decisions at submit (R18A A03, contract A00 §5.1–§5.3, §5.7, §5.9, §5.10, §9.2) against the shared
/// Postgres: eligibility, the prechecks in order, the draft-QA enqueue (cap, SQS failures, the message shape), the
/// human hooks, the reason lists and the draft API's automation block. Draft QA sends go through
/// <see cref="QaRuns.TestSendSeam"/> only; every env variable is restored in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DraftDecisionsTests
{
  private readonly PostgresFixture _db;
  public DraftDecisionsTests(PostgresFixture db) => _db = db;

  private async Task<long> DecisionCountAsync(IEnumerable<long> draftIds) =>
    await AutomationTestKit.CountAsync(_db, "select count(*) from automation_draft_decisions where draft_id = any($1)", draftIds.ToArray());

  // ---------------------------------------------------------------- eligibility

  [Fact]
  public async Task Submit_ModeOff_CreatesNoDecision()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Off);
    var sub = AutomationTestKit.Sub("off");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "off");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);

    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId, AutomationTestKit.Card(AutomationTestKit.Uid("off")));

    Assert.Single(ids);
    Assert.Equal(0, await DecisionCountAsync(ids));
    Assert.Empty(scope.QaSent);
  }

  [Fact]
  public async Task Submit_WithoutRunId_CreatesNoDecision()
  {
    using var scope = new AutomationTestKit.Scope();
    var sub = AutomationTestKit.Sub("norun");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "norun");

    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, null, AutomationTestKit.Card(AutomationTestKit.Uid("norun")));
    var noAgent = AutomationTestKit.Data(await AutomationTestKit.SubmitAsync(AutomationTestKit.Ctx(sub), deck.Id, null,
      AutomationTestKit.Card(AutomationTestKit.Uid("noagent"))));
    ids.Add(noAgent.GetProperty("created")[0].GetProperty("draftId").GetInt64());

    Assert.Equal(0, await DecisionCountAsync(ids));
    Assert.Empty(scope.QaSent);
  }

  [Fact]
  public async Task Submit_UnknownRunId_CreatesNoDecision()
  {
    using var scope = new AutomationTestKit.Scope();
    var sub = AutomationTestKit.Sub("unknown");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "unknown");

    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, Guid.NewGuid(),
      AutomationTestKit.Card(AutomationTestKit.Uid("unknown")));
    var unparsable = AutomationTestKit.Data(await AutomationTestKit.SubmitAsync(AutomationTestKit.Ctx(sub), deck.Id,
      new { name = "it-agent", runId = "not-a-uuid" }, AutomationTestKit.Card(AutomationTestKit.Uid("unparsable"))));
    ids.Add(unparsable.GetProperty("created")[0].GetProperty("draftId").GetInt64());

    Assert.Equal(2, ids.Count);
    Assert.Equal(0, await DecisionCountAsync(ids));
    Assert.Empty(scope.QaSent);
  }

  [Fact]
  public async Task Submit_SpaClient_CreatesNoDecision()
  {
    using var scope = new AutomationTestKit.Scope();
    var sub = AutomationTestKit.Sub("spa");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "spa");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);

    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub, agent: false), deck.Id, runId,
      AutomationTestKit.Card(AutomationTestKit.Uid("spa")));

    Assert.Equal(0, await DecisionCountAsync(ids));
    Assert.Empty(scope.QaSent);
  }

  [Fact]
  public async Task Submit_AgentRunKeys_AreAccepted_UnknownKeyStill400()
  {
    using var scope = new AutomationTestKit.Scope(AutomationMode.Off);
    var sub = AutomationTestKit.Sub("keys");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "keys");
    var auth = AutomationTestKit.Ctx(sub);

    var runId = Guid.NewGuid().ToString();
    var ok = AutomationTestKit.Data(await AutomationTestKit.SubmitAsync(auth, deck.Id,
      new { name = "it-agent", model = "m", skillVersion = "1", runId, queueItemId = "42" }, AutomationTestKit.Card(AutomationTestKit.Uid("keys"))));
    var draftId = ok.GetProperty("created")[0].GetProperty("draftId").GetInt64();
    var agent = (string)(await _db.ScalarAsync("select agent::text from ai_drafts where id = $1", draftId))!;
    using (var doc = JsonDocument.Parse(agent))
    {
      Assert.Equal(runId, doc.RootElement.GetProperty("runId").GetString());
      Assert.Equal("42", doc.RootElement.GetProperty("queueItemId").GetString());
    }

    const string message = "agent must be an object with optional string fields name, model, skillVersion, runId, queueItemId (max 200) " +
      "and authorConfigId (max 128)";
    AutomationTestKit.AssertError(await AutomationTestKit.SubmitAsync(auth, deck.Id, new { name = "a", runId, extra = "b" },
      AutomationTestKit.Card(AutomationTestKit.Uid("keys-x"))), 400, "VALIDATION_ERROR", message);
    AutomationTestKit.AssertError(await AutomationTestKit.SubmitAsync(auth, deck.Id, new { runId = new string('r', 201) },
      AutomationTestKit.Card(AutomationTestKit.Uid("keys-long"))), 400, "VALIDATION_ERROR", message);
    AutomationTestKit.AssertError(await AutomationTestKit.SubmitAsync(auth, deck.Id, new { queueItemId = 42 },
      AutomationTestKit.Card(AutomationTestKit.Uid("keys-num"))), 400, "VALIDATION_ERROR", message);
  }

  [Fact]
  public async Task Submit_EligibleDraft_IsQueuedForDraftQa()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "eligible");

    var d = (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!;
    Assert.Equal(e.RunId, d["run_id"]);
    Assert.Equal(e.DeckId, AutomationTestKit.Long(d["deck_id"]));
    Assert.Equal("dry_run", d["mode"]);
    Assert.Null(d["reason"]);
    Assert.Equal(1, Convert.ToInt32(d["qa_attempts"], CultureInfo.InvariantCulture));
    Assert.NotNull(d["qa_enqueued_at"]);
    Assert.Null(d["decided_at"]);
    Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", e.DraftId));

    var sent = Assert.Single(scope.QaSent);
    Assert.Equal(AutomationTestKit.FakeQaQueueUrl, sent.QueueUrl);

    var events = await AutomationTestKit.EventsAsync(_db, e.DraftId);
    Assert.Equal(2, events.Count);
    Assert.Null(events[0]["from_state"]);
    Assert.Equal("qa_pending", events[0]["to_state"]);
    Assert.Equal(("qa_pending", "qa_queued"), ((string)events[1]["from_state"]!, (string)events[1]["to_state"]!));
    Assert.All(events, ev => Assert.Equal("automation", ev["actor"]));
    Assert.All(events, ev => Assert.Equal("dry_run", ev["mode"]));
  }

  /// <summary>
  /// One case per precheck (A00 §5.1 table order). Case <c>k</c> fails check <c>k</c> and every later check at once, so
  /// the reason recorded proves that each check runs before all the ones after it.
  /// </summary>
  [Theory]
  [InlineData(1, "RUN_NOT_RUNNING")]
  [InlineData(2, "DECK_MISMATCH")]
  [InlineData(3, "DECK_NOT_ALLOWED")]
  [InlineData(4, "EXISTING_CARD")]
  [InlineData(5, "LIKELY_DUPLICATE")]
  [InlineData(6, "UNGROUNDED")]
  [InlineData(7, "SOURCE_HOST_NOT_ALLOWED")]
  [InlineData(8, "QA_UNAVAILABLE")]
  public async Task Submit_FailedPrecheck_RoutesHumanWithReason(int failFrom, string expected)
  {
    using var scope = new AutomationTestKit.Scope();
    var sub = AutomationTestKit.Sub("pre");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "pre");
    var other = await AutomationTestKit.NewDeckAsync(_db, "pre-other");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, failFrom <= 2 ? other.Id : deck.Id, failFrom <= 1 ? "completed" : "running");
    if (failFrom <= 3) scope.Set(AutomationEnv.DeckSlugsEnv, "some-other-deck, another-deck");
    else scope.Set(AutomationEnv.DeckSlugsEnv, $"some-other-deck,{deck.Slug}");

    var uid = AutomationTestKit.Uid("pre");
    const string question = "Which synthetic queue buffers a burst of writes for slow consumers?";
    if (failFrom <= 4) await AutomationTestKit.NewCardAsync(_db, deck.Id, uid, "An unrelated synthetic prompt about lighthouses", isDeleted: 1);
    if (failFrom <= 5) await AutomationTestKit.NewCardAsync(_db, deck.Id, AutomationTestKit.Uid("pre-dup"), question);
    if (failFrom <= 8) scope.Set(QaGate.EnabledEnv, "0");

    var card = AutomationTestKit.Card(uid, question, grounded: failFrom > 6,
      url: failFrom <= 7 ? "https://blog.example.org/synthetic/post" : AutomationTestKit.SourceUrl);
    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId, card);

    var d = (await AutomationTestKit.DecisionAsync(_db, ids[0]))!;
    Assert.Equal("human", d["state"]);
    Assert.Equal(expected, d["reason"]);
    Assert.NotNull(d["decided_at"]);
    Assert.Null(d["qa_job_id"]);
    Assert.Empty(scope.QaSent);
    var ev = Assert.Single(await AutomationTestKit.EventsAsync(_db, ids[0]));
    Assert.Equal(("human", expected), ((string)ev["to_state"]!, (string)ev["reason"]!));
    // dry_run writes no ledger row (A00 §14).
    Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from automation_events where dedupe_key = $1", $"auto-route:{ids[0]}"));
  }

  [Fact]
  public async Task Submit_DailyCap_StaysQaPending()
  {
    using var scope = new AutomationTestKit.Scope();
    const decimal perCard = 0.05m;
    decimal baseline;
    await using (var conn = await _db.OpenAsync())
    {
      var (spent, open) = await QaRuns.SpendTodayAsync(conn, null);
      baseline = spent + open * perCard;
    }
    // Less than one card of headroom.
    scope.Set(QaRuns.DailyCapEnv, (baseline + perCard - 0.000001m).ToString(CultureInfo.InvariantCulture));

    var sub = AutomationTestKit.Sub("cap");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "cap");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);
    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId, AutomationTestKit.Card(AutomationTestKit.Uid("cap")));

    var d = (await AutomationTestKit.DecisionAsync(_db, ids[0]))!;
    Assert.Equal("qa_pending", d["state"]);
    Assert.Equal("AI_QA_DAILY_CAP", d["reason"]);
    Assert.Null(d["qa_job_id"]);
    Assert.Equal(0, Convert.ToInt32(d["qa_attempts"], CultureInfo.InvariantCulture));
    Assert.Empty(scope.QaSent);
    // A reason change without a state change writes no event.
    Assert.Single(await AutomationTestKit.EventsAsync(_db, ids[0]));

    // Headroom for exactly one card: the retry goes through.
    scope.Set(QaRuns.DailyCapEnv, (baseline + perCard).ToString(CultureInfo.InvariantCulture));
    await using (var conn = await _db.OpenAsync())
    {
      Assert.Equal("qa_queued", await DraftDecisions.EnqueueQaAsync(conn, ids[0]));
    }
    Assert.Single(scope.QaSent);
  }

  [Fact]
  public async Task Submit_SqsFailure_StaysQaPendingEnqueueRetry()
  {
    using var scope = new AutomationTestKit.Scope();
    scope.FailSends = true;
    var sub = AutomationTestKit.Sub("sqs");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "sqs");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);

    APIGatewayProxyResponse response = null!;
    var stdout = await EmfCapture.StdoutAsync(async () =>
      response = await AutomationTestKit.SubmitAsync(AutomationTestKit.Ctx(sub), deck.Id, AutomationTestKit.Agent(runId),
        AutomationTestKit.Card(AutomationTestKit.Uid("sqs"))));
    var ids = AutomationTestKit.Data(response).GetProperty("created").EnumerateArray().Select(c => c.GetProperty("draftId").GetInt64()).ToList();

    var d = (await AutomationTestKit.DecisionAsync(_db, ids[0]))!;
    Assert.Equal("qa_pending", d["state"]);
    Assert.Equal("ENQUEUE_RETRY", d["reason"]);
    Assert.Equal(1, Convert.ToInt32(d["qa_attempts"], CultureInfo.InvariantCulture));
    Assert.Null(d["qa_enqueued_at"]);
    Assert.Null(d["decided_at"]);
    Assert.Equal(1, EmfCapture.GaugeSum(stdout, DraftDecisions.QaEnqueueFailuresMetric));
    var events = await AutomationTestKit.EventsAsync(_db, ids[0]);
    Assert.Equal(("qa_queued", "qa_pending", "ENQUEUE_RETRY"),
      ((string)events[^1]["from_state"]!, (string)events[^1]["to_state"]!, (string)events[^1]["reason"]!));
  }

  [Fact]
  public async Task EnqueueQa_ThirdSqsFailure_RoutesHumanEnqueueFailed()
  {
    using var scope = new AutomationTestKit.Scope();
    scope.FailSends = true;
    var sub = AutomationTestKit.Sub("sqs3");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "sqs3");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);
    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId, AutomationTestKit.Card(AutomationTestKit.Uid("sqs3")));

    await using var conn = await _db.OpenAsync();
    Assert.Equal("qa_pending", await DraftDecisions.EnqueueQaAsync(conn, ids[0]));
    var second = (await AutomationTestKit.DecisionAsync(_db, ids[0]))!;
    Assert.Equal(("qa_pending", "ENQUEUE_RETRY", 2), ((string)second["state"]!, (string)second["reason"]!, Convert.ToInt32(second["qa_attempts"], CultureInfo.InvariantCulture)));

    Assert.Equal("human", await DraftDecisions.EnqueueQaAsync(conn, ids[0]));
    var d = (await AutomationTestKit.DecisionAsync(_db, ids[0]))!;
    Assert.Equal("human", d["state"]);
    Assert.Equal("ENQUEUE_FAILED", d["reason"]);
    Assert.Equal(3, Convert.ToInt32(d["qa_attempts"], CultureInfo.InvariantCulture));
    Assert.NotNull(d["decided_at"]);
    Assert.Empty(scope.QaSent);

    // A finished decision is never enqueued again.
    scope.FailSends = false;
    Assert.Equal("human", await DraftDecisions.EnqueueQaAsync(conn, ids[0]));
    Assert.Empty(scope.QaSent);
    Assert.Equal("human", (await AutomationTestKit.EventsAsync(_db, ids[0]))[^1]["to_state"]);
  }

  [Fact]
  public async Task DraftQaMessage_MatchesTheContractShape()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "shape");

    using var contract = JsonDocument.Parse(AutomationTestKit.ContractMessageJson);
    using var actual = JsonDocument.Parse(Assert.Single(scope.QaSent).MessageBody);
    var c = contract.RootElement;
    var m = actual.RootElement;

    static string[] Keys(JsonElement el) => el.EnumerateObject().Select(p => p.Name).ToArray();
    Assert.Equal(Keys(c), Keys(m));
    Assert.Equal(Keys(c.GetProperty("deck")), Keys(m.GetProperty("deck")));
    var contractCard = c.GetProperty("cards")[0];
    var card = Assert.Single(m.GetProperty("cards").EnumerateArray());
    Assert.Equal(Keys(contractCard), Keys(card));
    Assert.Equal(Keys(contractCard.GetProperty("source")), Keys(card.GetProperty("source")));

    Assert.Equal(1, m.GetProperty("v").GetInt32());
    Assert.Equal(e.JobId, m.GetProperty("runId").GetGuid());
    Assert.Equal(0, m.GetProperty("chunk").GetInt32());
    Assert.Equal(1, m.GetProperty("chunkCount").GetInt32());
    Assert.Equal(QaRuns.AutomationPromptVersion, m.GetProperty("promptVersion").GetString());
    Assert.Equal(c.GetProperty("target").GetString(), m.GetProperty("target").GetString());
    Assert.Equal(c.GetProperty("profile").GetString(), m.GetProperty("profile").GetString());
    Assert.Equal(e.DeckId, m.GetProperty("deck").GetProperty("id").GetInt64());
    Assert.Equal(e.DeckSlug, m.GetProperty("deck").GetProperty("slug").GetString());
    Assert.Equal(DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), m.GetProperty("reviewDate").GetString());
    Assert.Equal(e.DraftId, card.GetProperty("cardId").GetInt64());
    Assert.Equal(e.Uid, card.GetProperty("stableUid").GetString());
    Assert.Equal(e.Hash, card.GetProperty("contentSha256").GetString());
    Assert.Equal(JsonValueKind.Null, card.GetProperty("mcq").ValueKind);
    Assert.False(card.GetProperty("source").TryGetProperty("grounding", out _));
    Assert.Equal(AutomationTestKit.SourceUrl, card.GetProperty("source").GetProperty("url").GetString());
    Assert.Equal(AutomationTestKit.SourceQuote, card.GetProperty("source").GetProperty("quote").GetString());
  }

  // ---------------------------------------------------------------- humans win (A00 §5.7)

  [Fact]
  public async Task HumanAccept_BeforeQa_SupersedesTheDecision()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "hacc");
    var human = AutomationTestKit.Sub("human");

    var accepted = AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(e.DraftId, AutomationTestKit.Ctx(human, agent: false)));
    Assert.Equal("accepted", accepted.GetProperty("action").GetString());

    var d = (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!;
    Assert.Equal("superseded", d["state"]);
    Assert.Equal("DECIDED_BY_HUMAN", d["reason"]);
    Assert.Equal("accepted", d["human_action"]);
    Assert.Null(d["human_reason"]);
    Assert.NotNull(d["human_decided_at"]);
    Assert.NotNull(d["decided_at"]);
    var ev = (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1];
    Assert.Equal(("qa_queued", "superseded", "DECIDED_BY_HUMAN", $"human:{human}"),
      ((string)ev["from_state"]!, (string)ev["to_state"]!, (string)ev["reason"]!, (string)ev["actor"]!));

    // The late report is a no-op: the decision is no longer qa_queued.
    var late = AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
    Assert.Equal(0, late.GetProperty("cardsDone").GetInt32());
    Assert.Equal("superseded", (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!["state"]);
  }

  [Fact]
  public async Task HumanReject_AfterWouldAccept_RecordsHumanAction()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "hrej");
    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash)));
    Assert.Equal("would_accept", (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!["state"]);

    var human = AutomationTestKit.Sub("human");
    AutomationTestKit.Data(await AutomationTestKit.RejectAsync(e.DraftId, AutomationTestKit.Ctx(human, agent: false), "ambiguous"));

    var d = (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!;
    Assert.Equal("would_accept", d["state"]);
    Assert.Null(d["reason"]);
    Assert.Equal("rejected", d["human_action"]);
    Assert.Equal("ambiguous", d["human_reason"]);
    Assert.NotNull(d["human_decided_at"]);
    var ev = (await AutomationTestKit.EventsAsync(_db, e.DraftId))[^1];
    Assert.Equal(("would_accept", "would_accept", AutomationReasons.HumanAction, $"human:{human}"),
      ((string)ev["from_state"]!, (string)ev["to_state"]!, (string)ev["reason"]!, (string)ev["actor"]!));
  }

  // ---------------------------------------------------------------- reasons (A00 §5.9)

  /// <summary>Every §5.9 decision reason × five synthetic (draft, deck) pairs: 95 generated cases.</summary>
  public static IEnumerable<object[]> ReasonCases()
  {
    long[][] ids = [[1, 1], [42, 7], [9_000_000_001, 3], [123_456, 987_654], [long.MaxValue, 1]];
    foreach (var reason in AutomationReasons.DecisionReasons)
    {
      foreach (var pair in ids) yield return [reason, pair[0], pair[1]];
    }
  }

  [Theory]
  [MemberData(nameof(ReasonCases))]
  public void ReasonToLedgerOutcome_MatchesTheContract(string reason, long draftId, long deckId)
  {
    string[] failures = ["QA_ERROR", "QA_TIMEOUT", "QA_HASH_MISMATCH", "QA_UNAVAILABLE", "ENQUEUE_FAILED"];
    var expected = failures.Contains(reason) ? "failure" : "success";
    Assert.Equal(expected, AutomationReasons.LedgerOutcome(reason));

    var detail = reason == "QA_ERROR" ? "PROVIDER_ACCESS_DENIED" : null;
    var e = DraftDecisions.RouteLedgerEvent(draftId, deckId, reason, detail);
    Assert.Equal("auto_accept", e.Automation);
    Assert.Equal(0, e.Units);
    Assert.Equal(expected, e.Outcome);
    Assert.Equal(deckId, e.DeckId);
    Assert.Equal(draftId.ToString(CultureInfo.InvariantCulture), e.Ref);
    Assert.Equal($"auto-route:{draftId.ToString(CultureInfo.InvariantCulture)}", e.DedupeKey);
    using var details = JsonDocument.Parse(JsonSerializer.Serialize(e.Details));
    Assert.Equal(reason, details.RootElement.GetProperty("reason").GetString());
    Assert.Equal(detail, details.RootElement.GetProperty("reasonDetail").GetString());
  }

  [Fact]
  public async Task ReasonLists_MatchTheMigrationConstraints()
  {
    async Task<List<string>> ConstraintCodesAsync(string name)
    {
      var def = (string)(await _db.ScalarAsync("select pg_get_constraintdef(oid) from pg_constraint where conname = $1", name))!;
      return Regex.Matches(def, "'([A-Z_]+)'").Select(m => m.Groups[1].Value).ToList();
    }

    Assert.Equal(await ConstraintCodesAsync("ck_automation_decisions_reason"), AutomationReasons.DecisionReasons);
    Assert.Equal(await ConstraintCodesAsync("ck_automation_publishes_reason"), AutomationReasons.PublishReasons);
    Assert.All(AutomationReasons.LedgerFailureReasons, r => Assert.Contains(r, AutomationReasons.DecisionReasons));
    Assert.DoesNotContain(AutomationReasons.HumanAction, AutomationReasons.DecisionReasons);
    Assert.Throws<ArgumentException>(() => AutomationReasons.LedgerOutcome(AutomationReasons.HumanAction));
    Assert.Throws<ArgumentException>(() => AutomationReasons.LedgerOutcome("PUBLISH_FAILED"));
  }

  // ---------------------------------------------------------------- draft API (A00 §5.10)

  [Fact]
  public async Task Drafts_ListAndGet_CarryTheAutomationBlock()
  {
    using var scope = new AutomationTestKit.Scope();
    var e = await AutomationTestKit.EligibleDraftAsync(_db, "api");
    var plain = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(e.Sub), e.DeckId, null,
      AutomationTestKit.Card(AutomationTestKit.Uid("api-plain"))))[0];
    var reader = AutomationTestKit.Ctx(AutomationTestKit.Sub("reader"), agent: false);

    AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash,
      findings: [AutomationTestKit.Finding("minor", "weak_distractor", "Synthetic minor finding.")])));

    var list = AutomationTestKit.Data(await AutomationTestKit.CallAsync(Drafts.HandleDrafts, "GET", AutomationTestKit.DraftsPath, null, reader,
      new Dictionary<string, string> { ["deckId"] = e.DeckId.ToString(CultureInfo.InvariantCulture), ["status"] = "all" }));
    var items = list.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("draftId").GetInt64());
    var auto = items[e.DraftId].GetProperty("automation");
    Assert.Equal(["state", "reason", "mode"], auto.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal("would_accept", auto.GetProperty("state").GetString());
    Assert.Equal(JsonValueKind.Null, auto.GetProperty("reason").ValueKind);
    Assert.Equal("dry_run", auto.GetProperty("mode").GetString());
    Assert.Equal(JsonValueKind.Null, items[plain].GetProperty("automation").ValueKind);

    var detail = AutomationTestKit.Data(await AutomationTestKit.CallAsync(
      (q, r, a) => Drafts.HandleGetDraft(q, r, a, e.DraftId.ToString(CultureInfo.InvariantCulture)), "GET",
      $"{AutomationTestKit.DraftsPath}/{e.DraftId}", null, reader)).GetProperty("automation");
    Assert.Equal(["runId", "state", "reason", "reasonDetail", "mode", "qa", "acceptedCardId", "humanAction"],
      detail.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(e.RunId, detail.GetProperty("runId").GetGuid());
    Assert.Equal("would_accept", detail.GetProperty("state").GetString());
    var qa = detail.GetProperty("qa");
    Assert.Equal(["status", "errorCode", "provider", "model", "promptVersion", "blocker", "major", "minor", "findings"],
      qa.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal("done", qa.GetProperty("status").GetString());
    Assert.Equal(AutomationTestKit.ReviewerModel, qa.GetProperty("model").GetString());
    Assert.Equal(1, qa.GetProperty("minor").GetInt32());
    var finding = Assert.Single(qa.GetProperty("findings").EnumerateArray());
    Assert.Equal(["severity", "category", "message", "suggestedFix"], finding.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal("weak_distractor", finding.GetProperty("category").GetString());
    Assert.Equal(JsonValueKind.Null, detail.GetProperty("acceptedCardId").ValueKind);
    Assert.Equal(JsonValueKind.Null, detail.GetProperty("humanAction").ValueKind);

    // qa is null until a report was applied.
    var queued = await AutomationTestKit.EligibleDraftAsync(_db, "api-q");
    var queuedDetail = AutomationTestKit.Data(await AutomationTestKit.CallAsync(
      (q, r, a) => Drafts.HandleGetDraft(q, r, a, queued.DraftId.ToString(CultureInfo.InvariantCulture)), "GET",
      $"{AutomationTestKit.DraftsPath}/{queued.DraftId}", null, reader)).GetProperty("automation");
    Assert.Equal("qa_queued", queuedDetail.GetProperty("state").GetString());
    Assert.Equal(JsonValueKind.Null, queuedDetail.GetProperty("qa").ValueKind);

    var plainDetail = AutomationTestKit.Data(await AutomationTestKit.CallAsync(
      (q, r, a) => Drafts.HandleGetDraft(q, r, a, plain.ToString(CultureInfo.InvariantCulture)), "GET",
      $"{AutomationTestKit.DraftsPath}/{plain}", null, reader));
    Assert.Equal(JsonValueKind.Null, plainDetail.GetProperty("automation").ValueKind);
  }

  [Fact]
  public async Task Drafts_WithoutAutomationTables_ReturnNullAutomation()
  {
    const string name = "it_a03_drafts_033";
    var scratch = await _db.CreateScratchDatabaseAsync(name);
    long deckId, draftId;
    await using (var conn = new NpgsqlConnection(scratch))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 33);
      deckId = AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, null,
        "insert into decks (slug, title, author) values ($1, 'deck a03', 'tests') returning id", [$"it-a03-033-{Guid.NewGuid():N}"]));
    }

    using var scope = new AutomationTestKit.Scope();
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", name);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();

      var auth = AutomationTestKit.Ctx(AutomationTestKit.Sub("033"));
      // A run id on a pre-034 database: the submit still succeeds (effective mode off, SERVER_NOT_READY_AUTOMATION).
      draftId = (await AutomationTestKit.SubmitDraftsAsync(auth, deckId, Guid.NewGuid(), AutomationTestKit.Card(AutomationTestKit.Uid("033"))))[0];

      var list = AutomationTestKit.Data(await AutomationTestKit.CallAsync(Drafts.HandleDrafts, "GET", AutomationTestKit.DraftsPath, null, auth,
        new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) }));
      var item = Assert.Single(list.GetProperty("items").EnumerateArray());
      Assert.Equal(JsonValueKind.Null, item.GetProperty("automation").ValueKind);

      var detail = AutomationTestKit.Data(await AutomationTestKit.CallAsync(
        (q, r, a) => Drafts.HandleGetDraft(q, r, a, draftId.ToString(CultureInfo.InvariantCulture)), "GET",
        $"{AutomationTestKit.DraftsPath}/{draftId}", null, auth));
      Assert.Equal(JsonValueKind.Null, detail.GetProperty("automation").ValueKind);

      // Accept and reject keep working without the decision table.
      AutomationTestKit.Data(await AutomationTestKit.AcceptAsync(draftId, auth));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }
}
