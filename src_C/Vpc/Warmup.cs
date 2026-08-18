using System.Diagnostics;
using System.Text.Json;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda;

/// <summary>
/// One-shot INIT phase warmup for the two things that sit on the request path and cost
/// seconds the first time they are touched: the SQS client and the Postgres connection.
/// </summary>
/// <remarks>
/// Why this exists: on core-vpc (128 MB) the first SQS call inside a container measured
/// 2980 ms while every later call in the same container measured 20 to 40 ms. That gap is
/// not network, it is one-time cost: AWS SDK assembly loading, JIT, the endpoint resolution
/// rule engine, credential resolution and the TLS handshake. Paying it during INIT instead
/// of inside a user request matters because Lambda grants the init phase a burst of unthrottled
/// CPU, whereas at 128 MB an invocation gets a small fraction of a vCPU. The same JIT work
/// therefore costs far less here than it does on the request path.
///
/// The database is the same shape of cost and a bigger one: cold start e2e is 9228 ms, of
/// which the FIRST connection is 4294 ms -- 68% of the cold handler -- against a 303 ms init.
///
/// Why it is allowed to fail silently: warmup is an optimization, not a feature. If it fails
/// the system must degrade to exactly today's behaviour (a slow first request) rather than
/// break. Nothing in here may throw into container init or into a request.
/// </remarks>
public static class Warmup
{
  // Lambda aborts container init at 10 s and retries it, which would turn a slow first
  // request into a failed one. The warmup therefore gets a hard cap well below that budget,
  // sized above the 2980 ms we actually measured so a normal warm-up still completes.
  private const int SqsTimeoutMs = 4000;

  // Above the 4294 ms the first connection actually measured. A cap at or below that number
  // would cancel precisely the case this probe exists to pay for, and would do it every time.
  private const int DbTimeoutMs = 4500;

  // ONE budget for both probes rather than two independent caps, because two independent
  // 4 s-ish caps can sum to 8.5 s on top of a 303 ms init and land inside Lambda's 10 s
  // init limit only by luck. With a shared budget the worst case is a number chosen here.
  private const int InitBudgetMs = 8000;

  // The restore path gets far less, and that is not caution, it is what SnapStart restores:
  // the snapshot preserves the loaded assemblies and the JIT-ed code, so the 4294 ms that a
  // cold container spends on assembly loading, JIT and TLS stack initialisation is already
  // paid. Only the sockets are dead. Re-establishing one is network work, tens to hundreds
  // of milliseconds. AWS also caps the whole after-restore hook at 10 s ("the runtime must
  // load and RegisterAfterSnapshot() runtime hooks must complete within the timeout limit
  // (10 seconds). Otherwise, you'll get a SnapStartTimeoutException" --
  // docs.aws.amazon.com/lambda/latest/dg/snapstart-runtime-hooks-dotnet.html), and the
  // runtime's own load shares that 10 s with us.
  private const int RestoreBudgetMs = 2000;

  // Floor for a probe when the shared budget is nearly gone. Below this a probe cannot
  // finish anyway and would only add a cancellation to the log, so the floor exists to keep
  // Math.Clamp well-formed rather than to make a doomed probe look reasonable.
  private const int MinProbeMs = 500;

  // Kill switch. Warmup can be turned off on a live function through configuration alone,
  // without waiting for a rollback deploy. One switch covers both probes: they share a
  // single reason to exist and a single reason anyone would want them gone.
  private const string DisableEnvVar = "WARMUP_DISABLED";

  private static int _started;

  /// <summary>What the SQS warmup decided to do, given its inputs.</summary>
  public enum Decision
  {
    Run,
    SkipNoQueueUrl,
    SkipDisabled,
  }

  /// <summary>What the database warmup decided to do, given its inputs.</summary>
  public enum DbDecision
  {
    Run,
    SkipNoDbConfig,
    SkipDisabled,
  }

  /// <summary>
  /// Pure decision step, kept separate from the I/O so it can be tested without AWS.
  /// </summary>
  public static Decision Decide(string? queueUrl, string? disableFlag)
  {
    if (IsDisabled(disableFlag)) return Decision.SkipDisabled;

    // Without a queue URL there is nothing legitimate to call. Publish itself already
    // rejects this configuration at request time, so warmup stays quiet rather than
    // inventing an error during init.
    if (string.IsNullOrWhiteSpace(queueUrl)) return Decision.SkipNoQueueUrl;

    return Decision.Run;
  }

