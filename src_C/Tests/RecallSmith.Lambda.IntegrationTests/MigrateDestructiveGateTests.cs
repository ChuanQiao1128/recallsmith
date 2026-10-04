using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using Migrate = RecallSmith.Lambda.Vpc.Db.Migrate;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R26X F01 (x-deploy-2): a migration whose header carries <c>-- destructive: true</c> (045) is never applied as a side
/// effect of a migrate call. <see cref="Migrate.HandleDbMigrate"/> stops before the first pending destructive migration
/// unless the query names its version in <c>confirmDestructive</c>, reports it as <c>blockedBy</c>, and applies nothing
/// after it. Each case runs on a fresh scratch database against a copy of the real migrations up to 045 plus two
/// synthetic ones behind 045: 046 (additive) and 047 (destructive). Real migrations after 045 (046 from R28 on) are
/// left out of the copy so the synthetic pair keeps its numbers.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class MigrateDestructiveGateTests
{
  private readonly PostgresFixture _db;
  public MigrateDestructiveGateTests(PostgresFixture db) => _db = db;

  private const string MigratePath = "/api/v1/admin/db/migrate";

  private static AuthContext SuperAdmin() => AutomationTestKit.Ctx(AutomationTestKit.Sub("f01-sa"), agent: false);

  /// <summary>Scratch database + migrations folder for one test; restores the env and the seam on dispose.</summary>
  private sealed class Scratch : IAsyncDisposable
  {
    private static readonly string[] Names = ["PGDATABASE", "API_ENV", "MIGRATE_SECRET"];
    private readonly Dictionary<string, string?> _saved = Names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    public required string ConnectionString { get; init; }
    public required string Dir { get; init; }

    /// <summary>
    /// Not async on purpose: an AsyncLocal set inside an async method does not flow back to its caller, so the seam
    /// is set here, synchronously, in the test's own flow.
    /// </summary>
    public static Task<Scratch> CreateAsync(PostgresFixture db, string name)
    {
      var dir = Path.Combine(Path.GetTempPath(), $"it-f01-migrations-{Guid.NewGuid():N}");
      Migrate.MigrationsDirOverride.Value = dir;
      return BuildAsync(db, name, dir);
    }

    private static async Task<Scratch> BuildAsync(PostgresFixture db, string name, string dir)
    {
      // No pooling: the next case drops this database WITH (FORCE), which would leave a dead pooled connection.
      var cs = new NpgsqlConnectionStringBuilder(await db.CreateScratchDatabaseAsync(name)) { Pooling = false }.ConnectionString;
      Directory.CreateDirectory(dir);
      foreach (var f in Directory.EnumerateFiles(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations"), "*.sql"))
      {
        var file = Path.GetFileName(f);
        if (int.Parse(file.Split('_')[0], NumberStyles.Integer, CultureInfo.InvariantCulture) > 45) continue;
        File.Copy(f, Path.Combine(dir, file));
      }
      await File.WriteAllTextAsync(Path.Combine(dir, "046_it_f01_additive.sql"),
        "-- synthetic additive migration behind 045\ncreate table if not exists it_f01_m046 (id int);\n");
      await File.WriteAllTextAsync(Path.Combine(dir, "047_it_f01_destructive.sql"),
        "-- synthetic destructive migration behind 046\n-- destructive: true\ncreate table if not exists it_f01_m047 (id int);\n");

      var s = new Scratch { ConnectionString = cs, Dir = dir };
      Environment.SetEnvironmentVariable("PGDATABASE", name);
      Environment.SetEnvironmentVariable("API_ENV", null);
      Environment.SetEnvironmentVariable("MIGRATE_SECRET", null);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      return s;
    }

    public async Task<NpgsqlConnection> OpenAsync()
    {
      var conn = new NpgsqlConnection(ConnectionString);
      await conn.OpenAsync();
      return conn;
    }

    public async Task<List<int>> RecordedAsync()
    {
      await using var conn = await OpenAsync();
      var rows = await DbUtil.QueryAsync(conn, null, "select version from schema_migrations order by version", []);
      return rows.Select(r => Convert.ToInt32(r["version"], CultureInfo.InvariantCulture)).ToList();
    }

    public async Task<bool> TableExistsAsync(string table)
    {
      await using var conn = await OpenAsync();
      return await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass($1) is not null", [table]) is true;
    }

    public ValueTask DisposeAsync()
    {
      Migrate.MigrationsDirOverride.Value = null;
      foreach (var (name, value) in _saved) Environment.SetEnvironmentVariable(name, value);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      try { Directory.Delete(Dir, recursive: true); } catch (IOException) { /* temp folder */ }
      return ValueTask.CompletedTask;
    }
  }

  private static async Task<JsonElement> MigrateAsync(AuthContext auth, IDictionary<string, string>? query = null) =>
    AutomationTestKit.Data(await AutomationTestKit.CallAsync(Migrate.HandleDbMigrate, "POST", MigratePath, null, auth, query));

  private static List<int> Versions(JsonElement data) =>
    data.GetProperty("applied").EnumerateArray().Select(m => m.GetProperty("version").GetInt32()).ToList();

  private static void AssertBlockedBy(JsonElement data, int version, string file)
  {
    var blocked = data.GetProperty("blockedBy");
    Assert.Equal(JsonValueKind.Object, blocked.ValueKind);
    Assert.Equal(version, blocked.GetProperty("version").GetInt32());
    Assert.Equal(file, blocked.GetProperty("file").GetString());
    Assert.Equal(Path.GetFileNameWithoutExtension(file), blocked.GetProperty("name").GetString());
    var message = data.GetProperty("message").GetString();
    Assert.Contains(file, message, StringComparison.Ordinal);
    Assert.Contains($"confirmDestructive={version}", message, StringComparison.Ordinal);
  }

  [Fact]
  public void RealMigrations_OnlyMigration045_IsMarkedDestructive()
  {
    var dir = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations");
    var marked = Directory.EnumerateFiles(dir, "*.sql")
      .Where(f => Migrate.IsDestructive(File.ReadLines(f)))
      .Select(Path.GetFileName)
      .ToList();
    Assert.Equal(["045_retire_content_intelligence.sql"], marked);
  }

  [Fact]
  public void DestructiveHeader_IsReadFromTheLeadingCommentBlockOnly()
  {
    Assert.True(Migrate.IsDestructive(["-- ====", "", "-- destructive: true", "drop table x;"]));
    Assert.True(Migrate.IsDestructive(["--   Destructive:   TRUE  "]));
    Assert.False(Migrate.IsDestructive(["-- destructive: false", "drop table x;"]));
    Assert.False(Migrate.IsDestructive(["create table x (id int);", "-- destructive: true"]));
    Assert.False(Migrate.IsDestructive(["-- a comment that says destructive: true in passing"]));
  }

  [Fact]
  public async Task DryRun_MarksEachPendingMigrationDestructiveOrNot()
  {
    await using var s = await Scratch.CreateAsync(_db, "it_f01_gate_dry");
    var data = await MigrateAsync(SuperAdmin(), new Dictionary<string, string> { ["dryRun"] = "true" });

    var pending = data.GetProperty("pending").EnumerateArray()
      .ToDictionary(m => m.GetProperty("version").GetInt32(), m => m.GetProperty("destructive").GetBoolean());
    Assert.True(pending[45]);
    Assert.False(pending[46]);
    Assert.True(pending[47]);
    Assert.False(pending[44]);
    Assert.False(pending[1]);
    Assert.Empty(await s.RecordedAsync());
  }

  [Fact]
  public async Task Migrate_PendingAdditiveThenDestructive_AppliesOnlyTheAdditive_AndReportsBlockedBy()
  {
    await using var s = await Scratch.CreateAsync(_db, "it_f01_gate_stop");
    var sa = SuperAdmin();

    var first = await MigrateAsync(sa);
    Assert.Equal(Enumerable.Range(1, 44).ToList(), Versions(first));
    Assert.Equal(44, first.GetProperty("appliedCount").GetInt32());
    AssertBlockedBy(first, 45, "045_retire_content_intelligence.sql");

    // Nothing at or behind 045 ran: the outbox is still there and the additive 046 was not carried along.
    Assert.Equal(Enumerable.Range(1, 44).ToList(), await s.RecordedAsync());
    Assert.True(await s.TableExistsAsync("analytics_event_outbox"));
    Assert.False(await s.TableExistsAsync("it_f01_m046"));

    // A later plain call (the next round's additive migration) still stops at 045.
    var second = await MigrateAsync(sa);
    Assert.Empty(Versions(second));
    AssertBlockedBy(second, 45, "045_retire_content_intelligence.sql");
    Assert.False(await s.TableExistsAsync("it_f01_m046"));
    Assert.True(await s.TableExistsAsync("analytics_event_outbox"));
  }

  [Theory]
  [InlineData("47")]
  [InlineData("46")]
  [InlineData("44")]
  [InlineData("045")]
  [InlineData(" 45")]
  [InlineData("")]
  [InlineData("true")]
  public async Task Migrate_WrongConfirmDestructive_DoesNotUnlock045(string confirm)
  {
    await using var s = await Scratch.CreateAsync(_db, "it_f01_gate_wrong");
    var data = await MigrateAsync(SuperAdmin(), new Dictionary<string, string> { ["confirmDestructive"] = confirm });

    AssertBlockedBy(data, 45, "045_retire_content_intelligence.sql");
    Assert.DoesNotContain(45, await s.RecordedAsync());
    Assert.True(await s.TableExistsAsync("analytics_event_outbox"));
    Assert.False(await s.TableExistsAsync("it_f01_m047"));
  }

  [Fact]
  public async Task Migrate_ConfirmDestructive_AppliesIt_AndTheAdditiveBehindIt_ButNotTheNextDestructive()
  {
    await using var s = await Scratch.CreateAsync(_db, "it_f01_gate_confirm");
    var sa = SuperAdmin();
    AssertBlockedBy(await MigrateAsync(sa), 45, "045_retire_content_intelligence.sql");

    var confirmed = await MigrateAsync(sa, new Dictionary<string, string> { ["confirmDestructive"] = "45" });
    Assert.Equal([45, 46], Versions(confirmed));
    AssertBlockedBy(confirmed, 47, "047_it_f01_destructive.sql");
    Assert.False(await s.TableExistsAsync("analytics_event_outbox"));
    Assert.True(await s.TableExistsAsync("it_f01_m046"));
    Assert.False(await s.TableExistsAsync("it_f01_m047"));

    await using (var conn = await s.OpenAsync())
    {
      Assert.Equal(1L, AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from admin_audit where action = 'db.migrate' and target = 'migration:45'", [])));
    }

    // The same confirmation again unlocks nothing new: 47 needs its own.
    var again = await MigrateAsync(sa, new Dictionary<string, string> { ["confirmDestructive"] = "45" });
    Assert.Empty(Versions(again));
    AssertBlockedBy(again, 47, "047_it_f01_destructive.sql");

    var last = await MigrateAsync(sa, new Dictionary<string, string> { ["confirmDestructive"] = "47" });
    Assert.Equal([47], Versions(last));
    Assert.Equal(JsonValueKind.Null, last.GetProperty("blockedBy").ValueKind);
    Assert.Equal(JsonValueKind.Null, last.GetProperty("message").ValueKind);
    Assert.True(await s.TableExistsAsync("it_f01_m047"));
  }

  [Fact]
  public async Task Migrate_ThroughVpcFunction_WithTheQueryInRawPath_AsInvokeAsAdminSendsIt_Applies045()
  {
    // scripts/invoke-as-admin.sh puts the path it is given into rawPath and sends no queryStringParameters.
    await using var s = await Scratch.CreateAsync(_db, "it_f01_gate_invoke");
    AssertBlockedBy(await MigrateAsync(SuperAdmin()), 45, "045_retire_content_intelligence.sql");

    var evt = JsonSerializer.SerializeToElement(new
    {
      version = "2.0",
      routeKey = "$default",
      rawPath = MigratePath + "?confirmDestructive=45",
      rawQueryString = "",
      headers = new Dictionary<string, string> { ["content-type"] = "application/json" },
      requestContext = new
      {
        http = new { method = "POST", path = MigratePath + "?confirmDestructive=45" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, string>
            {
              ["sub"] = "supervisor",
              ["cognito:groups"] = "[super_admin]",
              ["token_use"] = "access",
            },
          },
        },
      },
      body = (string?)null,
      isBase64Encoded = false,
    });

    APIGatewayProxyResponse resp = await new VpcFunction().Handler(evt);
    var data = AutomationTestKit.Data(resp);
    Assert.Equal([45, 46], Versions(data));
    AssertBlockedBy(data, 47, "047_it_f01_destructive.sql");
    Assert.False(await s.TableExistsAsync("analytics_event_outbox"));
  }

  [Fact]
  public void LambdaRequest_SplitsAQueryOffRawPath_AndQueryStringParametersWin()
  {
    static LambdaRequest Req(string rawPath, Dictionary<string, string>? qsp) => new(JsonSerializer.SerializeToElement(new
    {
      rawPath,
      requestContext = new { http = new { method = "POST" } },
      queryStringParameters = qsp,
    }));

    var split = Req("/api/v1/admin/db/migrate?confirmDestructive=45&dryRun=true", null);
    Assert.Equal("/api/v1/admin/db/migrate", split.Path);
    Assert.Equal("45", split.Query["confirmDestructive"]);
    Assert.Equal("true", split.Query["dryRun"]);

    var both = Req("/api/v1/admin/db/migrate?confirmDestructive=45", new() { ["confirmDestructive"] = "47" });
    Assert.Equal("47", both.Query["confirmDestructive"]);

    var plain = Req("/api/v1/admin/db/migrate", new() { ["dryRun"] = "true" });
    Assert.Equal("/api/v1/admin/db/migrate", plain.Path);
    Assert.Equal("true", Assert.Single(plain.Query).Value);
  }
}
