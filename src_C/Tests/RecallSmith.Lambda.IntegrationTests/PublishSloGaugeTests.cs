using System.Text.Json;
using Amazon.Lambda.SQSEvents;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// H02: the worker counts each terminal publish outcome once as a dimensionless EMF gauge
/// (PublishJobsSucceeded / PublishJobsFailed, H00 §4.3), and the gauges change nothing but stdout:
/// every test also pins the returned SQSBatchResponse. Joins the serial Postgres collection because
/// it redirects Console; no database row is touched (in-file fakes only).
/// </summary>
[Collection(PostgresCollection.Name)]
public class PublishSloGaugeTests
{
  private const string Succeeded = "PublishJobsSucceeded";
  private const string Failed = "PublishJobsFailed";

  // ---- in-file fakes (no mocking library) --------------------------------------------------

  private sealed class FakeProcessor : IPublishJobProcessor
  {
    public readonly List<string> Failed = new();

    /// Returns the exception ProcessAsync throws for a jobId, or null to succeed.
    public Func<string, Exception?>? ThrowFor;

    /// When true, FailAsync throws after recording the call.
    public bool FailThrows;

    public Task ProcessAsync(string jobId, int receiveCount = 1)
    {
      var ex = ThrowFor?.Invoke(jobId);
      if (ex is not null) throw ex;
      return Task.CompletedTask;
    }

    public Task FailAsync(string jobId, string errorMessage)
    {
      Failed.Add(jobId);
      if (FailThrows) throw new InvalidOperationException("fail write lost");
      return Task.CompletedTask;
    }

    public Task RecordAttemptErrorAsync(string jobId, string errorMessage) => Task.CompletedTask;
  }

  private static SQSEvent.SQSMessage Record(string messageId, string body, string receiveCount) => new()
  {
    MessageId = messageId,
    Body = body,
    Attributes = new Dictionary<string, string> { ["ApproximateReceiveCount"] = receiveCount },
  };

  private static string Msg(string jobId) => $"{{\"jobId\":\"{jobId}\"}}";

  private static SQSEvent Batch(params SQSEvent.SQSMessage[] records) => new() { Records = records.ToList() };

  private static SQSEvent One(string jobId, string receiveCount) => Batch(Record("m1", Msg(jobId), receiveCount));

  private static WorkerFunction Worker(FakeProcessor p, Func<long, Task>? rebuild = null) =>
    new(p, rebuild ?? (_ => Task.CompletedTask));

  /// Runs the handler with METRICS_NAMESPACE / METRICS_DISABLED set as given, restoring both afterwards.
  private static async Task<(SQSBatchResponse Response, string Stdout)> RunAsync(
    WorkerFunction fn, SQSEvent ev, string? metricsDisabled = null)
  {
    var oldNs = Environment.GetEnvironmentVariable("METRICS_NAMESPACE");
    var oldDisabled = Environment.GetEnvironmentVariable("METRICS_DISABLED");
    try
    {
      Environment.SetEnvironmentVariable("METRICS_NAMESPACE", null);
      Environment.SetEnvironmentVariable("METRICS_DISABLED", metricsDisabled);
      SQSBatchResponse? resp = null;
      var stdout = await EmfCapture.StdoutAsync(async () => resp = await fn.FunctionHandler(ev, null!));
      return (resp!, stdout);
    }
    finally
    {
      Environment.SetEnvironmentVariable("METRICS_NAMESPACE", oldNs);
      Environment.SetEnvironmentVariable("METRICS_DISABLED", oldDisabled);
    }
  }

