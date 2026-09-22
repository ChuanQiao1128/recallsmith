using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The optional cards.mcq overlay end to end against a real Postgres: POST inserts it as
/// $13::jsonb, PUT updates it through the Cast slot, and all three readers answer a JSON
/// object (never a JSON-encoded string). The two handler gates (explanation required,
/// difficulty 1..3) and the stem re-check on a PUT question change are pinned here too.
/// A live database is the point: the conversion from PG's text form to a wire object happens
/// in the handler (Helpers.JsonbCell), and the raw-DB probe shows PG still stores the text.
/// </summary>
[Collection(PostgresCollection.Name)]
public class CardsAuthoringMcqTests
{
  private readonly PostgresFixture _db;

  private const string CardsPath = "/api/v1/authoring/cards";

  public CardsAuthoringMcqTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-mcq-{Guid.NewGuid():N}";

  private async Task<long> NewDeckAsync(string tag)
  {
    var slug = $"it-mcq-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, $"deck {tag}", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static JsonElement Event(string method, string sub, string[] groups, object? body, IDictionary<string, string>? query)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = CardsPath,
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
      body = body is null ? null : JsonSerializer.Serialize(body),
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> InvokeAsync(string method, object? body, IDictionary<string, string>? query = null)
  {
    var req = new LambdaRequest(Event(method, NewSub(), ["super_admin"], body, query));
    var res = new Res(req.TraceId);
    return await Cards.HandleAuthoringCards(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static Dictionary<string, object?> PostBody(long deckId, int order, string question, string uid) => new(StringComparer.Ordinal)
  {
    ["deckId"] = deckId,
    ["stableUid"] = uid,
    ["question"] = question,
    ["orderInDeck"] = order,
  };

  private async Task<(JsonElement Data, long Id, string Uid)> PostMcqAsync(
    long deckId, int order, JsonElement blob, string question, string explanation = "an MCQ explanation", int difficulty = 2)
  {
    var uid = $"uid-{Guid.NewGuid():N}";
    var body = PostBody(deckId, order, question, uid);
    body["explanation"] = explanation;
    body["difficulty"] = difficulty;
    body["mcq"] = blob;

    var response = await InvokeAsync("POST", body);
    Assert.True(response.StatusCode == 200, $"POST {CardsPath} returned {response.StatusCode}: {response.Body}");
    var data = Data(response);
    return (data, data.GetProperty("id").GetInt64(), uid);
  }

  private static void AssertObjectShape(JsonElement mcq)
  {
    Assert.Equal(JsonValueKind.Object, mcq.ValueKind);
    Assert.Equal(new[] { "v", "options", "shuffle", "qualifier" }, mcq.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(new[] { "key", "why", "text", "correct" }, mcq.GetProperty("options")[0].EnumerateObject().Select(p => p.Name).ToArray());
  }

  private static bool DeepEqualsGold(JsonElement mcq, string gold) =>
    JsonNode.DeepEquals(JsonNode.Parse(mcq.GetRawText()), JsonNode.Parse(gold));

  private async Task<JsonElement> GetByIdAsync(long id)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["id"] = id.ToString(CultureInfo.InvariantCulture) };
    var response = await InvokeAsync("GET", null, query);
    Assert.True(response.StatusCode == 200, $"GET {CardsPath} returned {response.StatusCode}: {response.Body}");
    return Data(response).EnumerateArray().Single();
  }

  private async Task<string?> DbMcqTextAsync(long id)
  {
    var rows = await _db.QueryAsync("select mcq::text as t from cards where id = $1", id);
    return rows[0]["t"] as string;
  }

  // ------------------------------------------------------------------- cases

  [Fact]
  public async Task Post_WithMcq_EchoesMcqAsObject_InPgKeyOrder()
  {
    var deckId = await NewDeckAsync("post-obj");
    var (data, _, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);

    var mcq = data.GetProperty("mcq");
    AssertObjectShape(mcq);
    Assert.NotEqual(JsonValueKind.String, mcq.ValueKind);
    Assert.True(DeepEqualsGold(mcq, McqFixtures.SqsCanonical));
  }

  [Fact]
  public async Task Get_ReturnsMcqAsObject_ForEveryReader()
  {
    var deckId = await NewDeckAsync("get-obj");
    var (_, id, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);

    var byId = await GetByIdAsync(id);
    Assert.Equal(JsonValueKind.Object, byId.GetProperty("mcq").ValueKind);

    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) };
    var byDeck = await InvokeAsync("GET", null, query);
    var row = Data(byDeck).EnumerateArray().Single();
    Assert.Equal(JsonValueKind.Object, row.GetProperty("mcq").ValueKind);

    // The conversion happens in the handler, not in PG: the column still holds text.
    var raw = await DbMcqTextAsync(id);
    Assert.NotNull(raw);
    Assert.Contains("\"v\": 1", raw);
  }

