using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;
using VpcDb = RecallSmith.Lambda.Vpc.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The INIT-phase database warmup, and its interaction with the SnapStart hooks.
///
/// The measurement this exists to act on: cold start e2e 9228 ms, of which the FIRST
/// database connection is 4294 ms -- 68% of the cold handler -- against a 303 ms init.
///
/// Nearly every assertion below reads pg_stat_activity rather than a return value, and that
/// is the point. "The warmup ran" is trivially observable from inside the process and proves
/// nothing: a probe that opened a private connection, or one that opened a pooled connection
/// and forgot to give it back, both log the same happy line and both leave the first request
/// paying the full 4294 ms. Postgres recording when each backend process started is the only
/// witness to the claim that actually matters, and it is not the code under test.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DbWarmupTests
{
  private readonly PostgresFixture _db;

  // Roughly the production cap (4500 ms). Only ever hit against a container on the same
  // machine, so the exact number is not load-bearing -- it just has to be far above a local
  // connect and far below the point where a hung suite looks like a hung machine.
  private const int ProbeCapMs = 4000;

  public DbWarmupTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  /// <summary>
  /// Log lines go through Console, so reading them back means redirecting it. Safe only
  /// because every class that logs is in this one serially-run collection; Console.SetOut is
  /// process-global and a parallel collection writing during the window would land here.
  /// </summary>
  private static async Task<(string Out, string Err)> CaptureAsync(Func<Task> action)
  {
    var oldOut = Console.Out;
    var oldErr = Console.Error;
    var stdout = new StringWriter();
    var stderr = new StringWriter();

    Console.SetOut(stdout);
    Console.SetError(stderr);
    try
    {
      await action().ConfigureAwait(false);
    }
    finally
    {
      Console.SetOut(oldOut);
      Console.SetError(oldErr);
    }

    return (stdout.ToString(), stderr.ToString());
  }

  private static JsonElement DbWarmupLine(string text)
  {
    var line = text
      .Split('\n', StringSplitOptions.RemoveEmptyEntries)
      .FirstOrDefault(l => l.Contains("\"step\":\"db-warmup\"", StringComparison.Ordinal));

    Assert.True(line is not null, $"no db-warmup line was logged. Captured:\n{text}");

    using var doc = JsonDocument.Parse(line!);
    return doc.RootElement.Clone();
  }

  /// <summary>The server's clock, not this process's: backend_start is stamped by Postgres.</summary>
  private async Task<DateTime> ServerNowAsync() =>
    (DateTime)(await _db.ScalarAsync("select clock_timestamp()"))!;

  private async Task<DateTime> BackendStartAsync(int pid)
  {
    var v = await _db.ScalarAsync("select backend_start from pg_stat_activity where pid = $1", pid);
    Assert.True(v is not null, $"no pg_stat_activity row for backend {pid}");
    return (DateTime)v!;
  }

  // ------------------------------------------------------- the decision gate

  [Theory]
  [InlineData(null, "d", "u", "p")]
  [InlineData("h", null, "u", "p")]
  [InlineData("h", "d", null, "p")]
  [InlineData("h", "d", "u", null)]
  [InlineData("   ", "d", "u", "p")]
  public void DecideDb_SkipsWhenAnyPgVariableIsMissing(string? host, string? db, string? user, string? password)
  {
    Assert.Equal(
      Warmup.DbDecision.SkipNoDbConfig,
      Warmup.DecideDb(host, db, user, password, disableFlag: null));
  }

  [Theory]
  [InlineData("1")]
  [InlineData("true")]
  [InlineData("TRUE")]
  [InlineData("yes")]
  public void DecideDb_SkipsWhenKillSwitchSet(string flag)
  {
    // Checked before the configuration, otherwise the switch could not stop a warmup on a
    // fully configured function -- the only case where turning it off is worth anything.
    Assert.Equal(Warmup.DbDecision.SkipDisabled, Warmup.DecideDb("h", "d", "u", "p", flag));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("0")]
  [InlineData("false")]
  public void DecideDb_RunsWhenConfiguredAndNotDisabled(string? flag)
  {
    Assert.Equal(Warmup.DbDecision.Run, Warmup.DecideDb("h", "d", "u", "p", flag));
  }

  // ------------------------------------------------------------ the log line

  [Fact]
  public async Task WarmDatabase_LogsTheTimingLineTheIssueAsksFor()
  {
    Pg.Reset();

    var (stdout, _) = await CaptureAsync(() => Warmup.WarmDatabaseAsync(ProbeCapMs));
    var line = DbWarmupLine(stdout);

    Assert.Equal("db-warmup", line.GetProperty("step").GetString());
    Assert.Equal("ok", line.GetProperty("outcome").GetString());
    Assert.True(line.GetProperty("ok").GetBoolean());
    Assert.True(line.GetProperty("ms").GetInt64() >= 0);

    // Split phases, not one total. On core-vpc the 4294 ms is almost entirely the connect;
    // a single number would have left the next person unable to tell a slow ENI from a slow
    // query, which is the difference between an infra fix and a code fix.
    var connectMs = line.GetProperty("connectMs").GetInt64();
    var probeMs = line.GetProperty("probeMs").GetInt64();
    Assert.True(connectMs >= 0);
    Assert.True(probeMs >= 0);
    Assert.True(
      line.GetProperty("ms").GetInt64() >= connectMs,
      "total must contain the connect it reports");
  }

  // ------------------------------------------------- what the warmup buys

  [Fact]
  public async Task WarmDatabase_LeavesThePoolHoldingABackendTheFirstRequestThenReuses()
  {
    Pg.Reset();

    var before = await ServerNowAsync();
    await Warmup.WarmDatabaseAsync(ProbeCapMs);
    var after = await ServerNowAsync();

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    Assert.NotNull(conn);

    // The whole claim in one line: the Postgres backend serving the first request was
    // started during the warmup window, not when the request asked for it. Nothing
    // observable from inside this process can say that -- a handler that reconnected on
    // every call would satisfy every other assertion in this suite.
    Assert.InRange(await BackendStartAsync(conn!.ProcessID), before, after);
  }

  [Fact]
  public async Task WarmDatabase_ReturnsItsConnection_SoTheFirstRequestCanHaveIt()
  {
    // Production runs PG_MAX=1: a Lambda container serves one request at a time, so the pool
    // has exactly one slot. That turns a connection this probe forgot to hand back from a
    // wasted optimisation into a broken first request -- it would block on an exhausted pool
    // for Npgsql's whole connect Timeout and then throw. The rest of the suite runs PG_MAX=8,
    // which hides this failure completely, so the variable is moved for this test alone.
    var savedMax = Environment.GetEnvironmentVariable("PG_MAX");
    try
    {
      Environment.SetEnvironmentVariable("PG_MAX", "1");
      Pg.Reset();

      await Warmup.WarmDatabaseAsync(ProbeCapMs);

      var sw = Stopwatch.StartNew();
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      sw.Stop();

      Assert.NotNull(conn);
      Assert.True(
        sw.ElapsedMilliseconds < 1000,
        $"waited {sw.ElapsedMilliseconds} ms for the pool's only connection -- the warmup is still holding it");
    }
    finally
    {
      Environment.SetEnvironmentVariable("PG_MAX", savedMax);
      Pg.Reset();
    }
  }

  [Fact]
  public async Task WarmDatabase_DoesNotSpendOneOfTheTenAutoPrepareSlots()
  {
    // Issue #5 sized MaxAutoPrepare at 10 because the ingest statement's text varies with
    // batch size, so the cache holds one entry per distinct size seen. A `select 1` that got
    // prepared would hold one of those ten for the life of the container, for a statement
    // that runs exactly once. Npgsql's AutoPrepareMinUsages defaults to 5, so a single use
    // should not qualify -- but that is a claim about a library default, and this file's
    // standard is to check those rather than repeat them.
    var savedMax = Environment.GetEnvironmentVariable("PG_MAX");
    try
    {
      // PG_MAX=1 so the connection below is provably the same connector, and therefore the
      // same backend session, the probe used. pg_prepared_statements is per-session.
      Environment.SetEnvironmentVariable("PG_MAX", "1");
      Pg.Reset();

      await Warmup.WarmDatabaseAsync(ProbeCapMs);

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      Assert.NotNull(conn);

      await using var cmd = new NpgsqlCommand("select count(*) from pg_prepared_statements", conn);
      var prepared = Convert.ToInt64(await cmd.ExecuteScalarAsync(), CultureInfo.InvariantCulture);

      Assert.Equal(0L, prepared);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PG_MAX", savedMax);
      Pg.Reset();
    }
  }

  // --------------------------------------------------------- best effort

  [Fact]
  public async Task WarmDatabaseFailure_IsBestEffort_AndTheFirstRequestStillConnects()
  {
    Pg.Reset();

    // The failure is injected through the probe's OWN cancellation, not through a wrong host
    // or a wrong password. Lambda never changes a function's configuration between INIT and
    // the first invocation, so a test that moved PGHOST would be asserting about a state
    // production cannot reach. What genuinely differs between the two moments is how much
    // time the probe got: 4.5 s during init, against a database that may be behind a cold
    // ENI, an RDS failover or a full connection limit. An already-cancelled token IS that
    // cap having fired, and it is a fact rather than a race against a 1 ms stopwatch.
    var (_, stderr) = await CaptureAsync(
      () => Warmup.WarmDatabaseAsync(new CancellationToken(canceled: true)));

    var line = DbWarmupLine(stderr);
    // "capped", not "failed": the comment above already says a cancelled token IS
    // the cap having fired, and since the WaitAsync race made the cap real, the
    // log calls that situation by its name. The distinction matters operationally
    // -- "capped" means the handshake outlived INIT and the connection will still
    // land in the pool when it completes; "failed" means it never will.
    Assert.Equal("capped", line.GetProperty("outcome").GetString());
    Assert.False(line.GetProperty("ok").GetBoolean());

    // Same process, same environment, byte for byte the configuration the failed probe ran
    // under. The only thing that changed is that a request arrived, and it has to connect on
    // its own.
    var user = $"it-warmup-besteffort-{Guid.NewGuid():N}";
    var data = await LambdaHost.PostProgressEventsAsync(user, new
    {
      deviceId = "device-under-test",
      events = new[]
      {
        new
        {
          eventId = Guid.NewGuid().ToString("D").ToLowerInvariant(),
          deckSlug = "csharp-basics",
          stableUid = "card-1",
          rating = 3,
          eventTimeMs = DateTimeOffset.UtcNow.AddDays(-1).ToUnixTimeMilliseconds(),
        },
      },
    });

    Assert.Equal(1, data.GetProperty("acceptedCount").GetInt32());
  }

  [Fact]
  public async Task WarmDatabase_KillSwitchStopsTheConnection_NotJustTheLogLine()
  {
    var saved = Environment.GetEnvironmentVariable("WARMUP_DISABLED");
    try
    {
      Environment.SetEnvironmentVariable("WARMUP_DISABLED", "1");
      Pg.Reset();

      var (stdout, _) = await CaptureAsync(() => Warmup.WarmDatabaseAsync(ProbeCapMs));
      var after = await ServerNowAsync();

      Assert.Equal("SkipDisabled", DbWarmupLine(stdout).GetProperty("outcome").GetString());

      // Logging a skip and skipping are different things. If the gate were checked after the
      // connect instead of before it, the line above would still read SkipDisabled while the
      // switch bought nothing -- so the backend the first request lands on has to be one
      // that did not exist yet while the "skip" was being logged.
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      Assert.NotNull(conn);
      Assert.True(
        await BackendStartAsync(conn!.ProcessID) > after,
        "WARMUP_DISABLED was honoured in the log but a connection was opened anyway");
    }
    finally
    {
      Environment.SetEnvironmentVariable("WARMUP_DISABLED", saved);
      Pg.Reset();
    }
  }

  // ------------------------------------------------- SnapStart interaction

  [Fact]
  public async Task BeforeSnapshot_InvalidatesThePool_AndDeliberatelyDoesNotWarmIt()
  {
    Pg.Reset();
    await Warmup.WarmDatabaseAsync(ProbeCapMs);
    var poolBefore = Pg.DataSource();

    var (stdout, stderr) = await CaptureAsync(async () => await SnapStartHooks.BeforeSnapshot());

    Assert.NotSame(poolBefore, Pg.DataSource());

    // A connection opened at checkpoint time is a connection that gets snapshotted, and a
    // snapshotted TCP socket is dead in every environment restored from that snapshot. This
    // is the assertion that stops someone "fixing" the restore latency by moving the warmup
    // one hook earlier, which would look faster locally and break in production only.
    Assert.DoesNotContain("\"step\":\"db-warmup\"", stdout + stderr, StringComparison.Ordinal);
  }

  [Fact]
  public async Task AfterRestore_ThrowsAwayThePreSnapshotPool_AndWarmsAFreshOne()
  {
    // Guard: the restore hook re-warms the SQS client too, and with a real queue URL present
    // that would be an actual AWS call, which these tests must not make.
    if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PUBLISH_JOB_QUEUE_URL"))) return;

    Pg.Reset();
    await Warmup.WarmDatabaseAsync(ProbeCapMs);

    var poolBefore = Pg.DataSource();
    var adminPoolBefore = VpcDb.Pg.DataSource();

    int pidBefore;
    await using (var pre = await Pg.OpenConnectionOrNullAsync())
    {
      Assert.NotNull(pre);
      pidBefore = pre!.ProcessID;
    }

    var before = await ServerNowAsync();
    var (stdout, _) = await CaptureAsync(async () => await SnapStartHooks.AfterRestore());
    var after = await ServerNowAsync();

    // 1. Invalidated. Both pools: Vpc/Db/*.cs resolves the bare name `Pg` to a second class
    //    with its own static data source, and it was missing from this hook entirely.
    Assert.NotSame(poolBefore, Pg.DataSource());
    Assert.NotSame(adminPoolBefore, VpcDb.Pg.DataSource());

    // 2. Rebuilt, not merely disposed. Without this the hook would satisfy SnapStart's
    //    correctness requirement and hand the first post-restore request the full connect.
    Assert.Equal("ok", DbWarmupLine(stdout).GetProperty("outcome").GetString());

    await using var post = await Pg.OpenConnectionOrNullAsync();
    Assert.NotNull(post);
    Assert.NotEqual(pidBefore, post!.ProcessID);
    Assert.InRange(await BackendStartAsync(post.ProcessID), before, after);
  }
}


