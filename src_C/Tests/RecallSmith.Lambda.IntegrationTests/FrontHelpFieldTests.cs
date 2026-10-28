using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class FrontHelpFieldTests(PostgresFixture db)
{
  private static JsonElement Json(string value) => JsonSerializer.Deserialize<JsonElement>(value);
  private static readonly JsonElement Help = Json(FrontHelpContractTests.Help);
  private static readonly JsonElement Zh = Json("""{"zh-CN":{"v":1,"question":"什么是 VPC？","explanation":"虚拟网络","frontHelp":[{"term":"VPC","definition":"隔离的虚拟网络"}]}}""");
  private static AuthContext Admin() => AutomationTestKit.Ctx($"it-help-{Guid.NewGuid():N}", agent: false);
  private static Task<APIGatewayProxyResponse> Call(string method, object? body, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync(Cards.HandleAuthoringCards, method, "/api/v1/authoring/cards", body, Admin(), query);
  private static Task<APIGatewayProxyResponse> Import(long deckId, params object[] cards) =>
    AutomationTestKit.CallAsync(CardsImport.HandleCardsImport, "POST", "/api/v1/authoring/cards/import", new { deckId, cards }, Admin());
  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, response.Body);
    return AutomationTestKit.Data(response);
  }
  private static string Code(APIGatewayProxyResponse response) => Json(response.Body).GetProperty("error").GetProperty("code").GetString()!;
  private async Task<long> NewDeck() => Convert.ToInt64(await db.ScalarAsync("insert into decks (slug,title,author) values ($1,'help deck','tests') returning id", $"it-help-{Guid.NewGuid():N}"), CultureInfo.InvariantCulture);
  private static Dictionary<string, object?> Card(long deckId, bool help = true, bool translations = true)
  {
    var card = new Dictionary<string, object?> { ["deckId"] = deckId, ["stableUid"] = "u", ["orderInDeck"] = 1, ["question"] = "What is a VPC?", ["explanation"] = "A virtual network" };
    if (help) card["frontHelp"] = Help;
    if (translations) card["translations"] = Zh;
    return card;
  }

  [Fact]
  public async Task ApiImportPublishAndWorker_UseSameHelpAndSnapshot()
  {
    var deckId = await NewDeck();
    var first = Data(await Import(deckId, Card(deckId)));
    Assert.Equal(1, first.GetProperty("created").GetInt32());
    var second = Data(await Import(deckId, Card(deckId)));
    Assert.Equal(1, second.GetProperty("unchanged").GetInt32());
    var get = Data(await Call("GET", null, new Dictionary<string, string> { ["deckId"] = deckId.ToString() }))[0];
    var id = get.GetProperty("id").GetInt64();
    Assert.Equal("VPC", get.GetProperty("frontHelp")[0].GetProperty("term").GetString());
    Assert.Equal("ok", get.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
    var page = Data(await AutomationTestKit.CallAsync(CardsPage.HandleAuthoringCardsPage, "GET", "/api/v1/authoring/cards/page", null, Admin(), new Dictionary<string, string> { ["deckId"] = deckId.ToString() }));
    Assert.Equal("VPC", page.GetProperty("items")[0].GetProperty("frontHelp")[0].GetProperty("term").GetString());
    var preview = Data(await AutomationTestKit.CallAsync(Publish.HandleAuthoringPublish, "POST", "/api/v1/authoring/publish", new { deckId }, Admin(), new Dictionary<string, string> { ["mode"] = "preview" }));
    Assert.Equal("VPC", preview.GetProperty("export").GetProperty("cards")[0].GetProperty("frontHelp")[0].GetProperty("term").GetString());
    await using var conn = await db.OpenAsync();
    var cards = await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId);
    Assert.Equal("VPC", cards[0].FrontHelp!.Value[0].GetProperty("term").GetString());
    var rows = await DbUtil.QueryAsync(conn, null, Publish.CardsSql, [deckId]);
    Assert.Equal(PublishSnapshot.Digest(rows.Select(PublishSnapshot.FromRow)), PublishJobProcessor.SnapshotDigest(cards));
    var hashes = await DbUtil.QueryAsync(conn, null, $"select {CardContentHash.CardColumnsSql} from cards c where c.id=$1", [id]);
    Assert.Equal("front-help-v1", CardContentHash.Schema(hashes[0]));
    Assert.Null(Publish.FirstTranslationGateFailure(rows, ["zh-CN"], "en-US"));
  }

  [Fact]
  public async Task PutAndImport_OmittedHelpPreserve_ExplicitNullClears_AndEnglishEditsStaleTranslations()
  {
    var deckId = await NewDeck();
    var created = Data(await Call("POST", Card(deckId)));
    var id = created.GetProperty("id").GetInt64();
    var updated = Data(await Call("PUT", new { id, expectedVersion = 1, question = "What does a VPC provide?" }));
    Assert.Equal("VPC", updated.GetProperty("frontHelp")[0].GetProperty("term").GetString());
    Assert.Equal("stale", updated.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
    // The import's old client omits BOTH optional blocks; stored help and translations survive.
    var oldClient = Card(deckId, help: false, translations: false);
    oldClient["question"] = "What does a VPC provide?";
    Data(await Import(deckId, oldClient));
    var after = Data(await Call("GET", null, new Dictionary<string, string> { ["id"] = id.ToString() }))[0];
    Assert.True(after.TryGetProperty("frontHelp", out _));
    Assert.True(after.TryGetProperty("translations", out _));
    Assert.Equal("stale", after.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
    // Restamping translations without sending help must validate against the STORED English help.
    oldClient["translations"] = Zh;
    Data(await Import(deckId, oldClient));
    after = Data(await Call("GET", null, new Dictionary<string, string> { ["id"] = id.ToString() }))[0];
    Assert.Equal("ok", after.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
    var mismatch = await Call("PUT", new { id, expectedVersion = after.GetProperty("version").GetInt32(), frontHelp = (object?)null });
    Assert.Equal(400, mismatch.StatusCode);
    Assert.Equal("TRANSLATION_FRONT_HELP_MISMATCH", Code(mismatch));
    var cleared = Data(await Call("PUT", new { id, expectedVersion = after.GetProperty("version").GetInt32(), frontHelp = (object?)null, translations = (object?)null }));
    Assert.False(cleared.TryGetProperty("frontHelp", out _));
    Assert.Null(await db.ScalarAsync("select front_help::text from cards where id = $1", id));
    var empty = Card(deckId, translations: false);
    empty["frontHelp"] = Array.Empty<object>();
    Data(await Import(deckId, empty));
    Assert.Null(await db.ScalarAsync("select front_help::text from cards where id = $1", id));
  }

  [Fact]
  public async Task ChangedHelp_RequiresMatchingTranslationAndChangesBothBindings()
  {
    var deckId = await NewDeck();
    var created = Data(await Call("POST", Card(deckId)));
    var id = created.GetProperty("id").GetInt64();
    var before = (await db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id=$1", id))[0];
    var card = Card(deckId);
    card["frontHelp"] = new[] { new { term = "VPC", definition = "A logically isolated network" } };
    var changed = Data(await Import(deckId, card));
    Assert.Equal(1, changed.GetProperty("updated").GetInt32());
    var after = (await db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id=$1", id))[0];
    Assert.NotEqual(CardContentHash.Compute(before), CardContentHash.Compute(after));
    var two = new[] { new { term = "VPC", definition = "A network" }, new { term = "subnet", definition = "A range" } };
    var rejected = await Call("PUT", new { id, expectedVersion = 2, frontHelp = two });
    Assert.Equal(400, rejected.StatusCode);
    Assert.Equal("TRANSLATION_FRONT_HELP_MISMATCH", Code(rejected));
    Assert.Equal(1, Json((string)(await db.ScalarAsync("select front_help::text from cards where id=$1", id))!).GetArrayLength());
    var badImport = Card(deckId, translations: false);
    badImport["frontHelp"] = two;
    var imported = await Import(deckId, badImport, new { stableUid = "new", orderInDeck = 2, question = "q" });
    Assert.Equal(400, imported.StatusCode);
    Assert.Equal("TRANSLATION_FRONT_HELP_MISMATCH", Code(imported));
    Assert.Equal(1L, Convert.ToInt64(await db.ScalarAsync("select count(*) from cards where deck_id=$1", deckId)));
    Assert.Equal(2, Convert.ToInt32(await db.ScalarAsync("select version from cards where id=$1", id)));
    Assert.Equal(1, Convert.ToInt32(await db.ScalarAsync("select revision from cards where id=$1", id)));
  }

  [Fact]
  public async Task Pre049Schema_HandlesOldCardsAndRejectsHelpUntilMigrated()
  {
    const string name = "it_front_help_pre049";
    var connectionString = await db.CreateScratchDatabaseAsync(name);
    await using var conn = new NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 48);
    var oldDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", name);
    Pg.Reset();
    try
    {
      var deckId = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "insert into decks(slug,title,author) values('help-pre','help','tests') returning id", []));
      var created = Data(await Call("POST", Card(deckId, help: false, translations: false)));
      var id = created.GetProperty("id").GetInt64();
      Assert.False(created.TryGetProperty("frontHelp", out _));
      Assert.Null(Assert.Single(await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId)).FrontHelp);
      Data(await Import(deckId, Card(deckId, help: false, translations: false)));
      var rejected = await Call("PUT", new { id, expectedVersion = 1, frontHelp = Help });
      Assert.Equal(503, rejected.StatusCode);
      Assert.Equal("MIGRATION_REQUIRED", Code(rejected));
      var migration = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "049_card_front_help.sql"));
      await DbUtil.ExecuteAsync(conn, null, migration, []);
      await DbUtil.ExecuteAsync(conn, null, migration, []);
      Data(await Call("PUT", new { id, expectedVersion = 1, frontHelp = Help }));
      Assert.NotNull(Assert.Single(await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId)).FrontHelp);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", oldDb);
      Pg.Reset();
    }
  }
}
