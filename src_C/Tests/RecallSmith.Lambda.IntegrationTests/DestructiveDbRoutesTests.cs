using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// F06 / CBE-08: the three destructive DB routes (create, recreate, content-intelligence-demo)
/// answer 404 in production — before any role check — unless ALLOW_DESTRUCTIVE_DB=1, and every
/// x-migrate-secret gate runs through <see cref="DbSafety.CheckMigrateSecret"/>: a configured
/// secret is compared in constant time, and a missing one is 503 CONFIG_ERROR in production.
///
/// A live database is joined only so the "reopened" path can be driven to its real
/// PGDATABASE-must-be-'postgres' guard and the demo-seed count can be observed; the assertions
/// that matter are about which response the handler returns before it ever touches SQL. This class
/// mutates process env (API_ENV, ALLOW_DESTRUCTIVE_DB, MIGRATE_SECRET), so it joins the one
/// serially-run Postgres collection and restores every var in <see cref="EnvScope"/>.Dispose.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DestructiveDbRoutesTests
{
  private readonly PostgresFixture _db;

  private const string MigrateSecret = "test-migrate-secret";
  private const string CreatePath = "/api/v1/admin/db/create";
  private const string RecreatePath = "/api/v1/admin/db/recreate";
  private const string MigratePath = "/api/v1/admin/db/migrate";
  private const string DemoPath = "/api/v1/admin/db/content-intelligence-demo";

  public DestructiveDbRoutesTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- env

  /// <summary>Sets each (name, value) pair (value == null unsets it) and restores the saved
  /// values on dispose, so no test leaks API_ENV / ALLOW_DESTRUCTIVE_DB / MIGRATE_SECRET.</summary>
  private sealed class EnvScope : IDisposable
  {
    private readonly List<(string Name, string? Saved)> _saved = new();

    public EnvScope(params (string Name, string? Value)[] vars)
    {
      foreach (var (name, value) in vars)
      {
        _saved.Add((name, Environment.GetEnvironmentVariable(name)));
        Environment.SetEnvironmentVariable(name, value);
      }
    }

    public void Dispose()
    {
      // Restore in reverse so a name listed twice ends on its earliest saved value.
      for (var i = _saved.Count - 1; i >= 0; i--)
      {
        Environment.SetEnvironmentVariable(_saved[i].Name, _saved[i].Saved);
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-f06-{Guid.NewGuid():N}";

  private static JsonElement Event(string path, string[] groups, string? migrateSecret, IDictionary<string, string>? query)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal);
    if (migrateSecret is not null) headers["x-migrate-secret"] = migrateSecret;
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "POST" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = NewSub(),
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers,
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<(LambdaRequest Req, Res Res, AuthContext Auth)> BuildAsync(
    string path, string[] groups, string? migrateSecret = null, IDictionary<string, string>? query = null)
  {
    var req = new LambdaRequest(Event(path, groups, migrateSecret, query));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    return (req, res, auth);
  }

  private static string? ErrorCode(APIGatewayProxyResponse r)
  {
    using var doc = JsonDocument.Parse(r.Body!);
    return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
  }

  private static string? ErrorMessage(APIGatewayProxyResponse r)
  {
    using var doc = JsonDocument.Parse(r.Body!);
    return doc.RootElement.GetProperty("error").GetProperty("message").GetString();
  }

  private async Task<long> DemoDeckCountAsync()
  {
    var scalar = await _db.ScalarAsync("select count(*) from decks where slug = 'content-intelligence-demo'");
    return Convert.ToInt64(scalar, CultureInfo.InvariantCulture);
  }

  // ---------------------------------------------------------------- tests

  [Theory]
  [InlineData(null, null, true)]
  [InlineData("dev", null, true)]
  [InlineData("production", null, false)]
  [InlineData("Production", null, false)]
  [InlineData(" production ", null, false)]
  [InlineData("production", "1", true)]
  [InlineData("production", "0", false)]
  [InlineData("production", "true", false)]
  public void DestructiveRoutesEnabled_Table(string? apiEnv, string? allow, bool expected)
  {
    Assert.Equal(expected, DbSafety.DestructiveRoutesEnabled(apiEnv, allow));
  }

  [Fact]
  public async Task Recreate_InProduction_Is404_BeforeAnyRoleCheck()
  {
    using var _ = new EnvScope(("API_ENV", "production"), ("ALLOW_DESTRUCTIVE_DB", null));
    // Editor only: the 404 must win over the 403 an editor would otherwise get.
    var (req, res, auth) = await BuildAsync(RecreatePath, new[] { "editor" }, query: new Dictionary<string, string> { ["name"] = "it_f06_never" });
    var r = await Migrate.HandleDbDropAndRecreate(req, res, auth);
    Assert.Equal(404, r.StatusCode);
    Assert.Equal("NOT_FOUND", ErrorCode(r));
  }

  [Fact]
  public async Task Create_InProduction_Is404()
  {
    using var _ = new EnvScope(("API_ENV", "production"), ("ALLOW_DESTRUCTIVE_DB", null), ("MIGRATE_SECRET", MigrateSecret));
    var (req, res, auth) = await BuildAsync(CreatePath, new[] { "super_admin" }, migrateSecret: MigrateSecret,
      query: new Dictionary<string, string> { ["name"] = "it_f06_never" });
    var r = await Migrate.HandleDbCreateDatabase(req, res, auth);
    Assert.Equal(404, r.StatusCode);
    Assert.Equal("NOT_FOUND", ErrorCode(r));
  }

  [Fact]
  public async Task ContentIntelligenceDemo_InProduction_Is404()
  {
    var before = await DemoDeckCountAsync();
    using (var _ = new EnvScope(("API_ENV", "production"), ("ALLOW_DESTRUCTIVE_DB", null)))
    {
      var (req, res, auth) = await BuildAsync(DemoPath, new[] { "super_admin" });
      var r = await ContentIntelligenceDemo.HandleContentIntelligenceDemo(req, res, auth);
      Assert.Equal(404, r.StatusCode);
      Assert.Equal("NOT_FOUND", ErrorCode(r));
    }
    var after = await DemoDeckCountAsync();
    Assert.Equal(before, after);
  }

  [Fact]
  public async Task AllowDestructiveDb_ReopensTheRoutes_InProduction()
  {
    using var _ = new EnvScope(("API_ENV", "production"), ("ALLOW_DESTRUCTIVE_DB", "1"), ("MIGRATE_SECRET", MigrateSecret));
    var (req, res, auth) = await BuildAsync(RecreatePath, new[] { "super_admin" }, migrateSecret: MigrateSecret,
      query: new Dictionary<string, string> { ["name"] = "it_f06_never" });
    var r = await Migrate.HandleDbDropAndRecreate(req, res, auth);
    // Route is open again; the test DB is not named 'postgres', so the handler stops at its
    // PGDATABASE guard and no database is created or dropped. The only claim is: not 404.
    Assert.NotEqual(404, r.StatusCode);
  }

  [Fact]
  public async Task Migrate_InProduction_WithoutSecret_Is503ConfigError()
  {
    using var _ = new EnvScope(("API_ENV", "production"), ("MIGRATE_SECRET", null));
    var (req, res, auth) = await BuildAsync(MigratePath, new[] { "super_admin" });
    var r = await Migrate.HandleDbMigrate(req, res, auth);
    Assert.Equal(503, r.StatusCode);
    Assert.Equal("CONFIG_ERROR", ErrorCode(r));
  }

  [Fact]
  public async Task Migrate_WrongSecret_Is403BadMigrateSecret()
  {
    using var _ = new EnvScope(("MIGRATE_SECRET", MigrateSecret));
    var (req, res, auth) = await BuildAsync(MigratePath, new[] { "super_admin" }, migrateSecret: "wrong");
    var r = await Migrate.HandleDbMigrate(req, res, auth);
    Assert.Equal(403, r.StatusCode);
    Assert.Equal("Bad migrate secret", ErrorMessage(r));
  }

  [Fact]
  public async Task Migrate_RightSecret_DryRun_Is200()
  {
    using var _ = new EnvScope(("API_ENV", "production"), ("MIGRATE_SECRET", MigrateSecret));
    var (req, res, auth) = await BuildAsync(MigratePath, new[] { "super_admin" }, migrateSecret: MigrateSecret,
      query: new Dictionary<string, string> { ["dryRun"] = "true" });
    var r = await Migrate.HandleDbMigrate(req, res, auth);
    Assert.Equal(200, r.StatusCode);
    using var doc = JsonDocument.Parse(r.Body!);
    Assert.True(doc.RootElement.GetProperty("data").GetProperty("dryRun").GetBoolean());
  }

  [Fact]
  public async Task Migrate_OutsideProduction_WithoutSecret_DryRun_Is200()
  {
    using var _ = new EnvScope(("API_ENV", null), ("MIGRATE_SECRET", null));
    var (req, res, auth) = await BuildAsync(MigratePath, new[] { "super_admin" },
      query: new Dictionary<string, string> { ["dryRun"] = "true" });
    var r = await Migrate.HandleDbMigrate(req, res, auth);
    Assert.Equal(200, r.StatusCode);
    using var doc = JsonDocument.Parse(r.Body!);
    Assert.True(doc.RootElement.GetProperty("data").GetProperty("dryRun").GetBoolean());
  }
}
