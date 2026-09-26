using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// DeckBuilds against a real Postgres, driven through JWT authorizer claims (super_admin vs
/// editor) exactly as API Gateway delivers them. The read endpoint touches no S3, so there is
/// nothing to stub; one case goes the whole way through <see cref="VpcFunction.Handler"/> to prove
/// the route is wired, which <see cref="RouteMetricsTests"/> cannot (it only proves the label).
/// </summary>
[Collection(PostgresCollection.Name)]
public class DeckBuildsTests
{
  private readonly PostgresFixture _db;
  public DeckBuildsTests(PostgresFixture db) => _db = db;

  private static string Slug(string tag) => $"it-f29-{tag}-{Guid.NewGuid():N}";

  private static JsonElement Event(string path, string method, string[] groups)
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
              ["sub"] = "admin-sub",
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<(int Status, JsonDocument Doc)> InvokeAsync(string path, string method, string[] groups)
  {
    var req = new LambdaRequest(Event(path, method, groups));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await DeckBuilds.HandleDeckBuilds(req, res, auth);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      [slug, "deck a", "tests"]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static Task SeedPublishAsync(NpgsqlConnection conn, long deckId, string slug, string buildId, string status, string createdAtSql = "now()") =>
    DbUtil.ExecuteAsync(conn, null,
      $"insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, created_at) values ($1,$2,$3,$4,$5,$6,{createdAtSql})",
      [deckId, slug, buildId, $"content/{buildId}", Guid.NewGuid().ToString(), status]);

  // ---- auth & method --------------------------------------------------------------------------

  [Fact]
  public async Task Builds_RequiresSuperAdmin_403()
  {
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/1/builds", "GET", new[] { "editor" });

    Assert.Equal(403, status);
    doc.Dispose();
  }

  [Fact]
  public async Task Builds_Post_405()
  {
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/1/builds", "POST", new[] { "super_admin" });

    Assert.Equal(405, status);
    doc.Dispose();
  }

  // ---- error paths ----------------------------------------------------------------------------

  [Fact]
  public async Task Builds_NonNumericId_400()
  {
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/abc/builds", "GET", new[] { "super_admin" });

    Assert.Equal(400, status);
    Assert.Equal("VALIDATION_ERROR", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    doc.Dispose();
  }

  [Fact]
  public async Task Builds_UnknownDeck_404DeckNotFound()
  {
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/999999999/builds", "GET", new[] { "super_admin" });

    Assert.Equal(404, status);
    Assert.Equal("DECK_NOT_FOUND", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    doc.Dispose();
  }

  // ---- listing --------------------------------------------------------------------------------

  [Fact]
  public async Task Builds_ListsOnlySuccessNewestFirst_AndMarksLive()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("list");
    var deckId = await SeedDeckAsync(conn, slug);
    await SeedPublishAsync(conn, deckId, slug, "b-old", "SUCCESS", "now() - interval '2 hours'");
    await SeedPublishAsync(conn, deckId, slug, "b-failed", "FAILED", "now() - interval '1 hour'");
    await SeedPublishAsync(conn, deckId, slug, "b-new", "SUCCESS", "now()");
    await DbUtil.ExecuteAsync(conn, null, "update decks set live_build_id = $2 where id = $1", [deckId, "b-old"]);

    var (status, doc) = await InvokeAsync($"/api/v1/admin/decks/{deckId}/builds", "GET", new[] { "super_admin" });

    Assert.Equal(200, status);
    var data = doc.RootElement.GetProperty("data");
    Assert.Equal(new[] { "deckId", "slug", "liveBuildId", "builds" }, data.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal("b-old", data.GetProperty("liveBuildId").GetString());

    var builds = data.GetProperty("builds").EnumerateArray().ToArray();
    Assert.Equal(new[] { "b-new", "b-old" }, builds.Select(b => b.GetProperty("buildId").GetString()).ToArray());
    Assert.Equal(new[] { false, true }, builds.Select(b => b.GetProperty("isLive").GetBoolean()).ToArray());
    doc.Dispose();
  }

  [Fact]
  public async Task Builds_EmptyWhenNothingPublished()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("empty");
    var deckId = await SeedDeckAsync(conn, slug);

    var (status, doc) = await InvokeAsync($"/api/v1/admin/decks/{deckId}/builds", "GET", new[] { "super_admin" });

    Assert.Equal(200, status);
    var data = doc.RootElement.GetProperty("data");
    Assert.Empty(data.GetProperty("builds").EnumerateArray());
    Assert.Equal(JsonValueKind.Null, data.GetProperty("liveBuildId").ValueKind);
    doc.Dispose();
  }

  // ---- route wiring ---------------------------------------------------------------------------

  [Fact]
  public async Task Builds_IsReachableThroughVpcFunction()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("reach");
    var deckId = await SeedDeckAsync(conn, slug);

    var resp = await new VpcFunction().Handler(Event($"/api/v1/admin/decks/{deckId}/builds", "GET", new[] { "super_admin" }));

    Assert.Equal(200, resp.StatusCode);
  }

  // ---- ParseDeckId (pure) ---------------------------------------------------------------------

  [Theory]
  [InlineData("/api/v1/admin/decks/42/builds", 42L)]
  [InlineData("/dev/api/v1/admin/decks/42/builds", 42L)]
  [InlineData("/api/v1/admin/decks/abc/builds", null)]
  [InlineData("/api/v1/admin/decks/-1/builds", null)]
  [InlineData("/api/v1/admin/decks//builds", null)]
  public void ParseDeckId_Table(string path, long? expected)
  {
    Assert.Equal(expected, DeckBuilds.ParseDeckId(path));
  }
}