  /// <summary>
  /// Pure decision step for the database probe, kept separate from the I/O so it can be
  /// tested without a database.
  /// </summary>
  /// <remarks>
  /// These are the same four variables Pg.DataSource() requires. They are re-checked here
  /// rather than letting Pg hand back a null connection, so that an unconfigured function
  /// produces one logged skip during init instead of a silently swallowed null.
  /// </remarks>
  public static DbDecision DecideDb(
    string? host,
    string? database,
    string? user,
    string? password,
    string? disableFlag)
  {
    if (IsDisabled(disableFlag)) return DbDecision.SkipDisabled;

    if (string.IsNullOrWhiteSpace(host) ||
        string.IsNullOrWhiteSpace(database) ||
        string.IsNullOrWhiteSpace(user) ||
        string.IsNullOrWhiteSpace(password))
    {
      return DbDecision.SkipNoDbConfig;
    }

    return DbDecision.Run;
  }

  private static bool IsDisabled(string? disableFlag)
  {
    var flag = (disableFlag ?? string.Empty).Trim();
    return flag.Equals("1", StringComparison.Ordinal) ||
           flag.Equals("true", StringComparison.OrdinalIgnoreCase) ||
           flag.Equals("yes", StringComparison.OrdinalIgnoreCase);
  }

  /// <summary>
  /// Runs the warmup at most once per container. Safe to call from a constructor:
  /// it never throws, and it blocks only up to <see cref="InitBudgetMs"/>.
  /// </summary>
  public static void RunOnce()
  {
    if (Interlocked.Exchange(ref _started, 1) == 1) return;
    RunAll(InitBudgetMs);
  }

  /// <summary>
  /// Re-warms after a SnapStart restore. Call it AFTER the pools have been invalidated.
  /// </summary>
  /// <remarks>
  /// This exists because RunOnce cannot cover the restore path even in principle. RunOnce
  /// runs from the VpcFunction constructor, which under SnapStart executes once, before the
  /// snapshot is taken -- so everything it warmed is either disposed by the before-snapshot
  /// hook or is a socket that does not survive the restore. AWS is explicit that this is the
  /// caller's problem: "Always re-establish your network connections when your function
  /// resumes from a snapshot ... you can use an after-restore runtime hook"
  /// (docs.aws.amazon.com/lambda/latest/dg/snapstart-best-practices.html).
  ///
  /// The _started latch is deliberately NOT cleared. It means "RunOnce has fired", and it
  /// has; clearing it would only let a later constructor call re-run the init-sized warmup
  /// on a restored container that does not need it.
  /// </remarks>
  public static void RunAfterRestore() => RunAll(RestoreBudgetMs);

  private static void RunAll(int budgetMs)
  {
    var spent = Stopwatch.StartNew();

    // Database first, deliberately. It is the larger measured cost (4294 ms against
    // 2980 ms) and it sits on nearly every route, whereas the SQS client is reached only
    // by POST /authoring/publish. If the shared budget runs short, the probe that should
    // already have been paid for is the database one.
    try
    {
      // Blocking is deliberate. The point is to finish this work before the first
      // invocation starts, so it cannot be fire and forget.
      WarmDatabaseAsync(Remaining(budgetMs, spent, DbTimeoutMs)).GetAwaiter().GetResult();
    }
    catch (Exception ex)
    {
      // Last line of defence. WarmDatabaseAsync already swallows its own failures; this
      // guarantees that even an unexpected one cannot abort container init.
      SafeLogDb(outcome: "error", ok: false, connectMs: 0, probeMs: 0, totalMs: 0, error: ex.GetType().Name);
    }

    try
    {
      WarmSqsAsync(Remaining(budgetMs, spent, SqsTimeoutMs)).GetAwaiter().GetResult();
    }
    catch (Exception ex)
    {
      SafeLog(outcome: "error", ok: false, clientMs: 0, callMs: 0, totalMs: 0, error: ex.GetType().Name);
    }
  }

  private static int Remaining(int budgetMs, Stopwatch spent, int ownCap) =>
    Math.Clamp(budgetMs - (int)spent.ElapsedMilliseconds, MinProbeMs, ownCap);

