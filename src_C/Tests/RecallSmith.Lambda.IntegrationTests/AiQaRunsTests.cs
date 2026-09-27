using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Internal;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The AI QA console routes (R18 J13, contract §7.2) against a real Postgres: the start checks in contract order,
/// the §7.4 message shape through <see cref="QaRuns.TestSendSeam"/> (no AWS client is ever built), stale-run
/// reaping, the run detail and list, the status preview of the publish gate, finding resolution with its ledger
/// defect, and the 503 on a pre-031 schema. Every test creates its own deck; every env var and seam is restored
/// in finally. Card text is plainly synthetic.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AiQaRunsTests
{
  private readonly PostgresFixture _db;
  public AiQaRunsTests(PostgresFixture db) => _db = db;

  private const string RunsPath = "/api/v1/authoring/qa/runs";
  private const string StatusPath = "/api/v1/authoring/qa/status";
  private const string FakeQueueUrl = "https://sqs.test/000000000000/ai-qa";

  // ---------------------------------------------------------------- helpers

  /// <summary>Sets the AI QA env for one test and restores every value (and the send seam) on dispose.</summary>
  private sealed class QaEnv : IDisposable
  {
    private static readonly string[] Names =
      [QaGate.EnabledEnv, QaGate.RequiredEnv, QaRuns.QueueUrlEnv, QaRuns.MaxCardsEnv, QaRuns.DailyCapEnv, "INTERNAL_SHARED_SECRET"];

    private readonly Dictionary<string, string?> _saved = Names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    private readonly Func<SendMessageRequest, Task>? _savedSeam = QaRuns.TestSendSeam;

    public List<SendMessageRequest> Sent { get; } = [];

    public QaEnv()
    {
      Set(QaGate.EnabledEnv, "1");
      Set(QaGate.RequiredEnv, "0");
      Set(QaRuns.QueueUrlEnv, FakeQueueUrl);
      Set(QaRuns.MaxCardsEnv, "200");
      Set(QaRuns.DailyCapEnv, "1000000");
      QaRuns.TestSendSeam = r => { lock (Sent) Sent.Add(r); return Task.CompletedTask; };
    }

    public void Set(string name, string? value) => Environment.SetEnvironmentVariable(name, value);

    public void Dispose()
    {
      foreach (var (name, value) in _saved) Environment.SetEnvironmentVariable(name, value);
      QaRuns.TestSendSeam = _savedSeam;
    }
  }

  private static string SuperSub() => $"it-j13-super-{Guid.NewGuid():N}";

  private async Task<(long Id, string Slug)> NewDeckAsync(string tag)
  {
    var slug = $"it-j13-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id", slug, $"deck j13 {tag}", "tests");
    return (Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture), slug);
  }

  private async Task<long> NewCardAsync(long deckId, string uid, int order, string? sourceJson = null)
  {
    var id = await _db.ScalarAsync(
      """
      insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, source)
      values ($1, $2, $3, $4, 2, $5, $6::jsonb) returning id
      """,
      deckId, uid, $"Synthetic question for {uid}?", $"Synthetic explanation for {uid}.", order, sourceJson);
    return Convert.ToInt64(id, CultureInfo.InvariantCulture);
  }

  private async Task<string> HashAsync(long cardId)
  {
    var rows = await _db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1", cardId);
    return CardContentHash.Compute(rows[0]);
  }

  /// <summary>One run row plus one item per card at the card's current hash.</summary>
  private async Task<Guid> SeedRunAsync(long deckId, string status, IEnumerable<(long CardId, string Uid, string ItemStatus)> items,
    int ageMinutes = 0, decimal cost = 0, int chunkCount = 1)
  {
    var list = items.ToList();
    var runId = Guid.NewGuid();
    await _db.QueryAsync(
      """
      insert into ai_qa_runs (id, deck_id, scope, status, requested_by_sub, card_count, chunk_count, estimated_cost_usd, created_at, updated_at)
      values ($1, $2, 'changed', $3, 'it-j13-seed', $4, $5, $6, now() - make_interval(mins => $7), now() - make_interval(mins => $7))
      """,
      runId, deckId, status, list.Count, chunkCount, cost, ageMinutes);
    foreach (var (cardId, uid, itemStatus) in list)
    {
      await _db.QueryAsync(
        "insert into ai_qa_items (run_id, card_id, stable_uid, content_sha256, status) values ($1, $2, $3, $4, $5)",
        runId, cardId, uid, await HashAsync(cardId), itemStatus);
    }
    return runId;
  }

  private async Task<long> SeedFindingAsync(Guid runId, long cardId, string severity, string category, string message = "Synthetic finding.")
  {
    var id = await _db.ScalarAsync(
      """
      insert into ai_qa_findings (run_id, card_id, content_sha256, severity, category, message)
      values ($1, $2, $3, $4, $5, $6) returning id
      """,
      runId, cardId, await HashAsync(cardId), severity, category, message);
    return Convert.ToInt64(id, CultureInfo.InvariantCulture);
  }

  private static JsonElement Event(string method, string path, string sub, string[] groups, IDictionary<string, string>? query, string? body)
  {
    return JsonSerializer.SerializeToElement(new
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
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private delegate Task<APIGatewayProxyResponse> Handler(LambdaRequest req, Res res, AuthContext auth);

  private static async Task<APIGatewayProxyResponse> CallAsync(Handler handler, string method, string path, object? body,
    IDictionary<string, string>? query = null, string? sub = null, string[]? groups = null)
  {
    var raw = body switch { null => null, string s => s, _ => JsonSerializer.Serialize(body) };
    var req = new LambdaRequest(Event(method, path, sub ?? SuperSub(), groups ?? ["super_admin"], query, raw));
    var res = new Res(req.TraceId);
    return await handler(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static Task<APIGatewayProxyResponse> StartAsync(object body) => CallAsync(QaRuns.HandleRuns, "POST", RunsPath, body);

  private static Task<APIGatewayProxyResponse> ListAsync(Dictionary<string, string> query) => CallAsync(QaRuns.HandleRuns, "GET", RunsPath, null, query);

  private static Task<APIGatewayProxyResponse> GetRunAsync(string runId) =>
    CallAsync((q, r, a) => QaRuns.HandleRun(q, r, a, runId), "GET", $"{RunsPath}/{runId}", null);

  private static Task<APIGatewayProxyResponse> StatusAsync(long deckId) =>
    CallAsync(QaRuns.HandleStatus, "GET", StatusPath, null, new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) });

  private static Task<APIGatewayProxyResponse> ResolveAsync(string findingId, object body) =>
    CallAsync((q, r, a) => QaRuns.HandleResolveFinding(q, r, a, findingId), "POST", $"/api/v1/authoring/qa/findings/{findingId}/resolve", body);

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static JsonElement AssertError(APIGatewayProxyResponse response, int status, string code)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    var error = doc.RootElement.GetProperty("error").Clone();
    Assert.Equal(code, error.GetProperty("code").GetString());
    return error;
  }

  private async Task<Dictionary<string, object?>> RunRowAsync(Guid runId) =>
    (await _db.QueryAsync("select status, error_code, finished_at from ai_qa_runs where id = $1", runId))[0];

  // ---------------------------------------------------------------- start: checks in contract order

  [Fact]
  public async Task StartRun_Disabled_Returns503AiQaDisabled()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("disabled");
    await NewCardAsync(deck.Id, "disabled-a", 1);

    foreach (var off in new[] { "0", "", "no", null })
    {
      env.Set(QaGate.EnabledEnv, off);
      AssertError(await StartAsync(new { deckId = deck.Id, scope = "all" }), 503, "AI_QA_DISABLED");
    }
    Assert.Empty(env.Sent);
  }

  [Fact]
  public async Task StartRun_MissingQueueUrl_Returns503ConfigError()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("noqueue");
    await NewCardAsync(deck.Id, "noqueue-a", 1);
    env.Set(QaRuns.QueueUrlEnv, "");

    var error = AssertError(await StartAsync(new { deckId = deck.Id, scope = "all" }), 503, "CONFIG_ERROR");
    Assert.Contains("AI_QA_QUEUE_URL", error.GetProperty("message").GetString());
  }

  [Fact]
  public async Task StartRun_UnknownDeck_Returns404DeckNotFound()
  {
    using var env = new QaEnv();
    AssertError(await StartAsync(new { deckId = long.MaxValue - 13, scope = "all" }), 404, "DECK_NOT_FOUND");

    var deleted = await NewDeckAsync("deleted");
    await _db.QueryAsync("update decks set is_deleted = 1 where id = $1", deleted.Id);
    AssertError(await StartAsync(new { deckId = deleted.Id, scope = "all" }), 404, "DECK_NOT_FOUND");

    // Body validation precedes the deck lookup.
    AssertError(await StartAsync("{not json"), 400, "BAD_REQUEST");
    AssertError(await StartAsync(new { deckId = "12", scope = "all" }), 400, "VALIDATION_ERROR");
    AssertError(await StartAsync(new { deckId = deleted.Id, scope = "everything" }), 400, "VALIDATION_ERROR");
    AssertError(await StartAsync(new { deckId = deleted.Id, scope = "cards" }), 400, "VALIDATION_ERROR");
    AssertError(await StartAsync(new { deckId = deleted.Id, scope = "cards", cardIds = new[] { 1, 1 } }), 400, "VALIDATION_ERROR");
    AssertError(await StartAsync(new { deckId = deleted.Id, scope = "all", cardIds = new[] { 1 } }), 400, "VALIDATION_ERROR");
    Assert.Empty(env.Sent);
  }

  [Fact]
  public async Task StartRun_ScopeChanged_EnqueuesChunksOfAtMostFiveCards()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("chunks");
    var ids = new List<long>();
    for (var i = 1; i <= 7; i++)
    {
      var source = i == 3 ? """{"url":"https://docs.aws.amazon.com/synthetic/chunks.html","quote":"Synthetic quote."}""" : null;
      // Inserted out of order so the message order has to come from order_in_deck.
      ids.Add(await NewCardAsync(deck.Id, $"chunks-{i}", (8 - i) * 10, source));
    }
    ids.Reverse(); // deck order: order_in_deck 10, 20, … 70

    var dayBefore = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    var data = Data(await StartAsync(new { deckId = deck.Id, scope = "changed" }));
    var dayAfter = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    var runId = data.GetProperty("runId").GetString()!;
    Assert.Equal("queued", data.GetProperty("status").GetString());
    Assert.Equal(7, data.GetProperty("cardCount").GetInt32());
    Assert.Equal(2, data.GetProperty("chunkCount").GetInt32());

    Assert.Equal(2, env.Sent.Count);
    var rows = await _db.QueryAsync(
      $"select {CardContentHash.CardColumnsSql} from cards c where c.deck_id = $1 order by c.order_in_deck", deck.Id);
    var expectedHash = rows.ToDictionary(r => Convert.ToInt64(r["id"], CultureInfo.InvariantCulture), CardContentHash.Compute);

    var seenCards = new List<long>();
    for (var chunk = 0; chunk < 2; chunk++)
    {
      var request = env.Sent[chunk];
      Assert.Equal(FakeQueueUrl, request.QueueUrl);
      using var doc = JsonDocument.Parse(request.MessageBody);
      var m = doc.RootElement;
      Assert.Equal(1, m.GetProperty("v").GetInt32());
      Assert.Equal(runId, m.GetProperty("runId").GetString());
      Assert.Equal(chunk, m.GetProperty("chunk").GetInt32());
      Assert.Equal(2, m.GetProperty("chunkCount").GetInt32());
      Assert.Equal("qa-v1", m.GetProperty("promptVersion").GetString());
      Assert.Equal(deck.Id, m.GetProperty("deck").GetProperty("id").GetInt64());
      Assert.Equal(deck.Slug, m.GetProperty("deck").GetProperty("slug").GetString());
      Assert.Equal("deck j13 chunks", m.GetProperty("deck").GetProperty("title").GetString());
      Assert.Contains(m.GetProperty("reviewDate").GetString(), new[] { dayBefore, dayAfter });

      var cards = m.GetProperty("cards").EnumerateArray().ToList();
      Assert.Equal(chunk == 0 ? 5 : 2, cards.Count);
      foreach (var card in cards)
      {
        var cardId = card.GetProperty("cardId").GetInt64();
        seenCards.Add(cardId);
        Assert.Equal(expectedHash[cardId], card.GetProperty("contentSha256").GetString());
        Assert.Equal(2, card.GetProperty("difficulty").GetInt32());
        Assert.StartsWith("Synthetic question for chunks-", card.GetProperty("question").GetString());
        Assert.Equal(JsonValueKind.Null, card.GetProperty("mcq").ValueKind);
        Assert.Equal(JsonValueKind.Null, card.GetProperty("codeSnippet").ValueKind);
        foreach (var key in new[] { "stableUid", "topic", "explanation", "codeLanguage", "realWorldUsage", "source" })
        {
          Assert.True(card.TryGetProperty(key, out _), $"card lacks {key}");
        }
        if (card.GetProperty("stableUid").GetString() == "chunks-3")
        {
          Assert.Equal("https://docs.aws.amazon.com/synthetic/chunks.html", card.GetProperty("source").GetProperty("url").GetString());
        }
        else
        {
          Assert.Equal(JsonValueKind.Null, card.GetProperty("source").ValueKind);
        }
      }
    }
    Assert.Equal(ids, seenCards);

    var items = await _db.QueryAsync("select card_id, status, content_sha256 from ai_qa_items where run_id = $1", Guid.Parse(runId));
    Assert.Equal(7, items.Count);
    Assert.All(items, i =>
    {
      Assert.Equal("queued", i["status"]);
      Assert.Equal(expectedHash[Convert.ToInt64(i["card_id"], CultureInfo.InvariantCulture)], i["content_sha256"]);
    });
    var run = await _db.QueryAsync("select status, scope, card_count, chunk_count, prompt_version from ai_qa_runs where id = $1", Guid.Parse(runId));
    Assert.Equal("queued", run[0]["status"]);
    Assert.Equal("changed", run[0]["scope"]);
    Assert.Equal(7, Convert.ToInt32(run[0]["card_count"], CultureInfo.InvariantCulture));
    Assert.Equal(2, Convert.ToInt32(run[0]["chunk_count"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task StartRun_ScopeChanged_SkipsCardsReviewedAtCurrentHash()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("skip");
    var a = await NewCardAsync(deck.Id, "skip-a", 1);
    var b = await NewCardAsync(deck.Id, "skip-b", 2);
    await SeedRunAsync(deck.Id, "done", [(a, "skip-a", "done")], ageMinutes: 5);

    var first = Data(await StartAsync(new { deckId = deck.Id, scope = "changed" }));
    Assert.Equal(1, first.GetProperty("cardCount").GetInt32());
    var firstItems = await _db.QueryAsync("select card_id from ai_qa_items where run_id = $1", Guid.Parse(first.GetProperty("runId").GetString()!));
    Assert.Equal(b, Convert.ToInt64(Assert.Single(firstItems)["card_id"], CultureInfo.InvariantCulture));
    await _db.QueryAsync("update ai_qa_runs set status = 'done' where id = $1", Guid.Parse(first.GetProperty("runId").GetString()!));

    await _db.QueryAsync("update cards set question = 'Synthetic edited question?', updated_at = now() where id = $1", a);
    var second = Data(await StartAsync(new { deckId = deck.Id, scope = "changed" }));
    var secondItems = (await _db.QueryAsync("select card_id from ai_qa_items where run_id = $1", Guid.Parse(second.GetProperty("runId").GetString()!)))
      .Select(r => Convert.ToInt64(r["card_id"], CultureInfo.InvariantCulture)).ToList();
    Assert.Contains(a, secondItems);
  }

  [Fact]
  public async Task StartRun_ScopeCards_RejectsCardsOutsideTheDeck()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("cards");
    var other = await NewDeckAsync("cards-other");
    var mine = await NewCardAsync(deck.Id, "cards-mine", 1);
    var deletedCard = await NewCardAsync(deck.Id, "cards-deleted", 2);
    await _db.QueryAsync("update cards set is_deleted = 1 where id = $1", deletedCard);
    var foreign = await NewCardAsync(other.Id, "cards-foreign", 1);

    var error = AssertError(await StartAsync(new { deckId = deck.Id, scope = "cards", cardIds = new[] { mine, foreign, deletedCard } }), 400, "VALIDATION_ERROR");
    var message = error.GetProperty("message").GetString()!;
    Assert.StartsWith("cardIds not live in this deck:", message);
    Assert.Contains(foreign.ToString(CultureInfo.InvariantCulture), message);
    Assert.Contains(deletedCard.ToString(CultureInfo.InvariantCulture), message);
    Assert.Empty(env.Sent);

    var ok = Data(await StartAsync(new { deckId = deck.Id, scope = "cards", cardIds = new[] { mine } }));
    Assert.Equal(1, ok.GetProperty("cardCount").GetInt32());
  }

  [Fact]
  public async Task StartRun_ActiveRun_Returns409InProgress()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("active");
    var a = await NewCardAsync(deck.Id, "active-a", 1);
    await SeedRunAsync(deck.Id, "running", [(a, "active-a", "queued")], ageMinutes: 30);

    AssertError(await StartAsync(new { deckId = deck.Id, scope = "all" }), 409, "AI_QA_RUN_IN_PROGRESS");
    Assert.Empty(env.Sent);
  }

  [Fact]
  public async Task StartRun_StaleActiveRun_IsReapedAsTimeout()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("stale");
    var a = await NewCardAsync(deck.Id, "stale-a", 1);
    var stale = await SeedRunAsync(deck.Id, "running", [(a, "stale-a", "queued")], ageMinutes: 121);

    var data = Data(await StartAsync(new { deckId = deck.Id, scope = "all" }));
    Assert.Equal(1, data.GetProperty("cardCount").GetInt32());

    var row = await RunRowAsync(stale);
    Assert.Equal("failed", row["status"]);
    Assert.Equal("TIMEOUT", row["error_code"]);
    Assert.NotNull(row["finished_at"]);
  }

  [Fact]
  public async Task StartRun_NothingToReview_Returns400()
  {
    using var env = new QaEnv();
    var empty = await NewDeckAsync("nothing");
    AssertError(await StartAsync(new { deckId = empty.Id, scope = "all" }), 400, "AI_QA_NOTHING_TO_REVIEW");

    var reviewed = await NewDeckAsync("nothing-reviewed");
    var a = await NewCardAsync(reviewed.Id, "nothing-a", 1);
    await SeedRunAsync(reviewed.Id, "done", [(a, "nothing-a", "done")]);
    AssertError(await StartAsync(new { deckId = reviewed.Id, scope = "changed" }), 400, "AI_QA_NOTHING_TO_REVIEW");
    Assert.Empty(env.Sent);
  }

  [Fact]
  public async Task StartRun_TooManyCards_Returns400()
  {
    using var env = new QaEnv();
    env.Set(QaRuns.MaxCardsEnv, "3");
    var deck = await NewDeckAsync("toomany");
    for (var i = 1; i <= 4; i++) await NewCardAsync(deck.Id, $"toomany-{i}", i);

    AssertError(await StartAsync(new { deckId = deck.Id, scope = "all" }), 400, "AI_QA_TOO_MANY_CARDS");
    Assert.Empty(env.Sent);
    Assert.Equal(0L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from ai_qa_runs where deck_id = $1", deck.Id), CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task StartRun_DailyCapReached_Returns429()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("cap");
    var a = await NewCardAsync(deck.Id, "cap-a", 1);
    Guid? spendRun = null;
    try
    {
      var today = Convert.ToDecimal(await _db.ScalarAsync(
        "select coalesce(sum(estimated_cost_usd), 0) from ai_qa_runs where created_at >= date_trunc('day', now(), 'UTC')"),
        CultureInfo.InvariantCulture);
      spendRun = await SeedRunAsync(deck.Id, "done", [(a, "cap-a", "error")], cost: 1.5m);
      env.Set(QaRuns.DailyCapEnv, (today + 1.5m).ToString(CultureInfo.InvariantCulture));

      AssertError(await StartAsync(new { deckId = deck.Id, scope = "all" }), 429, "AI_QA_DAILY_CAP");
      Assert.Empty(env.Sent);

      env.Set(QaRuns.DailyCapEnv, (today + 1.5m + 0.000001m).ToString(CultureInfo.InvariantCulture));
      Data(await StartAsync(new { deckId = deck.Id, scope = "all" }));
    }
    finally
    {
      if (spendRun is not null) await _db.QueryAsync("delete from ai_qa_runs where id = $1", spendRun.Value);
    }
  }

  [Fact]
  public async Task StartRun_SendFailure_MarksRunFailed()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("sendfail");
    for (var i = 1; i <= 6; i++) await NewCardAsync(deck.Id, $"sendfail-{i}", i);

    var calls = 0;
    QaRuns.TestSendSeam = _ => ++calls == 2 ? throw new InvalidOperationException("sqs down") : Task.CompletedTask;
    var response = await StartAsync(new { deckId = deck.Id, scope = "all" });
    Assert.Equal(500, response.StatusCode);

    var runs = await _db.QueryAsync("select id, status, error_code, finished_at from ai_qa_runs where deck_id = $1", deck.Id);
    var run = Assert.Single(runs);
    Assert.Equal("failed", run["status"]);
    Assert.Equal("ENQUEUE_FAILED", run["error_code"]);
    Assert.NotNull(run["finished_at"]);
    Assert.Equal(6L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from ai_qa_items where run_id = $1 and status = 'queued'", run["id"]), CultureInfo.InvariantCulture));

    QaRuns.TestSendSeam = r => { lock (env.Sent) env.Sent.Add(r); return Task.CompletedTask; };
    Data(await StartAsync(new { deckId = deck.Id, scope = "all" }));
    Assert.Equal(2, env.Sent.Count);
  }

  // ---------------------------------------------------------------- read

  [Fact]
  public async Task GetRun_ReportsEffectiveStatusItemsAndFindings()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("detail");
    var second = await NewCardAsync(deck.Id, "detail-second", 20);
    var first = await NewCardAsync(deck.Id, "detail-first", 10);
    var runId = await SeedRunAsync(deck.Id, "running", [(second, "detail-second", "done"), (first, "detail-first", "done")], ageMinutes: 150);
    var minor = await SeedFindingAsync(runId, first, "minor", "weak_distractor");
    var major = await SeedFindingAsync(runId, second, "major", "ambiguous_stem");
    var blocker = await SeedFindingAsync(runId, second, "blocker", "incorrect_answer");
    var firstMajor = await SeedFindingAsync(runId, first, "major", "answer_leak");

    var data = Data(await GetRunAsync(runId.ToString()));
    var run = data.GetProperty("run");
    Assert.Equal(runId.ToString(), run.GetProperty("runId").GetString());
    Assert.Equal(deck.Id, run.GetProperty("deckId").GetInt64());
    Assert.Equal("running", run.GetProperty("status").GetString());
    Assert.Equal("failed", run.GetProperty("effectiveStatus").GetString());
    foreach (var key in new[] { "scope", "provider", "model", "promptVersion", "requestedBySub", "cardCount", "chunkCount", "cardsDone", "errorCount",
                                "blockerCount", "majorCount", "minorCount", "inputTokens", "outputTokens", "cacheReadTokens", "estimatedCostUsd",
                                "errorCode", "createdAt", "updatedAt", "finishedAt" })
    {
      Assert.True(run.TryGetProperty(key, out _), $"run lacks {key}");
    }
    // Computed, never written.
    Assert.Equal("running", (await RunRowAsync(runId))["status"]);

    var items = data.GetProperty("items").EnumerateArray().ToList();
    Assert.Equal(new[] { first, second }, items.Select(i => i.GetProperty("cardId").GetInt64()));
    Assert.Equal("detail-first", items[0].GetProperty("stableUid").GetString());
    Assert.Equal(await HashAsync(first), items[0].GetProperty("contentSha256").GetString());
    foreach (var key in new[] { "status", "errorCode", "latencyMs", "inputTokens", "outputTokens", "cacheReadTokens", "estimatedCostUsd", "requestId", "updatedAt" })
    {
      Assert.True(items[0].TryGetProperty(key, out _), $"item lacks {key}");
    }

    var findings = data.GetProperty("findings").EnumerateArray().ToList();
    Assert.Equal(new[] { firstMajor, minor, blocker, major }, findings.Select(f => f.GetProperty("findingId").GetInt64()));
    Assert.Equal("detail-second", findings[2].GetProperty("stableUid").GetString());
    Assert.Equal("open", findings[2].GetProperty("resolution").GetString());
    foreach (var key in new[] { "runId", "cardId", "contentSha256", "severity", "category", "message", "suggestedFix", "resolvedBySub", "resolvedAt", "resolutionNote", "createdAt" })
    {
      Assert.True(findings[0].TryGetProperty(key, out _), $"finding lacks {key}");
    }

    AssertError(await GetRunAsync("not-a-uuid"), 404, "RUN_NOT_FOUND");
    AssertError(await GetRunAsync(Guid.NewGuid().ToString()), 404, "RUN_NOT_FOUND");
    Assert.Equal(405, (await CallAsync((q, r, a) => QaRuns.HandleRun(q, r, a, runId.ToString()), "POST", $"{RunsPath}/{runId}", new { })).StatusCode);
  }

  [Fact]
  public async Task ListRuns_PaginatesWithCursor()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("list");
    var a = await NewCardAsync(deck.Id, "list-a", 1);
    var oldest = await SeedRunAsync(deck.Id, "done", [(a, "list-a", "done")], ageMinutes: 30);
    var middle = await SeedRunAsync(deck.Id, "done", [(a, "list-a", "done")], ageMinutes: 20);
    var newest = await SeedRunAsync(deck.Id, "failed", [(a, "list-a", "queued")], ageMinutes: 10);
    var deckQuery = deck.Id.ToString(CultureInfo.InvariantCulture);

    var page1 = Data(await ListAsync(new() { ["deckId"] = deckQuery, ["limit"] = "2" }));
    Assert.Equal(new[] { newest.ToString(), middle.ToString() },
      page1.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("runId").GetString()));
    var cursor = page1.GetProperty("nextCursor").GetString();
    Assert.False(string.IsNullOrEmpty(cursor));

    var page2 = Data(await ListAsync(new() { ["deckId"] = deckQuery, ["limit"] = "2", ["cursor"] = cursor! }));
    Assert.Equal(new[] { oldest.ToString() }, page2.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("runId").GetString()));
    Assert.Equal(JsonValueKind.Null, page2.GetProperty("nextCursor").ValueKind);

    var all = Data(await ListAsync(new() { ["deckId"] = deckQuery }));
    Assert.Equal(3, all.GetProperty("items").GetArrayLength());

    AssertError(await ListAsync(new() { ["deckId"] = deckQuery, ["cursor"] = "%%%" }), 400, "VALIDATION_ERROR");
    AssertError(await ListAsync(new() { ["deckId"] = deckQuery, ["cursor"] = "eyJ2IjoyfQ" }), 400, "VALIDATION_ERROR");
    AssertError(await ListAsync(new() { ["deckId"] = deckQuery, ["limit"] = "0" }), 400, "VALIDATION_ERROR");
    AssertError(await ListAsync(new()), 400, "VALIDATION_ERROR");
    AssertError(await ListAsync(new() { ["deckId"] = (long.MaxValue - 13).ToString(CultureInfo.InvariantCulture) }), 404, "DECK_NOT_FOUND");
  }

  [Fact]
  public async Task Status_ReportsChangedMissingAndOpenBlockers()
  {
    using var env = new QaEnv();
    env.Set(QaGate.RequiredEnv, "1");
    var deck = await NewDeckAsync("status");
    var clean = await NewCardAsync(deck.Id, "status-clean", 1);
    var blocked = await NewCardAsync(deck.Id, "status-blocked", 2);
    var unreviewed = await NewCardAsync(deck.Id, "status-unreviewed", 3);
    var runId = await SeedRunAsync(deck.Id, "done", [(clean, "status-clean", "done"), (blocked, "status-blocked", "done")]);
    var blockerId = await SeedFindingAsync(runId, blocked, "blocker", "multiple_correct", "Two options are correct.");
    await SeedFindingAsync(runId, clean, "major", "ambiguous_stem");

    var data = Data(await StatusAsync(deck.Id));
    Assert.True(data.GetProperty("enabled").GetBoolean());
    Assert.True(data.GetProperty("required").GetBoolean());
    Assert.Equal(3, data.GetProperty("changedCards").GetInt32());
    Assert.Equal(2, data.GetProperty("reviewedCurrent").GetInt32());
    var missing = Assert.Single(data.GetProperty("missing").EnumerateArray().ToList());
    Assert.Equal(unreviewed, missing.GetProperty("cardId").GetInt64());
    Assert.Equal("status-unreviewed", missing.GetProperty("stableUid").GetString());
    var open = Assert.Single(data.GetProperty("openBlockers").EnumerateArray().ToList());
    Assert.Equal(blockerId, open.GetProperty("findingId").GetInt64());
    Assert.Equal(blocked, open.GetProperty("cardId").GetInt64());
    Assert.Equal("status-blocked", open.GetProperty("stableUid").GetString());
    Assert.Equal("multiple_correct", open.GetProperty("category").GetString());
    Assert.Equal("Two options are correct.", open.GetProperty("message").GetString());
    Assert.True(data.GetProperty("wouldBlock").GetBoolean());

    env.Set(QaGate.RequiredEnv, "0");
    var relaxed = Data(await StatusAsync(deck.Id));
    Assert.False(relaxed.GetProperty("required").GetBoolean());
    Assert.False(relaxed.GetProperty("wouldBlock").GetBoolean());
    Assert.Equal(3, relaxed.GetProperty("changedCards").GetInt32());

    env.Set(QaGate.EnabledEnv, "0");
    env.Set(QaGate.RequiredEnv, "1");
    var disabled = Data(await StatusAsync(deck.Id));
    Assert.False(disabled.GetProperty("enabled").GetBoolean());
    Assert.False(disabled.GetProperty("wouldBlock").GetBoolean());
  }

  // ---------------------------------------------------------------- resolve

  [Fact]
  public async Task ResolveFinding_FixedBlocker_RecordsLedgerDefect()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("resolve");
    var a = await NewCardAsync(deck.Id, "resolve-a", 1);
    var runId = await SeedRunAsync(deck.Id, "done", [(a, "resolve-a", "done")]);
    var blocker = await SeedFindingAsync(runId, a, "blocker", "incorrect_answer");
    var minor = await SeedFindingAsync(runId, a, "minor", "weak_distractor");
    var sub = SuperSub();

    var resolved = Data(await CallAsync((q, r, au) => QaRuns.HandleResolveFinding(q, r, au, blocker.ToString(CultureInfo.InvariantCulture)),
      "POST", "/api/v1/authoring/qa/findings/x/resolve", new { resolution = "fixed", note = "  Corrected the answer.  " }, sub: sub));
    Assert.Equal(blocker, resolved.GetProperty("findingId").GetInt64());
    Assert.Equal("fixed", resolved.GetProperty("resolution").GetString());
    Assert.Equal(sub, resolved.GetProperty("resolvedBySub").GetString());
    Assert.Equal("Corrected the answer.", resolved.GetProperty("resolutionNote").GetString());
    Assert.Equal("resolve-a", resolved.GetProperty("stableUid").GetString());
    Assert.NotEqual(JsonValueKind.Null, resolved.GetProperty("resolvedAt").ValueKind);

    var ledger = await _db.QueryAsync(
      "select automation, units, outcome, defects_caught, deck_id, ref from automation_events where dedupe_key = $1", $"qa-fix:{blocker}");
    var row = Assert.Single(ledger);
    Assert.Equal("ai_qa_review", row["automation"]);
    Assert.Equal(0, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture));
    Assert.Equal("success", row["outcome"]);
    Assert.Equal(1, Convert.ToInt32(row["defects_caught"], CultureInfo.InvariantCulture));
    Assert.Equal(deck.Id, Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(blocker.ToString(CultureInfo.InvariantCulture), row["ref"]);

    Data(await ResolveAsync(minor.ToString(CultureInfo.InvariantCulture), new { resolution = "fixed" }));
    Assert.Equal(0L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from automation_events where dedupe_key = $1", $"qa-fix:{minor}"), CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task ResolveFinding_Twice_Returns409AlreadyResolved()
  {
    using var env = new QaEnv();
    var deck = await NewDeckAsync("twice");
    var a = await NewCardAsync(deck.Id, "twice-a", 1);
    var runId = await SeedRunAsync(deck.Id, "done", [(a, "twice-a", "done")]);
    var major = await SeedFindingAsync(runId, a, "major", "outdated_fact");
    var id = major.ToString(CultureInfo.InvariantCulture);

    AssertError(await ResolveAsync(id, new { resolution = "ignored" }), 400, "VALIDATION_ERROR");
    AssertError(await ResolveAsync(id, new { resolution = "dismissed", note = new string('n', 501) }), 400, "VALIDATION_ERROR");

    Assert.Equal("dismissed", Data(await ResolveAsync(id, new { resolution = "dismissed" })).GetProperty("resolution").GetString());
    AssertError(await ResolveAsync(id, new { resolution = "fixed" }), 409, "FINDING_ALREADY_RESOLVED");
    Assert.Equal("dismissed", await _db.ScalarAsync("select resolution from ai_qa_findings where id = $1", major));
    Assert.Equal(0L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from automation_events where dedupe_key = $1", $"qa-fix:{major}"), CultureInfo.InvariantCulture));

    AssertError(await ResolveAsync("abc", new { resolution = "fixed" }), 404, "FINDING_NOT_FOUND");
    AssertError(await ResolveAsync((long.MaxValue - 13).ToString(CultureInfo.InvariantCulture), new { resolution = "fixed" }), 404, "FINDING_NOT_FOUND");
  }

  // ---------------------------------------------------------------- schema not ready

  [Fact]
  public async Task Routes_MissingTables_Return503ServerNotReadyAiQa()
  {
    using var env = new QaEnv();
    var scratch = await _db.CreateScratchDatabaseAsync("it_j13_notready");
    long deckId;
    await using (var conn = new NpgsqlConnection(scratch))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 30);
      deckId = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null,
        "insert into decks (slug, title, author) values ($1, $2, $3) returning id", [$"it-j13-notready-{Guid.NewGuid():N}", "deck j13", "tests"]),
        CultureInfo.InvariantCulture);
      await DbUtil.ExecuteAsync(conn, null,
        "insert into cards (deck_id, stable_uid, question, explanation, order_in_deck) values ($1, $2, $3, $4, 1)",
        [deckId, "notready-a", "Synthetic question?", "Synthetic explanation."]);
    }

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", "it_j13_notready");
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();

      AssertError(await StartAsync(new { deckId, scope = "all" }), 503, "SERVER_NOT_READY_AI_QA");
      AssertError(await StatusAsync(deckId), 503, "SERVER_NOT_READY_AI_QA");

      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", "test-secret");
      var body = JsonSerializer.Serialize(new { v = 1, runId = Guid.NewGuid(), chunk = 0, items = Array.Empty<object>() });
      var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      using var mac = new HMACSHA256(Encoding.UTF8.GetBytes("test-secret"));
      var signature = "v1=" + Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes($"{ts.ToString(CultureInfo.InvariantCulture)}.{body}"))).ToLowerInvariant();
      var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
      {
        rawPath = "/api/internal/ai-qa/results",
        requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
        headers = new Dictionary<string, string>
        {
          ["content-type"] = "application/json",
          ["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture),
          ["x-internal-signature"] = signature,
        },
        queryStringParameters = new Dictionary<string, string>(),
        body,
        isBase64Encoded = false,
      }));
      AssertError(await AiQaResults.HandleAiQaResults(req, new Res(req.TraceId)), 503, "SERVER_NOT_READY_AI_QA");
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }
}
