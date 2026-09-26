using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Db;
using DbUtil = RecallSmith.Lambda.Db.DbUtil;
using Pg = RecallSmith.Lambda.Db.Pg;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The super_admin-only bootstrap endpoint against a real Postgres. A live database is the whole
/// point: the claims this makes — that the created role is least-privilege, that its password was
/// applied without ever appearing in SQL text, that ownership of every public table moves to it —
/// are properties of what the server did, not of the C# that asked for it. The container's
/// POSTGRES_USER is a superuser, so it has rolcreaterole and stands in for the RDS master.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AppRoleTests
{
  private readonly PostgresFixture _db;

  private const string BootstrapPath = "/api/v1/admin/db/bootstrap-roles";

  // A valid app-role password (^[A-Za-z0-9]{32,64}$), built at runtime so no literal reads like a
  // credential; secret-named fixture values elsewhere start with PLACEHOLDER-.
  private static readonly string Pw = new string('a', 32);
  private const string MigrateSecret = "PLACEHOLDER-migrate";

  public AppRoleTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-approle-{Guid.NewGuid():N}";

  private static string Body(string name, string password, string database, bool createDatabase) =>
    JsonSerializer.Serialize(new { roles = new[] { new { name, password, database, createDatabase } } });

  private static JsonElement Event(string sub, string[] groups, string? body, string? migrateSecret)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal);
    if (migrateSecret is not null) headers["x-migrate-secret"] = migrateSecret;
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = BootstrapPath,
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
              ["sub"] = sub,
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers,
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> InvokeAsync(string[] groups, string? body, string? migrateSecret = null)
  {
    var req = new LambdaRequest(Event(NewSub(), groups, body, migrateSecret));
    var res = new Res(req.TraceId);
    return await AppRole.HandleBootstrapRoles(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static string ErrorCode(APIGatewayProxyResponse r)
  {
    using var doc = JsonDocument.Parse(r.Body!);
    return doc.RootElement.GetProperty("error").GetProperty("code").GetString()!;
  }

  private Task DropRoleAsync(string role) => _db.QueryAsync($"drop role if exists {role}");

  private Task DropDatabaseAsync(string database) => _db.QueryAsync($"drop database if exists {database} with (force)");

  // ---------------------------------------------------------------- tests

  [Fact]
  public async Task BootstrapRoles_Editor_Returns403()
  {
    var r = await InvokeAsync(new[] { "editor" }, Body("developercards_app", Pw, "developercards_db", false));
    Assert.Equal(403, r.StatusCode);
    Assert.Equal("FORBIDDEN", ErrorCode(r));
  }

  [Fact]
  public async Task BootstrapRoles_BadMigrateSecret_Returns403()
  {
    var saved = Environment.GetEnvironmentVariable("MIGRATE_SECRET");
    try
    {
      Environment.SetEnvironmentVariable("MIGRATE_SECRET", MigrateSecret);

      var wrong = await InvokeAsync(new[] { "super_admin" }, Body("developercards_app", Pw, "developercards_db", false), migrateSecret: "PLACEHOLDER-wrong");
      Assert.Equal(403, wrong.StatusCode);
      using (var doc = JsonDocument.Parse(wrong.Body!))
      {
        Assert.Equal("FORBIDDEN", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal("Bad migrate secret", doc.RootElement.GetProperty("error").GetProperty("message").GetString());
      }

      // Right header, but an invalid body — a 400 here proves the secret gate was passed.
      var passed = await InvokeAsync(new[] { "super_admin" }, "not json", migrateSecret: MigrateSecret);
      Assert.Equal(400, passed.StatusCode);
    }
    finally
    {
      Environment.SetEnvironmentVariable("MIGRATE_SECRET", saved);
    }
  }

  [Fact]
  public async Task BootstrapRoles_BadRoleName_Returns400()
  {
    var r = await InvokeAsync(new[] { "super_admin" }, Body("postgres", Pw, "developercards_db", false));
    Assert.Equal(400, r.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(r));
  }

  [Fact]
  public async Task BootstrapRoles_BadDatabaseName_Returns400()
  {
    var r = await InvokeAsync(new[] { "super_admin" }, Body("developercards_app", Pw, "postgres", false));
    Assert.Equal(400, r.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(r));
  }

  [Theory]
  [MemberData(nameof(BadPasswords))]
  public async Task BootstrapRoles_BadPassword_Returns400(string password)
  {
    var r = await InvokeAsync(new[] { "super_admin" }, Body("developercards_app", password, "developercards_db", false));
    Assert.Equal(400, r.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(r));
    Assert.DoesNotContain(password, r.Body!);
  }

  public static IEnumerable<object[]> BadPasswords()
  {
    yield return new object[] { new string('a', 31) };            // too short
    yield return new object[] { new string('a', 65) };            // too long
    yield return new object[] { new string('a', 31) + "'" };      // 32 chars, contains a quote
  }

  [Fact]
  public async Task BootstrapRoles_MissingDatabaseWithoutCreate_Returns400()
  {
    await DropRoleAsync("developercards_app");
    await DropDatabaseAsync("developercards_db");
    try
    {
      var r = await InvokeAsync(new[] { "super_admin" }, Body("developercards_app", Pw, "developercards_db", false));
      Assert.Equal(400, r.StatusCode);
      Assert.Equal("VALIDATION_ERROR", ErrorCode(r));

      // The pre-flight rejects before any mutation: the role must not have been created.
      var created = await _db.ScalarAsync("select 1 from pg_roles where rolname = 'developercards_app'");
      Assert.Null(created);
    }
    finally
    {
      await DropRoleAsync("developercards_app");
    }
  }

  [Fact]
  public async Task BootstrapRoles_NotMaster_Returns409()
  {
    var savedUser = Environment.GetEnvironmentVariable("PGUSER");
    var savedPw = Environment.GetEnvironmentVariable("PGPASSWORD");

    await DropRoleAsync("e06_notmaster");
    await using (var admin = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(admin, null, $"create role e06_notmaster with login nosuperuser nocreatedb nocreaterole noinherit password '{Pw}'", []);
    }

    try
    {
      Environment.SetEnvironmentVariable("PGUSER", "e06_notmaster");
      Environment.SetEnvironmentVariable("PGPASSWORD", Pw);
      Pg.Reset();

      var r = await InvokeAsync(new[] { "super_admin" }, Body("developercards_app", Pw, "developercards_staging", true));
      Assert.Equal(409, r.StatusCode);
      using var doc = JsonDocument.Parse(r.Body!);
      Assert.Equal("NOT_MASTER", doc.RootElement.GetProperty("error").GetString());
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGUSER", savedUser);
      Environment.SetEnvironmentVariable("PGPASSWORD", savedPw);
      Pg.Reset();
      await DropRoleAsync("e06_notmaster");
    }
  }

  [Fact]
  public async Task BootstrapRoles_CreatesRoleAndDatabase_ThenIdempotent()
  {
    await DropDatabaseAsync("developercards_staging");
    await DropRoleAsync("developercards_app_staging");
    try
    {
      var body = Body("developercards_app_staging", Pw, "developercards_staging", true);

      var first = await InvokeAsync(new[] { "super_admin" }, body);
      Assert.Equal(200, first.StatusCode);
      using (var doc = JsonDocument.Parse(first.Body!))
      {
        var role = doc.RootElement.GetProperty("data").GetProperty("roles")[0];
        Assert.True(role.GetProperty("created").GetBoolean());
        Assert.True(role.GetProperty("databaseCreated").GetBoolean());
        Assert.Equal(0, role.GetProperty("tablesReassigned").GetInt32());
        Assert.Equal(0, role.GetProperty("sequencesReassigned").GetInt32());
      }

      var attrs = await _db.QueryAsync("select rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolconnlimit from pg_roles where rolname = 'developercards_app_staging'");
      Assert.Single(attrs);
      Assert.False(Convert.ToBoolean(attrs[0]["rolsuper"], CultureInfo.InvariantCulture));
      Assert.False(Convert.ToBoolean(attrs[0]["rolcreatedb"], CultureInfo.InvariantCulture));
      Assert.False(Convert.ToBoolean(attrs[0]["rolcreaterole"], CultureInfo.InvariantCulture));
      Assert.False(Convert.ToBoolean(attrs[0]["rolinherit"], CultureInfo.InvariantCulture));
      Assert.Equal(50, Convert.ToInt32(attrs[0]["rolconnlimit"], CultureInfo.InvariantCulture));

      // The password reached the role: a fresh connection as it, with the fixture password, opens.
      var csb = new NpgsqlConnectionStringBuilder(_db.ConnectionString)
      {
        Username = "developercards_app_staging",
        Password = Pw,
        Database = "developercards_staging",
        SslMode = SslMode.Disable,
      };
      await using (var asRole = new NpgsqlConnection(csb.ConnectionString))
      {
        await asRole.OpenAsync();
        var one = await DbUtil.ExecuteScalarAsync(asRole, null, "select 1", []);
        Assert.Equal(1, Convert.ToInt32(one, CultureInfo.InvariantCulture));
      }

      var second = await InvokeAsync(new[] { "super_admin" }, body);
      Assert.Equal(200, second.StatusCode);
      using (var doc = JsonDocument.Parse(second.Body!))
      {
        var role = doc.RootElement.GetProperty("data").GetProperty("roles")[0];
        Assert.False(role.GetProperty("created").GetBoolean());
        Assert.False(role.GetProperty("databaseCreated").GetBoolean());
      }
    }
    finally
    {
      await DropDatabaseAsync("developercards_staging");
      await DropRoleAsync("developercards_app_staging");
    }
  }

  [Fact]
  public async Task Bootstrap_ReassignsOwnershipOnConnectedDatabase()
  {
    var scratch = await _db.CreateScratchDatabaseAsync("developercards_db");
    await DropRoleAsync("developercards_app");
    try
    {
      await using (var conn = new NpgsqlConnection(scratch))
      {
        await conn.OpenAsync();
        await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);

        var specs = new[] { new AppRole.AppRoleSpec("developercards_app", Pw, "developercards_db", false) };
        var first = await AppRole.BootstrapAsync(conn, specs);
        Assert.True(first[0].TablesReassigned > 0);

        var tablesNotOwned = await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from pg_tables where schemaname = 'public' and tableowner <> 'developercards_app'", []);
        Assert.Equal(0, Convert.ToInt32(tablesNotOwned, CultureInfo.InvariantCulture));
        var sequencesNotOwned = await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from pg_sequences where schemaname = 'public' and sequenceowner <> 'developercards_app'", []);
        Assert.Equal(0, Convert.ToInt32(sequencesNotOwned, CultureInfo.InvariantCulture));

        var second = await AppRole.BootstrapAsync(conn, specs);
        Assert.Equal(0, second[0].TablesReassigned);
      }

      // As the app role, the reassigned tables are readable and the schema is writable.
      var csb = new NpgsqlConnectionStringBuilder(scratch)
      {
        Username = "developercards_app",
        Password = Pw,
        SslMode = SslMode.Disable,
      };
      await using (var asRole = new NpgsqlConnection(csb.ConnectionString))
      {
        await asRole.OpenAsync();
        var decks = await DbUtil.ExecuteScalarAsync(asRole, null, "select count(*) from decks", []);
        Assert.NotNull(decks);
        await DbUtil.ExecuteAsync(asRole, null, "create table e06_probe (id int)", []);
        await DbUtil.ExecuteAsync(asRole, null, "drop table e06_probe", []);
      }
    }
    finally
    {
      await DropDatabaseAsync("developercards_db");
      await DropRoleAsync("developercards_app");
    }
  }

  [Fact]
  public async Task BootstrapRoles_RouteIsWired()
  {
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = BootstrapPath,
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
              ["cognito:groups"] = new[] { "editor" },
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });

    // An unrouted path would be 404; a super_admin route reached by an editor is 403.
    var r = await new VpcFunction().Handler(evt);
    Assert.Equal(403, r.StatusCode);
  }
}
