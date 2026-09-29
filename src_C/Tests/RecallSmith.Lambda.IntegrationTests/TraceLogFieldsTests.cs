using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.SQSEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Worker;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// H00 §3.3 on the wire: every <c>Log.*</c> line carries <c>xrayTraceId</c> right after
/// <c>level</c> when <c>_X_AMZN_TRACE_ID</c> holds a valid root; the RouteMetrics EMF line appends
/// <c>xrayTraceId</c>/<c>upstreamTraceId</c> after <c>traceId</c> as plain properties while its
/// base bytes stay exactly as before; the worker writes one <c>worker-record</c> line per record
/// carrying the SQS <c>AWSTraceHeader</c> root.
/// </summary>
/// <remarks>
/// In the postgres collection because these tests redirect Console and set process env, both
/// process-global and shared with LogShapeTests/RouteMetricsTests.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class TraceLogFieldsTests
{
  private const string ExampleRoot = "1-5759e988-bd862e3fe1be46a994272793";
  private const string OtherRoot = "1-66f9a0b1-0123456789abcdef01234567";
  private const string UpstreamRoot = "1-66f9a0b2-fedcba9876543210fedcba98";

  private const string GoldenPush =
    "{\"_aws\":{\"Timestamp\":1700000000123,\"CloudWatchMetrics\":[{\"Namespace\":\"DeveloperCards\",\"Dimensions\":[[\"Service\"],[\"Service\",\"Route\",\"Method\"]],\"Metrics\":[{\"Name\":\"Latency\",\"Unit\":\"Milliseconds\"},{\"Name\":\"Errors\",\"Unit\":\"Count\"}]}]},\"Service\":\"core-vpc\",\"Route\":\"/api/v1/sync/push\",\"Method\":\"POST\",\"Latency\":21.456,\"Errors\":0,\"statusCode\":200,\"traceId\":\"trace-1\"}";

  private const string GoldenHealth =
    "{\"_aws\":{\"Timestamp\":1,\"CloudWatchMetrics\":[{\"Namespace\":\"DeveloperCards\",\"Dimensions\":[[\"Service\"],[\"Service\",\"Route\",\"Method\"]],\"Metrics\":[{\"Name\":\"Latency\",\"Unit\":\"Milliseconds\"},{\"Name\":\"Errors\",\"Unit\":\"Count\"}]}]},\"Service\":\"core-vpc\",\"Route\":\"/health\",\"Method\":\"GET\",\"Latency\":1,\"Errors\":0,\"statusCode\":200,\"traceId\":null}";

  private static readonly string[] BaseEmfKeys =
    ["_aws", "Service", "Route", "Method", "Latency", "Errors", "statusCode", "traceId"];

  // ---------------------------------------------------------------- helpers

  private static async Task<T> WithTraceEnvAsync<T>(string? value, Func<Task<T>> action)
  {
    var saved = Environment.GetEnvironmentVariable(TraceContext.EnvVar);
    Environment.SetEnvironmentVariable(TraceContext.EnvVar, value);
    try
    {
      return await action().ConfigureAwait(false);
    }
    finally
    {
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, saved);
    }
  }

  private static string LambdaEnv(string root) => $"Root={root};Parent=53995c3f42cd8ad8;Sampled=1";

  /// <summary>Stdout of <paramref name="action"/>; stderr is redirected too so nothing leaks.</summary>
  private static async Task<string> CaptureAsync(Func<Task> action)
  {
    var oldOut = Console.Out;
    var oldErr = Console.Error;
    var stdout = new StringWriter();
    Console.SetOut(stdout);
    Console.SetError(new StringWriter());
    try
    {
      await action().ConfigureAwait(false);
    }
    finally
    {
      Console.SetOut(oldOut);
      Console.SetError(oldErr);
    }
    return stdout.ToString();
  }

  /// <summary>The JSON lines of <paramref name="text"/>; the worker's plain-text lines are skipped.</summary>
  private static JsonElement[] JsonLines(string text) =>
    text
      .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Where(l => l.StartsWith('{'))
      .Select(l =>
      {
        using var doc = JsonDocument.Parse(l);
        return doc.RootElement.Clone();
      })
      .ToArray();

  private static string[] Names(JsonElement obj) => obj.EnumerateObject().Select(p => p.Name).ToArray();

  private static JsonElement Single(string text) => Assert.Single(JsonLines(text));

  private static JsonElement EmfLine(string text) =>
    Assert.Single(JsonLines(text), l => l.TryGetProperty("_aws", out _));

  private static LambdaRequest Request(Dictionary<string, string> headers) =>
    new(JsonSerializer.SerializeToElement(new
    {
      rawPath = "/health",
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "GET" } },
      headers,
      queryStringParameters = new Dictionary<string, string>(StringComparer.Ordinal),
      body = (string?)null,
      isBase64Encoded = false,
    }));

  private static async Task<JsonElement> MeasureAsync(string? traceEnv, Dictionary<string, string> headers)
  {
    var stdout = await WithTraceEnvAsync(traceEnv, () => CaptureAsync(() =>
      RouteMetrics.MeasureAsync("core-vpc", Request(headers),
        () => Task.FromResult(new APIGatewayProxyResponse { StatusCode = 200 }))));
    return EmfLine(stdout);
  }

  // ---------------------------------------------------------------- Log.* fields

  [Fact]
  public async Task LogInfo_WithTraceEnv_NamesAreTsLevelXrayTraceIdMsg()
  {
    var stdout = await WithTraceEnvAsync(LambdaEnv(ExampleRoot), () => CaptureAsync(() =>
    {
      Log.Info("x");
      return Task.CompletedTask;
    }));

    var line = Single(stdout);
    Assert.Equal(["ts", "level", "xrayTraceId", "msg"], Names(line));
    Assert.Equal(ExampleRoot, line.GetProperty("xrayTraceId").GetString());
  }

  [Fact]
  public async Task LogInfo_WithoutTraceEnv_NamesAreTsLevelMsg()
  {
    var stdout = await WithTraceEnvAsync(null, () => CaptureAsync(() =>
    {
      Log.Info("x");
      return Task.CompletedTask;
    }));

    Assert.Equal(["ts", "level", "msg"], Names(Single(stdout)));
  }

  [Fact]
  public async Task LogInfo_InvalidTraceEnv_OmitsXrayTraceId()
  {
    foreach (var invalid in new[] { "Parent=53995c3f42cd8ad8;Sampled=1", $"Root={ExampleRoot.ToUpperInvariant()}", "garbage", " " })
    {
      var stdout = await WithTraceEnvAsync(invalid, () => CaptureAsync(() =>
      {
        Log.Info("x");
        return Task.CompletedTask;
      }));

      Assert.Equal(["ts", "level", "msg"], Names(Single(stdout)));
    }
  }

  [Fact]
  public async Task LogEvent_WithTraceEnv_PutsXrayTraceIdAfterLevel()
  {
    var stdout = await WithTraceEnvAsync(LambdaEnv(ExampleRoot), () => CaptureAsync(() =>
    {
      Log.Event("info", new { tag = "boot", lambda = "core-vpc", path = "/health" });
      return Task.CompletedTask;
    }));

    Assert.Equal(["ts", "level", "xrayTraceId", "tag", "lambda", "path"], Names(Single(stdout)));
  }

  [Fact]
  public async Task LogEvent_CallerXrayTraceId_IsDropped()
  {
    var withEnv = await WithTraceEnvAsync(LambdaEnv(ExampleRoot), () => CaptureAsync(() =>
    {
      Log.Event("info", new { tag = "t", xrayTraceId = OtherRoot });
      return Task.CompletedTask;
    }));
    var line = Single(withEnv);
    Assert.Equal(["ts", "level", "xrayTraceId", "tag"], Names(line));
    Assert.Equal(ExampleRoot, line.GetProperty("xrayTraceId").GetString());

    var withoutEnv = await WithTraceEnvAsync(null, () => CaptureAsync(() =>
    {
      Log.Event("info", new { tag = "t", xrayTraceId = OtherRoot });
      return Task.CompletedTask;
    }));
    Assert.Equal(["ts", "level", "tag"], Names(Single(withoutEnv)));
  }

  [Fact]
  public async Task LogEvent_ReadsTraceEnvOnEveryCall()
  {
    var first = await WithTraceEnvAsync(LambdaEnv(ExampleRoot), () => CaptureAsync(() =>
    {
      Log.Event("info", new { tag = "t" });
      return Task.CompletedTask;
    }));
    var second = await WithTraceEnvAsync(LambdaEnv(OtherRoot), () => CaptureAsync(() =>
    {
      Log.Event("info", new { tag = "t" });
      return Task.CompletedTask;
    }));

    Assert.Equal(ExampleRoot, Single(first).GetProperty("xrayTraceId").GetString());
    Assert.Equal(OtherRoot, Single(second).GetProperty("xrayTraceId").GetString());
  }

  // ---------------------------------------------------------------- EMF BuildLine

  [Fact]
  public void Emf_NineArgumentLine_IsByteIdenticalToTheBaseLine()
  {
    Assert.Equal(GoldenPush,
      RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/api/v1/sync/push", "POST", 21.456, 0, 200, "trace-1", 1700000000123));
    Assert.Equal(GoldenHealth,
      RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/health", "GET", 1, 0, 200, null, 1));

    Assert.Equal(GoldenPush,
      RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/api/v1/sync/push", "POST", 21.456, 0, 200, "trace-1", 1700000000123,
        xrayTraceId: null, upstreamTraceId: null));
    Assert.Equal(GoldenHealth,
      RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/health", "GET", 1, 0, 200, null, 1,
        xrayTraceId: null, upstreamTraceId: null));
  }

  [Fact]
  public void Emf_WithTraceIds_AppendsThemAfterTraceIdOnly()
  {
    var line = RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/api/v1/sync/push", "POST", 21.456, 0, 200, "trace-1", 1700000000123,
      xrayTraceId: ExampleRoot, upstreamTraceId: UpstreamRoot);

    Assert.Equal(GoldenPush[..^1] + $",\"xrayTraceId\":\"{ExampleRoot}\",\"upstreamTraceId\":\"{UpstreamRoot}\"}}", line);

    using var doc = JsonDocument.Parse(line);
    Assert.Equal([.. BaseEmfKeys, "xrayTraceId", "upstreamTraceId"], Names(doc.RootElement));
  }

  [Fact]
  public void Emf_OnlyUpstream_AppendsOnlyUpstream()
  {
    var line = RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/health", "GET", 1, 0, 200, null, 1,
      upstreamTraceId: UpstreamRoot);

    Assert.Equal(GoldenHealth[..^1] + $",\"upstreamTraceId\":\"{UpstreamRoot}\"}}", line);

    var onlyXray = RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/health", "GET", 1, 0, 200, null, 1,
      xrayTraceId: ExampleRoot);
    Assert.Equal(GoldenHealth[..^1] + $",\"xrayTraceId\":\"{ExampleRoot}\"}}", onlyXray);
  }

  [Fact]
  public void Emf_TraceIds_AreNeverDimensionsOrMetrics()
  {
    var line = RouteMetrics.BuildLine("DeveloperCards", "core-vpc", "/api/v1/sync/push", "POST", 21.456, 0, 200, "trace-1", 1700000000123,
      xrayTraceId: ExampleRoot, upstreamTraceId: UpstreamRoot);

    using var golden = JsonDocument.Parse(GoldenPush);
    using var withIds = JsonDocument.Parse(line);
    var goldenMetrics = golden.RootElement.GetProperty("_aws").GetProperty("CloudWatchMetrics")[0];
    var metrics = withIds.RootElement.GetProperty("_aws").GetProperty("CloudWatchMetrics")[0];

    Assert.Equal(goldenMetrics.GetProperty("Dimensions").GetRawText(), metrics.GetProperty("Dimensions").GetRawText());
    Assert.Equal(goldenMetrics.GetProperty("Metrics").GetRawText(), metrics.GetProperty("Metrics").GetRawText());
    Assert.Equal(golden.RootElement.GetProperty("_aws").GetRawText(), withIds.RootElement.GetProperty("_aws").GetRawText());
    Assert.DoesNotContain("xrayTraceId", metrics.GetRawText());
    Assert.DoesNotContain("upstreamTraceId", metrics.GetRawText());
  }

  // ---------------------------------------------------------------- EMF through MeasureAsync

  [Fact]
  public async Task MeasureAsync_CarriesXrayFromEnvAndUpstreamFromHeader()
  {
    var headerForms = new[]
    {
      new Dictionary<string, string> { ["x-dc-trace-id"] = $"Root={UpstreamRoot};Parent=53995c3f42cd8ad8" },
      new Dictionary<string, string> { ["x-dc-trace-id"] = UpstreamRoot },
      new Dictionary<string, string> { ["X-DC-Trace-Id"] = UpstreamRoot },
    };

    foreach (var headers in headerForms)
    {
      var line = await MeasureAsync(LambdaEnv(ExampleRoot), headers);
      Assert.Equal(ExampleRoot, line.GetProperty("xrayTraceId").GetString());
      Assert.Equal(UpstreamRoot, line.GetProperty("upstreamTraceId").GetString());
      Assert.Equal([.. BaseEmfKeys, "xrayTraceId", "upstreamTraceId"], Names(line));
    }
  }

  [Fact]
  public async Task MeasureAsync_InvalidUpstreamHeader_IsOmitted()
  {
    foreach (var invalid in new[] { "not-a-trace", $"Root={UpstreamRoot.ToUpperInvariant()}", "Parent=53995c3f42cd8ad8", "" })
    {
      var line = await MeasureAsync(LambdaEnv(ExampleRoot), new Dictionary<string, string> { ["x-dc-trace-id"] = invalid });
      Assert.False(line.TryGetProperty("upstreamTraceId", out _), $"upstreamTraceId written for '{invalid}'");
      Assert.Equal([.. BaseEmfKeys, "xrayTraceId"], Names(line));
    }
  }

  [Fact]
  public async Task MeasureAsync_NoTraceEnvNoHeader_LineIsUnchanged()
  {
    var line = await MeasureAsync(null, new Dictionary<string, string>());
    Assert.Equal(BaseEmfKeys, Names(line));
  }

  // ---------------------------------------------------------------- worker-record

  private sealed class FakeProcessor : IPublishJobProcessor
  {
    public Task ProcessAsync(string jobId, int receiveCount = 1) => Task.CompletedTask;
    public Task FailAsync(string jobId, string errorMessage) => Task.CompletedTask;
    public Task RecordAttemptErrorAsync(string jobId, string errorMessage) => Task.CompletedTask;
  }

  private static SQSEvent OneRecord(string messageId, string jobId, Dictionary<string, string>? attributes) =>
    new()
    {
      Records =
      [
        new SQSEvent.SQSMessage { MessageId = messageId, Body = $"{{\"jobId\":\"{jobId}\"}}", Attributes = attributes },
      ],
    };

  private static async Task<JsonElement[]> WorkerRecordLinesAsync(string? traceEnv, SQSEvent evt)
  {
    var worker = new WorkerFunction(new FakeProcessor(), _ => Task.CompletedTask);
    var stdout = await WithTraceEnvAsync(traceEnv, () => CaptureAsync(() => worker.FunctionHandler(evt, null!)));
    return JsonLines(stdout)
      .Where(l => l.TryGetProperty("tag", out var t) && t.GetString() == "worker-record")
      .ToArray();
  }

  [Fact]
  public async Task WorkerRecordLine_CarriesUpstreamTraceIdFromAwsTraceHeader()
  {
    var messageId = Guid.NewGuid().ToString();
    var jobId = Guid.NewGuid().ToString();
    var evt = OneRecord(messageId, jobId, new Dictionary<string, string>
    {
      ["ApproximateReceiveCount"] = "2",
      ["AWSTraceHeader"] = $"Root={UpstreamRoot};Parent=53995c3f42cd8ad8;Sampled=1",
    });

    var lines = await WorkerRecordLinesAsync(LambdaEnv(ExampleRoot), evt);

    var line = Assert.Single(lines);
    Assert.Equal(messageId, line.GetProperty("messageId").GetString());
    Assert.Equal(jobId, line.GetProperty("jobId").GetString());
    Assert.Equal(2, line.GetProperty("receiveCount").GetInt32());
    Assert.Equal(UpstreamRoot, line.GetProperty("upstreamTraceId").GetString());
    Assert.Equal(ExampleRoot, line.GetProperty("xrayTraceId").GetString());
  }

  [Fact]
  public async Task WorkerRecordLine_NoOrInvalidAwsTraceHeader_HasNoInvalidUpstream()
  {
    var attributeSets = new Dictionary<string, string>?[]
    {
      new() { ["ApproximateReceiveCount"] = "1" },
      null,
      new() { ["ApproximateReceiveCount"] = "1", ["AWSTraceHeader"] = "Root=not-a-root;Parent=53995c3f42cd8ad8" },
    };

    foreach (var attributes in attributeSets)
    {
      var lines = await WorkerRecordLinesAsync(LambdaEnv(ExampleRoot), OneRecord(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), attributes));

      var line = Assert.Single(lines);
      Assert.True(
        !line.TryGetProperty("upstreamTraceId", out var upstream) || upstream.ValueKind == JsonValueKind.Null,
        "upstreamTraceId must be absent or null");
      Assert.Equal(ExampleRoot, line.GetProperty("xrayTraceId").GetString());
    }
  }
}
