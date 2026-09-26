using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker.Repositories;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// F08 (CBE-22): Helpers.HandlePgError maps check / FK / not-null / invalid-text Postgres
/// errors to 400 VALIDATION_ERROR and 23505 to 409 UNIQUE_VIOLATION; VERSION_CONFLICT is 409;
/// CONFIG_ERROR is 503 via Helpers.ConfigError; deck and card PUT report editor-dropped body
/// keys as ignoredFields instead of silently dropping them. Handlers are called directly with
/// gateway-claims events against a real Postgres; the deck manifest rebuild is a no-op stub so
/// no S3 call happens.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AuthoringErrorMappingTests
{
  private readonly PostgresFixture _db;
  public AuthoringErrorMappingTests(PostgresFixture db) => _db = db;

  private const string CardsPath = "/api/v1/authoring/cards";
  private const string DecksPath = "/api/v1/authoring/decks";
  private const string PermissionsBulkPath = "/api/v1/admin/permissions/bulk";

  private static readonly DeckRollback.ManifestRebuildFn NoopRebuild =
    _ => Task.FromResult(new ManifestBuildResult(1, 0, "content/manifest.json", "\"etag\"", 1));

  private static string NewSub() => $"it-f08-{Guid.NewGuid():N}";
  private static string Slug(string tag) => $"it-f08-{tag}-{Guid.NewGuid():N}";

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

  private static async Task<APIGatewayProxyResponse> CardsAsync(string method, string sub, string[] groups, string? body)
  {
    var req = new LambdaRequest(Event(method, CardsPath, sub, groups, null, body));
    var res = new Res(req.TraceId);
    return await Cards.HandleAuthoringCards(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> DecksAsync(string method, string sub, string[] groups, string? body)
  {
    var req = new LambdaRequest(Event(method, DecksPath, sub, groups, null, body));
    var res = new Res(req.TraceId);
    return await Decks.HandleAuthoringDecks(req, res, await Auth.GetAuthContextAsync(req), NoopRebuild);
  }

  private static async Task<APIGatewayProxyResponse> PermissionsBulkAsync(string sub, string[] groups, string? body)
  {
    var req = new LambdaRequest(Event("POST", PermissionsBulkPath, sub, groups, null, body));
    var res = new Res(req.TraceId);
    return await Permissions.HandleAuthoringPermissions(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static string? ErrorMessage(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("message").GetString();

  private async Task<long> NewDeckAsync(string tag)
  {
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      Slug(tag), $"deck {tag}", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<(long CardId, string Uid)> NewCardAsync(long deckId, int order)
  {
    var uid = $"uid-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, $3, $4) returning id",
      deckId, uid, "q", order);
    return (Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture), uid);
  }

  private Task GrantEditorAsync(string editorSub, long deckId) =>
    _db.QueryAsync(
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 1)",
      editorSub, deckId);

  private async Task<string?> DbTierAsync(long deckId) =>
    Convert.ToString((await _db.QueryAsync("select tier from decks where id = $1", deckId))[0]["tier"], CultureInfo.InvariantCulture);

  // ---- Postgres error mapping ------------------------------------------------------------------

  [Fact]
  public async Task CardPost_OrderInDeckZero_Is400ValidationError()
  {
    var deckId = await NewDeckAsync("order-zero");
    var body = JsonSerializer.Serialize(new
    {
      deckId,
      stableUid = $"uid-{Guid.NewGuid():N}",
      question = "q",
      orderInDeck = 0,
    });

    var resp = await CardsAsync("POST", NewSub(), ["super_admin"], body);

    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
    Assert.Contains("orderInDeck", ErrorMessage(resp), StringComparison.Ordinal);
  }

  [Fact]
  public async Task CardPost_UnknownDeck_Is400ValidationError()
  {
    var body = JsonSerializer.Serialize(new
    {
      deckId = 999999999L,
      stableUid = $"uid-{Guid.NewGuid():N}",
      question = "q",
      orderInDeck = 1,
    });

    var resp = await CardsAsync("POST", NewSub(), ["super_admin"], body);

    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
  }

  [Fact]
  public async Task PermissionsBulk_UnknownDeck_Is400ValidationError()
  {
    var body = JsonSerializer.Serialize(new
    {
      adminSub = NewSub(),
      permissions = new[] { new { deckId = 999999999L, canWrite = true } },
    });

    var resp = await PermissionsBulkAsync(NewSub(), ["super_admin"], body);

    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
  }

  [Fact]
  public async Task DeckPut_NullTitle_Is400ValidationError()
  {
    var deckId = await NewDeckAsync("null-title");
    var body = JsonSerializer.Serialize(new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = deckId,
      ["title"] = null,
    });

    var resp = await DecksAsync("PUT", NewSub(), ["super_admin"], body);

    Assert.Equal(400, resp.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
  }

  [Fact]
  public async Task CardPut_StaleVersion_Is409VersionConflict()
  {
    var deckId = await NewDeckAsync("stale");
    var (cardId, _) = await NewCardAsync(deckId, 1);
    var body = JsonSerializer.Serialize(new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["id"] = cardId,
      ["expectedVersion"] = 99,
      ["question"] = "q2",
    });

    var resp = await CardsAsync("PUT", NewSub(), ["super_admin"], body);

    Assert.Equal(409, resp.StatusCode);
    Assert.Equal("VERSION_CONFLICT", ErrorCode(resp));
  }

  [Fact]
  public async Task DeckPost_DuplicateSlug_Is409UniqueViolation()
  {
    var slug = Slug("dup");
    var first = JsonSerializer.Serialize(new { slug, title = "first", author = "tests" });
    var firstResp = await DecksAsync("POST", NewSub(), ["super_admin"], first);
    Assert.True(firstResp.StatusCode == 200, $"seed POST returned {firstResp.StatusCode}: {firstResp.Body}");

    var second = JsonSerializer.Serialize(new { slug, title = "second", author = "tests" });
    var resp = await DecksAsync("POST", NewSub(), ["super_admin"], second);

    Assert.Equal(409, resp.StatusCode);
    Assert.Equal("UNIQUE_VIOLATION", ErrorCode(resp));
  }

  [Fact]
  public async Task InvalidTextRepresentation_Maps_To400()
  {
    var pg = await Assert.ThrowsAsync<PostgresException>(() => _db.ScalarAsync("select 'abc'::bigint"));

    var resp = Helpers.HandlePgError(pg, new Res("t"));

    Assert.NotNull(resp);
    Assert.Equal(400, resp!.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(resp));
  }

  [Fact]
  public void ConfigError_Is503()
  {
    var resp = Helpers.ConfigError(new Res("t"), "Missing PG env vars");

    Assert.Equal(503, resp.StatusCode);
    Assert.Equal("CONFIG_ERROR", ErrorCode(resp));
  }

  // ---- ignoredFields ---------------------------------------------------------------------------

  [Fact]
  public async Task DeckPut_Editor_ReportsIgnoredFields()
  {
    var deckId = await NewDeckAsync("editor-deck");
    var editorSub = NewSub();
    await GrantEditorAsync(editorSub, deckId);
    var tierBefore = await DbTierAsync(deckId);

    var body = JsonSerializer.Serialize(new { id = deckId, title = "t2", tier = "premium" });
    var resp = await DecksAsync("PUT", editorSub, ["editor"], body);

    Assert.True(resp.StatusCode == 200, $"PUT returned {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.Equal("t2", data.GetProperty("title").GetString());
    Assert.Equal(tierBefore, await DbTierAsync(deckId));
    Assert.NotEqual("premium", await DbTierAsync(deckId));
    Assert.Equal(
      new[] { "tier" },
      data.GetProperty("ignoredFields").EnumerateArray().Select(e => e.GetString()).ToArray());
  }

  [Fact]
  public async Task CardPut_Editor_ReportsIgnoredFields()
  {
    var deckId = await NewDeckAsync("editor-card");
    var (cardId, _) = await NewCardAsync(deckId, 1);
    var editorSub = NewSub();
    await GrantEditorAsync(editorSub, deckId);

    var body = JsonSerializer.Serialize(new
    {
      id = cardId,
      expectedVersion = 1,
      question = "q2",
      stableUid = "other",
    });
    var resp = await CardsAsync("PUT", editorSub, ["editor"], body);

    Assert.True(resp.StatusCode == 200, $"PUT returned {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.Equal(
      new[] { "stableUid" },
      data.GetProperty("ignoredFields").EnumerateArray().Select(e => e.GetString()).ToArray());
  }

  [Fact]
  public async Task SuperAdminPut_HasNoIgnoredFieldsKey()
  {
    var deckId = await NewDeckAsync("super-deck");

    var body = JsonSerializer.Serialize(new { id = deckId, title = "t2", tier = "premium" });
    var resp = await DecksAsync("PUT", NewSub(), ["super_admin"], body);

    Assert.True(resp.StatusCode == 200, $"PUT returned {resp.StatusCode}: {resp.Body}");
    var data = Data(resp);
    Assert.False(data.TryGetProperty("ignoredFields", out _));
  }
}
