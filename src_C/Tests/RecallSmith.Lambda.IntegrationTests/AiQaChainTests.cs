using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The accept → QA → publish chain (R18 Y02, automation-17) against a real Postgres: an accept with <c>runQa</c>
/// queues (or reuses) a <c>scope=changed</c> run, and a publish refused with <c>AI_QA_REQUIRED</c> starts the run
/// that would clear it and returns its id. Nothing starts when AI_QA_ENABLED is off. Every SQS send goes through the
/// test seams; every env var and seam is restored in finally. Card text is plainly synthetic.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AiQaChainTests
{
  private readonly PostgresFixture _db;
  public AiQaChainTests(PostgresFixture db) => _db = db;

  private const string FakeQaQueueUrl = "https://sqs.test/000000000000/ai-qa-y02";
  private const string SeamQueueUrl = "https://sqs.test/000000000000/y02-publish";
  private const string SeamBucket = "it-y02-bucket";

  // ---------------------------------------------------------------- helpers

  private sealed class ChainEnv : IDisposable
  {
    private static readonly string[] Names =
      [QaGate.EnabledEnv, QaGate.RequiredEnv, QaRuns.QueueUrlEnv, QaRuns.MaxCardsEnv, QaRuns.DailyCapEnv, QaRuns.EstUsdPerCardEnv];

    private readonly Dictionary<string, string?> _saved = Names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    private readonly Func<SendMessageRequest, Task>? _savedQaSeam = QaRuns.TestSendSeam;
    private readonly Publish.EnqueueSeam? _savedPublishSeam = Publish.TestEnqueueSeam;

    public List<SendMessageRequest> QaSent { get; } = [];
    public List<SendMessageRequest> PublishSent { get; } = [];

    public ChainEnv(string enabled, string required = "0")
    {
      Set(QaGate.EnabledEnv, enabled);
      Set(QaGate.RequiredEnv, required);
      Set(QaRuns.QueueUrlEnv, FakeQaQueueUrl);
      Set(QaRuns.MaxCardsEnv, "200");
      Set(QaRuns.DailyCapEnv, "1000000");
      QaRuns.TestSendSeam = r => { lock (QaSent) QaSent.Add(r); return Task.CompletedTask; };
      Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, r => { lock (PublishSent) PublishSent.Add(r); return Task.CompletedTask; });
    }

    public void Set(string name, string? value) => Environment.SetEnvironmentVariable(name, value);

    public void Dispose()
    {
      foreach (var (name, value) in _saved) Environment.SetEnvironmentVariable(name, value);
      QaRuns.TestSendSeam = _savedQaSeam;
      Publish.TestEnqueueSeam = _savedPublishSeam;
    }
  }

  private async Task<long> NewDeckAsync(string tag) => Convert.ToInt64(await _db.ScalarAsync(
    "insert into decks (slug, title, author, deck_type) values ($1, $2, $3, 1) returning id",
    $"it-y02-{tag}-{Guid.NewGuid():N}", $"deck y02 {tag}", "tests"), CultureInfo.InvariantCulture);

  private async Task<long> NewCardAsync(long deckId, string uid, int order) => Convert.ToInt64(await _db.ScalarAsync(
    "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, $3, $4, 2, $5) returning id",
    deckId, uid, $"Synthetic question for {uid}?", $"Synthetic explanation for {uid}.", order), CultureInfo.InvariantCulture);

  private static Dictionary<string, object?> Card(string uid) => new(StringComparer.Ordinal)
  {
    ["stableUid"] = uid,
    ["difficulty"] = 2,
    ["topic"] = "Synthetic topic",
    ["question"] = $"Synthetic question about draft {uid}?",
    ["explanation"] = $"Synthetic explanation for draft {uid}.",
    ["codeSnippet"] = null,
    ["codeLanguage"] = null,
    ["realWorldUsage"] = "Synthetic usage note.",
    ["mcq"] = null,
    ["source"] = new Dictionary<string, object?>
    {
      ["url"] = "https://docs.aws.amazon.com/synthetic/latest/userguide/queue-buffering.html",
      ["quote"] = "Synthetic quote: a queue absorbs a burst so consumers read at their own pace.",
    },
  };

  private static JsonElement Event(string method, string path, string sub, string? body) => JsonSerializer.SerializeToElement(new
  {
    rawPath = path,
    requestContext = new
    {
      requestId = Guid.NewGuid().ToString(),
      http = new { method },
      authorizer = new
      {
        jwt = new
        {
          claims = new Dictionary<string, object>(StringComparer.Ordinal)
          {
            ["sub"] = sub,
            ["cognito:groups"] = new[] { "super_admin" },
          },
        },
      },
    },
    headers = new Dictionary<string, string>(),
    queryStringParameters = new Dictionary<string, string>(),
    body,
    isBase64Encoded = false,
  });

  private delegate Task<APIGatewayProxyResponse> Handler(LambdaRequest req, Res res, AuthContext auth);

  private static async Task<APIGatewayProxyResponse> CallAsync(Handler handler, string path, object body)
  {
    var req = new LambdaRequest(Event("POST", path, $"it-y02-super-{Guid.NewGuid():N}", JsonSerializer.Serialize(body)));
    return await handler(req, new Res(req.TraceId), await Auth.GetAuthContextAsync(req));
  }

  private async Task<List<long>> SubmitAsync(long deckId, params string[] uids)
  {
    var response = await CallAsync(Drafts.HandleDrafts, "/api/v1/authoring/drafts",
      new { deckId, drafts = uids.Select(u => new { clientDraftKey = Guid.NewGuid().ToString("N"), card = Card(u) }).ToArray() });
    return Data(response).GetProperty("created").EnumerateArray().Select(c => c.GetProperty("draftId").GetInt64()).ToList();
  }

  private static Task<APIGatewayProxyResponse> AcceptAsync(long draftId, object body) =>
    CallAsync((q, r, a) => Drafts.HandleAccept(q, r, a, draftId.ToString(CultureInfo.InvariantCulture)),
      $"/api/v1/authoring/drafts/{draftId}/accept", body);

  private static Task<APIGatewayProxyResponse> PublishAsync(long deckId) =>
    CallAsync(Publish.HandleAuthoringPublish, "/api/v1/authoring/publish", new { deckId });

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static JsonElement Error(APIGatewayProxyResponse response, int status, string code)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    var error = doc.RootElement.GetProperty("error").Clone();
    Assert.Equal(code, error.GetProperty("code").GetString());
    return error;
  }

  private async Task<List<Dictionary<string, object?>>> RunsAsync(long deckId) =>
    await _db.QueryAsync("select id, scope, status, card_count, requested_by_sub from ai_qa_runs where deck_id = $1 order by created_at", deckId);

  // ---------------------------------------------------------------- accept → QA

  [Fact]
  public async Task Accept_RunQa_QueuesAChangedRun_ThenReusesIt()
  {
    using var env = new ChainEnv("1");
    var deckId = await NewDeckAsync("acceptqa");
    var ids = await SubmitAsync(deckId, "acceptqa-a", "acceptqa-b");

    var first = Data(await AcceptAsync(ids[0], new { runQa = true }));
    var cardId = first.GetProperty("cardId").GetInt64();
    var qa = first.GetProperty("qa");
    Assert.Equal("queued", qa.GetProperty("status").GetString());
    var runId = qa.GetProperty("runId").GetString();

    var run = Assert.Single(await RunsAsync(deckId));
    Assert.Equal(runId, run["id"]!.ToString());
    Assert.Equal("changed", run["scope"]);
    Assert.Equal(1, Convert.ToInt32(run["card_count"], CultureInfo.InvariantCulture));
    Assert.StartsWith("it-y02-super-", (string)run["requested_by_sub"]!);
    Assert.Equal(cardId, Convert.ToInt64(await _db.ScalarAsync("select card_id from ai_qa_items where run_id = $1", run["id"]), CultureInfo.InvariantCulture));
    var message = Assert.Single(env.QaSent);
    Assert.Contains($"\"cardId\":{cardId}", message.MessageBody);

    // The next accept finds the deck's run still open and reuses it instead of stacking a second run.
    var second = Data(await AcceptAsync(ids[1], new { runQa = true })).GetProperty("qa");
    Assert.Equal("in_progress", second.GetProperty("status").GetString());
    Assert.Equal(runId, second.GetProperty("runId").GetString());
    Assert.Single(await RunsAsync(deckId));
    Assert.Single(env.QaSent);
  }

  [Fact]
  public async Task Accept_RunQa_WithAiQaDisabled_StartsNothing()
  {
    using var env = new ChainEnv("0");
    var deckId = await NewDeckAsync("acceptoff");
    var ids = await SubmitAsync(deckId, "acceptoff-a");

    var qa = Data(await AcceptAsync(ids[0], new { runQa = true })).GetProperty("qa");
    Assert.Equal("disabled", qa.GetProperty("status").GetString());
    Assert.Equal("AI_QA_DISABLED", qa.GetProperty("code").GetString());
    Assert.Empty(await RunsAsync(deckId));
    Assert.Empty(env.QaSent);
  }

  [Fact]
  public async Task Accept_WithoutRunQa_IsUnchanged_AndRunQaMustBeBoolean()
  {
    using var env = new ChainEnv("1");
    var deckId = await NewDeckAsync("acceptplain");
    var ids = await SubmitAsync(deckId, "acceptplain-a", "acceptplain-b");

    var data = Data(await AcceptAsync(ids[0], new { runQa = false }));
    Assert.False(data.TryGetProperty("qa", out _));
    Assert.Empty(await RunsAsync(deckId));

    Error(await AcceptAsync(ids[1], new { runQa = "yes" }), 400, "VALIDATION_ERROR");
    Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", ids[1]));
  }

  // ---------------------------------------------------------------- publish gate → QA

  [Fact]
  public async Task PublishGate_AiQaRequired_StartsTheRun_AndReturnsItsId()
  {
    using var env = new ChainEnv("1", "1");
    var deckId = await NewDeckAsync("gatechain");
    await NewCardAsync(deckId, "gatechain-a", 1);
    await NewCardAsync(deckId, "gatechain-b", 2);

    var error = Error(await PublishAsync(deckId), 409, "AI_QA_REQUIRED");
    var runId = error.GetProperty("runId").GetString();
    Assert.NotNull(runId);
    Assert.Equal("queued", error.GetProperty("qaRun").GetProperty("status").GetString());
    var run = Assert.Single(await RunsAsync(deckId));
    Assert.Equal(runId, run["id"]!.ToString());
    Assert.Equal("changed", run["scope"]);
    Assert.Equal(2, Convert.ToInt32(run["card_count"], CultureInfo.InvariantCulture));
    Assert.Empty(env.PublishSent);

    // Publishing again while the run is open reuses it.
    var again = Error(await PublishAsync(deckId), 409, "AI_QA_REQUIRED");
    Assert.Equal(runId, again.GetProperty("runId").GetString());
    Assert.Equal("in_progress", again.GetProperty("qaRun").GetProperty("status").GetString());
    Assert.Single(await RunsAsync(deckId));
    Assert.Single(env.QaSent);
  }

  [Fact]
  public async Task PublishGate_WithoutQueue_StillRefuses_WithoutARun()
  {
    using var env = new ChainEnv("1", "1");
    env.Set(QaRuns.QueueUrlEnv, null);
    var deckId = await NewDeckAsync("gatenoqueue");
    await NewCardAsync(deckId, "gatenoqueue-a", 1);

    var error = Error(await PublishAsync(deckId), 409, "AI_QA_REQUIRED");
    Assert.Equal(JsonValueKind.Null, error.GetProperty("runId").ValueKind);
    Assert.Equal("not_started", error.GetProperty("qaRun").GetProperty("status").GetString());
    Assert.Equal("CONFIG_ERROR", error.GetProperty("qaRun").GetProperty("code").GetString());
    Assert.Empty(await RunsAsync(deckId));
  }
}
