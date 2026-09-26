using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// DeckRollback against a real Postgres, driven through JWT authorizer claims (super_admin vs
/// editor) exactly as API Gateway delivers them. The manifest rebuild is a counting stub
/// (ManifestRebuildFn) so the endpoint's DB effects are observed without touching S3.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DeckRollbackTests
{
  private readonly PostgresFixture _db;
  public DeckRollbackTests(PostgresFixture db) => _db = db;

  private static string Slug(string tag) => $"it-e03-{tag}-{Guid.NewGuid():N}";

  private static JsonElement Event(string path, string method, string[] groups, string? body)
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
      body,
      isBase64Encoded = false,
    });
  }

  private sealed class RebuildStub
  {
    public int Calls;
    public DeckRollback.ManifestRebuildFn Fn => _ =>
    {
      Calls++;
      return Task.FromResult(new ManifestBuildResult(1, 0, "content/manifest.json", "\"etag\"", 1));
    };
  }

  private static async Task<(int Status, JsonDocument Doc)> InvokeAsync(string path, string method, string[] groups, string? body, DeckRollback.ManifestRebuildFn rebuild)
  {
    var req = new LambdaRequest(Event(path, method, groups, body));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    var resp = await DeckRollback.HandleDeckRollback(req, res, auth, rebuild);
    return (resp.StatusCode, JsonDocument.Parse(resp.Body ?? "{}"));
  }

  private static async Task<long> SeedDeckAsync(NpgsqlConnection conn, string slug)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      "insert into decks (slug, title, author) values ($1,$2,$3) returning id",
      [slug, "deck a", "tests"]);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static Task SeedPublishAsync(NpgsqlConnection conn, long deckId, string slug, string buildId, string status) =>
    DbUtil.ExecuteAsync(conn, null,
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1,$2,$3,$4,$5,$6)",
      [deckId, slug, buildId, $"content/{buildId}", Guid.NewGuid().ToString(), status]);

  // ---- error paths ----------------------------------------------------------------------------

  [Fact]
  public async Task Rollback_UnknownDeck_404DeckNotFound()
  {
    var stub = new RebuildStub();
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/999999999/rollback", "POST", new[] { "super_admin" }, "{\"buildId\":\"b1\"}", stub.Fn);

    Assert.Equal(404, status);
    Assert.Equal("DECK_NOT_FOUND", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    Assert.Equal(0, stub.Calls);
    doc.Dispose();
  }

  [Fact]
  public async Task Rollback_NonNumericId_400()
  {
    var stub = new RebuildStub();
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/abc/rollback", "POST", new[] { "super_admin" }, "{\"buildId\":\"b1\"}", stub.Fn);

    Assert.Equal(400, status);
    Assert.Equal("VALIDATION_ERROR", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    Assert.Equal(0, stub.Calls);
    doc.Dispose();
  }

  [Fact]
  public async Task Rollback_MissingBuildId_400()
  {
    var stub = new RebuildStub();
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/1/rollback", "POST", new[] { "super_admin" }, "{}", stub.Fn);

    Assert.Equal(400, status);
    Assert.Equal("VALIDATION_ERROR", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    Assert.Equal(0, stub.Calls);
    doc.Dispose();
  }

  [Fact]
  public async Task Rollback_BuildNotSuccess_400()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("notsuccess");
    var deckId = await SeedDeckAsync(conn, slug);
    await SeedPublishAsync(conn, deckId, slug, "b-failed", "FAILED");

    var stub = new RebuildStub();
    var (status, doc) = await InvokeAsync($"/api/v1/admin/decks/{deckId}/rollback", "POST", new[] { "super_admin" }, "{\"buildId\":\"b-failed\"}", stub.Fn);

    Assert.Equal(400, status);
    Assert.Equal("VALIDATION_ERROR", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    Assert.Equal(0, stub.Calls);
    doc.Dispose();
  }

  // ---- success --------------------------------------------------------------------------------

  [Fact]
  public async Task Rollback_MovesPointerAndRebuildsManifest()
  {
    await using var conn = await _db.OpenAsync();
    var slug = Slug("rollback");
    var deckId = await SeedDeckAsync(conn, slug);
    await SeedPublishAsync(conn, deckId, slug, "b-older", "SUCCESS");
    await SeedPublishAsync(conn, deckId, slug, "b-newer", "SUCCESS");
    await DbUtil.ExecuteAsync(conn, null, "update decks set live_build_id = $2 where id = $1", [deckId, "b-newer"]);

    var stub = new RebuildStub();
    var (status, doc) = await InvokeAsync($"/api/v1/admin/decks/{deckId}/rollback", "POST", new[] { "super_admin" }, "{\"buildId\":\"b-older\"}", stub.Fn);

    Assert.Equal(200, status);
    var data = doc.RootElement.GetProperty("data");
    Assert.Equal(new[] { "deckId", "slug", "liveBuildId", "previousBuildId", "manifestRebuilt" }, data.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal("b-older", data.GetProperty("liveBuildId").GetString());
    Assert.Equal("b-newer", data.GetProperty("previousBuildId").GetString());
    Assert.True(data.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Equal(1, stub.Calls);
    doc.Dispose();

    var pointer = await DbUtil.ExecuteScalarAsync(conn, null, "select live_build_id from decks where id = $1", [deckId]);
    Assert.Equal("b-older", Convert.ToString(pointer, CultureInfo.InvariantCulture));
  }

  // ---- auth & method --------------------------------------------------------------------------

  [Fact]
  public async Task Rollback_RequiresSuperAdmin_403()
  {
    var stub = new RebuildStub();
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/1/rollback", "POST", new[] { "editor" }, "{\"buildId\":\"b1\"}", stub.Fn);

    Assert.Equal(403, status);
    Assert.Equal(0, stub.Calls);
    doc.Dispose();
  }

  [Fact]
  public async Task Rollback_Get_405()
  {
    var stub = new RebuildStub();
    var (status, doc) = await InvokeAsync("/api/v1/admin/decks/1/rollback", "GET", new[] { "super_admin" }, null, stub.Fn);

    Assert.Equal(405, status);
    Assert.Equal(0, stub.Calls);
    doc.Dispose();
  }

  // ---- ParseDeckId (pure) ---------------------------------------------------------------------

  [Theory]
  [InlineData("/api/v1/admin/decks/42/rollback", 42L)]
  [InlineData("/dev/api/v1/admin/decks/42/rollback", 42L)]
  [InlineData("/api/v1/admin/decks/abc/rollback", null)]
  [InlineData("/api/v1/admin/decks/-1/rollback", null)]
  [InlineData("/api/v1/admin/decks//rollback", null)]
  public void ParseDeckId_Table(string path, long? expected)
  {
    Assert.Equal(expected, DeckRollback.ParseDeckId(path));
  }
}