  private static async Task WarmSqsAsync(int timeoutMs)
  {
    var total = Stopwatch.StartNew();
    long clientMs = 0;
    long callMs = 0;

    try
    {
      var queueUrl = Vpc.Authoring.Publish.WarmupQueueUrl;
      var decision = Decide(queueUrl, Environment.GetEnvironmentVariable(DisableEnvVar));
      if (decision != Decision.Run)
      {
        total.Stop();
        SafeLog(outcome: decision.ToString(), ok: true, clientMs: 0, callMs: 0, totalMs: total.ElapsedMilliseconds, error: null);
        return;
      }

      var clientWatch = Stopwatch.StartNew();
      // Warm the very instance the request path will use, not a throwaway copy, so the
      // resolved endpoint, credentials and connection pool are the ones publish reuses.
      var sqs = Vpc.Authoring.Publish.SqsForWarmup();
      clientWatch.Stop();
      clientMs = clientWatch.ElapsedMilliseconds;

      using var cts = new CancellationTokenSource(timeoutMs);

      // GetQueueAttributes rather than ListQueues: it is read-only, returns a few bytes,
      // and it targets the exact queue and host that SendMessage will target, so the
      // signer, endpoint resolution and TLS session it warms are the ones that get reused.
      // ListQueues is account-wide, more likely to be denied, and can return a large page.
      // Even an AccessDenied here is a successful warmup in the sense that matters: the
      // SDK was loaded, JIT-ed, credentials were resolved and the TLS handshake completed.
      // Sending a real message is never an option, it would enqueue a phantom publish job.
      var request = new GetQueueAttributesRequest
      {
        QueueUrl = queueUrl,
        AttributeNames = ["QueueArn"],
      };

      var callWatch = Stopwatch.StartNew();
      await sqs.GetQueueAttributesAsync(request, cts.Token).ConfigureAwait(false);
      callWatch.Stop();
      callMs = callWatch.ElapsedMilliseconds;

      total.Stop();
      SafeLog(outcome: "ok", ok: true, clientMs: clientMs, callMs: callMs, totalMs: total.ElapsedMilliseconds, error: null);
    }
    catch (Exception ex)
    {
      total.Stop();
      // A denied or timed out probe still leaves the SDK loaded and JIT-ed, so this is
      // logged as a warning and never propagated.
      SafeLog(outcome: "failed", ok: false, clientMs: clientMs, callMs: callMs, totalMs: total.ElapsedMilliseconds, error: $"{ex.GetType().Name}: {ex.Message}");
    }
  }

  /// <summary>
  /// Opens and validates the pooled Postgres connection the handlers will reuse, under a
  /// hard time cap. Never throws.
  /// </summary>
  /// <summary>
  /// The other half of the cap above. An open that outlived WaitAsync is still
  /// running; if its connection were simply forgotten it would strand the one
  /// pooled slot (PG_MAX=1) and the first request would inherit a dead pool.
  /// Disposing an NpgsqlConnection returns it to the pool, so attaching that as
  /// a continuation turns "the handshake was slow" into "the pool got warm a
  /// moment later" instead of into a leak. Faults are read so the runtime never
  /// sees an unobserved task exception.
  /// </summary>
  internal static void DisposeWhenItArrives(Task<NpgsqlConnection?> openTask) =>
    _ = openTask.ContinueWith(
      t =>
      {
        if (t.IsCompletedSuccessfully) _ = t.Result?.DisposeAsync();
        else _ = t.Exception;
      },
      CancellationToken.None,
      TaskContinuationOptions.ExecuteSynchronously,
      TaskScheduler.Default);

  public static async Task WarmDatabaseAsync(int timeoutMs)
  {
    using var cts = new CancellationTokenSource(timeoutMs);
    await WarmDatabaseAsync(cts.Token).ConfigureAwait(false);
  }

