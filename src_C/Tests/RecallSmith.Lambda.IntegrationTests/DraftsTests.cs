using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The AI draft review queue (R18 J11, contract §8.3) against a real Postgres: submit idempotence and the
/// DraftCard validation matrix, the accept/reject state machine, the append-only event trigger, stable-uid
/// collisions, the ledger rows, the review.queued webhook (through the J03 send seam only) and the 503 on a
/// pre-030 schema. Every test creates its own deck. Card text is plainly synthetic; source URLs are
/// docs.aws.amazon.com-shaped strings with synthetic quotes.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DraftsTests
{
  private readonly PostgresFixture _db;
  public DraftsTests(PostgresFixture db) => _db = db;

  private const string DraftsPath = "/api/v1/authoring/drafts";
  private const string FakeQueueUrl = "https://sqs.invalid.example/000000000000/developercards-webhook-events-test";
  private const string SourceUrl = "https://docs.aws.amazon.com/synthetic/latest/userguide/queue-buffering.html";
  private const string SourceQuote = "Synthetic quote: a queue absorbs a burst so consumers read at their own pace.";

  // Canonical valid MCQ (PublishMcqGateTests); its stem needs no qualifier and no choose-N.
  private const string ValidMcq =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";
  private const string BadVersionMcq =
    """{"v":2,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";
  private const string McqQuestion = "Which service buffers a burst";

  // ---------------------------------------------------------------- helpers

  private static string SuperSub() => $"it-j11-super-{Guid.NewGuid():N}";

  private async Task<(long Id, string Slug)> NewDeckAsync(string tag)
  {
    var slug = $"it-j11-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id", slug, $"deck j11 {tag}", "tests");
    return (Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture), slug);
  }

  private Task NewCardAsync(long deckId, string uid, string question, int order, int isDeleted = 0) =>
    _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, is_deleted) values ($1, $2, $3, $4, 2, $5, $6)",
      deckId, uid, question, "synthetic explanation", order, isDeleted);

  private static Dictionary<string, object?> Card(string uid, string? question = null) => new(StringComparer.Ordinal)
  {
    ["stableUid"] = uid,
    ["difficulty"] = 2,
    ["topic"] = "Synthetic topic",
    ["question"] = question ?? $"Synthetic question about draft {uid}?",
    ["explanation"] = $"Synthetic explanation for draft {uid}.",
    ["codeSnippet"] = null,
    ["codeLanguage"] = null,
    ["realWorldUsage"] = "Synthetic usage note.",
    ["mcq"] = null,
    ["source"] = new Dictionary<string, object?> { ["url"] = SourceUrl, ["quote"] = SourceQuote },
  };

  private static object Entry(string key, object card) => new { clientDraftKey = key, card };

  private static string Key() => Guid.NewGuid().ToString("N");

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

  private static Task<APIGatewayProxyResponse> SubmitAsync(object body, string? sub = null, string[]? groups = null) =>
    CallAsync(Drafts.HandleDrafts, "POST", DraftsPath, body, null, sub, groups);

  private static Task<APIGatewayProxyResponse> ListAsync(Dictionary<string, string> query) =>
    CallAsync(Drafts.HandleDrafts, "GET", DraftsPath, null, query);

  private static Task<APIGatewayProxyResponse> GetAsync(long draftId) =>
    CallAsync((q, r, a) => Drafts.HandleGetDraft(q, r, a, draftId.ToString(CultureInfo.InvariantCulture)), "GET", $"{DraftsPath}/{draftId}", null);

  private static Task<APIGatewayProxyResponse> AcceptAsync(long draftId, object? body = null) =>
    CallAsync((q, r, a) => Drafts.HandleAccept(q, r, a, draftId.ToString(CultureInfo.InvariantCulture)), "POST", $"{DraftsPath}/{draftId}/accept", body);

  private static Task<APIGatewayProxyResponse> RejectAsync(long draftId, object body) =>
    CallAsync((q, r, a) => Drafts.HandleReject(q, r, a, draftId.ToString(CultureInfo.InvariantCulture)), "POST", $"{DraftsPath}/{draftId}/reject", body);

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

  /// <summary>Submits the given cards (one fresh key each) and returns the created draft ids in order.</summary>
  private async Task<List<long>> SubmitCardsAsync(long deckId, params object[] cards)
  {
    var data = Data(await SubmitAsync(new { deckId, drafts = cards.Select(c => Entry(Key(), c)).ToArray() }));
    var ids = data.GetProperty("created").EnumerateArray().Select(c => c.GetProperty("draftId").GetInt64()).ToList();
    Assert.Equal(cards.Length, ids.Count);
    return ids;
  }

  private async Task<string> StatusAsync(long draftId) =>
    (string)(await _db.ScalarAsync("select status from ai_drafts where id = $1", draftId))!;

  private async Task<long> EventCountAsync(long draftId) =>
    Convert.ToInt64(await _db.ScalarAsync("select count(*) from ai_review_events where draft_id = $1", draftId), CultureInfo.InvariantCulture);

  // ---------------------------------------------------------------- submit

  [Fact]
  public async Task Submit_CreatesPendingDrafts_WithSimilarAndSubmittedEvent()
  {
    var deck = await NewDeckAsync("submit");
    const string liveQuestion = "Which synthetic service keeps a durable buffer of messages between producers and consumers?";
    await NewCardAsync(deck.Id, "live-card", liveQuestion, 10);

    var dupCard = Card("draft-dup", liveQuestion);
    var otherCard = Card("draft-other", "Synthetic zebra lighthouse parable with no overlap at all");
    var data = Data(await SubmitAsync(new
    {
      deckId = deck.Id,
      agent = new { name = "synthetic-agent", model = "synthetic-model", skillVersion = "1" },
      drafts = new[] { Entry(Key(), dupCard), Entry(Key(), otherCard) },
    }));

    var created = data.GetProperty("created").EnumerateArray().ToList();
    Assert.Equal(2, created.Count);
    Assert.Empty(data.GetProperty("duplicates").EnumerateArray());
    Assert.Empty(data.GetProperty("rejected").EnumerateArray());
    Assert.Equal("draft-dup", created[0].GetProperty("stableUid").GetString());

    var dupId = created[0].GetProperty("draftId").GetInt64();
    var otherId = created[1].GetProperty("draftId").GetInt64();
    foreach (var id in new[] { dupId, otherId })
    {
      Assert.Equal("pending", await StatusAsync(id));
      var submitted = await _db.ScalarAsync("select count(*) from ai_review_events where draft_id = $1 and action = 'submitted'", id);
      Assert.Equal(1L, Convert.ToInt64(submitted, CultureInfo.InvariantCulture));
    }

    var likely = await _db.ScalarAsync("""select ("similar"->0->>'likelyDuplicate')::boolean from ai_drafts where id = $1""", dupId);
    Assert.Equal(true, likely);

    var stored = (string)(await _db.ScalarAsync("select card::text from ai_drafts where id = $1", dupId))!;
    var fromDb = DraftCard.Parse(JsonDocument.Parse(stored).RootElement);
    var original = DraftCard.Parse(JsonSerializer.SerializeToElement(dupCard));
    Assert.Equal(original, fromDb);
    Assert.Equal(original, DraftCard.Parse(JsonDocument.Parse(original.ToJson()).RootElement));
  }

  [Fact]
  public async Task Submit_SameClientDraftKey_IsReportedAsDuplicate()
  {
    var deck = await NewDeckAsync("dupkey");
    var key = Key();
    var first = Data(await SubmitAsync(new { deckId = deck.Id, drafts = new[] { Entry(key, Card("dup-key-card")) } }));
    var firstId = first.GetProperty("created")[0].GetProperty("draftId").GetInt64();

    var second = Data(await SubmitAsync(new { deckId = deck.Id, drafts = new[] { Entry(key, Card("dup-key-card")) } }));
    Assert.Empty(second.GetProperty("created").EnumerateArray());
    var dup = Assert.Single(second.GetProperty("duplicates").EnumerateArray());
    Assert.Equal(key, dup.GetProperty("clientDraftKey").GetString());
    Assert.Equal(firstId, dup.GetProperty("draftId").GetInt64());

    var rows = await _db.ScalarAsync("select count(*) from ai_drafts where deck_id = $1", deck.Id);
    Assert.Equal(1L, Convert.ToInt64(rows, CultureInfo.InvariantCulture));
    Assert.Equal(1L, await EventCountAsync(firstId));
  }

  [Theory]
  [InlineData("unknown-key", "VALIDATION_ERROR")]
  [InlineData("bad-uid", "BAD_UID_FORMAT")]
  [InlineData("blank-question", "MISSING_QUESTION")]
  [InlineData("blank-explanation", "MISSING_ANSWER")]
  [InlineData("difficulty-5", "BAD_DIFFICULTY")]
  [InlineData("no-source", "SOURCE_REQUIRED")]
  [InlineData("blank-quote", "SOURCE_REQUIRED")]
  [InlineData("http-url", "VALIDATION_ERROR")]
  [InlineData("long-topic", "VALIDATION_ERROR")]
  [InlineData("mcq-v2", "MCQ_BAD_VERSION")]
  [InlineData("mcq-difficulty-4", "MCQ_DIFFICULTY_RANGE")]
  public async Task Submit_ValidationMatrix_RejectsOnlyTheBadCard(string variant, string expectedCode)
  {
    var deck = await NewDeckAsync("matrix");
    var bad = Card("bad-card");
    switch (variant)
    {
      case "unknown-key": bad["orderInDeck"] = 5; break;
      case "bad-uid": bad["stableUid"] = "Bad UID"; break;
      case "blank-question": bad["question"] = "   "; break;
      case "blank-explanation": bad["explanation"] = " "; break;
      case "difficulty-5": bad["difficulty"] = 5; break;
      case "no-source": bad.Remove("source"); break;
      case "blank-quote": bad["source"] = new { url = SourceUrl, quote = "   " }; break;
      case "http-url": bad["source"] = new { url = "http://docs.aws.amazon.com/synthetic/page.html", quote = SourceQuote }; break;
      case "long-topic": bad["topic"] = new string('t', 81); break;
      case "mcq-v2":
        bad["question"] = McqQuestion;
        bad["mcq"] = JsonDocument.Parse(BadVersionMcq).RootElement;
        break;
      case "mcq-difficulty-4":
        bad["question"] = McqQuestion;
        bad["mcq"] = JsonDocument.Parse(ValidMcq).RootElement;
        bad["difficulty"] = 4;
        break;
      default: throw new ArgumentOutOfRangeException(nameof(variant));
    }

    var goodKey = Key();
    var badKey = Key();
    var data = Data(await SubmitAsync(new { deckId = deck.Id, drafts = new[] { Entry(goodKey, Card("good-card")), Entry(badKey, bad) } }));

    var created = Assert.Single(data.GetProperty("created").EnumerateArray());
    Assert.Equal(goodKey, created.GetProperty("clientDraftKey").GetString());
    var rejected = Assert.Single(data.GetProperty("rejected").EnumerateArray());
    Assert.Equal(badKey, rejected.GetProperty("clientDraftKey").GetString());
    Assert.Equal(expectedCode, rejected.GetProperty("code").GetString());
    Assert.False(string.IsNullOrEmpty(rejected.GetProperty("message").GetString()));
  }

  [Theory]
  [InlineData("missing-deck-id")]
  [InlineData("empty-drafts")]
  [InlineData("51-drafts")]
  [InlineData("missing-key")]
  [InlineData("129-char-key")]
  [InlineData("repeated-key")]
  [InlineData("bad-agent")]
  public async Task Submit_StructuralErrors_Return400ValidationError(string variant)
  {
    var deck = await NewDeckAsync("struct");
    object body = variant switch
    {
      "missing-deck-id" => new { drafts = new[] { Entry(Key(), Card("s-card")) } },
      "empty-drafts" => new { deckId = deck.Id, drafts = Array.Empty<object>() },
      "51-drafts" => new { deckId = deck.Id, drafts = Enumerable.Range(0, 51).Select(i => Entry(Key(), Card($"s-card-{i}"))).ToArray() },
      "missing-key" => new { deckId = deck.Id, drafts = new object[] { new { card = Card("s-card") } } },
      "129-char-key" => new { deckId = deck.Id, drafts = new[] { Entry(new string('k', 129), Card("s-card")) } },
      "repeated-key" => new { deckId = deck.Id, drafts = new[] { Entry("same-key", Card("s-card-a")), Entry("same-key", Card("s-card-b")) } },
      "bad-agent" => new { deckId = deck.Id, agent = new { name = "a", extra = "b" }, drafts = new[] { Entry(Key(), Card("s-card")) } },
      _ => throw new ArgumentOutOfRangeException(nameof(variant)),
    };

    AssertError(await SubmitAsync(body), 400, "VALIDATION_ERROR");
    var rows = await _db.ScalarAsync("select count(*) from ai_drafts where deck_id = $1", deck.Id);
    Assert.Equal(0L, Convert.ToInt64(rows, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Submit_UnknownDeck_Returns404DeckNotFound()
  {
    var max = Convert.ToInt64(await _db.ScalarAsync("select coalesce(max(id), 0) from decks"), CultureInfo.InvariantCulture);
    AssertError(await SubmitAsync(new { deckId = max + 1000, drafts = new[] { Entry(Key(), Card("nodeck-card")) } }), 404, "DECK_NOT_FOUND");
  }

  [Fact]
  public async Task Submit_EditorWithoutWrite_Returns403()
  {
    var deck = await NewDeckAsync("editor");
    var sub = $"it-j11-editor-{Guid.NewGuid():N}";
    await _db.QueryAsync(
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)", sub, deck.Id);

    var response = await SubmitAsync(new { deckId = deck.Id, drafts = new[] { Entry(Key(), Card("editor-card")) } }, sub, ["editor"]);

    Assert.Equal(403, response.StatusCode);
    var rows = await _db.ScalarAsync("select count(*) from ai_drafts where deck_id = $1", deck.Id);
    Assert.Equal(0L, Convert.ToInt64(rows, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Submit_Created_EnqueuesReviewQueuedWebhook()
  {
    var deck = await NewDeckAsync("webhook");
    var subRows = await _db.QueryAsync(
      "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, true) returning id",
      $"it-j11-{Guid.NewGuid():N}"[..20], $"https://hooks.example.com/it-j11/{Guid.NewGuid():N}", new[] { "review.queued" });
    var subscriptionId = Convert.ToInt64(subRows[0]["id"], CultureInfo.InvariantCulture);

    var sent = new List<SendMessageRequest>();
    var savedSeam = WebhookEvents.TestSendSeam;
    var savedUrl = Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv);
    try
    {
      WebhookEvents.TestSendSeam = r => { lock (sent) sent.Add(r); return Task.CompletedTask; };
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, FakeQueueUrl);

      var key = Key();
      var data = Data(await SubmitAsync(new { deckId = deck.Id, drafts = new[] { Entry(key, Card("hook-card-a")), Entry(Key(), Card("hook-card-b")) } }));
      var batchId = data.GetProperty("batchId").GetString();
      var createdIds = data.GetProperty("created").EnumerateArray().Select(c => c.GetProperty("draftId").GetInt64()).ToList();

      var deliveries = await _db.QueryAsync(
        "select body from webhook_deliveries where subscription_id = $1 and event = 'review.queued'", subscriptionId);
      var delivery = Assert.Single(deliveries);
      using (var doc = JsonDocument.Parse((string)delivery["body"]!))
      {
        var hookData = doc.RootElement.GetProperty("data");
        Assert.Equal(batchId, hookData.GetProperty("batchId").GetString());
        Assert.Equal(deck.Id, hookData.GetProperty("deckId").GetInt64());
        Assert.Equal(deck.Slug, hookData.GetProperty("deckSlug").GetString());
        Assert.Equal(2, hookData.GetProperty("draftCount").GetInt32());
        Assert.Equal(createdIds, hookData.GetProperty("draftIds").EnumerateArray().Select(e => e.GetInt64()).ToList());
        Assert.EndsWith($"/review?deckId={deck.Id}", hookData.GetProperty("consoleUrl").GetString());
      }
      Assert.Contains(sent, r => r.QueueUrl == FakeQueueUrl);

      // A duplicate-only resubmit creates nothing, so it enqueues nothing.
      var again = Data(await SubmitAsync(new { deckId = deck.Id, drafts = new[] { Entry(key, Card("hook-card-a")) } }));
      Assert.Single(again.GetProperty("duplicates").EnumerateArray());
      var count = await _db.ScalarAsync(
        "select count(*) from webhook_deliveries where subscription_id = $1 and event = 'review.queued'", subscriptionId);
      Assert.Equal(1L, Convert.ToInt64(count, CultureInfo.InvariantCulture));
    }
    finally
    {
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, savedUrl);
      WebhookEvents.TestSendSeam = savedSeam;
      await _db.QueryAsync("update webhook_subscriptions set is_active = false where id = $1", subscriptionId);
    }
  }

  // ---------------------------------------------------------------- read

  [Fact]
  public async Task GetDraft_ReturnsCardSimilarAndEvents()
  {
    var deck = await NewDeckAsync("get");
    const string liveQuestion = "Which synthetic cache tier keeps hot keys closest to the reader?";
    await NewCardAsync(deck.Id, "get-live", liveQuestion, 10);
    var ids = await SubmitCardsAsync(deck.Id, Card("get-draft", liveQuestion));

    var data = Data(await GetAsync(ids[0]));

    Assert.Equal(ids[0], data.GetProperty("draftId").GetInt64());
    Assert.Equal(deck.Id, data.GetProperty("deckId").GetInt64());
    Assert.Equal("pending", data.GetProperty("status").GetString());
    Assert.Equal("get-draft", data.GetProperty("stableUid").GetString());
    Assert.Equal(liveQuestion, data.GetProperty("card").GetProperty("question").GetString());
    Assert.Equal(SourceUrl, data.GetProperty("card").GetProperty("source").GetProperty("url").GetString());
    var similar = data.GetProperty("similar").EnumerateArray().ToList();
    Assert.NotEmpty(similar);
    Assert.Equal("get-live", similar[0].GetProperty("stableUid").GetString());
    Assert.True(similar[0].GetProperty("likelyDuplicate").GetBoolean());
    var ev = Assert.Single(data.GetProperty("events").EnumerateArray());
    Assert.Equal("submitted", ev.GetProperty("action").GetString());
    Assert.Equal(JsonValueKind.Null, data.GetProperty("acceptedCardId").ValueKind);

    AssertError(await GetAsync(long.MaxValue), 404, "DRAFT_NOT_FOUND");
    AssertError(await CallAsync((q, r, a) => Drafts.HandleGetDraft(q, r, a, "abc"), "GET", $"{DraftsPath}/abc", null), 404, "DRAFT_NOT_FOUND");
  }

  [Fact]
  public async Task List_FiltersByStatus_AndPaginatesWithCursor()
  {
    var deck = await NewDeckAsync("list");
    var ids = await SubmitCardsAsync(deck.Id, Card("list-a"), Card("list-b"), Card("list-c"));
    Data(await AcceptAsync(ids[0]));
    var deckId = deck.Id.ToString(CultureInfo.InvariantCulture);

    var page1 = Data(await ListAsync(new() { ["deckId"] = deckId, ["status"] = "pending", ["limit"] = "1" }));
    var item1 = Assert.Single(page1.GetProperty("items").EnumerateArray());
    Assert.Equal(ids[2], item1.GetProperty("draftId").GetInt64());
    Assert.Equal("pending", item1.GetProperty("status").GetString());
    Assert.False(item1.GetProperty("likelyDuplicate").GetBoolean());
    var cursor = page1.GetProperty("nextCursor").GetString();
    Assert.False(string.IsNullOrEmpty(cursor));

    var page2 = Data(await ListAsync(new() { ["deckId"] = deckId, ["status"] = "pending", ["limit"] = "1", ["cursor"] = cursor! }));
    var item2 = Assert.Single(page2.GetProperty("items").EnumerateArray());
    Assert.Equal(ids[1], item2.GetProperty("draftId").GetInt64());
    Assert.Equal(JsonValueKind.Null, page2.GetProperty("nextCursor").ValueKind);

    var accepted = Data(await ListAsync(new() { ["deckId"] = deckId, ["status"] = "accepted" }));
    var acc = Assert.Single(accepted.GetProperty("items").EnumerateArray());
    Assert.Equal(ids[0], acc.GetProperty("draftId").GetInt64());
    Assert.NotEqual(JsonValueKind.Null, acc.GetProperty("acceptedCardId").ValueKind);

    var all = Data(await ListAsync(new() { ["deckId"] = deckId, ["status"] = "all" }));
    Assert.Equal(3, all.GetProperty("items").GetArrayLength());

    AssertError(await ListAsync(new() { ["deckId"] = deckId, ["cursor"] = "%%%" }), 400, "VALIDATION_ERROR");
    AssertError(await ListAsync(new() { ["deckId"] = deckId, ["status"] = "done" }), 400, "VALIDATION_ERROR");
    AssertError(await ListAsync(new() { ["deckId"] = deckId, ["limit"] = "101" }), 400, "VALIDATION_ERROR");
    AssertError(await ListAsync(new()), 400, "VALIDATION_ERROR");
  }

  // ---------------------------------------------------------------- accept

  [Fact]
  public async Task Accept_InsertsLiveCardWithSourceAndNextOrder()
  {
    var deck = await NewDeckAsync("accept");
    await NewCardAsync(deck.Id, "accept-live-1", "Synthetic first live question?", 10);
    await NewCardAsync(deck.Id, "accept-live-3", "Synthetic third live question?", 30);
    var ids = await SubmitCardsAsync(deck.Id, Card("accept-draft"));

    var data = Data(await AcceptAsync(ids[0]));
    Assert.Equal("accepted", data.GetProperty("action").GetString());
    Assert.Equal("accept-draft", data.GetProperty("stableUid").GetString());
    var cardId = data.GetProperty("cardId").GetInt64();

    var card = (await _db.QueryAsync(
      "select order_in_deck, revision, is_deleted, source->>'url' as url, source->>'quote' as quote, topic from cards where id = $1", cardId))[0];
    Assert.Equal(40, Convert.ToInt32(card["order_in_deck"], CultureInfo.InvariantCulture));
    Assert.Equal(1, Convert.ToInt32(card["revision"], CultureInfo.InvariantCulture));
    Assert.Equal(0, Convert.ToInt32(card["is_deleted"], CultureInfo.InvariantCulture));
    Assert.Equal(SourceUrl, card["url"]);
    Assert.Equal(SourceQuote, card["quote"]);
    Assert.Equal("Synthetic topic", card["topic"]);

    var draft = (await _db.QueryAsync(
      "select status, accepted_card_id, decided_at, decided_by_sub from ai_drafts where id = $1", ids[0]))[0];
    Assert.Equal("accepted", draft["status"]);
    Assert.Equal(cardId, Convert.ToInt64(draft["accepted_card_id"], CultureInfo.InvariantCulture));
    Assert.NotNull(draft["decided_at"]);
    Assert.NotNull(draft["decided_by_sub"]);

    var ev = (await _db.QueryAsync(
      "select action, before_card, after_card from ai_review_events where draft_id = $1 order by id desc limit 1", ids[0]))[0];
    Assert.Equal("accepted", ev["action"]);
    Assert.Null(ev["before_card"]);
    Assert.Null(ev["after_card"]);
  }

  [Fact]
  public async Task Accept_WithEditedCard_RecordsBeforeAndAfter()
  {
    var deck = await NewDeckAsync("edit");
    var original = Card("edit-draft");
    var same = Card("same-draft");
    var ids = await SubmitCardsAsync(deck.Id, original, same);

    var edited = Card("edit-draft", "Synthetic edited question about draft edit-draft?");
    var data = Data(await AcceptAsync(ids[0], new { card = edited, reviewMs = 1000 }));
    Assert.Equal("edited_accepted", data.GetProperty("action").GetString());

    var ev = (await _db.QueryAsync(
      "select action, before_card::text as before_card, after_card::text as after_card, review_ms from ai_review_events where draft_id = $1 and action <> 'submitted'", ids[0]))[0];
    Assert.Equal("edited_accepted", ev["action"]);
    Assert.NotNull(ev["before_card"]);
    Assert.NotNull(ev["after_card"]);
    Assert.NotEqual(ev["before_card"], ev["after_card"]);
    Assert.Equal(1000, Convert.ToInt32(ev["review_ms"], CultureInfo.InvariantCulture));
    Assert.Equal((string)original["question"]!,
      DraftCard.Parse(JsonDocument.Parse((string)ev["before_card"]!).RootElement).Question);

    var question = await _db.ScalarAsync("select question from cards where id = $1", data.GetProperty("cardId").GetInt64());
    Assert.Equal("Synthetic edited question about draft edit-draft?", question);

    // An identical card is not an edit.
    var sameData = Data(await AcceptAsync(ids[1], new { card = same }));
    Assert.Equal("accepted", sameData.GetProperty("action").GetString());
  }

  [Fact]
  public async Task Accept_Twice_Returns409DraftNotPending()
  {
    var deck = await NewDeckAsync("twice");
    var ids = await SubmitCardsAsync(deck.Id, Card("twice-a"), Card("twice-b"), Card("twice-c"), Card("twice-d"));

    // accept → accept
    Data(await AcceptAsync(ids[0]));
    var before = await EventCountAsync(ids[0]);
    AssertError(await AcceptAsync(ids[0]), 409, "DRAFT_NOT_PENDING");
    Assert.Equal(before, await EventCountAsync(ids[0]));

    // reject → accept
    Data(await RejectAsync(ids[1], new { reason = "other" }));
    before = await EventCountAsync(ids[1]);
    AssertError(await AcceptAsync(ids[1]), 409, "DRAFT_NOT_PENDING");
    Assert.Equal(before, await EventCountAsync(ids[1]));
    Assert.Equal("rejected", await StatusAsync(ids[1]));

    // accept → reject
    Data(await AcceptAsync(ids[2]));
    before = await EventCountAsync(ids[2]);
    AssertError(await RejectAsync(ids[2], new { reason = "other" }), 409, "DRAFT_NOT_PENDING");
    Assert.Equal(before, await EventCountAsync(ids[2]));
    Assert.Equal("accepted", await StatusAsync(ids[2]));

    // reject → reject
    Data(await RejectAsync(ids[3], new { reason = "low_value" }));
    before = await EventCountAsync(ids[3]);
    AssertError(await RejectAsync(ids[3], new { reason = "incorrect" }), 409, "DRAFT_NOT_PENDING");
    Assert.Equal(before, await EventCountAsync(ids[3]));

    var cards = await _db.ScalarAsync("select count(*) from cards where deck_id = $1", deck.Id);
    Assert.Equal(2L, Convert.ToInt64(cards, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Accept_StableUidTaken_Returns409()
  {
    var deck = await NewDeckAsync("uid");
    await NewCardAsync(deck.Id, "taken-live", "Synthetic live holder?", 10);
    await NewCardAsync(deck.Id, "taken-deleted", "Synthetic deleted holder?", 20, isDeleted: 1);
    var ids = await SubmitCardsAsync(deck.Id, Card("taken-live"), Card("taken-deleted"));

    var live = await AcceptAsync(ids[0]);
    AssertError(live, 409, "STABLE_UID_TAKEN");
    Assert.DoesNotContain("(deleted)", live.Body);

    var deleted = await AcceptAsync(ids[1]);
    AssertError(deleted, 409, "STABLE_UID_TAKEN");
    Assert.Contains("(deleted)", deleted.Body);

    foreach (var id in ids)
    {
      Assert.Equal("pending", await StatusAsync(id));
      Assert.Equal(1L, await EventCountAsync(id));
    }
    var cards = await _db.ScalarAsync("select count(*) from cards where deck_id = $1", deck.Id);
    Assert.Equal(2L, Convert.ToInt64(cards, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Accept_RecordsLedgerEventWithReviewMinutes()
  {
    var deck = await NewDeckAsync("ledger-accept");
    var ids = await SubmitCardsAsync(deck.Id, Card("ledger-accept-card"));

    Data(await AcceptAsync(ids[0], new { reviewMs = 90000 }));

    var row = Assert.Single(await _db.QueryAsync(
      "select automation, units, actual_minutes, deck_id, ref from automation_events where dedupe_key = $1", $"draft-accept:{ids[0]}"));
    Assert.Equal("ai_draft_review", row["automation"]);
    Assert.Equal(1, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture));
    Assert.Equal(1.50m, Convert.ToDecimal(row["actual_minutes"], CultureInfo.InvariantCulture));
    Assert.Equal(deck.Id, Convert.ToInt64(row["deck_id"], CultureInfo.InvariantCulture));
    Assert.Equal(ids[0].ToString(CultureInfo.InvariantCulture), row["ref"]);
  }

  // ---------------------------------------------------------------- reject

  [Fact]
  public async Task Reject_DefectReason_RecordsLedgerDefect()
  {
    var deck = await NewDeckAsync("ledger-defect");
    var ids = await SubmitCardsAsync(deck.Id, Card("defect-card"));

    var data = Data(await RejectAsync(ids[0], new { reason = "duplicate", note = "  same as an existing card  ", reviewMs = 3000 }));
    Assert.Equal("rejected", data.GetProperty("action").GetString());

    var row = Assert.Single(await _db.QueryAsync(
      "select units, defects_caught from automation_events where dedupe_key = $1", $"draft-reject:{ids[0]}"));
    Assert.Equal(1, Convert.ToInt32(row["defects_caught"], CultureInfo.InvariantCulture));
    Assert.Equal(0, Convert.ToInt32(row["units"], CultureInfo.InvariantCulture));

    var ev = (await _db.QueryAsync(
      "select reason, note, review_ms from ai_review_events where draft_id = $1 and action = 'rejected'", ids[0]))[0];
    Assert.Equal("duplicate", ev["reason"]);
    Assert.Equal("same as an existing card", ev["note"]);
    Assert.Equal(3000, Convert.ToInt32(ev["review_ms"], CultureInfo.InvariantCulture));

    var draft = (await _db.QueryAsync("select status, accepted_card_id, decided_at from ai_drafts where id = $1", ids[0]))[0];
    Assert.Equal("rejected", draft["status"]);
    Assert.Null(draft["accepted_card_id"]);
    Assert.NotNull(draft["decided_at"]);
  }

  [Fact]
  public async Task Reject_NonDefectReason_RecordsNoLedgerDefect()
  {
    var deck = await NewDeckAsync("ledger-nodefect");
    var ids = await SubmitCardsAsync(deck.Id, Card("nodefect-card"));

    AssertError(await RejectAsync(ids[0], new { reason = "not-a-reason" }), 400, "VALIDATION_ERROR");
    Data(await RejectAsync(ids[0], new { reason = "low_value" }));

    var count = await _db.ScalarAsync("select count(*) from automation_events where dedupe_key = $1", $"draft-reject:{ids[0]}");
    Assert.Equal(0L, Convert.ToInt64(count, CultureInfo.InvariantCulture));
    Assert.Equal("rejected", await StatusAsync(ids[0]));
  }

  // ---------------------------------------------------------------- schema

  [Fact]
  public async Task ReviewEvents_AreAppendOnly()
  {
    var deck = await NewDeckAsync("append");
    var ids = await SubmitCardsAsync(deck.Id, Card("append-card"));

    var update = await Assert.ThrowsAsync<PostgresException>(() =>
      _db.QueryAsync("update ai_review_events set note = 'changed' where draft_id = $1", ids[0]));
    Assert.Contains("ai_review_events is append-only", update.Message);

    var delete = await Assert.ThrowsAsync<PostgresException>(() =>
      _db.QueryAsync("delete from ai_review_events where draft_id = $1", ids[0]));
    Assert.Contains("ai_review_events is append-only", delete.Message);

    Assert.Equal(1L, await EventCountAsync(ids[0]));
  }

  [Fact]
  public async Task Routes_MissingTables_Return503ServerNotReadyReview()
  {
    var scratch = await _db.CreateScratchDatabaseAsync("it_j11_notready");
    long deckId;
    await using (var conn = new NpgsqlConnection(scratch))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 29);
      var id = await DbUtil.ExecuteScalarAsync(conn, null,
        "insert into decks (slug, title, author) values ($1, $2, $3) returning id", [$"it-j11-notready-{Guid.NewGuid():N}", "deck j11", "tests"]);
      deckId = Convert.ToInt64(id, CultureInfo.InvariantCulture);
    }

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", "it_j11_notready");
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();

      AssertError(await SubmitAsync(new { deckId, drafts = new[] { Entry(Key(), Card("notready-card")) } }), 503, "SERVER_NOT_READY_REVIEW");
      AssertError(await ListAsync(new() { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) }), 503, "SERVER_NOT_READY_REVIEW");
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  // ---------------------------------------------------------------- router

  [Fact]
  public async Task Drafts_ThroughVpcFunction_AreRouted()
  {
    var deck = await NewDeckAsync("routed");
    var sub = SuperSub();
    var body = JsonSerializer.Serialize(new { deckId = deck.Id, drafts = new[] { Entry(Key(), Card("routed-card")) } });
    var function = new RecallSmith.Lambda.VpcFunction();

    var submitted = Data(await function.Handler(Event("POST", DraftsPath, sub, ["super_admin"], null, body)));
    var draftId = submitted.GetProperty("created")[0].GetProperty("draftId").GetInt64();

    var one = Data(await function.Handler(Event("GET", $"{DraftsPath}/{draftId}", sub, ["super_admin"], null, null)));
    Assert.Equal(draftId, one.GetProperty("draftId").GetInt64());

    var wrongMethod = await function.Handler(Event("GET", $"{DraftsPath}/{draftId}/accept", sub, ["super_admin"], null, null));
    Assert.Equal(405, wrongMethod.StatusCode);
  }
}
