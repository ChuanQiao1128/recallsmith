using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Worker;
using Migrate = RecallSmith.Lambda.Vpc.Db.Migrate;
using VpcPg = RecallSmith.Lambda.Vpc.Db.Pg;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R29 HARDEN, enterprise audit SPC-01: every application connection runs with a server-side
/// <c>statement_timeout</c> and <c>idle_in_transaction_session_timeout</c> (<see cref="PgSessionTimeouts"/>), sent as
/// startup options, so a slow query on the app path is cancelled by Postgres itself; the worker and the migration
/// runner keep their long work. The witnesses are the server's: <c>show</c>, the SQLSTATE Postgres raised
/// (57014 query_canceled) and <c>pg_stat_activity</c>. The shipped values are asserted as such; the cancellation cases
/// shorten the app profile to about a second so the suite does not sleep for 20.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DbSessionTimeoutsTests
{
  private readonly PostgresFixture _db;
  public DbSessionTimeoutsTests(PostgresFixture db) => _db = db;

  private const string QueryCanceled = "57014";

  /// <summary>Sets the profile both pools build with, and puts the shipped one back on dispose.</summary>
  private sealed class Profile : IDisposable
  {
    public Profile(PgSessionTimeouts timeouts)
    {
      PgSessionTimeouts.Current = timeouts;
      Pg.Reset();
      VpcPg.Reset();
    }

    public void Dispose()
    {
      PgSessionTimeouts.Current = PgSessionTimeouts.Api;
      Pg.Reset();
      VpcPg.Reset();
    }
  }

  private static async Task<string?> ShowAsync(NpgsqlConnection conn, string setting) =>
    await DbUtil.ExecuteScalarAsync(conn, null, $"show {setting}", []) as string;

  private static async Task<NpgsqlConnection> AppConnectionAsync() =>
    (await Pg.OpenConnectionOrNullAsync())!;

  [Fact]
  public void ShippedProfiles_AreTheMeasuredValues()
  {
    Assert.Equal(new PgSessionTimeouts(20_000, 60_000), PgSessionTimeouts.Api);
    Assert.Equal(new PgSessionTimeouts(600_000, 600_000), PgSessionTimeouts.Worker);
    Assert.Equal("-c statement_timeout=20000 -c idle_in_transaction_session_timeout=60000", PgSessionTimeouts.Api.ConnectionOptions);
    Assert.Equal("-c statement_timeout=600000 -c idle_in_transaction_session_timeout=600000", PgSessionTimeouts.Worker.ConnectionOptions);
  }

  [Fact]
  public async Task AppPools_StartEveryConnectionWithTheApiLimits()
  {
    using var _ = new Profile(PgSessionTimeouts.Api);

    await using (var conn = await AppConnectionAsync())
    {
      Assert.Equal("20s", await ShowAsync(conn, "statement_timeout"));
      Assert.Equal("1min", await ShowAsync(conn, "idle_in_transaction_session_timeout"));
    }

    // The pool the migration runner and the admin db routes use (Vpc.Db.Pg) carries the same limits.
    await using (var conn = (await VpcPg.OpenConnectionOrNullAsync())!)
    {
      Assert.Equal("20s", await ShowAsync(conn, "statement_timeout"));
      Assert.Equal("1min", await ShowAsync(conn, "idle_in_transaction_session_timeout"));
    }
  }

  [Fact]
  public async Task AppPath_SlowQuery_IsCancelledByTheServer()
  {
    using var _ = new Profile(new PgSessionTimeouts(1_000, 60_000));
    await using var conn = await AppConnectionAsync();

    var clock = Stopwatch.StartNew();
    var ex = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteScalarAsync(conn, null, "select pg_sleep(5)", []));
    clock.Stop();

    Assert.Equal(QueryCanceled, ex.SqlState);
    Assert.Contains("statement timeout", ex.MessageText, StringComparison.Ordinal);
    Assert.True(clock.Elapsed < TimeSpan.FromSeconds(4), $"took {clock.Elapsed}");

    // The connection is still usable afterwards: a cancelled statement is not a broken session.
    Assert.Equal(1, Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, null, "select 1", []), CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task AppPath_HandlerBlockedBehindALock_AnswersWithinTheLimitInsteadOfWaiting()
  {
    // A real handler on the app path (GET /api/v1/entitlements) whose query waits on a lock another session holds
    // and never releases while the request runs: the server cancels the wait, so the request fails in about the limit.
    using var _ = new Profile(new PgSessionTimeouts(1_000, 60_000));
    await using var holder = await _db.OpenAsync(); // the fixture's own connection string: no limits
    await using var tx = await holder.BeginTransactionAsync();
    await DbUtil.ExecuteAsync(holder, tx, "lock table user_entitlements in access exclusive mode", []);

    var auth = new AuthContext(
      Claims: new Dictionary<string, JsonElement>(StringComparer.Ordinal),
      UserSub: $"it-spc01-{Guid.NewGuid():N}",
      Username: null,
      Groups: [],
      IsSuperAdmin: false,
      IsEditor: false,
      IsAdmin: false);

    var clock = Stopwatch.StartNew();
    var ex = await Assert.ThrowsAsync<PostgresException>(() => AutomationTestKit.CallAsync(
      RecallSmith.Lambda.Vpc.Runtime.Entitlements.HandleEntitlements, "GET", "/api/v1/entitlements", null, auth));
    clock.Stop();

    Assert.Equal(QueryCanceled, ex.SqlState);
    Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), $"took {clock.Elapsed}");
    await tx.RollbackAsync();
  }

  [Fact]
  public async Task AppPath_IdleTransaction_IsEndedByTheServer()
  {
    using var _ = new Profile(new PgSessionTimeouts(20_000, 1_000));
    await using var conn = await AppConnectionAsync();
    await using var tx = await conn.BeginTransactionAsync();
    var pid = Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, tx, "select pg_backend_pid()", []), CultureInfo.InvariantCulture);

    // Postgres ends the session itself (FATAL 25P03): nothing on the client side has to be alive for that.
    var gone = false;
    for (var i = 0; i < 50 && !gone; i++)
    {
      await Task.Delay(200);
      gone = await _db.ScalarAsync("select count(*) from pg_stat_activity where pid = $1", pid) is long n && n == 0;
    }
    Assert.True(gone, "the idle-in-transaction session was still there after 10 s");
    await Assert.ThrowsAnyAsync<NpgsqlException>(() => DbUtil.ExecuteScalarAsync(conn, tx, "select 1", []));
  }

  [Fact]
  public async Task PooledConnection_ComesBackWithItsLimits_AfterASessionLevelSet()
  {
    // Npgsql resets a pooled connection (RESET ALL) before reuse; RESET returns to the startup options, not to the
    // server default, so a session-level SET by one request cannot lift the limits for the next.
    using var _ = new Profile(new PgSessionTimeouts(1_500, 60_000));

    int pid;
    await using (var conn = await AppConnectionAsync())
    {
      pid = Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, null, "select pg_backend_pid()", []), CultureInfo.InvariantCulture);
      await DbUtil.ExecuteAsync(conn, null, "set statement_timeout = 0", []);
      Assert.Equal("0", await ShowAsync(conn, "statement_timeout"));
    }

    await using (var again = await AppConnectionAsync())
    {
      Assert.Equal(pid, Convert.ToInt32(await DbUtil.ExecuteScalarAsync(again, null, "select pg_backend_pid()", []), CultureInfo.InvariantCulture));
      Assert.Equal("1500ms", await ShowAsync(again, "statement_timeout"));
    }
  }

  [Fact]
  public async Task Worker_UsesItsOwnLimits_AndKeepsAStatementTheAppPathWouldCancel()
  {
    using var _ = new Profile(new PgSessionTimeouts(1_000, 60_000));

    await using (var app = await AppConnectionAsync())
    {
      var ex = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteScalarAsync(app, null, "select pg_sleep(2)", []));
      Assert.Equal(QueryCanceled, ex.SqlState);
    }

    // The Lambda entry point names the worker profile before any connection (WorkerFunction's runtime constructor).
    var entryPoint = new WorkerFunction();
    Assert.NotNull(entryPoint);
    Assert.Same(PgSessionTimeouts.Worker, PgSessionTimeouts.Current);
    Pg.Reset();

    await using var worker = await AppConnectionAsync();
    Assert.Equal("10min", await ShowAsync(worker, "statement_timeout"));
    Assert.Equal("10min", await ShowAsync(worker, "idle_in_transaction_session_timeout"));
    await DbUtil.ExecuteScalarAsync(worker, null, "select pg_sleep(2)", []);
  }

  [Fact]
  public async Task MigrationRunner_LiftsTheLimitsInsideTheMigration_Only()
  {
    const string name = "it_spc01_migrate";
    var dir = Path.Combine(Path.GetTempPath(), $"it-spc01-migrations-{Guid.NewGuid():N}");
    Migrate.MigrationsDirOverride.Value = dir;
    string[] envNames = ["PGDATABASE", "API_ENV", "MIGRATE_SECRET"];
    var saved = envNames.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    try
    {
      // Both limits at one second on every app connection (this pool included); the migration's own statement
      // sleeps for two and must still be applied.
      using var _ = new Profile(new PgSessionTimeouts(1_000, 1_000));
      var cs = new NpgsqlConnectionStringBuilder(await _db.CreateScratchDatabaseAsync(name)) { Pooling = false }.ConnectionString;
      Directory.CreateDirectory(dir);
      await File.WriteAllTextAsync(Path.Combine(dir, "001_it_spc01_slow.sql"),
        "-- synthetic slow migration (SPC-01)\nselect pg_sleep(2);\ncreate table it_spc01_slow (id int);\n");
      Environment.SetEnvironmentVariable("PGDATABASE", name);
      Environment.SetEnvironmentVariable("API_ENV", null);
      Environment.SetEnvironmentVariable("MIGRATE_SECRET", null);
      Pg.Reset();
      VpcPg.Reset();

      var response = await AutomationTestKit.CallAsync(Migrate.HandleDbMigrate, "POST", "/api/v1/admin/db/migrate", null,
        AutomationTestKit.Ctx(AutomationTestKit.Sub("spc01-sa"), agent: false));
      var data = AutomationTestKit.Data(response);
      Assert.Equal(1, data.GetProperty("appliedCount").GetInt32());

      await using (var check = new NpgsqlConnection(cs))
      {
        await check.OpenAsync();
        Assert.True(await DbUtil.ExecuteScalarAsync(check, null, "select to_regclass('it_spc01_slow') is not null", []) is true);
        Assert.Equal(1L, AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(check, null,
          "select count(*) from schema_migrations where version = 1", [])));
      }

      // The lift was `set local`: the runner's pool is back at its limits, and the same sleep outside a migration fails.
      await using var after = (await VpcPg.OpenConnectionOrNullAsync())!;
      Assert.Equal("1s", await ShowAsync(after, "statement_timeout"));
      var ex = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteScalarAsync(after, null, "select pg_sleep(2)", []));
      Assert.Equal(QueryCanceled, ex.SqlState);
    }
    finally
    {
      Migrate.MigrationsDirOverride.Value = null;
      foreach (var (envName, value) in saved) Environment.SetEnvironmentVariable(envName, value);
      Pg.Reset();
      VpcPg.Reset();
      try { Directory.Delete(dir, recursive: true); } catch (IOException) { /* temp folder */ }
    }
  }
}