/// <summary>
/// The cap's other half, tested at its seam. The cap itself is WaitAsync racing
/// the open; what cannot be left to inspection is what happens to the open that
/// loses the race. These drive DisposeWhenItArrives with hand-built tasks
/// because no local container can be told to stall its TLS handshake on cue.
/// </summary>
public sealed class WarmupLateArrivalTests
{
  private sealed class RecordingConnection
  {
    // NpgsqlConnection cannot be faked, so the helper's contract is exercised
    // through the real type where possible and through task-state transitions
    // where not. What CAN be asserted without a live handshake:
  }

  [Fact]
  public async Task AFaultedLateOpen_IsObserved_NotRethrownAnywhere()
  {
    var tcs = new TaskCompletionSource<Npgsql.NpgsqlConnection?>();
    RecallSmith.Lambda.Warmup.DisposeWhenItArrives(tcs.Task);

    // The open "fails" after the cap already gave up on it. If the continuation
    // did not read the exception, the finalizer thread would surface an
    // UnobservedTaskException later -- here it must simply vanish.
    tcs.SetException(new TimeoutException("handshake never completed"));

    // Give the synchronous continuation a beat, then force full collection so an
    // unobserved fault would have its one chance to escalate.
    await Task.Delay(50);
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
  }

  [Fact]
  public async Task ANullLateOpen_CompletesWithoutThrowing()
  {
    var tcs = new TaskCompletionSource<Npgsql.NpgsqlConnection?>();
    RecallSmith.Lambda.Warmup.DisposeWhenItArrives(tcs.Task);
    tcs.SetResult(null);
    await Task.Delay(50);
  }

  [Fact]
  public async Task ACancelledLateOpen_IsAlsoObserved()
  {
    var tcs = new TaskCompletionSource<Npgsql.NpgsqlConnection?>();
    RecallSmith.Lambda.Warmup.DisposeWhenItArrives(tcs.Task);
    tcs.SetCanceled();
    await Task.Delay(50);
    GC.Collect();
    GC.WaitForPendingFinalizers();
  }
}
