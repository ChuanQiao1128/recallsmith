using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Internal;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// POST /api/internal/ai-qa/results (R18 J13, contract §7.7) against a real Postgres: the §4.3 HMAC preamble,
/// body validation, the item transition rules under redelivery (a done item is never downgraded, resolved findings
/// are never erased), the recomputed run counters, the card.flagged webhook (through the J03 send seam only) and the
/// once-per-chunk ledger row. Runs and items are seeded directly, with hashes from <see cref="CardContentHash"/> over
/// rows read with <see cref="CardContentHash.CardColumnsSql"/>. The shared secret is the fake <c>test-secret</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AiQaResultsTests
{
  private readonly PostgresFixture _db;
  public AiQaResultsTests(PostgresFixture db) => _db = db;

  private const string ResultsPath = "/api/internal/ai-qa/results";
  private const string FakeSecret = "test-secret";
  private const string FakeWebhookQueueUrl = "https://sqs.test/000000000000/developercards-webhook-events-test";

  // ---------------------------------------------------------------- helpers

  private static string Sign(string secret, long timestampMs, string body)
  {
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var hash = mac.ComputeHash(Encoding.UTF8.GetBytes($"{timestampMs.ToString(CultureInfo.InvariantCulture)}.{body}"));
    return "v1=" + Convert.ToHexString(hash).ToLowerInvariant();
  }

  private static async Task<APIGatewayProxyResponse> ReportAsync(object body, string? signature = null, string method = "POST")
  {
    var raw = body as string ?? JsonSerializer.Serialize(body);
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var saved = Environment.GetEnvironmentVariable("INTERNAL_SHARED_SECRET");
    try
    {
      Environment.SetEnvironmentVariable("INTERNAL_SHARED_SECRET", "test-secret");
      var req = new LambdaRequest(JsonSerializer.SerializeToElement(new
      {
        rawPath = ResultsPath,
        requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
        headers = new Dictionary<string, string>
        {
          ["content-type"] = "application/json",
          ["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture),
          ["x-internal-signature"] = signature ?? Sign(FakeSecret, ts, raw),
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

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static void AssertError(APIGatewayProxyResponse response, int status, string code)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    Assert.Equal(code, doc.RootElement.GetProperty("error").GetProperty("code").GetString());
  }

  private sealed record Seeded(Guid RunId, long DeckId, string DeckSlug, List<(long CardId, string Uid, string Hash)> Cards);

  /// <summary>A deck with <paramref name="cardCount"/> live cards and one run whose items are all <c>queued</c>.</summary>
  private async Task<Seeded> SeedAsync(string tag, int cardCount, string runStatus = "queued", string? errorCode = null, int chunkCount = 1)
  {
    var slug = $"it-j13-{tag}-{Guid.NewGuid():N}";
    var deckId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id", slug, $"deck j13 {tag}", "tests"), CultureInfo.InvariantCulture);

    var cards = new List<(long, string, string)>();
    for (var i = 1; i <= cardCount; i++)
    {
      var uid = $"{tag}-{i}";
      var cardId = Convert.ToInt64(await _db.ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, $3, $4, 2, $5) returning id",
        deckId, uid, $"Synthetic question for {uid}?", $"Synthetic explanation for {uid}.", i), CultureInfo.InvariantCulture);
      var row = (await _db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1", cardId))[0];
      cards.Add((cardId, uid, CardContentHash.Compute(row)));
    }

    var runId = Guid.NewGuid();
    await _db.QueryAsync(
      """
      insert into ai_qa_runs (id, deck_id, scope, status, error_code, finished_at, requested_by_sub, card_count, chunk_count)
      values ($1, $2, 'all', $3, $4::text, case when $3 = 'failed' then now() else null end, 'it-j13-seed', $5, $6)
      """,
      runId, deckId, runStatus, errorCode, cardCount, chunkCount);
    foreach (var (cardId, uid, hash) in cards)
    {
      await _db.QueryAsync(
        "insert into ai_qa_items (run_id, card_id, stable_uid, content_sha256, status) values ($1, $2, $3, $4, 'queued')",
        runId, cardId, uid, hash);
    }
    return new Seeded(runId, deckId, slug, cards);
  }

  private static object Finding(string severity, string category, string message, string? suggestedFix = null) =>
    new { severity, category, message, suggestedFix };

  private static object Item((long CardId, string Uid, string Hash) card, string status, string? errorCode = null, object[]? findings = null,
    int inputTokens = 0, int outputTokens = 0, int cacheRead = 0, decimal cost = 0m) =>
    new
    {
      cardId = card.CardId,
      contentSha256 = card.Hash,
      status,
      errorCode,
      findings = findings ?? [],
      usage = new { inputTokens, outputTokens, cacheReadInputTokens = cacheRead },
      latencyMs = 1234,
      requestId = $"req_{Guid.NewGuid():N}",
      estimatedCostUsd = cost,
    };

  private static object Body(Guid runId, int chunk, params object[] items) =>
    new { v = 1, runId, chunk, provider = "bedrock", model = "anthropic.claude-opus-5", promptVersion = "qa-v1", items };

  private async Task<Dictionary<string, object?>> RunAsync(Guid runId) =>
    (await _db.QueryAsync(
      """
      select status, error_code, finished_at, cards_done, error_count, blocker_count, major_count, minor_count, input_tokens, output_tokens,
        cache_read_tokens, estimated_cost_usd, provider, model, prompt_version
      from ai_qa_runs where id = $1
      """, runId))[0];

  private async Task<Dictionary<string, object?>> ItemAsync(Guid runId, long cardId) =>
    (await _db.QueryAsync("select status, error_code, latency_ms, request_id from ai_qa_items where run_id = $1 and card_id = $2", runId, cardId))[0];

  private async Task<List<Dictionary<string, object?>>> FindingsAsync(Guid runId, long cardId) =>
    await _db.QueryAsync(
      "select id, severity, category, message, suggested_fix, resolution, content_sha256 from ai_qa_findings where run_id = $1 and card_id = $2 order by id",
      runId, cardId);

  private static int Int(object? v) => Convert.ToInt32(v, CultureInfo.InvariantCulture);

  // ---------------------------------------------------------------- preamble

  [Fact]
  public async Task Results_BadSignature_Returns403()
  {
    var seeded = await SeedAsync("badsig", 1);
    var body = JsonSerializer.Serialize(Body(seeded.RunId, 0, Item(seeded.Cards[0], "done")));
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    foreach (var signature in new[] { Sign("wrong-secret", ts, body), Sign(FakeSecret, ts, body + " "), "v1=00" })
    {
      Assert.Equal(403, (await ReportAsync(body, signature)).StatusCode);
    }
    Assert.Equal("queued", (await ItemAsync(seeded.RunId, seeded.Cards[0].CardId))["status"]);
  }

  [Fact]
  public async Task Results_NonPost_Returns405()
  {
    Assert.Equal(405, (await ReportAsync("{}", method: "GET")).StatusCode);
    Assert.Equal(405, (await ReportAsync("{}", method: "PUT")).StatusCode);
  }

  [Fact]
  public async Task Results_UnknownRun_Returns404RunNotFound()
  {
    AssertError(await ReportAsync(new { v = 1, runId = Guid.NewGuid(), chunk = 0, items = Array.Empty<object>() }), 404, "RUN_NOT_FOUND");
  }

  [Theory]
  [InlineData("v2")]
  [InlineData("runIdNotUuid")]
  [InlineData("itemsNotArray")]
  [InlineData("statusQueued")]
  [InlineData("errorCodeUnknown")]
  [InlineData("severityCritical")]
  [InlineData("categoryTypo")]
  [InlineData("findingCardIdMismatch")]
  [InlineData("chunkOutOfRange")]
  [InlineData("notJson")]
  public async Task Results_InvalidBody_Returns400ValidationError(string invalid)
  {
    var seeded = await SeedAsync("invalid", 1);
    var card = seeded.Cards[0];
    var finding = new { cardId = card.CardId, severity = "major", category = "ambiguous_stem", message = "Synthetic finding." };
    object ItemWith(string status = "done", string? errorCode = null, object? f = null) =>
      new { cardId = card.CardId, contentSha256 = card.Hash, status, errorCode, findings = new[] { f ?? finding } };

    object body = invalid switch
    {
      "v2" => new { v = 2, runId = seeded.RunId, chunk = 0, items = new[] { ItemWith() } },
      "runIdNotUuid" => new { v = 1, runId = "x", chunk = 0, items = new[] { ItemWith() } },
      "itemsNotArray" => new { v = 1, runId = seeded.RunId, chunk = 0, items = new { cardId = card.CardId } },
      "statusQueued" => new { v = 1, runId = seeded.RunId, chunk = 0, items = new[] { ItemWith(status: "queued") } },
      "errorCodeUnknown" => new { v = 1, runId = seeded.RunId, chunk = 0, items = new[] { ItemWith(status: "error", errorCode: "NOPE") } },
      "severityCritical" => new { v = 1, runId = seeded.RunId, chunk = 0,
        items = new[] { ItemWith(f: new { cardId = card.CardId, severity = "critical", category = "ambiguous_stem", message = "m" }) } },
      "categoryTypo" => new { v = 1, runId = seeded.RunId, chunk = 0,
        items = new[] { ItemWith(f: new { cardId = card.CardId, severity = "major", category = "typo", message = "m" }) } },
      "findingCardIdMismatch" => new { v = 1, runId = seeded.RunId, chunk = 0,
        items = new[] { ItemWith(f: new { cardId = card.CardId + 1, severity = "major", category = "ambiguous_stem", message = "m" }) } },
      "chunkOutOfRange" => new { v = 1, runId = seeded.RunId, chunk = 1, items = new[] { ItemWith() } },
      "notJson" => "{not json",
      _ => throw new ArgumentOutOfRangeException(nameof(invalid)),
    };

    AssertError(await ReportAsync(body), 400, "VALIDATION_ERROR");
    Assert.Equal("queued", (await ItemAsync(seeded.RunId, card.CardId))["status"]);
    Assert.Empty(await FindingsAsync(seeded.RunId, card.CardId));
  }

  // ---------------------------------------------------------------- transitions and counters

  [Fact]
  public async Task Results_AllItemsTerminal_MarksRunDone_AndRecomputesCounters()
  {
    var seeded = await SeedAsync("terminal", 3);
    var (a, b, c) = (seeded.Cards[0], seeded.Cards[1], seeded.Cards[2]);

    var data = Data(await ReportAsync(Body(seeded.RunId, 0,
      Item(a, "done", findings: [Finding("major", "ambiguous_stem", "  The stem allows two readings.  ", "Name the region."), Finding("minor", "weak_distractor", "Option c is implausible.", "   ")],
        inputTokens: 1000, outputTokens: 200, cacheRead: 800, cost: 0.012m),
      Item(b, "done", inputTokens: 900, outputTokens: 100, cacheRead: 800, cost: 0.008m),
      Item(c, "refused", errorCode: "REFUSAL", inputTokens: 50, outputTokens: 5, cost: 0.0005m))));

    Assert.Equal(seeded.RunId.ToString(), data.GetProperty("runId").GetString());
    Assert.Equal("done", data.GetProperty("runStatus").GetString());
    Assert.Equal(3, data.GetProperty("cardsDone").GetInt32());
    Assert.Equal(3, data.GetProperty("cardCount").GetInt32());

    var run = await RunAsync(seeded.RunId);
    Assert.Equal("done", run["status"]);
    Assert.Null(run["error_code"]);
    Assert.NotNull(run["finished_at"]);
    Assert.Equal(3, Int(run["cards_done"]));
    Assert.Equal(1, Int(run["error_count"]));
    Assert.Equal(0, Int(run["blocker_count"]));
    Assert.Equal(1, Int(run["major_count"]));
    Assert.Equal(1, Int(run["minor_count"]));
    Assert.Equal(1950L, Convert.ToInt64(run["input_tokens"], CultureInfo.InvariantCulture));
    Assert.Equal(305L, Convert.ToInt64(run["output_tokens"], CultureInfo.InvariantCulture));
    Assert.Equal(1600L, Convert.ToInt64(run["cache_read_tokens"], CultureInfo.InvariantCulture));
    Assert.Equal(0.0205m, Convert.ToDecimal(run["estimated_cost_usd"], CultureInfo.InvariantCulture));
    Assert.Equal("bedrock", run["provider"]);
    Assert.Equal("anthropic.claude-opus-5", run["model"]);
    Assert.Equal("qa-v1", run["prompt_version"]);

    var refused = await ItemAsync(seeded.RunId, c.CardId);
    Assert.Equal("refused", refused["status"]);
    Assert.Equal("REFUSAL", refused["error_code"]);
    Assert.Equal(1234, Int(refused["latency_ms"]));

    var findings = await FindingsAsync(seeded.RunId, a.CardId);
    Assert.Equal(2, findings.Count);
    Assert.Equal("The stem allows two readings.", findings[0]["message"]);
    Assert.Equal("Name the region.", findings[0]["suggested_fix"]);
    Assert.Null(findings[1]["suggested_fix"]);
    Assert.All(findings, f => Assert.Equal(a.Hash, f["content_sha256"]));
    Assert.Empty(await FindingsAsync(seeded.RunId, c.CardId));
  }

  [Fact]
  public async Task Results_PartialReport_KeepsRunRunning()
  {
    var seeded = await SeedAsync("partial", 3, chunkCount: 2);

    var data = Data(await ReportAsync(Body(seeded.RunId, 1, Item(seeded.Cards[2], "done"))));
    Assert.Equal("running", data.GetProperty("runStatus").GetString());
    Assert.Equal(1, data.GetProperty("cardsDone").GetInt32());

    var run = await RunAsync(seeded.RunId);
    Assert.Equal("running", run["status"]);
    Assert.Null(run["finished_at"]);
    Assert.Equal(1, Int(run["cards_done"]));
    Assert.Equal("queued", (await ItemAsync(seeded.RunId, seeded.Cards[0].CardId))["status"]);

    var done = Data(await ReportAsync(Body(seeded.RunId, 0, Item(seeded.Cards[0], "error", errorCode: "PROVIDER_ERROR"), Item(seeded.Cards[1], "skipped", errorCode: "DISABLED"))));
    Assert.Equal("done", done.GetProperty("runStatus").GetString());
    Assert.Equal(1, Int((await RunAsync(seeded.RunId))["error_count"]));
  }

  [Fact]
  public async Task Results_ReReport_ReplacesFindings()
  {
    var seeded = await SeedAsync("replace", 1);
    var card = seeded.Cards[0];

    Data(await ReportAsync(Body(seeded.RunId, 0,
      Item(card, "done", findings: [Finding("major", "outdated_fact", "First finding."), Finding("minor", "other", "Second finding.")]))));
    Assert.Equal(2, (await FindingsAsync(seeded.RunId, card.CardId)).Count);

    Data(await ReportAsync(Body(seeded.RunId, 0, Item(card, "done", findings: [Finding("blocker", "incorrect_answer", "Replacement finding.")]))));
    var findings = await FindingsAsync(seeded.RunId, card.CardId);
    var only = Assert.Single(findings);
    Assert.Equal("Replacement finding.", only["message"]);
    Assert.Equal("blocker", only["severity"]);

    var run = await RunAsync(seeded.RunId);
    Assert.Equal(1, Int(run["blocker_count"]));
    Assert.Equal(0, Int(run["major_count"]));
    Assert.Equal(0, Int(run["minor_count"]));
  }

  [Fact]
  public async Task Results_DoneItem_IsNeverDowngraded()
  {
    var seeded = await SeedAsync("downgrade", 1);
    var card = seeded.Cards[0];

    Data(await ReportAsync(Body(seeded.RunId, 0, Item(card, "done", findings: [Finding("major", "answer_leak", "The stem names the answer.")], cost: 0.01m))));
    var before = await RunAsync(seeded.RunId);

    var data = Data(await ReportAsync(Body(seeded.RunId, 0, Item(card, "error", errorCode: "PROVIDER_TIMEOUT", cost: 0.5m))));
    Assert.Equal("done", data.GetProperty("runStatus").GetString());

    var item = await ItemAsync(seeded.RunId, card.CardId);
    Assert.Equal("done", item["status"]);
    Assert.Null(item["error_code"]);
    var finding = Assert.Single(await FindingsAsync(seeded.RunId, card.CardId));
    Assert.Equal("The stem names the answer.", finding["message"]);

    var after = await RunAsync(seeded.RunId);
    foreach (var key in new[] { "status", "cards_done", "error_count", "blocker_count", "major_count", "minor_count", "estimated_cost_usd" })
    {
      Assert.Equal(before[key], after[key]);
    }
  }

  [Fact]
  public async Task Results_ReReport_KeepsResolvedFindings()
  {
    var seeded = await SeedAsync("resolved", 1);
    var card = seeded.Cards[0];

    Data(await ReportAsync(Body(seeded.RunId, 0,
      Item(card, "done", findings: [Finding("major", "qualifier_mismatch", "Kept finding one."), Finding("minor", "weak_distractor", "Kept finding two.")]))));
    var stored = await FindingsAsync(seeded.RunId, card.CardId);
    await _db.QueryAsync(
      "update ai_qa_findings set resolution = 'dismissed', resolved_by_sub = 'it-j13-editor', resolved_at = now() where id = $1", stored[0]["id"]);
    var before = await FindingsAsync(seeded.RunId, card.CardId);

    Data(await ReportAsync(Body(seeded.RunId, 0, Item(card, "done", findings: [Finding("blocker", "incorrect_answer", "A different finding.")]))));

    var after = await FindingsAsync(seeded.RunId, card.CardId);
    Assert.Equal(before.Count, after.Count);
    for (var i = 0; i < before.Count; i++)
    {
      foreach (var key in before[i].Keys) Assert.Equal(before[i][key], after[i][key]);
    }
    Assert.Equal("dismissed", after[0]["resolution"]);
    Assert.Equal(0, Int((await RunAsync(seeded.RunId))["blocker_count"]));
  }

  [Fact]
  public async Task Results_UnknownCardId_IsIgnored()
  {
    var seeded = await SeedAsync("unknown", 2);
    var stranger = (CardId: long.MaxValue - 13, Uid: "stranger", Hash: new string('0', 64));

    var data = Data(await ReportAsync(Body(seeded.RunId, 0, Item(stranger, "done", findings: [Finding("blocker", "other", "Not this run.")]), Item(seeded.Cards[0], "done"))));
    Assert.Equal("running", data.GetProperty("runStatus").GetString());
    Assert.Equal(1, data.GetProperty("cardsDone").GetInt32());
    Assert.Equal(0L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from ai_qa_findings where run_id = $1", seeded.RunId), CultureInfo.InvariantCulture));
    Assert.Equal(2L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from ai_qa_items where run_id = $1", seeded.RunId), CultureInfo.InvariantCulture));

    var ledger = await _db.QueryAsync("select details from automation_events where dedupe_key = $1", $"qa:{seeded.RunId}:0");
    using var details = JsonDocument.Parse((string)Assert.Single(ledger)["details"]!);
    Assert.Equal(1, details.RootElement.GetProperty("ignored").GetInt32());
    Assert.Equal(1, details.RootElement.GetProperty("becameDone").GetInt32());
  }

  // ---------------------------------------------------------------- side effects

  [Fact]
  public async Task Results_BlockerFinding_EnqueuesCardFlaggedOnce()
  {
    var seeded = await SeedAsync("flagged", 2);
    var (flaggedCard, cleanCard) = (seeded.Cards[0], seeded.Cards[1]);
    var subscriptionId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, true) returning id",
      $"it-j13-{Guid.NewGuid():N}"[..20], $"https://hooks.example.com/it-j13/{Guid.NewGuid():N}", new[] { "card.flagged" }), CultureInfo.InvariantCulture);

    var sent = new List<SendMessageRequest>();
    var savedSeam = WebhookEvents.TestSendSeam;
    var savedUrl = Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv);
    try
    {
      WebhookEvents.TestSendSeam = r => { lock (sent) sent.Add(r); return Task.CompletedTask; };
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, FakeWebhookQueueUrl);

      var body = Body(seeded.RunId, 0,
        Item(flaggedCard, "done", findings:
        [
          Finding("minor", "weak_distractor", "Minor first in the report."),
          Finding("major", "source_unsupported", "The quote does not support the answer."),
          Finding("blocker", "multiple_correct", "Options a and c are both correct."),
        ]),
        Item(cleanCard, "done", findings: [Finding("minor", "other", "Only a minor note.")]));
      Data(await ReportAsync(body));

      var deliveries = await _db.QueryAsync(
        "select body from webhook_deliveries where subscription_id = $1 and event = 'card.flagged'", subscriptionId);
      var delivery = Assert.Single(deliveries);
      using (var doc = JsonDocument.Parse((string)delivery["body"]!))
      {
        var hook = doc.RootElement.GetProperty("data");
        Assert.Equal(seeded.DeckId, hook.GetProperty("deckId").GetInt64());
        Assert.Equal(seeded.DeckSlug, hook.GetProperty("deckSlug").GetString());
        Assert.Equal(flaggedCard.CardId, hook.GetProperty("cardId").GetInt64());
        Assert.Equal(flaggedCard.Uid, hook.GetProperty("stableUid").GetString());
        Assert.Equal(seeded.RunId.ToString(), hook.GetProperty("runId").GetString());
        Assert.Equal(1, hook.GetProperty("counts").GetProperty("blocker").GetInt32());
        Assert.Equal(1, hook.GetProperty("counts").GetProperty("major").GetInt32());
        Assert.Equal(1, hook.GetProperty("counts").GetProperty("minor").GetInt32());
        Assert.Equal(new[] { "blocker", "major", "minor" },
          hook.GetProperty("findings").EnumerateArray().Select(f => f.GetProperty("severity").GetString()));
        Assert.EndsWith($"/decks/qa?deckId={seeded.DeckId}&runId={seeded.RunId}", hook.GetProperty("consoleUrl").GetString());
      }
      Assert.Contains(sent, r => r.QueueUrl == FakeWebhookQueueUrl);

      Data(await ReportAsync(body));
      Assert.Equal(1L, Convert.ToInt64(await _db.ScalarAsync(
        "select count(*) from webhook_deliveries where subscription_id = $1 and event = 'card.flagged'", subscriptionId), CultureInfo.InvariantCulture));
    }
    finally
    {
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, savedUrl);
      WebhookEvents.TestSendSeam = savedSeam;
      await _db.QueryAsync("update webhook_subscriptions set is_active = false where id = $1", subscriptionId);
    }
  }

  [Fact]
  public async Task Results_RecordsLedgerEventOncePerChunk()
  {
    var seeded = await SeedAsync("ledger", 3);
    var body = Body(seeded.RunId, 0, Item(seeded.Cards[0], "done"), Item(seeded.Cards[1], "done"), Item(seeded.Cards[2], "error", errorCode: "PROVIDER_ERROR"));

    Data(await ReportAsync(body));
    var rows = await _db.QueryAsync(
      "select automation, units, outcome, deck_id, ref from automation_events where dedupe_key = $1", $"qa:{seeded.RunId}:0");
    var row = Assert.Single(rows);
    Assert.Equal("ai_qa_review", row["automation"]);
    Assert.Equal(2, Int(row["units"]));
    Assert.Equal("partial", row["outcome"]);
    Assert.Equal(seeded.DeckId, Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(seeded.RunId.ToString(), row["ref"]);

    Data(await ReportAsync(body));
    Assert.Equal(1L, Convert.ToInt64(await _db.ScalarAsync(
      "select count(*) from automation_events where dedupe_key = $1", $"qa:{seeded.RunId}:0"), CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Results_LateReport_MovesTimedOutRunToDone()
  {
    var seeded = await SeedAsync("late", 2, runStatus: "failed", errorCode: "TIMEOUT");

    var partial = Data(await ReportAsync(Body(seeded.RunId, 0, Item(seeded.Cards[0], "done"))));
    Assert.Equal("failed", partial.GetProperty("runStatus").GetString());
    Assert.Equal("TIMEOUT", (await RunAsync(seeded.RunId))["error_code"]);

    var done = Data(await ReportAsync(Body(seeded.RunId, 0, Item(seeded.Cards[1], "done"))));
    Assert.Equal("done", done.GetProperty("runStatus").GetString());
    var run = await RunAsync(seeded.RunId);
    Assert.Equal("done", run["status"]);
    Assert.Null(run["error_code"]);
    Assert.NotNull(run["finished_at"]);
    Assert.Equal(2, Int(run["cards_done"]));
  }

  [Fact]
  public void InternalSignature_ContractVector_Matches()
  {
    Assert.Equal("v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85", Sign("test-secret", 1790000000000, "{\"a\":1}"));
  }
}
