using System.Diagnostics;
using System.Text.Json;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda;

/// <summary>
/// One-shot INIT phase warmup for the AWS clients that sit on the request path.
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
/// Why it is allowed to fail silently: warmup is an optimization, not a feature. If it fails
/// the system must degrade to exactly today's behaviour (a slow first request) rather than
/// break. Nothing in here may throw into container init or into a request.
/// </remarks>
public static class Warmup
{
  // Lambda aborts container init at 10 s and retries it, which would turn a slow first
  // request into a failed one. The warmup therefore gets a hard cap well below that budget,
  // sized above the 2980 ms we actually measured so a normal warm-up still completes.
  private const int TimeoutMs = 4000;

  // Kill switch. Warmup can be turned off on a live function through configuration alone,
  // without waiting for a rollback deploy.
  private const string DisableEnvVar = "WARMUP_DISABLED";

  private static int _started;

  /// <summary>What the warmup decided to do, given its inputs.</summary>
  public enum Decision
  {
    Run,
    SkipNoQueueUrl,
    SkipDisabled,
  }

  /// <summary>
  /// Pure decision step, kept separate from the I/O so it can be tested without AWS.
  /// </summary>
  public static Decision Decide(string? queueUrl, string? disableFlag)
  {
    var flag = (disableFlag ?? string.Empty).Trim();
    if (flag.Equals("1", StringComparison.Ordinal) ||
        flag.Equals("true", StringComparison.OrdinalIgnoreCase) ||
        flag.Equals("yes", StringComparison.OrdinalIgnoreCase))
    {
      return Decision.SkipDisabled;
    }

    // Without a queue URL there is nothing legitimate to call. Publish itself already
    // rejects this configuration at request time, so warmup stays quiet rather than
    // inventing an error during init.
    if (string.IsNullOrWhiteSpace(queueUrl)) return Decision.SkipNoQueueUrl;

    return Decision.Run;
  }

  /// <summary>
  /// Runs the warmup at most once per container. Safe to call from a constructor:
  /// it never throws, and it blocks only up to <see cref="TimeoutMs"/>.
  /// </summary>
  public static void RunOnce()
  {
    if (Interlocked.Exchange(ref _started, 1) == 1) return;

    try
    {
      // Blocking is deliberate. The point is to finish this work before the first
      // invocation starts, so it cannot be fire and forget.
      WarmSqsAsync().GetAwaiter().GetResult();
    }
    catch (Exception ex)
    {
      // Last line of defence. WarmSqsAsync already swallows its own failures; this
      // guarantees that even an unexpected one cannot abort container init.
      SafeLog(outcome: "error", ok: false, clientMs: 0, callMs: 0, totalMs: 0, error: ex.GetType().Name);
    }
  }

  private static async Task WarmSqsAsync()
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

      using var cts = new CancellationTokenSource(TimeoutMs);

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