  [Fact]
  public async Task Post_QaCard_ReturnsMcqNull()
  {
    var deckId = await NewDeckAsync("qa-null");
    var uid = $"uid-{Guid.NewGuid():N}";
    var response = await InvokeAsync("POST", PostBody(deckId, 10, "A plain Q/A card?", uid));
    Assert.True(response.StatusCode == 200, $"POST {CardsPath} returned {response.StatusCode}: {response.Body}");

    var data = Data(response);
    Assert.True(data.TryGetProperty("mcq", out var mcqEl));
    Assert.Equal(JsonValueKind.Null, mcqEl.ValueKind);

    var byId = await GetByIdAsync(data.GetProperty("id").GetInt64());
    Assert.Equal(JsonValueKind.Null, byId.GetProperty("mcq").ValueKind);
  }

  [Fact]
  public async Task Post_McqWithoutExplanation_IsRejected()
  {
    var deckId = await NewDeckAsync("post-noexpl");

    var uid1 = $"uid-{Guid.NewGuid():N}";
    var noExpl = PostBody(deckId, 10, McqFixtures.SqsQuestion, uid1);
    noExpl["mcq"] = McqFixtures.SqsBlob();
    var r1 = await InvokeAsync("POST", noExpl);
    Assert.Equal(400, r1.StatusCode);
    Assert.Equal("MCQ_EXPLANATION_REQUIRED", ErrorCode(r1));

    var uid2 = $"uid-{Guid.NewGuid():N}";
    var blankExpl = PostBody(deckId, 11, McqFixtures.SqsQuestion, uid2);
    blankExpl["explanation"] = "   ";
    blankExpl["mcq"] = McqFixtures.SqsBlob();
    var r2 = await InvokeAsync("POST", blankExpl);
    Assert.Equal(400, r2.StatusCode);
    Assert.Equal("MCQ_EXPLANATION_REQUIRED", ErrorCode(r2));

    var count = await _db.QueryAsync("select count(*) as n from cards where stable_uid = $1 or stable_uid = $2", uid1, uid2);
    Assert.Equal(0, Convert.ToInt32(count[0]["n"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Post_McqDifficultyOutOfRange_IsRejected()
  {
    var deckId = await NewDeckAsync("post-diff");

    var uid1 = $"uid-{Guid.NewGuid():N}";
    var high = PostBody(deckId, 10, McqFixtures.SqsQuestion, uid1);
    high["explanation"] = "e";
    high["difficulty"] = 4;
    high["mcq"] = McqFixtures.SqsBlob();
    var r1 = await InvokeAsync("POST", high);
    Assert.Equal(400, r1.StatusCode);
    Assert.Equal("MCQ_DIFFICULTY_RANGE", ErrorCode(r1));

    var uid2 = $"uid-{Guid.NewGuid():N}";
    var low = PostBody(deckId, 11, McqFixtures.SqsQuestion, uid2);
    low["explanation"] = "e";
    low["difficulty"] = 0;
    low["mcq"] = McqFixtures.SqsBlob();
    var r2 = await InvokeAsync("POST", low);
    Assert.Equal(400, r2.StatusCode);
    Assert.Equal("MCQ_DIFFICULTY_RANGE", ErrorCode(r2));

    // Absent difficulty falls back to the DB default (2) and is accepted.
    var uid3 = $"uid-{Guid.NewGuid():N}";
    var absent = PostBody(deckId, 12, McqFixtures.SqsQuestion, uid3);
    absent["explanation"] = "e";
    absent["mcq"] = McqFixtures.SqsBlob();
    var r3 = await InvokeAsync("POST", absent);
    Assert.True(r3.StatusCode == 200, $"POST {CardsPath} returned {r3.StatusCode}: {r3.Body}");
  }

  [Fact]
  public async Task Post_InvalidBlob_ReturnsTheMcqCode()
  {
    var deckId = await NewDeckAsync("post-invalid");

    var uid1 = $"uid-{Guid.NewGuid():N}";
    var tooFew = PostBody(deckId, 10, "Pick one option?", uid1);
    tooFew["explanation"] = "e";
    tooFew["mcq"] = new
    {
      v = 1,
      options = new object[]
      {
        new { key = "a", text = "Alpha choice", correct = true },
        new { key = "b", text = "Bravo choice", correct = false, why = "b is wrong" },
      },
    };
    var r1 = await InvokeAsync("POST", tooFew);
    Assert.Equal(400, r1.StatusCode);
    Assert.Equal("MCQ_TOO_FEW_OPTIONS", ErrorCode(r1));

    var uid2 = $"uid-{Guid.NewGuid():N}";
    var badQualifier = PostBody(deckId, 11, "A question that omits the phrase entirely?", uid2);
    badQualifier["explanation"] = "e";
    badQualifier["mcq"] = new
    {
      v = 1,
      qualifier = "Zephyr constraint",
      options = new object[]
      {
        new { key = "a", text = "Alpha choice", correct = true },
        new { key = "b", text = "Bravo choice", correct = false, why = "b is wrong" },
        new { key = "c", text = "Charlie choice", correct = false, why = "c is wrong" },
      },
    };
    var r2 = await InvokeAsync("POST", badQualifier);
    Assert.Equal(400, r2.StatusCode);
    Assert.Equal("MCQ_QUALIFIER_NOT_IN_STEM", ErrorCode(r2));
  }

  [Fact]
  public async Task Put_McqNull_ClearsTheColumn()
  {
    var deckId = await NewDeckAsync("put-null");
    var (_, id, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);

    var put = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id,
      ["expectedVersion"] = 1,
      ["mcq"] = null,
    });
    Assert.True(put.StatusCode == 200, $"PUT {CardsPath} returned {put.StatusCode}: {put.Body}");

    var data = Data(put);
    Assert.Equal(JsonValueKind.Null, data.GetProperty("mcq").ValueKind);
    Assert.Equal(2, data.GetProperty("version").GetInt32());

    Assert.Equal(JsonValueKind.Null, (await GetByIdAsync(id)).GetProperty("mcq").ValueKind);
    Assert.Null(await DbMcqTextAsync(id));
  }

  [Fact]
  public async Task Put_WithoutMcq_LeavesItIntact()
  {
    var deckId = await NewDeckAsync("put-nomcq");
    var (_, id, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);
    var before = await DbMcqTextAsync(id);

    var put = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id,
      ["expectedVersion"] = 1,
      ["realWorldUsage"] = "changed",
    });
    Assert.True(put.StatusCode == 200, $"PUT {CardsPath} returned {put.StatusCode}: {put.Body}");

    var mcq = Data(put).GetProperty("mcq");
    Assert.Equal(JsonValueKind.Object, mcq.ValueKind);
    Assert.True(DeepEqualsGold(mcq, McqFixtures.SqsCanonical));
    Assert.Equal(before, await DbMcqTextAsync(id));
  }

