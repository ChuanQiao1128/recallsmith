using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The authoring cards.topic column end to end against a real Postgres: POST/PUT
/// normalisation (trim, blank → null, max 80, string only) and its presence as
/// the last key of the GET / page / preview projections. The pure NormalizeTopic
/// rules are pinned by the [Theory] tables at the bottom (C00 §3.3).
/// </summary>
[Collection(PostgresCollection.Name)]
public class CardsAuthoringTopicTests
{
  private readonly PostgresFixture _db;

  private const string CardsPath = "/api/v1/authoring/cards";
  private const string PagePath = "/api/v1/authoring/cards/page";
  private const string PublishPath = "/api/v1/authoring/publish";

  public CardsAuthoringTopicTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-topic-{Guid.NewGuid():N}";

  private async Task<long> NewDeckAsync(string tag)
  {
    var slug = $"it-topic-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, $"deck {tag}", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
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

  private static async Task<APIGatewayProxyResponse> CardsAsync(string method, IDictionary<string, string>? query, string? body)
  {
    var req = new LambdaRequest(Event(method, CardsPath, NewSub(), ["super_admin"], query, body));
    var res = new Res(req.TraceId);
    return await Cards.HandleAuthoringCards(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> PageAsync(long deckId)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
      ["limit"] = "50",
    };
    var req = new LambdaRequest(Event("GET", PagePath, NewSub(), ["super_admin"], query, null));
    var res = new Res(req.TraceId);
    return await CardsPage.HandleAuthoringCardsPage(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> PreviewAsync(long deckId)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["mode"] = "preview" };
    var body = JsonSerializer.Serialize(new { deckId });
    var req = new LambdaRequest(Event("POST", PublishPath, NewSub(), ["super_admin"], query, body));
    var res = new Res(req.TraceId);
    return await Publish.HandleAuthoringPublish(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static string? ErrorMessage(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("message").GetString();

  /// <summary>
  /// POSTs a card, filling in a fresh stableUid. <paramref name="topic"/> is sent
  /// as the JSON value it deserialises to (string, number, null …); pass
  /// includeTopic: false to omit the key entirely.
  /// </summary>
  private static async Task<(APIGatewayProxyResponse Response, string Uid)> PostCardAsync(
    long deckId, int orderInDeck, object? topic, bool includeTopic = true)
  {
    var uid = $"uid-{Guid.NewGuid():N}";
    var body = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId,
      ["stableUid"] = uid,
      ["question"] = "q",
      ["orderInDeck"] = orderInDeck,
    };
    if (includeTopic) body["topic"] = topic;

    var response = await CardsAsync("POST", null, JsonSerializer.Serialize(body));
    return (response, uid);
  }

  private static Task<APIGatewayProxyResponse> PutCardAsync(object body) =>
    CardsAsync("PUT", null, JsonSerializer.Serialize(body));

  private async Task<string?> DbTopicAsync(long id)
  {
    var rows = await _db.QueryAsync("select topic from cards where id = $1", id);
    return rows[0]["topic"] as string;
  }

  // ------------------------------------------------------------------- POST

  [Fact]
  public async Task Post_WithTopic_ReturnsTrimmedTopic()
  {
    var deckId = await NewDeckAsync("post-trim");

    var (response, _) = await PostCardAsync(deckId, 1, "  Networking  ");
    Assert.True(response.StatusCode == 200, $"POST {CardsPath} returned {response.StatusCode}: {response.Body}");

    var data = Data(response);
    Assert.Equal("Networking", data.GetProperty("topic").GetString());

    var id = data.GetProperty("id").GetInt64();
    Assert.Equal("Networking", await DbTopicAsync(id));
  }

  [Fact]
  public async Task Post_BlankTopic_ReturnsNull()
  {
    var deckId = await NewDeckAsync("post-blank");

    var (blank, _) = await PostCardAsync(deckId, 1, "   ");
    Assert.True(blank.StatusCode == 200, $"POST {CardsPath} returned {blank.StatusCode}: {blank.Body}");
    Assert.Equal(JsonValueKind.Null, Data(blank).GetProperty("topic").ValueKind);

    var (absent, _) = await PostCardAsync(deckId, 2, null, includeTopic: false);
    Assert.True(absent.StatusCode == 200, $"POST {CardsPath} returned {absent.StatusCode}: {absent.Body}");
    var data = Data(absent);
    Assert.True(data.TryGetProperty("topic", out var topicEl));
    Assert.Equal(JsonValueKind.Null, topicEl.ValueKind);
  }

  [Fact]
  public async Task Post_TopicOver80_IsValidationError()
  {
    var deckId = await NewDeckAsync("post-over80");

    var (tooLong, uid) = await PostCardAsync(deckId, 1, new string('x', 81));
    Assert.Equal(400, tooLong.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(tooLong));
    Assert.Contains("topic too long (max 80)", ErrorMessage(tooLong)!, StringComparison.Ordinal);

    var count = await _db.QueryAsync("select count(*) as n from cards where stable_uid = $1", uid);
    Assert.Equal(0, Convert.ToInt32(count[0]["n"], CultureInfo.InvariantCulture));

    var eighty = new string('x', 80);
    var (boundary, _) = await PostCardAsync(deckId, 2, eighty);
    Assert.True(boundary.StatusCode == 200, $"POST {CardsPath} returned {boundary.StatusCode}: {boundary.Body}");
    Assert.Equal(eighty, Data(boundary).GetProperty("topic").GetString());
  }

  [Fact]
  public async Task Post_NonStringTopic_IsValidationError()
  {
    var deckId = await NewDeckAsync("post-nonstring");

    var (response, _) = await PostCardAsync(deckId, 1, 42);
    Assert.Equal(400, response.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(response));
    Assert.Equal("topic must be a string", ErrorMessage(response));
  }

  // -------------------------------------------------------------------- PUT

  [Fact]
  public async Task Put_TopicNull_ClearsTopic()
  {
    var deckId = await NewDeckAsync("put-null");
    var (post, _) = await PostCardAsync(deckId, 1, "T");
    var id = Data(post).GetProperty("id").GetInt64();

    var put = await PutCardAsync(new { id, expectedVersion = 1, topic = (string?)null });
    Assert.True(put.StatusCode == 200, $"PUT {CardsPath} returned {put.StatusCode}: {put.Body}");

    var data = Data(put);
    Assert.Equal(JsonValueKind.Null, data.GetProperty("topic").ValueKind);
    Assert.Equal(2, data.GetProperty("version").GetInt32());

    Assert.Null(await DbTopicAsync(id));
  }

  [Fact]
  public async Task Put_WithoutTopic_LeavesTopicIntact()
  {
    var deckId = await NewDeckAsync("put-notopic");
    var (post, _) = await PostCardAsync(deckId, 1, "T");
    var id = Data(post).GetProperty("id").GetInt64();

    var put = await PutCardAsync(new { id, expectedVersion = 1, question = "q2" });
    Assert.True(put.StatusCode == 200, $"PUT {CardsPath} returned {put.StatusCode}: {put.Body}");

    var data = Data(put);
    Assert.Equal("T", data.GetProperty("topic").GetString());
    Assert.Equal("q2", data.GetProperty("question").GetString());
  }

  [Fact]
  public async Task Put_TopicOver80_IsValidationError()
  {
    var deckId = await NewDeckAsync("put-over80");
    var (post, _) = await PostCardAsync(deckId, 1, "T");
    var id = Data(post).GetProperty("id").GetInt64();

    var tooLong = await PutCardAsync(new { id, expectedVersion = 1, topic = new string('x', 81) });
    Assert.Equal(400, tooLong.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(tooLong));

    var rows = await _db.QueryAsync("select topic, version from cards where id = $1", id);
    Assert.Equal("T", rows[0]["topic"] as string);
    Assert.Equal(1, Convert.ToInt32(rows[0]["version"], CultureInfo.InvariantCulture));

    var ok = await PutCardAsync(new { id, expectedVersion = 1, topic = "  Storage " });
    Assert.True(ok.StatusCode == 200, $"PUT {CardsPath} returned {ok.StatusCode}: {ok.Body}");
    Assert.Equal("Storage", Data(ok).GetProperty("topic").GetString());
  }

  // ------------------------------------------------- GET / page / preview

  [Fact]
  public async Task Get_Page_Preview_AllCarryTopicKey()
  {
    var deckId = await NewDeckAsync("carry-key");
    var (postA, _) = await PostCardAsync(deckId, 1, "T");
    Assert.True(postA.StatusCode == 200, $"POST {CardsPath} returned {postA.StatusCode}: {postA.Body}");
    var (postB, _) = await PostCardAsync(deckId, 2, null, includeTopic: false);
    Assert.True(postB.StatusCode == 200, $"POST {CardsPath} returned {postB.StatusCode}: {postB.Body}");

    // GET (bare array, ordered by order_in_deck asc)
    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
    };
    var getResponse = await CardsAsync("GET", query, null);
    Assert.True(getResponse.StatusCode == 200, $"GET {CardsPath} returned {getResponse.StatusCode}: {getResponse.Body}");
    var items = Data(getResponse).EnumerateArray().ToList();
    Assert.Equal(2, items.Count);
    AssertTopicKey(items[0], "T");
    AssertTopicKey(items[1], null);

    // Page envelope
    var pageResponse = await PageAsync(deckId);
    Assert.True(pageResponse.StatusCode == 200, $"GET {PagePath} returned {pageResponse.StatusCode}: {pageResponse.Body}");
    var pageItems = Data(pageResponse).GetProperty("items").EnumerateArray().ToList();
    Assert.Equal(2, pageItems.Count);
    AssertTopicKey(pageItems[0], "T");
    AssertTopicKey(pageItems[1], null);

    // Preview export
    var previewResponse = await PreviewAsync(deckId);
    Assert.True(previewResponse.StatusCode == 200, $"POST {PublishPath} returned {previewResponse.StatusCode}: {previewResponse.Body}");
    var cards = Data(previewResponse).GetProperty("export").GetProperty("cards").EnumerateArray().ToList();
    Assert.Equal(2, cards.Count);
    AssertTopicKey(cards[0], "T");
    AssertTopicKey(cards[1], null);
    Assert.True(cards[0].TryGetProperty("stableUid", out _));
    Assert.True(cards[0].TryGetProperty("orderInDeck", out _));
    Assert.True(cards[0].TryGetProperty("revision", out _));
  }

  private static void AssertTopicKey(JsonElement card, string? expected)
  {
    Assert.True(card.TryGetProperty("topic", out var topicEl), "card is missing the topic key");
    if (expected is null)
      Assert.Equal(JsonValueKind.Null, topicEl.ValueKind);
    else
      Assert.Equal(expected, topicEl.GetString());
  }

  // --------------------------------------------------- pure NormalizeTopic

  [Theory]
  [InlineData("\"  AWS  \"", "AWS")]
  [InlineData("\"\"", null)]
  [InlineData("\"   \"", null)]
  [InlineData("null", null)]
  public void NormalizeTopic_TrimsAndNullsBlank(string json, string? expected)
  {
    var el = JsonSerializer.Deserialize<JsonElement>(json);
    Assert.Equal(expected, Helpers.NormalizeTopic(el));
  }

  public static IEnumerable<object[]> RejectCases()
  {
    yield return new object[] { "42", "topic must be a string" };
    yield return new object[] { "true", "topic must be a string" };
    yield return new object[] { "{}", "topic must be a string" };
    yield return new object[] { "[]", "topic must be a string" };
    yield return new object[] { "\"" + new string('x', 81) + "\"", "topic too long (max 80)" };
  }

  [Theory]
  [MemberData(nameof(RejectCases))]
  public void NormalizeTopic_RejectsNonStringAndOverlong(string json, string message)
  {
    var el = JsonSerializer.Deserialize<JsonElement>(json);
    var ex = Assert.Throws<ValidationError>(() => Helpers.NormalizeTopic(el));
    Assert.Equal(message, ex.Message);
  }

  [Theory]
  [InlineData(1, true)]
  [InlineData(80, true)]
  [InlineData(81, false)]
  public void NormalizeTopic_LengthBoundaryIs80(int length, bool accepted)
  {
    var s = new string('x', length);
    var el = JsonSerializer.SerializeToElement(s);

    if (accepted)
      Assert.Equal(s, Helpers.NormalizeTopic(el));
    else
      Assert.Throws<ValidationError>(() => Helpers.NormalizeTopic(el));
  }
}
