using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The atomic, idempotent cards import endpoint (F01, CBE-02) end to end against a real
/// Postgres: whole-deck upsert by (deck_id, stable_uid) in one transaction, the deferred
/// uq_cards_deck_order that lets it renumber mid-file, the 409 conflict paths (a live holder
/// outside the payload, a soft-deleted uid in the payload), soft-deleted blockers parked past
/// the highest order, and the 503 MIGRATION_REQUIRED answer on a pre-022 schema. Migration 022's
/// shape and idempotence are pinned too.
/// </summary>
[Collection(PostgresCollection.Name)]
public class CardsImportTests
{
  private readonly PostgresFixture _db;

  private const string ImportPath = "/api/v1/authoring/cards/import";

  public CardsImportTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-f01-{Guid.NewGuid():N}";

  private static JsonElement Event(string method, string path, string sub, string[] groups, string? body)
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
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> ImportAsync(long deckId, object[] cards, string[]? groups = null, string? sub = null)
  {
    var body = JsonSerializer.Serialize(new { deckId, cards });
    var req = new LambdaRequest(Event("POST", ImportPath, sub ?? NewSub(), groups ?? ["super_admin"], body));
    var res = new Res(req.TraceId);
    return await CardsImport.HandleCardsImport(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static object Card(string uid, int order, string question = "q", string explanation = "a") =>
    new { stableUid = uid, question, explanation, orderInDeck = order, difficulty = 2 };

  private async Task<long> NewDeckAsync()
  {
    var slug = $"it-f01-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, "deck f01", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<Dictionary<string, int>> Orders(long deckId)
  {
    var rows = await _db.QueryAsync(
      """select stable_uid as "stableUid", order_in_deck as "orderInDeck" from cards where deck_id = $1 and is_deleted = 0""",
      deckId);
    return rows.ToDictionary(
      r => (string)r["stableUid"]!,
      r => Convert.ToInt32(r["orderInDeck"], CultureInfo.InvariantCulture),
      StringComparer.Ordinal);
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static string? ErrorMessage(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("message").GetString();

  // ---------------------------------------------------------------- tests

  [Fact]
  public async Task Import_NewDeck_CreatesAllCardsInOneCall()
  {
    var deckId = await NewDeckAsync();
    var resp = await ImportAsync(deckId, [Card("a", 5), Card("b", 10), Card("c", 20)]);

    Assert.Equal(200, resp.StatusCode);
    Assert.Equal(3, Data(resp).GetProperty("created").GetInt32());

    var orders = await Orders(deckId);
    Assert.Equal(new Dictionary<string, int>(StringComparer.Ordinal) { ["a"] = 5, ["b"] = 10, ["c"] = 20 }, orders);
  }

  [Fact]
  public async Task Import_SamePayloadTwice_IsIdempotent()
  {
    var deckId = await NewDeckAsync();
    var cards = new[] { Card("a", 5), Card("b", 10), Card("c", 20) };

    await ImportAsync(deckId, cards);
    var resp = await ImportAsync(deckId, cards);

    Assert.Equal(200, resp.StatusCode);
    var data = Data(resp);
    Assert.Equal(0, data.GetProperty("created").GetInt32());
    Assert.Equal(0, data.GetProperty("updated").GetInt32());
    Assert.Equal(3, data.GetProperty("unchanged").GetInt32());
    foreach (var c in data.GetProperty("cards").EnumerateArray())
    {
      Assert.Equal("unchanged", c.GetProperty("action").GetString());
    }

    var versions = await _db.QueryAsync("select version from cards where deck_id = $1 and is_deleted = 0", deckId);
    Assert.Equal(3, versions.Count);
    foreach (var row in versions)
    {
      Assert.Equal(1, Convert.ToInt32(row["version"], CultureInfo.InvariantCulture));
    }
  }

  [Fact]
  public async Task Import_MidFileInsert_ShiftsFollowingCardsAtomically()
  {
    // The CBE-02 regression: a mid-deck insert used to collide on uq_cards_deck_order
    // and leave the deck half-renumbered. The deferred constraint fixes it.
    var deckId = await NewDeckAsync();
    await ImportAsync(deckId, [Card("a", 5), Card("b", 10), Card("c", 20)]);

    var resp = await ImportAsync(deckId, [Card("a", 5), Card("x", 10), Card("b", 20), Card("c", 30)]);
    Assert.Equal(200, resp.StatusCode);
    var data = Data(resp);
    Assert.Equal(1, data.GetProperty("created").GetInt32());
    Assert.Equal(2, data.GetProperty("updated").GetInt32());
    Assert.Equal(1, data.GetProperty("unchanged").GetInt32());

    var orders = await Orders(deckId);
    Assert.Equal(
      new Dictionary<string, int>(StringComparer.Ordinal) { ["a"] = 5, ["x"] = 10, ["b"] = 20, ["c"] = 30 },
      orders);
  }

  [Fact]
  public async Task Import_SwapTwoOrders_Succeeds()
  {
    var deckId = await NewDeckAsync();
    await ImportAsync(deckId, [Card("a", 5), Card("b", 10)]);

    var resp = await ImportAsync(deckId, [Card("a", 10), Card("b", 5)]);
    Assert.Equal(200, resp.StatusCode);

    var orders = await Orders(deckId);
    Assert.Equal(new Dictionary<string, int>(StringComparer.Ordinal) { ["a"] = 10, ["b"] = 5 }, orders);
  }

  [Fact]
  public async Task Import_OrderHeldByLiveCardOutsidePayload_Is409AndWritesNothing()
  {
    var deckId = await NewDeckAsync();
    await ImportAsync(deckId, [Card("z", 30)]);

    var resp = await ImportAsync(deckId, [Card("y", 30)]);
    Assert.Equal(409, resp.StatusCode);
    Assert.Equal("ORDER_CONFLICT", ErrorCode(resp));

    var orders = await Orders(deckId);
    Assert.False(orders.ContainsKey("y"));
  }

  [Fact]
  public async Task Import_SoftDeletedCardOnAPayloadOrder_IsParked()
  {
    var deckId = await NewDeckAsync();
    await ImportAsync(deckId, [Card("d", 10)]);
    await _db.QueryAsync("update cards set is_deleted = 1 where deck_id = $1 and stable_uid = $2", deckId, "d");

    var resp = await ImportAsync(deckId, [Card("a", 5), Card("b", 10)]);
    Assert.Equal(200, resp.StatusCode);
    Assert.Equal(2, Data(resp).GetProperty("created").GetInt32());

    var d = await _db.QueryAsync(
      """select is_deleted as "isDeleted", order_in_deck as "orderInDeck" from cards where deck_id = $1 and stable_uid = $2""",
      deckId, "d");
    Assert.Single(d);
    Assert.Equal(1, Convert.ToInt32(d[0]["isDeleted"], CultureInfo.InvariantCulture));
    Assert.True(Convert.ToInt32(d[0]["orderInDeck"], CultureInfo.InvariantCulture) > 10);
  }

  [Fact]
  public async Task Import_SoftDeletedUidInPayload_Is409()
  {
    var deckId = await NewDeckAsync();
    await ImportAsync(deckId, [Card("d", 10)]);
    await _db.QueryAsync("update cards set is_deleted = 1 where deck_id = $1 and stable_uid = $2", deckId, "d");

    var resp = await ImportAsync(deckId, [Card("d", 10)]);
    Assert.Equal(409, resp.StatusCode);
    Assert.Equal("SOFT_DELETED_UID", ErrorCode(resp));
  }

  [Fact]
  public async Task Import_InvalidCard_Is400AndWritesNothing()
  {
    var deckId = await NewDeckAsync();
    var resp = await ImportAsync(deckId, [Card("a", 5), Card("b", 10, question: "  ")]);

    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    Assert.StartsWith("cards[1]", ErrorMessage(resp));

    var orders = await Orders(deckId);
    Assert.False(orders.ContainsKey("a"));
  }

  [Fact]
  public async Task Import_McqWithoutExplanation_Is400()
  {
    var deckId = await NewDeckAsync();
    var mcq = new
    {
      v = 1,
      options = new object[]
      {
        new { key = "a", text = "Alpha choice", correct = true },
        new { key = "b", text = "Bravo choice", correct = false, why = "b is wrong" },
        new { key = "c", text = "Charlie choice", correct = false, why = "c is wrong" },
      },
    };

    var without = new { stableUid = "m", question = "Pick one option?", explanation = "", orderInDeck = 5, difficulty = 2, mcq };
    var resp = await ImportAsync(deckId, [without]);
    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("MCQ_EXPLANATION_REQUIRED", ErrorCode(resp));

    var with = new { stableUid = "m", question = "Pick one option?", explanation = "e", orderInDeck = 5, difficulty = 2, mcq };
    var ok = await ImportAsync(deckId, [with]);
    Assert.Equal(200, ok.StatusCode);

    var rows = await _db.QueryAsync("select mcq from cards where deck_id = $1 and stable_uid = $2", deckId, "m");
    Assert.Single(rows);
    Assert.NotNull(rows[0]["mcq"]);
  }

  [Fact]
  public async Task Import_TooManyCards_Is400()
  {
    var deckId = await NewDeckAsync();
    var cards = Enumerable.Range(1, 501).Select(n => Card($"u{n}", n)).ToArray();

    var resp = await ImportAsync(deckId, cards);
    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
  }

  [Fact]
  public async Task Import_DuplicateUidInPayload_Is400()
  {
    var deckId = await NewDeckAsync();
    var resp = await ImportAsync(deckId, [Card("a", 5), Card("a", 10)]);

    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
  }

  [Fact]
  public async Task Import_EditorWithoutWritePermission_Is403()
  {
    var deckId = await NewDeckAsync();
    var resp = await ImportAsync(deckId, [Card("a", 5)], groups: ["editor"], sub: NewSub());

    Assert.Equal(403, resp.StatusCode);
  }

  [Fact]
  public async Task Import_UnknownDeck_Is404()
  {
    var resp = await ImportAsync(999999999, [Card("a", 5)]);
    Assert.Equal(404, resp.StatusCode);
    Assert.Equal("DECK_NOT_FOUND", ErrorCode(resp));
  }

  [Fact]
  public async Task Import_Pre022Schema_Is503MigrationRequired()
  {
    var scratchCs = await _db.CreateScratchDatabaseAsync("f01_pre022");
    await using var conn = new NpgsqlConnection(scratchCs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 21);

    var slug = $"it-f01-pre022-{Guid.NewGuid():N}";
    var deckRows = await DbUtil.QueryAsync(
      conn, null, "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      [slug, "deck pre022", "tests"]);
    var deckId = Convert.ToInt64(deckRows[0]["id"], CultureInfo.InvariantCulture);

    var prevDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", "f01_pre022");
    Pg.Reset();
    try
    {
      var resp = await ImportAsync(deckId, [Card("a", 5)]);
      Assert.Equal(503, resp.StatusCode);
      Assert.Equal("MIGRATION_REQUIRED", ErrorCode(resp));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", prevDb);
      Pg.Reset();
    }
  }

  [Fact]
  public async Task Migration022_MakesOrderConstraintDeferrableInitiallyImmediate()
  {
    var rows = await _db.QueryAsync(
      """select condeferrable as "condeferrable", condeferred as "condeferred" from pg_constraint where conname = 'uq_cards_deck_order'""");
    Assert.Single(rows);
    Assert.True(Convert.ToBoolean(rows[0]["condeferrable"]));
    Assert.False(Convert.ToBoolean(rows[0]["condeferred"]));
  }

  [Fact]
  public async Task Migration022_IsIdempotent()
  {
    var scratchCs = await _db.CreateScratchDatabaseAsync("f01_twice");
    await using var conn = new NpgsqlConnection(scratchCs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 22);

    var path = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "022_cards_deck_order_deferrable.sql");
    var sql = await File.ReadAllTextAsync(path);
    await DbUtil.ExecuteAsync(conn, null, sql, []);

    var rows = await DbUtil.QueryAsync(
      conn, null,
      """select condeferrable as "condeferrable" from pg_constraint where conname = 'uq_cards_deck_order'""",
      []);
    Assert.Single(rows);
    Assert.True(Convert.ToBoolean(rows[0]["condeferrable"]));
  }

  [Fact]
  public async Task Import_IsRoutedByVpcFunction()
  {
    var deckId = await NewDeckAsync();
    var body = JsonSerializer.Serialize(new { deckId, cards = new[] { Card("a", 5) } });
    var evt = Event("POST", ImportPath, NewSub(), ["super_admin"], body);

    var resp = await new RecallSmith.Lambda.VpcFunction().Handler(evt);
    Assert.Equal(200, resp.StatusCode);
    Assert.Equal(1, Data(resp).GetProperty("created").GetInt32());
  }
}