  [Fact]
  public async Task Put_ReplacesTheBlob_AndEchoesObject()
  {
    var deckId = await NewDeckAsync("put-replace");
    var (_, id, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);

    var put = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id,
      ["expectedVersion"] = 1,
      ["question"] = McqFixtures.S3Question,
      ["mcq"] = McqFixtures.S3Blob(),
    });
    Assert.True(put.StatusCode == 200, $"PUT {CardsPath} returned {put.StatusCode}: {put.Body}");

    var mcq = Data(put).GetProperty("mcq");
    Assert.Equal(JsonValueKind.Object, mcq.ValueKind);
    Assert.Equal(5, mcq.GetProperty("options").GetArrayLength());
    Assert.Equal(JsonValueKind.Null, mcq.GetProperty("qualifier").ValueKind);
    Assert.True(DeepEqualsGold(mcq, McqFixtures.S3Canonical));

    Assert.True(DeepEqualsGold((await GetByIdAsync(id)).GetProperty("mcq"), McqFixtures.S3Canonical));
  }

  [Fact]
  public async Task Put_BlankExplanationOrBadDifficulty_OnMcqCard_IsRejected()
  {
    var deckId = await NewDeckAsync("put-gates");
    var (_, id, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);

    var nullExpl = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id, ["expectedVersion"] = 1, ["explanation"] = null,
    });
    Assert.Equal(400, nullExpl.StatusCode);
    Assert.Equal("MCQ_EXPLANATION_REQUIRED", ErrorCode(nullExpl));

    var blankExpl = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id, ["expectedVersion"] = 1, ["explanation"] = "  ",
    });
    Assert.Equal(400, blankExpl.StatusCode);
    Assert.Equal("MCQ_EXPLANATION_REQUIRED", ErrorCode(blankExpl));

    var badDiff = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id, ["expectedVersion"] = 1, ["difficulty"] = 5,
    });
    Assert.Equal(400, badDiff.StatusCode);
    Assert.Equal("MCQ_DIFFICULTY_RANGE", ErrorCode(badDiff));

    var rows = await _db.QueryAsync("select version from cards where id = $1", id);
    Assert.Equal(1, Convert.ToInt32(rows[0]["version"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Put_QuestionChange_ReChecksTheStoredStem()
  {
    var deckId = await NewDeckAsync("put-restem");
    var (_, sqsId, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);

    // Dropping the "LEAST operational overhead" phrase from the stem invalidates the stored qualifier.
    var lost = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = sqsId, ["expectedVersion"] = 1, ["question"] = "Which option is best?",
    });
    Assert.Equal(400, lost.StatusCode);
    Assert.Equal("MCQ_QUALIFIER_NOT_IN_STEM", ErrorCode(lost));

    var kept = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = sqsId, ["expectedVersion"] = 1, ["question"] = McqFixtures.SqsQuestion + " Really?",
    });
    Assert.True(kept.StatusCode == 200, $"PUT {CardsPath} returned {kept.StatusCode}: {kept.Body}");

    var (_, s3Id, _) = await PostMcqAsync(deckId, 11, McqFixtures.S3Blob(), McqFixtures.S3Question);
    var noMarker = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = s3Id,
      ["expectedVersion"] = 1,
      ["question"] = "A company must keep a copy of every object in a second Region for seven years. Which two actions meet these requirements?",
    });
    Assert.Equal(400, noMarker.StatusCode);
    Assert.Equal("MCQ_CHOOSE_N_MISMATCH", ErrorCode(noMarker));
  }

  [Fact]
  public async Task Put_McqOntoQaCard_RequiresExplanation()
  {
    var deckId = await NewDeckAsync("put-onto-qa");
    var uid = $"uid-{Guid.NewGuid():N}";
    var post = await InvokeAsync("POST", PostBody(deckId, 10, "A plain Q/A card without explanation?", uid));
    Assert.True(post.StatusCode == 200, $"POST {CardsPath} returned {post.StatusCode}: {post.Body}");
    var id = Data(post).GetProperty("id").GetInt64();

    var noExpl = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id, ["expectedVersion"] = 1, ["mcq"] = McqFixtures.SqsBlob(), ["question"] = McqFixtures.SqsQuestion,
    });
    Assert.Equal(400, noExpl.StatusCode);
    Assert.Equal("MCQ_EXPLANATION_REQUIRED", ErrorCode(noExpl));

    var withExpl = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id, ["expectedVersion"] = 1, ["mcq"] = McqFixtures.SqsBlob(), ["question"] = McqFixtures.SqsQuestion, ["explanation"] = "e",
    });
    Assert.True(withExpl.StatusCode == 200, $"PUT {CardsPath} returned {withExpl.StatusCode}: {withExpl.Body}");
    Assert.Equal(JsonValueKind.Object, Data(withExpl).GetProperty("mcq").ValueKind);
  }

  [Fact]
  public async Task Put_StaleVersion_StillReportsVersionConflict()
  {
    var deckId = await NewDeckAsync("put-stale");
    var (_, id, _) = await PostMcqAsync(deckId, 10, McqFixtures.SqsBlob(), McqFixtures.SqsQuestion);

    var stale = await InvokeAsync("PUT", new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = id,
      ["expectedVersion"] = 99,
      ["question"] = McqFixtures.SqsQuestion,
      ["mcq"] = McqFixtures.SqsBlob(),
    });
    Assert.Equal(400, stale.StatusCode);
    Assert.Equal("VERSION_CONFLICT", ErrorCode(stale));
  }
}

