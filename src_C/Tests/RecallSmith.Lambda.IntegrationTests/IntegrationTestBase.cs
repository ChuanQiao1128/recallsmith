using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using Testcontainers.PostgreSql;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// One real Postgres for the whole suite.
///
/// WHY a live database and not another pure-function replica: the ingest's
/// hardest rules are not written in C# at all. The distinct-on tiebreak, the
/// four-column same-predicate LWW group and the migration 015 backfill are SQL,
/// and SQL is only as true as the planner that runs it. `distinct on` in
/// particular returns an UNSPECIFIED row among ties, so a rule about ties is a
/// claim about execution, not about text, and no in-process fake can settle it.
///
/// Shared as a collection fixture because starting Postgres costs seconds and
/// the tests cost milliseconds. Isolation is by user_sub, not by container:
/// every table that the ingest touches is keyed by it, and every test mints a
/// fresh one, so the suite is rerunnable against a container that is already
/// dirty.
/// </summary>
public sealed class PostgresFixture : Xunit.IAsyncLifetime
{
  // Pinned, not floating. A suite whose entire purpose is to observe what a
  // real planner does must not quietly change planners between runs.
  private const string Image = "postgres:16-alpine";
  private const string Db = "recallsmith";
  private const string User = "recallsmith";
  private const string Password = "recallsmith";

  private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
    .WithImage(Image)
    .WithDatabase(Db)
    .WithUsername(User)
    .WithPassword(Password)
    .Build();

  public string ConnectionString { get; private set; } = string.Empty;

  public async Task InitializeAsync()
  {
    await _container.StartAsync();
    ConnectionString = _container.GetConnectionString();

    await using (var conn = await OpenAsync())
    {
      await ApplyMigrationsAsync(conn, int.MaxValue);
    }

    // Pg builds its NpgsqlDataSource once and caches it in a static field, so
    // the env vars have to be in place BEFORE the reset, never after.
    Environment.SetEnvironmentVariable("PGHOST", _container.Hostname);
    Environment.SetEnvironmentVariable("PGPORT", _container.GetMappedPublicPort(5432).ToString(CultureInfo.InvariantCulture));
    Environment.SetEnvironmentVariable("PGDATABASE", Db);
    Environment.SetEnvironmentVariable("PGUSER", User);
    Environment.SetEnvironmentVariable("PGPASSWORD", Password);
    // The container speaks plaintext; Pg defaults to SslMode.Require.
    Environment.SetEnvironmentVariable("PGSSLMODE", "disable");
    // Production runs PG_MAX=1 because a Lambda container serves one request at
    // a time, so one pooled connection is exactly right there. In-process that
    // default would silently defeat the concurrency tests: two handler calls
    // racing for the same brand-new user would queue on Npgsql's pool and reach
    // Postgres one after the other, and the test would "pass" without the race
    // ever happening. Raising it here models what production actually does with
    // concurrency -- runs N containers, therefore N independent connections.
    Environment.SetEnvironmentVariable("PG_MAX", "8");
    Pg.Reset();
  }

  public async Task DisposeAsync()
  {
    Pg.Reset();
    await _container.DisposeAsync();
  }

  public async Task<NpgsqlConnection> OpenAsync()
  {
    var conn = new NpgsqlConnection(ConnectionString);
    await conn.OpenAsync();
    return conn;
  }

