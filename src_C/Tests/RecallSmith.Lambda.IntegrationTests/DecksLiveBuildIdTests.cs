using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// GET /api/v1/authoring/decks now projects decks.live_build_id as "liveBuildId"
/// (F24 / CFE-04). It is what lets an editor's console tell a published deck from
/// a draft without ever fetching the super_admin-only manifest.
///
/// A live database is the point: the column is added and backfilled by migration
/// 021, and the only honest way to show the GET returns it — for a super admin,
/// for a permitted editor, and as JSON null for a deck that was never published —
/// is to run the real handler against the real projection.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DecksLiveBuildIdTests
{
  private readonly PostgresFixture _db;

  private const string DecksPath = "/api/v1/authoring/decks";

  public DecksLiveBuildIdTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub(string tag) => $"it-livebuild-{tag}-{Guid.NewGuid():N}";

  private async Task<long> NewDeckAsync(string tag, string? liveBuildId)
  {
    var slug = $"it-livebuild-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author, live_build_id) values ($1, $2, $3, $4) returning id",
      slug, $"deck {tag}", "tests", liveBuildId);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private Task GrantReadAsync(string adminSub, long deckId) =>
    _db.QueryAsync(
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)",
      adminSub, deckId);

  /// <summary>
  /// A real API Gateway GET event, with the groups carried as JWT claims so
  /// Auth.GetAuthContext decides super_admin vs editor exactly as production does.
  /// </summary>
  private static JsonElement Event(string sub, string[] groups, IDictionary<string, string> query)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = DecksPath,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "GET" },
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
      queryStringParameters = query,
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> InvokeGetAsync(string sub, string[] groups, long deckId)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["id"] = deckId.ToString(CultureInfo.InvariantCulture),
    };
    var req = new LambdaRequest(Event(sub, groups, query));
    var res = new Res(req.TraceId);
    return await Decks.HandleAuthoringDecks(req, res, await Auth.GetAuthContextAsync(req));
  }

  /// <summary>The single deck row the id-scoped GET returned.</summary>
  private static JsonElement SingleDeck(APIGatewayProxyResponse response, long deckId)
  {
    Assert.True(response.StatusCode == 200, $"GET {DecksPath} returned {response.StatusCode}: {response.Body}");

    using var doc = JsonDocument.Parse(response.Body!);
    var data = doc.RootElement.GetProperty("data");
    Assert.Equal(JsonValueKind.Array, data.ValueKind);

    var match = data.EnumerateArray().Single(d => d.GetProperty("id").GetInt64() == deckId);
    return match.Clone();
  }

  // ------------------------------------------------------------------- facts

  [Fact]
  public async Task Get_ReturnsLiveBuildId_ForSuperAdmin()
  {
    var deckId = await NewDeckAsync("super", "build-super-42");

    var response = await InvokeGetAsync(NewSub("super"), ["super_admin"], deckId);
    var deck = SingleDeck(response, deckId);

    Assert.True(deck.TryGetProperty("liveBuildId", out var liveBuildId), "liveBuildId must be projected");
    Assert.Equal("build-super-42", liveBuildId.GetString());
  }

  [Fact]
  public async Task Get_ReturnsLiveBuildId_ForEditorWithReadPermission()
  {
    var deckId = await NewDeckAsync("editor", "build-editor-7");
    var editor = NewSub("editor");
    await GrantReadAsync(editor, deckId);

    var response = await InvokeGetAsync(editor, ["editor"], deckId);
    var deck = SingleDeck(response, deckId);

    // The whole reason the column exists on this endpoint: an editor, who never
    // fetches the manifest, reads the live pointer straight off the deck.
    Assert.True(deck.TryGetProperty("liveBuildId", out var liveBuildId), "liveBuildId must be projected");
    Assert.Equal("build-editor-7", liveBuildId.GetString());
  }

  [Fact]
  public async Task Get_ReturnsNullLiveBuildId_ForANeverPublishedDeck()
  {
    var deckId = await NewDeckAsync("draft", null);

    var response = await InvokeGetAsync(NewSub("super"), ["super_admin"], deckId);
    var deck = SingleDeck(response, deckId);

    // A deck that has never published carries a null pointer, and the projection
    // must pass that through as JSON null rather than omitting it or coercing it.
    Assert.True(deck.TryGetProperty("liveBuildId", out var liveBuildId), "liveBuildId must be present");
    Assert.Equal(JsonValueKind.Null, liveBuildId.ValueKind);
  }
}