  /// The EMF lines in stdout that declare metric <paramref name="name"/>.
  private static List<string> LinesDeclaring(string stdout, string name)
  {
    var lines = new List<string>();
    foreach (var line in stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    {
      if (!line.StartsWith('{') || !line.Contains("\"_aws\"", StringComparison.Ordinal)) continue;
      using var doc = JsonDocument.Parse(line);
      var declared = doc.RootElement.GetProperty("_aws").GetProperty("CloudWatchMetrics").EnumerateArray()
        .SelectMany(m => m.GetProperty("Metrics").EnumerateArray())
        .Any(m => m.GetProperty("Name").GetString() == name);
      if (declared) lines.Add(line);
    }
    return lines;
  }

  private static void AssertCounts(string stdout, int succeeded, int failed)
  {
    Assert.Equal(succeeded, LinesDeclaring(stdout, Succeeded).Count);
    Assert.Equal(failed, LinesDeclaring(stdout, Failed).Count);
    Assert.Equal(succeeded, EmfCapture.GaugeSum(stdout, Succeeded));
    Assert.Equal(failed, EmfCapture.GaugeSum(stdout, Failed));
  }

  private static string[] FailedIds(SQSBatchResponse resp) =>
    resp.BatchItemFailures.Select(f => f.ItemIdentifier).ToArray();

  // ---- tests -------------------------------------------------------------------------------

  [Fact]
  public void Constants_MatchTheContract()
  {
    Assert.Equal("PublishJobsSucceeded", WorkerFunction.PublishSucceededMetric);
    Assert.Equal("PublishJobsFailed", WorkerFunction.PublishFailedMetric);
  }

  [Fact]
  public async Task Success_EmitsOneSucceededGauge()
  {
    var p = new FakeProcessor();
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", "1"));

    Assert.Empty(resp.BatchItemFailures);
    Assert.Single(LinesDeclaring(stdout, Succeeded));
    AssertCounts(stdout, succeeded: 1, failed: 0);
  }

  [Fact]
  public async Task BusinessError_FailAsyncOk_EmitsOneFailedGauge()
  {
    var p = new FakeProcessor { ThrowFor = _ => new BusinessException("deck has no cards") };
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", "1"));

    Assert.Empty(resp.BatchItemFailures);
    Assert.Equal(new[] { "j1" }, p.Failed);
    AssertCounts(stdout, succeeded: 0, failed: 1);
  }

  [Fact]
  public async Task BusinessError_FailAsyncThrows_EmitsNoGauge()
  {
    var p = new FakeProcessor { ThrowFor = _ => new BusinessException("deck has no cards"), FailThrows = true };
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", "1"));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }

  [Fact]
  public async Task SystemError_OnFinalReceive_EmitsOneFailedGauge()
  {
    var p = new FakeProcessor { ThrowFor = _ => new InvalidOperationException("s3 down") };
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", "3"));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    Assert.Equal(new[] { "j1" }, p.Failed);
    AssertCounts(stdout, succeeded: 0, failed: 1);
  }

  [Fact]
  public async Task SystemError_OnFinalReceive_FailAsyncThrows_StillEmitsOneFailedGauge()
  {
    var p = new FakeProcessor { ThrowFor = _ => new InvalidOperationException("s3 down"), FailThrows = true };
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", "3"));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    AssertCounts(stdout, succeeded: 0, failed: 1);
  }

  [Fact]
  public async Task SystemError_AfterMaxReceive_EmitsOneFailedGauge()
  {
    var p = new FakeProcessor { ThrowFor = _ => new InvalidOperationException("s3 down") };
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", "5"));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    Assert.Equal(new[] { "j1" }, p.Failed);
    AssertCounts(stdout, succeeded: 0, failed: 1);
  }

  [Theory]
  [InlineData("1")]
  [InlineData("2")]
  public async Task SystemError_BeforeFinalReceive_EmitsNoGauge(string receiveCount)
  {
    var p = new FakeProcessor { ThrowFor = _ => new InvalidOperationException("s3 down") };
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", receiveCount));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    Assert.Empty(p.Failed);
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }

  [Fact]
  public async Task ManifestRebuildThrows_BeforeFinalReceive_EmitsNoGauge()
  {
    var p = new FakeProcessor();
    var fn = Worker(p, _ => throw new InvalidOperationException("manifest rebuild failed"));
    var (resp, stdout) = await RunAsync(fn, One("j1", "1"));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    Assert.Empty(p.Failed);
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }

  // "{}" is not in this list: it deserializes to JobId = "" and goes down the normal path today
  // (an absent row is acknowledged as a replay), so it is not a malformed body for the worker.
  [Theory]
  [InlineData("not-json")]
  [InlineData("null")]
  [InlineData("{\"jobId\":null}")]
  public async Task MalformedBody_EmitsNoGauge(string body)
  {
    var p = new FakeProcessor();
    var (resp, stdout) = await RunAsync(Worker(p), Batch(Record("m1", body, "3")));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }

  [Fact]
  public async Task JobNotAcquired_EmitsNoGauge()
  {
    var p = new FakeProcessor { ThrowFor = id => new JobNotAcquiredException(id) };
    var (resp, stdout) = await RunAsync(Worker(p), One("j1", "3"));

    Assert.Equal(new[] { "m1" }, FailedIds(resp));
    Assert.Empty(p.Failed);
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }

  [Fact]
  public async Task MixedBatch_CountsEachTerminalOutcomeOnce()
  {
    var p = new FakeProcessor
    {
      ThrowFor = id => id switch
      {
        "biz" => new BusinessException("deck has no cards"),
        "sys-last" or "sys-first" => new InvalidOperationException("s3 down"),
        _ => null,
      },
    };
    var ev = Batch(
      Record("m-ok", Msg("ok"), "1"),
      Record("m-biz", Msg("biz"), "1"),
      Record("m-sys-last", Msg("sys-last"), "3"),
      Record("m-sys-first", Msg("sys-first"), "1"));
    var (resp, stdout) = await RunAsync(Worker(p), ev);

    Assert.Equal(new[] { "m-sys-last", "m-sys-first" }, FailedIds(resp));
    Assert.Equal(new[] { "biz", "sys-last" }, p.Failed);
    AssertCounts(stdout, succeeded: 1, failed: 2);
  }

  [Fact]
  public async Task GaugeLine_IsDimensionlessCountInTheDefaultNamespace()
  {
    var p = new FakeProcessor();
    var (_, stdout) = await RunAsync(Worker(p), One("j1", "1"));

    var line = Assert.Single(LinesDeclaring(stdout, Succeeded));
    using var doc = JsonDocument.Parse(line);
    var root = doc.RootElement;
    var cwm = Assert.Single(root.GetProperty("_aws").GetProperty("CloudWatchMetrics").EnumerateArray().ToList());
    Assert.Equal("DeveloperCards", cwm.GetProperty("Namespace").GetString());
    var dims = Assert.Single(cwm.GetProperty("Dimensions").EnumerateArray().ToList());
    Assert.Equal(JsonValueKind.Array, dims.ValueKind);
    Assert.Equal(0, dims.GetArrayLength());
    var metric = Assert.Single(cwm.GetProperty("Metrics").EnumerateArray().ToList());
    Assert.Equal(Succeeded, metric.GetProperty("Name").GetString());
    Assert.Equal("Count", metric.GetProperty("Unit").GetString());
    Assert.Equal(1, root.GetProperty(Succeeded).GetDouble());
  }

  [Fact]
  public async Task MetricsDisabled_EmitsNothing()
  {
    var p = new FakeProcessor
    {
      ThrowFor = id => id == "sys-last" ? new InvalidOperationException("s3 down") : null,
    };
    var ev = Batch(Record("m-ok", Msg("ok"), "1"), Record("m-sys-last", Msg("sys-last"), "3"));
    var (resp, stdout) = await RunAsync(Worker(p), ev, metricsDisabled: "1");

    Assert.Equal(new[] { "m-sys-last" }, FailedIds(resp));
    Assert.DoesNotContain("\"_aws\"", stdout, StringComparison.Ordinal);
    AssertCounts(stdout, succeeded: 0, failed: 0);
  }
}