  public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params object?[] parameters)
  {
    await using var conn = await OpenAsync();
    return await DbUtil.QueryAsync(conn, null, sql, parameters);
  }

  public async Task<object?> ScalarAsync(string sql, params object?[] parameters)
  {
    await using var conn = await OpenAsync();
    return await DbUtil.ExecuteScalarAsync(conn, null, sql, parameters);
  }

  /// <summary>
  /// The server's own view of what it was asked to run.
  ///
  /// Round trips are the thing issue #5 is about, and no client-side assertion
  /// can settle how many of them there were: the handler could open a
  /// transaction, or split one statement into two, and every state assertion in
  /// this suite would still pass. Postgres writing down each statement it
  /// executes is the only witness that is not the code under test.
  /// </summary>
  public Task<(string Stdout, string Stderr)> ContainerLogsAsync(DateTime sinceUtc) =>
    _container.GetLogsAsync(sinceUtc, default, timestampsEnabled: false);

  /// <summary>
  /// A second database inside the same container, for tests that need a schema
  /// frozen at an older version. Same container so there is no second image
  /// pull, and a separate database so the shared one keeps its full schema and
  /// the process-wide PG env vars never have to move.
  /// </summary>
  public async Task<string> CreateScratchDatabaseAsync(string name)
  {
    await using (var conn = await OpenAsync())
    {
      // CREATE DATABASE cannot run inside a transaction block, hence null tx.
      await DbUtil.ExecuteAsync(conn, null, $"drop database if exists {name} with (force);", []);
      await DbUtil.ExecuteAsync(conn, null, $"create database {name};", []);
    }

    return new NpgsqlConnectionStringBuilder(ConnectionString) { Database = name }.ConnectionString;
  }

  /// <summary>
  /// Applies Db/Migrations in filename order, stopping after maxVersion.
  /// Deliberately goes through DbUtil.ExecuteAsync, the same path Migrate.cs
  /// uses in production, so the $-rewriting in SqlUtil.ToNpgsql is exercised on
  /// the real migration text rather than bypassed by a tidier test runner.
  /// </summary>
  public static async Task ApplyMigrationsAsync(NpgsqlConnection conn, int maxVersion)
  {
    var dir = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations");
    var files = Directory
      .EnumerateFiles(dir, "*.sql", SearchOption.TopDirectoryOnly)
      .Select(f => Path.GetFileName(f)!)
      .Where(f => Regex.IsMatch(f, "^\\d+_.+\\.sql$"))
      .OrderBy(f => f, StringComparer.Ordinal)
      .ToList();

    Assert.NotEmpty(files);

    foreach (var file in files)
    {
      var version = int.Parse(file.Split('_')[0], CultureInfo.InvariantCulture);
      if (version > maxVersion) continue;
      var sql = await File.ReadAllTextAsync(Path.Combine(dir, file));
      await DbUtil.ExecuteAsync(conn, null, sql, []);
    }
  }
}

[CollectionDefinition(PostgresCollection.Name)]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
  // Every real-database class joins this one collection, which xunit runs
  // serially. That matters: Pg's data source is static process state, so two
  // classes reconfiguring it in parallel would be racing over one global.
  public const string Name = "postgres";
}

/// <summary>
/// Calls the Lambda handlers the way API Gateway does: a raw event JSON in, an
/// APIGatewayProxyResponse out. Nothing here reimplements handler logic, so a
/// test that passes here is a statement about the deployed path.
/// </summary>
public static class LambdaHost
{
  public static Task<JsonElement> PostProgressEventsAsync(string userSub, object body) =>
    InvokeAsync(
      userSub,
      "POST",
      "/api/progress/events",
      query: null,
      body: JsonSerializer.Serialize(body),
      handler: RecallSmith.Lambda.Vpc.Runtime.ProgressEvents.HandleProgressEvents);

  public static Task<JsonElement> PostDrawStateSyncAsync(string userSub, object body) =>
    InvokeAsync(
      userSub,
      "POST",
      "/api/v1/draw-state/sync",
      query: null,
      body: JsonSerializer.Serialize(body),
      handler: RecallSmith.Lambda.Vpc.Runtime.DrawStateSync.HandleDrawStateSync);

  public static Task<JsonElement> GetProgressAsync(string userSub, IDictionary<string, string>? query = null) =>
    InvokeAsync(
      userSub,
      "GET",
      "/api/progress",
      query: query,
      body: null,
      handler: RecallSmith.Lambda.Vpc.Runtime.ProgressGet.HandleProgressGet);

  private static async Task<JsonElement> InvokeAsync(
    string userSub,
    string method,
    string path,
    IDictionary<string, string>? query,
    string? body,
    Func<LambdaRequest, Res, AuthContext, Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse>> handler)
  {
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });

    var req = new LambdaRequest(evt);
    var res = new Res(req.TraceId);
    var auth = new AuthContext(
      Claims: new Dictionary<string, JsonElement>(StringComparer.Ordinal),
      UserSub: userSub,
      Username: userSub,
      Groups: [],
      IsSuperAdmin: false,
      IsEditor: false,
      IsAdmin: false);

    var response = await handler(req, res, auth);

    // Clone: the JsonDocument is disposed on return, and a JsonElement into a
    // disposed document throws on first read instead of at the assertion.
    using var doc = JsonDocument.Parse(response.Body ?? "{}");
    var root = doc.RootElement.Clone();

    Assert.True(
      response.StatusCode == 200,
      $"{method} {path} returned {response.StatusCode}: {response.Body}");

    return root.GetProperty("data");
  }
}
