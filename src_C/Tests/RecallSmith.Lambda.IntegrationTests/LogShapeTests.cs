using System.Text.Json;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The structured-log line contract: every <c>Log.*</c> call and <c>Log.Event</c> is one JSON
/// object per line with <c>ts</c> first and <c>level</c> second; a lone JSON-object string is
/// spread at the top level (the rule that keeps <c>DbWarmupTests</c>' selector working); the
/// dimensionless <c>RouteMetrics.EmitGauge</c> is one EMF line; and the <c>internal:</c> route
/// label never mints an unbounded metric.
/// </summary>
/// <remarks>
/// In the postgres collection because these tests redirect Console, which is process-global and
/// shared with DbWarmupTests/RouteMetricsTests; xunit runs separate collections in parallel.
/// The fixture is not injected -- Console redirection is all these need.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class LogShapeTests
{
  // ---------------------------------------------------------------- helpers

  /// <summary>
  /// Log lines go through Console, so reading them back means redirecting it. Safe only because
  /// every class that logs is in this one serially-run collection; Console.SetOut is
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

  private static JsonElement[] Lines(string text) =>
    text
      .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Where(l => l.Length > 0)
      .Select(l =>
      {
        using var doc = JsonDocument.Parse(l);
        return doc.RootElement.Clone();
      })
      .ToArray();

  private static string[] Names(JsonElement obj) =>
    obj.EnumerateObject().Select(p => p.Name).ToArray();

  // ---------------------------------------------------------------- Log.* shape

  [Fact]
  public async Task Info_PlainArgs_IsOneJsonObject_TsLevelMsg()
  {
    var (outText, _) = await CaptureAsync(() =>
    {
      Log.Info("hello", 42, null);
      return Task.CompletedTask;
    });

    var line = Assert.Single(Lines(outText));
    Assert.Equal(new[] { "ts", "level", "msg" }, Names(line));
    Assert.Equal("info", line.GetProperty("level").GetString());
    Assert.Equal("hello 42 null", line.GetProperty("msg").GetString());

    var ts = line.GetProperty("ts").GetString()!;
    Assert.EndsWith("Z", ts);
    Assert.True(DateTimeOffset.TryParse(ts, out _));
  }

  [Fact]
  public async Task WarnAndError_WriteJsonToStderr()
  {
    var (outText, errText) = await CaptureAsync(() =>
    {
      Log.Warn("w");
      Log.Error("e:", new InvalidOperationException("boom"));
      return Task.CompletedTask;
    });

    Assert.Empty(Lines(outText));

    var errLines = Lines(errText);
    Assert.Equal(2, errLines.Length);
    Assert.Equal("warn", errLines[0].GetProperty("level").GetString());
    Assert.Equal("error", errLines[1].GetProperty("level").GetString());
    Assert.Contains("boom", errLines[1].GetProperty("msg").GetString());

    // The stack trace's newlines are escaped by the writer, so the line stays on one line:
    // exactly two records => exactly two real newlines in the captured stderr.
    Assert.Equal(2, errText.Count(c => c == '\n'));
  }

  [Fact]
  public async Task Info_SingleJsonObjectArg_IsEmbeddedAtTopLevel()
  {
    var (outText, _) = await CaptureAsync(() =>
    {
      Log.Info(JsonSerializer.Serialize(new { step = "db-warmup", ok = true, ms = 12 }));
      return Task.CompletedTask;
    });

    // The DbWarmupTests selector text must survive verbatim.
    Assert.Contains("\"step\":\"db-warmup\"", outText);

    var line = Assert.Single(Lines(outText));
    Assert.True(line.TryGetProperty("ts", out _));
    Assert.Equal("info", line.GetProperty("level").GetString());
    Assert.Equal("db-warmup", line.GetProperty("step").GetString());
    Assert.True(line.GetProperty("ok").GetBoolean());
    Assert.Equal(12, line.GetProperty("ms").GetInt32());
    Assert.False(line.TryGetProperty("msg", out _));
  }

  [Fact]
  public async Task Event_PrependsTsAndLevel_ThenFieldsInDeclaredOrder()
  {
    var (outText, _) = await CaptureAsync(() =>
    {
      Log.Event("info", new { tag = "boot", lambda = "core-vpc", path = "/health" });
      return Task.CompletedTask;
    });

    var line = Assert.Single(Lines(outText));
    Assert.Equal(new[] { "ts", "level", "tag", "lambda", "path" }, Names(line));
  }

  [Fact]
  public async Task Event_DropsFieldsNamedTsOrLevel()
  {
    var (_, errText) = await CaptureAsync(() =>
    {
      Log.Event("warn", new { level = "info", ts = "x", tag = "auth" });
      return Task.CompletedTask;
    });

    var line = Assert.Single(Lines(errText));
    Assert.Single(line.EnumerateObject().Where(p => p.Name == "level"));
    Assert.Equal("warn", line.GetProperty("level").GetString());
    Assert.NotEqual("x", line.GetProperty("ts").GetString());
    Assert.Equal("auth", line.GetProperty("tag").GetString());
  }

  [Fact]
  public async Task Debug_WritesOnlyWhenLogLevelIsDebug()
  {
    var (outText, _) = await CaptureAsync(() =>
    {
      Log.Debug("d");
      Log.Event("debug", new { a = 1 });
      return Task.CompletedTask;
    });

    Assert.Equal(Log.IsEnabled("debug") ? 2 : 0, Lines(outText).Length);
  }

  [Fact]
  public async Task EveryLineWritten_ParsesAsJsonWithTsAndLevel()
  {
    var (outText, errText) = await CaptureAsync(() =>
    {
      Log.Debug("d", 1);
      Log.Info("i", new { x = 1 });
      Log.Warn("w");
      Log.Error("e", new InvalidOperationException("boom"));
      Log.Info(JsonSerializer.Serialize(new { pre = "serialised" }));
      Log.Event("debug", new { a = 1 });
      Log.Event("info", new { b = 2 });
      Log.Event("warn", new { c = 3 });
      Log.Event("error", new { d = 4 });
      return Task.CompletedTask;
    });

    var levels = new[] { "debug", "info", "warn", "error" };
    foreach (var line in Lines(outText).Concat(Lines(errText)))
    {
      Assert.Equal(JsonValueKind.Object, line.ValueKind);
      Assert.Equal(JsonValueKind.String, line.GetProperty("ts").ValueKind);
      Assert.Contains(line.GetProperty("level").GetString(), levels);
    }
  }

  // ---------------------------------------------------------------- EmitGauge

  [Fact]
  public async Task EmitGauge_IsOneEmfLine_NoDimensions_DefaultNamespace()
  {
    var (outText, _) = await CaptureAsync(() =>
    {
      RouteMetrics.EmitGauge("OutboxPending", 12);
      return Task.CompletedTask;
    });

    var line = Assert.Single(Lines(outText));
    var aws = line.GetProperty("_aws");
    var cwm = aws.GetProperty("CloudWatchMetrics")[0];

    Assert.Equal("DeveloperCards", cwm.GetProperty("Namespace").GetString());

    var dims = cwm.GetProperty("Dimensions");
    Assert.Equal(1, dims.GetArrayLength());
    Assert.Equal(0, dims[0].GetArrayLength());

    var metric = cwm.GetProperty("Metrics")[0];
    Assert.Equal("OutboxPending", metric.GetProperty("Name").GetString());
    Assert.Equal("Count", metric.GetProperty("Unit").GetString());

    Assert.Equal(12, line.GetProperty("OutboxPending").GetDouble());
    Assert.True(aws.GetProperty("Timestamp").GetInt64() > 0);
  }

  [Fact]
  public async Task EmitGauge_HonoursNamespaceOverride_AndKillSwitch()
  {
    var savedNs = Environment.GetEnvironmentVariable(RouteMetrics.NamespaceEnvVar);
    var savedDisabled = Environment.GetEnvironmentVariable(RouteMetrics.DisableEnvVar);
    try
    {
      Environment.SetEnvironmentVariable(RouteMetrics.DisableEnvVar, null);
      Environment.SetEnvironmentVariable(RouteMetrics.NamespaceEnvVar, "DeveloperCards/Staging");
      var (overridden, _) = await CaptureAsync(() =>
      {
        RouteMetrics.EmitGauge("OutboxPending", 5);
        return Task.CompletedTask;
      });
      Assert.Equal(
        "DeveloperCards/Staging",
        Assert.Single(Lines(overridden)).GetProperty("_aws").GetProperty("CloudWatchMetrics")[0].GetProperty("Namespace").GetString());

      Environment.SetEnvironmentVariable(RouteMetrics.DisableEnvVar, "1");
      var (killed, _) = await CaptureAsync(() =>
      {
        RouteMetrics.EmitGauge("OutboxPending", 5);
        return Task.CompletedTask;
      });
      Assert.Empty(Lines(killed));

      Environment.SetEnvironmentVariable(RouteMetrics.DisableEnvVar, null);
      var (emptyName, _) = await CaptureAsync(() =>
      {
        RouteMetrics.EmitGauge("", 1);
        return Task.CompletedTask;
      });
      Assert.Empty(Lines(emptyName));
    }
    finally
    {
      Environment.SetEnvironmentVariable(RouteMetrics.NamespaceEnvVar, savedNs);
      Environment.SetEnvironmentVariable(RouteMetrics.DisableEnvVar, savedDisabled);
    }
  }

  // ---------------------------------------------------------------- internal routes

  [Theory]
  [InlineData("/internal/outbox/publish", "internal:outbox/publish")]
  [InlineData("/internal/content-intelligence/import", "internal:content-intelligence/import")]
  [InlineData("/internal/publish/reap-orphans", "internal:publish/reap-orphans")]
  [InlineData("/internal/manifest/rebuild", "internal:manifest/rebuild")]
  [InlineData("/internal/db/migrate", "internal:db/migrate")]
  [InlineData("/internal/health/deep", "internal:health/deep")]
  [InlineData("/internal/outbox/publish/", "internal:outbox/publish")]
  public void RouteFor_InternalAction_IsLabelledInternalColonAction(string path, string expected)
  {
    Assert.Equal(expected, RouteMetrics.RouteFor(path));
  }

  [Fact]
  public void RouteFor_UnknownInternalAction_IsUnmatched_AndMintsNothing()
  {
    Assert.Equal(RouteMetrics.UnmatchedRoute, RouteMetrics.RouteFor("/internal/whatever"));

    for (var i = 0; i < 200; i++)
    {
      Assert.Equal(RouteMetrics.UnmatchedRoute, RouteMetrics.RouteFor($"/internal/x-{i:D4}"));
    }

    // A real /api/internal/* route keeps its /api/ prefix (NormalizePath) and its own label.
    Assert.Equal("/api/internal/entitlements/apply", RouteMetrics.RouteFor("/api/internal/entitlements/apply"));
  }

  [Fact]
  public void KnownRoutes_ExcludeInternalActions()
  {
    Assert.DoesNotContain(
      RouteMetrics.KnownRoutes,
      r => r.StartsWith("/internal/", StringComparison.Ordinal) || r.StartsWith("internal:", StringComparison.Ordinal));
    Assert.Equal(6, RouteMetrics.InternalActions.Count);
  }

  [Fact]
  public void DefaultNamespace_IsDeveloperCards()
  {
    Assert.Equal("DeveloperCards", RouteMetrics.DefaultNamespace);
  }
}
