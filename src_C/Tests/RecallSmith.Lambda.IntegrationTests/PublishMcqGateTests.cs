using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The pre-enqueue MCQ gate and the object echo on preview / page, against a real
/// Postgres. The gate is a pure function (Publish.FirstMcqGateFailure) tested
/// against rows read with the exact production select (Publish.CardsSql): a stored
/// blob that once passed the API but no longer satisfies the rules — the shape a
/// direct SQL insert reproduces — must be refused before it reaches the Worker.
///
/// Publishing is exercised in preview mode only: mode=publish answers CONFIG_ERROR
/// before the gate whenever the publish queue env var is empty, and setting that env
/// var would make Warmup fire a real SQS call — so the gate is verified through the
/// pure function and preview is verified for the object echo.
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishMcqGateTests
{
  private readonly PostgresFixture _db;

  public PublishMcqGateTests(PostgresFixture db) => _db = db;

  // Change 7's canonical compact blob (PG key order); the valid MCQ every case builds on.
  private const string ValidMcq =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  // Identical except the version — only the version rule fails, so Canonicalize raises MCQ_BAD_VERSION.
  private const string BadVersionMcq =
    """{"v":2,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  private const string Question = "Which service buffers a burst";
  private const string Explanation = "queue it";

  // ---------------------------------------------------------------- helpers

  private async Task<long> NewDeckAsync(string tag)
  {
    var slug = $"it-c09gate-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, $"deck {tag}", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  // Direct SQL on purpose: it sidesteps Cards.cs, which is how a blob written before a
  // rule tightened looks on disk. mcqJson is null for a plain Q/A card.
  private Task NewCardAsync(long deckId, int order, string uid, string question, string? explanation, int difficulty, string? mcqJson) =>
    _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck, mcq) values ($1, $2, $3, $4, $5, $6, $7::jsonb)",
      deckId, uid, question, explanation, difficulty, order, mcqJson);

  private Task<List<Dictionary<string, object?>>> LoadRowsAsync(long deckId) =>
    _db.QueryAsync(Publish.CardsSql, deckId);

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

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  // ---------------------------------------------------------------- gate cases

  [Fact]
  public async Task Gate_InvalidStoredMcq_ReportsUidAndCode()
  {
    var deckId = await NewDeckAsync("invalid");
    await NewCardAsync(deckId, 1, "qa-1", "plain question", Explanation, 2, null);
    await NewCardAsync(deckId, 2, "good-mcq", Question, Explanation, 2, ValidMcq);
    await NewCardAsync(deckId, 3, "bad-version", Question, Explanation, 2, BadVersionMcq);

    var gate = Publish.FirstMcqGateFailure(await LoadRowsAsync(deckId));

    Assert.NotNull(gate);
    Assert.Equal(("bad-version", "MCQ_BAD_VERSION"), gate!.Value);
  }

  [Fact]
  public async Task Gate_MissingExplanation_IsMcqExplanationRequired()
  {
    var deckId = await NewDeckAsync("no-expl");
    await NewCardAsync(deckId, 1, "no-explanation", Question, null, 2, ValidMcq);

    var gate = Publish.FirstMcqGateFailure(await LoadRowsAsync(deckId));

    Assert.NotNull(gate);
    Assert.Equal(("no-explanation", "MCQ_EXPLANATION_REQUIRED"), gate!.Value);
  }

  [Fact]
  public async Task Gate_DifficultyOutOfRange_IsMcqDifficultyRange()
  {
    var deckId = await NewDeckAsync("bad-diff");
    await NewCardAsync(deckId, 1, "hard-mcq", Question, Explanation, 4, ValidMcq);

    var gate = Publish.FirstMcqGateFailure(await LoadRowsAsync(deckId));

    Assert.NotNull(gate);
    Assert.Equal(("hard-mcq", "MCQ_DIFFICULTY_RANGE"), gate!.Value);
  }

  [Fact]
  public async Task Gate_ValidMcqAndQaRows_Pass()
  {
    var deckId = await NewDeckAsync("pass");
    // Q/A rules are untouched: a Q/A card with difficulty 4 and no explanation is fine.
    await NewCardAsync(deckId, 1, "qa-hard", "plain question", null, 4, null);
    await NewCardAsync(deckId, 2, "good-mcq", Question, Explanation, 2, ValidMcq);

    var gate = Publish.FirstMcqGateFailure(await LoadRowsAsync(deckId));

    Assert.Null(gate);
  }

  // ---------------------------------------------------------------- preview / page

  [Fact]
  public async Task Preview_IsNotGated_AndEchoesMcqAsObject()
  {
    var deckId = await NewDeckAsync("preview");
    await NewCardAsync(deckId, 1, "qa-1", "plain question", Explanation, 2, null);
    await NewCardAsync(deckId, 2, "good-mcq", Question, Explanation, 2, ValidMcq);
    await NewCardAsync(deckId, 3, "bad-version", Question, Explanation, 2, BadVersionMcq);

    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["mode"] = "preview" };
    var body = $"{{\"deckId\":{deckId}}}";
    var req = new LambdaRequest(Event("POST", "/api/v1/authoring/publish", "it-c09gate-super", ["super_admin"], query, body));
    var res = new Res(req.TraceId);

    var response = await Publish.HandleAuthoringPublish(req, res, Auth.GetAuthContext(req));
    var data = Data(response);

    var cards = data.GetProperty("export").GetProperty("cards").EnumerateArray().ToList();
    Assert.Equal(3, cards.Count);

    // Q/A card: mcq echoed as JSON null (byte identity is on CardExportData, not the preview).
    Assert.Equal(JsonValueKind.Null, cards[0].GetProperty("mcq").ValueKind);

    // Valid MCQ card: an object with v == 1.
    var mcq = cards[1].GetProperty("mcq");
    Assert.Equal(JsonValueKind.Object, mcq.ValueKind);
    Assert.Equal(1, mcq.GetProperty("v").GetInt32());

    // The bad-version card is present too — preview is not gated.
    Assert.Equal(JsonValueKind.Object, cards[2].GetProperty("mcq").ValueKind);
  }

  [Fact]
  public async Task CardsPage_EchoesMcqAsObject()
  {
    var deckId = await NewDeckAsync("page");
    await NewCardAsync(deckId, 1, "qa-1", "plain question", Explanation, 2, null);
    await NewCardAsync(deckId, 2, "good-mcq", Question, Explanation, 2, ValidMcq);

    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
      ["limit"] = "50",
    };
    var req = new LambdaRequest(Event("GET", "/api/v1/authoring/cards/page", "it-c09gate-super", ["super_admin"], query, null));
    var res = new Res(req.TraceId);

    var response = await CardsPage.HandleAuthoringCardsPage(req, res, Auth.GetAuthContext(req));
    var data = Data(response);

    var items = data.GetProperty("items").EnumerateArray().ToList();
    Assert.Equal(2, items.Count);
    Assert.Equal(JsonValueKind.Null, items[0].GetProperty("mcq").ValueKind);
    Assert.Equal(JsonValueKind.Object, items[1].GetProperty("mcq").ValueKind);
  }
}