  /// <summary>
  /// The cancellation-token form. Production always reaches this through the millisecond
  /// overload; taking a token directly is what lets a test express "the cap fired" as a
  /// fact rather than as a race against a stopwatch.
  /// </summary>
  public static async Task WarmDatabaseAsync(CancellationToken cancellationToken)
  {
    var total = Stopwatch.StartNew();
    long connectMs = 0;
    long probeMs = 0;

    try
    {
      var decision = DecideDb(
        Environment.GetEnvironmentVariable("PGHOST"),
        Environment.GetEnvironmentVariable("PGDATABASE"),
        Environment.GetEnvironmentVariable("PGUSER"),
        Environment.GetEnvironmentVariable("PGPASSWORD"),
        Environment.GetEnvironmentVariable(DisableEnvVar));

      if (decision != DbDecision.Run)
      {
        total.Stop();
        SafeLogDb(decision.ToString(), ok: true, connectMs: 0, probeMs: 0, totalMs: total.ElapsedMilliseconds, error: null);
        return;
      }

      var connectWatch = Stopwatch.StartNew();

      // Pg, not a private NpgsqlConnection. A throwaway connection would pay the assembly
      // load, the JIT and the TLS stack initialisation -- most of the 4294 ms -- and still
      // leave the pool that every handler draws from empty, so the first request would
      // reconnect anyway. This warms the pool itself.
      //
      // The `await using` matters more than it looks: production runs PG_MAX=1, so a
      // connection this method forgot to return would not merely waste the warmup, it
      // would make the first real request block on an exhausted pool until Npgsql's
      // connect Timeout and then fail. A leak here is worse than no warmup at all.
      //
      // WaitAsync, because the token alone is not a cap. Npgsql does not observe
      // cancellation during the physical connect and TLS handshake, so the real
      // bound of a bare OpenAsync is the connection string's Timeout -- eight
      // seconds by default, which brushes Lambda's ten-second INIT abort line and
      // crosses it the day someone raises PG_CONNECTION_TIMEOUT. The race makes
      // the cap true regardless: INIT is released on time, and the abandoned open
      // is not a leak -- DisposeWhenItArrives returns the connection to the pool
      // the moment the handshake completes, so a slow handshake still warms the
      // pool for the first request. It just no longer holds INIT hostage.
      NpgsqlConnection? conn;
      var openTask = Pg.OpenConnectionOrNullAsync(cancellationToken);
      try
      {
        conn = await openTask.WaitAsync(cancellationToken).ConfigureAwait(false);
      }
      catch (OperationCanceledException)
      {
        DisposeWhenItArrives(openTask);
        total.Stop();
        SafeLogDb("capped", ok: false, connectMs: connectWatch.ElapsedMilliseconds, probeMs: 0, totalMs: total.ElapsedMilliseconds,
          error: "handshake outlived the cap; the connection will still land in the pool when it completes");
        return;
      }
      await using var _ = conn;
      connectWatch.Stop();
      connectMs = connectWatch.ElapsedMilliseconds;

      if (conn is null)
      {
        // Unreachable while DecideDb checks the same four variables Pg does; kept because
        // "unreachable" is a claim about two functions agreeing, and they can drift.
        total.Stop();
        SafeLogDb(DbDecision.SkipNoDbConfig.ToString(), ok: true, connectMs: connectMs, probeMs: 0, totalMs: total.ElapsedMilliseconds, error: null);
        return;
      }

      var probeWatch = Stopwatch.StartNew();

      // A round trip, not just a socket. Opening the connection already includes the
      // startup packet and authentication, but executing something is what drives
      // Npgsql's command, parameter and result-reading paths through the JIT -- the code
      // every later query re-enters. `select 1` because the probe must be free on the
      // server side and must not depend on any table existing yet.
      await using (var cmd = new NpgsqlCommand("select 1", conn))
      {
        await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
      }

      probeWatch.Stop();
      probeMs = probeWatch.ElapsedMilliseconds;

      total.Stop();
      SafeLogDb("ok", ok: true, connectMs: connectMs, probeMs: probeMs, totalMs: total.ElapsedMilliseconds, error: null);
    }
    catch (Exception ex)
    {
      total.Stop();

      // Best effort, and that word has to hold at exactly this line: a cancelled or refused
      // probe leaves the caller with the same empty pool it had before, which is today's
      // behaviour -- a slow first request. The request path builds and opens on its own.
      SafeLogDb("failed", ok: false, connectMs: connectMs, probeMs: probeMs, totalMs: total.ElapsedMilliseconds, error: $"{ex.GetType().Name}: {ex.Message}");
    }
  }

  private static void SafeLogDb(string outcome, bool ok, long connectMs, long probeMs, long totalMs, string? error)
  {
    try
    {
      var line = JsonSerializer.Serialize(new
      {
        step = "db-warmup",
        lambda = "core-vpc",
        target = "postgres",
        outcome,
        ok,
        // Split because the two phases fail for different reasons and are fixed in
        // different places: connect is the VPC/ENI/TLS cost this whole change is aimed at,
        // probe is one round trip to a warm socket. A single total would hide which moved.
        connectMs,
        probeMs,
        ms = totalMs,
        error,
      });

      if (ok) Log.Info(line);
      else Log.Warn(line);
    }
    catch
    {
      // Logging must not be the thing that breaks init.
    }
  }

  private static void SafeLog(string outcome, bool ok, long clientMs, long callMs, long totalMs, string? error)
  {
    try
    {
      var line = JsonSerializer.Serialize(new
      {
        step = "warmup",
        lambda = "core-vpc",
        target = "sqs",
        outcome,
        ok,
        clientMs,
        callMs,
        totalMs,
        error,
      });

      if (ok) Log.Info(line);
      else Log.Warn(line);
    }
    catch
    {
      // Logging must not be the thing that breaks init.
    }
  }
}