/// <summary>The two §4.3 golden cards, reused by the DB tests (no new file per C08 scope).</summary>
internal static class McqFixtures
{
  public const string SqsCanonical = """{"v":1,"options":[{"key":"a","why":"Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.","text":"Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.","correct":false},{"key":"b","why":null,"text":"Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.","correct":true},{"key":"c","why":"A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.","text":"Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.","correct":false},{"key":"d","why":"Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.","text":"Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.","correct":false}],"shuffle":true,"qualifier":"LEAST operational overhead"}""";
  public const string S3Canonical = """{"v":1,"options":[{"key":"a","why":null,"text":"Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.","correct":true},{"key":"b","why":"Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.","text":"Enable S3 Transfer Acceleration on the source bucket.","correct":false},{"key":"c","why":null,"text":"Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.","correct":true},{"key":"d","why":"A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.","text":"Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.","correct":false},{"key":"e","why":"MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.","text":"Enable MFA Delete on the source bucket.","correct":false}],"shuffle":true,"qualifier":null}""";

  public const string SqsQuestion = "An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost. The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?";
  public const string S3Question = "A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator. Which combination of actions meets these requirements? (Choose two.)";

  public static JsonElement SqsBlob() => JsonSerializer.Deserialize<JsonElement>(SqsCanonical);
  public static JsonElement S3Blob() => JsonSerializer.Deserialize<JsonElement>(S3Canonical);
}
