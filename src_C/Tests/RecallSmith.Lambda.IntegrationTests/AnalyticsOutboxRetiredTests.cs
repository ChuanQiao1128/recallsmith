using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R26 S01 (contract R26-00 §1): Snowflake and the analytics outbox are retired. The sync ingest
/// stops writing analytics_event_outbox, the export / import / content-intelligence routes are gone
/// (404), migration 045 drops the outbox and the content_intelligence_* tables, and account deletion
/// works on a database either side of 045.
///
/// The supervisor never runs 045 against a real database; the owner does. So the code must work
/// BEFORE 045 as well: the "before" cases run against a scratch database frozen at 044 (the outbox
/// table still exists), and the "after" cases run against the shared fixture, which has applied
/// every migration including 045.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AnalyticsOutboxRetiredTests
{
  private readonly PostgresFixture _db;
  public AnalyticsOutboxRetiredTests(PostgresFixture db) => _db = db;

  private const long OneDayMs = 24L * 60 * 60 * 1000;
  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-5).ToUnixTimeMilliseconds();

  private static readonly string[] RetiredTables =
  [
    "analytics_event_outbox",
    "content_intelligence_card_snapshot",
    "content_intelligence_import_runs",
  ];

  private static string NewUser(string tag) => $"it-r26s01-{tag}-{Guid.NewGuid():N}";

  private static string NewEventId() => Guid.NewGuid().ToString("D").ToLowerInvariant();

  private static object Batch(params string[] eventIds) => new
  {
    deviceId = "device-under-test",
    clientVersion = "1.2.3",
    clientPlatform = "ios",
    clientFeatures = new[] { "mcq" },
    updateId = "0b6c3f52-1c3f-4a3b-9c8e-7f0d2a1b4c5d",
    events = eventIds.Select((id, i) => (object)new
    {
      eventId = id,
      deckSlug = "it-r26s01-deck",
      stableUid = $"uid-{i}",
      rating = 3,
      eventTimeMs = Base + i,
      nextReviewAtMs = Base + i + OneDayMs,
      sessionId = "sess-r26s01",
      progressAfter = new { stage = 2 },
    }).ToList(),
  };

  private static async Task<long> CountAsync(NpgsqlConnection conn, string sql, params object?[] args) =>
    Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, sql, args), CultureInfo.InvariantCulture);

  private static async Task<bool> TableExistsAsync(NpgsqlConnection conn, string table) =>
    await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass($1) is not null", [table]) is true;

  /// <summary>A scratch database migrated through 044: the outbox and both content-intelligence tables exist.</summary>
  private async Task<string> Pre045DatabaseAsync(string name)
  {
    var cs = await _db.CreateScratchDatabaseAsync(name);
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 44);
    foreach (var table in RetiredTables) Assert.True(await TableExistsAsync(conn, table), $"premise: {table} exists before 045");
    return cs;
  }

  private static async Task<string> Migration045SqlAsync() =>
    await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "045_retire_content_intelligence.sql"));

  // ---------------------------------------------------------------- migration 045

  [Fact]
  public async Task Migration045_DropsTheOutboxAndContentIntelligenceTables_AndIsIdempotent()
  {
    var cs = await Pre045DatabaseAsync("r26s01_m045");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();

    var sql = await Migration045SqlAsync();
    Assert.Contains("set local lock_timeout = '5s'", sql, StringComparison.Ordinal);

    // Migrate.ApplyOne runs each file inside one transaction, so SET LOCAL has a scope; mirror that.
    for (var run = 0; run < 2; run++)
    {
      await using var tx = await conn.BeginTransactionAsync();
      await DbUtil.ExecuteAsync(conn, tx, sql, []);
      await tx.CommitAsync();
    }

    foreach (var table in RetiredTables) Assert.False(await TableExistsAsync(conn, table), $"{table} survived 045");
    // Nothing else went with them.
    Assert.True(await TableExistsAsync(conn, "user_progress_events"));
    Assert.True(await TableExistsAsync(conn, "user_progress"));
  }

  [Fact]
  public async Task SharedFixture_HasRunMigration045()
  {
    await using var conn = await _db.OpenAsync();
    foreach (var table in RetiredTables) Assert.False(await TableExistsAsync(conn, table), $"{table} exists after 045");
  }

  // ---------------------------------------------------------------- ingest

  [Fact]
  public async Task Ingest_BeforeMigration045_WritesNoOutboxRow_AndKeepsIdempotency()
  {
    var cs = await Pre045DatabaseAsync("r26s01_ingest");
    var prevDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", "r26s01_ingest");
    Pg.Reset();
    try
    {
      var user = NewUser("pre045");
      var ids = new[] { NewEventId(), NewEventId() };

      var data = await LambdaHost.PostProgressEventsAsync(user, Batch(ids));
      Assert.Equal(2, data.GetProperty("acceptedCount").GetInt32());

      var replay = await LambdaHost.PostProgressEventsAsync(user, Batch(ids));
      Assert.Equal(0, replay.GetProperty("acceptedCount").GetInt32());
      Assert.Equal(2, replay.GetProperty("duplicateEventIds").GetArrayLength());

      await using var conn = new NpgsqlConnection(cs);
      await conn.OpenAsync();
      Assert.Equal(0, await CountAsync(conn, "select count(*) from analytics_event_outbox"));
      Assert.Equal(2, await CountAsync(conn, "select count(*) from user_progress_events where user_sub = $1", user));
      Assert.Equal(2, await CountAsync(conn, "select coalesce(sum(review_count), 0) from user_progress where user_sub = $1", user));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", prevDb);
      Pg.Reset();
    }
  }

  [Fact]
  public async Task Ingest_AfterMigration045_StillSucceeds()
  {
    var user = NewUser("post045");
    var ids = new[] { NewEventId(), NewEventId(), NewEventId() };

    var data = await LambdaHost.PostProgressEventsAsync(user, Batch(ids));
    Assert.Equal(3, data.GetProperty("acceptedCount").GetInt32());

    await using var conn = await _db.OpenAsync();
    Assert.False(await TableExistsAsync(conn, "analytics_event_outbox"));
    Assert.Equal(3, await CountAsync(conn, "select count(*) from user_progress where user_sub = $1", user));
  }

  // ---------------------------------------------------------------- routes

  private static JsonElement Event(string method, string path, string? sub = null, string[]? groups = null) => JsonSerializer.SerializeToElement(new
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
            ["sub"] = sub ?? NewUser("admin"),
            ["cognito:groups"] = groups ?? new[] { "super_admin" },
          },
        },
      },
    },
    headers = new Dictionary<string, string>(),
    queryStringParameters = new Dictionary<string, string>(),
    body = (string?)null,
    isBase64Encoded = false,
  });

  [Theory]
  [InlineData("POST", "/api/v1/admin/analytics/outbox/publish")]
  [InlineData("POST", "/api/v1/admin/analytics/content-intelligence/import")]
  [InlineData("POST", "/api/v1/admin/db/content-intelligence-demo")]
  [InlineData("GET", "/api/v1/authoring/content-intelligence")]
  public async Task RetiredRoutes_Are404_ForASuperAdmin(string method, string path)
  {
    // A configured MIGRATE_SECRET with no header keeps the old demo route (on the base) from ever
    // running its seed script against the shared database: it would stop at 403.
    var prev = Environment.GetEnvironmentVariable("MIGRATE_SECRET");
    Environment.SetEnvironmentVariable("MIGRATE_SECRET", "test-migrate-secret");
    try
    {
      var resp = await new VpcFunction().Handler(Event(method, path));
      Assert.Equal(404, resp.StatusCode);
    }
    finally
    {
      Environment.SetEnvironmentVariable("MIGRATE_SECRET", prev);
    }
  }

  [Theory]
  [InlineData("/api/v1/admin/analytics/outbox/publish")]
  [InlineData("/api/v1/admin/analytics/content-intelligence/import")]
  [InlineData("/api/v1/admin/db/content-intelligence-demo")]
  [InlineData("/api/v1/authoring/content-intelligence")]
  [InlineData("/internal/outbox/publish")]
  [InlineData("/internal/content-intelligence/import")]
  public void RetiredRoutes_HaveNoMetricLabel(string path)
  {
    Assert.Equal(RouteMetrics.UnmatchedRoute, RouteMetrics.RouteFor(path));
  }

  // ---------------------------------------------------------------- account deletion

  [Fact]
  public async Task AccountDeletion_BeforeMigration045_StillDeletesTheCallersOutboxRows()
  {
    var cs = await Pre045DatabaseAsync("r26s01_delete");
    await using var conn = new NpgsqlConnection(cs);
    await conn.OpenAsync();

    var sub = NewUser("del-pre");
    var other = NewUser("del-other");
    var mine = Guid.NewGuid();
    var theirs = Guid.NewGuid();
    foreach (var (s, e) in new[] { (sub, mine), (other, theirs) })
    {
      await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [s]);
      await DbUtil.ExecuteAsync(conn, null,
        "insert into user_progress_events (event_id, user_sub, deck_slug, stable_uid, event_time) values ($1, $2, 'd', 'u', now())", [e, s]);
      await DbUtil.ExecuteAsync(conn, null,
        "insert into analytics_event_outbox (event_id, event_type, aggregate_type, aggregate_id, payload) values ($1, 'card_reviewed', 'card', 'd:u', '{}'::jsonb)", [e]);
    }

    var r = await AccountDeletion.DeleteUserDataAsync(conn, sub);

    Assert.Equal(1, r.OutboxRows);
    Assert.Equal(1, r.UserRows);
    Assert.Equal(0, await CountAsync(conn, "select count(*) from analytics_event_outbox where event_id = $1", mine));
    Assert.Equal(1, await CountAsync(conn, "select count(*) from analytics_event_outbox where event_id = $1", theirs));
    Assert.Equal(0, await CountAsync(conn, "select count(*) from users where user_sub = $1", sub));
  }

  [Fact]
  public async Task AccountDeletion_AfterMigration045_TreatsTheMissingOutboxAsZeroRows()
  {
    await using var conn = await _db.OpenAsync();
    Assert.False(await TableExistsAsync(conn, "analytics_event_outbox"));

    var sub = NewUser("del-post");
    await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_progress_events (event_id, user_sub, deck_slug, stable_uid, event_time) values ($1, $2, 'd', 'u', now())", [Guid.NewGuid(), sub]);

    var r = await AccountDeletion.DeleteUserDataAsync(conn, sub);

    Assert.Equal(0, r.OutboxRows);
    Assert.Equal(1, r.UserRows);
    Assert.Equal(0, await CountAsync(conn, "select count(*) from user_progress_events where user_sub = $1", sub));
  }

  [Fact]
  public async Task AccountDeletion_OutboxDroppedAfterTheCheck_CountsZero_AndTheDeletionStillCommits()
  {
    // R26X F01 (s-tests-1): 045 can commit between the to_regclass check and the delete. Model that moment on the
    // post-045 database: the outbox delete runs as if the check had said "present", inside the deletion's transaction.
    await using var conn = await _db.OpenAsync();
    Assert.False(await TableExistsAsync(conn, "analytics_event_outbox"));

    var sub = NewUser("del-race");
    await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [sub]);

    await using (var tx = await conn.BeginTransactionAsync())
    {
      Assert.Equal(0, await AccountDeletion.DeleteOutboxRowsAsync(conn, tx, sub));
      // The transaction is not aborted: the rest of the deletion runs and commits.
      Assert.Equal(1, await DbUtil.ExecuteAsync(conn, tx, "delete from users where user_sub = $1", [sub]));
      await tx.CommitAsync();
    }

    Assert.Equal(0, await CountAsync(conn, "select count(*) from users where user_sub = $1", sub));
  }

  [Theory]
  [InlineData("/api/v1/me")]
  [InlineData("/api/v1/user/me")]
  public async Task DeleteMeRoute_BeforeMigration045_Is204_AndDeletesTheCallersOutboxRows(string path)
  {
    // R26X F01 (s-tests-2): the route itself, through VpcFunction.Handler, on a database frozen at 044.
    var name = path.EndsWith("/user/me", StringComparison.Ordinal) ? "r26xf01_delroute_user" : "r26xf01_delroute_me";
    var cs = await Pre045DatabaseAsync(name);
    var sub = NewUser("route-pre");
    var other = NewUser("route-other");
    var mine = Guid.NewGuid();
    var theirs = Guid.NewGuid();
    await using (var conn = new NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      foreach (var (s, e) in new[] { (sub, mine), (other, theirs) })
      {
        await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [s]);
        await DbUtil.ExecuteAsync(conn, null,
          "insert into user_progress_events (event_id, user_sub, deck_slug, stable_uid, event_time) values ($1, $2, 'd', 'u', now())", [e, s]);
        await DbUtil.ExecuteAsync(conn, null,
          "insert into analytics_event_outbox (event_id, event_type, aggregate_type, aggregate_id, payload) values ($1, 'card_reviewed', 'card', 'd:u', '{}'::jsonb)", [e]);
      }
    }

    var prevDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", name);
    Pg.Reset();
    RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    try
    {
      var resp = await new VpcFunction().Handler(Event("DELETE", path, sub, groups: []));
      Assert.Equal(204, resp.StatusCode);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", prevDb);
      Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }

    await using (var conn = new NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      Assert.Equal(0, await CountAsync(conn, "select count(*) from analytics_event_outbox where event_id = $1", mine));
      Assert.Equal(1, await CountAsync(conn, "select count(*) from analytics_event_outbox where event_id = $1", theirs));
      Assert.Equal(0, await CountAsync(conn, "select count(*) from users where user_sub = $1", sub));
      Assert.Equal(1, await CountAsync(conn, "select count(*) from users where user_sub = $1", other));
    }
  }
}
