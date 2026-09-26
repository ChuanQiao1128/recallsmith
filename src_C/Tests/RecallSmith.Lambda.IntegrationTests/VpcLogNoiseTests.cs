using System.Text.Json;
using RecallSmith.Lambda;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The boot line moved from every request into the container constructor (CBE-24), and the dead
/// authoring/dashboard route was deleted (CBE-19). These assert the observable consequences:
/// a request no longer mints a <c>{tag:"boot"}</c> line, constructing the function does exactly
/// once, and the removed route now answers 404.
/// </summary>
/// <remarks>
/// In the postgres collection because these redirect Console, which is process-global and shared
/// with RouteMetricsTests/LogShapeTests; xunit runs separate collections in parallel. The fixture
/// is not injected — Console redirection and a live route table are all these need.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class VpcLogNoiseTests
{
  private const string BootMarker = "\"tag\":\"boot\"";

  /// <summary>
  /// Lines go through Console, so reading them back means redirecting it. Safe only because every
  /// class that logs is in this one serially-run collection; Console.SetOut is process-global and
  /// a parallel collection writing during the window would land here.
  /// </summary>
  private static async Task<string> CaptureAsync(Func<Task> action)
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

    return stdout.ToString();
  }

  private static int Count(string haystack, string needle)
  {
    var count = 0;
    var i = 0;
    while ((i = haystack.IndexOf(needle, i, StringComparison.Ordinal)) >= 0)
    {
      count++;
      i += needle.Length;
    }
    return count;
  }

  private static JsonElement Event(string path, string method, string[]? groups)
  {
    object requestContext = groups is null
      ? new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      }
      : new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = $"it-f10-{Guid.NewGuid():N}",
              ["cognito:groups"] = groups,
            },
          },
        },
      };

    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext,
      headers = new Dictionary<string, string>(StringComparer.Ordinal),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  [Fact]
  public async Task Handler_DoesNotLogBoot_PerRequest()
  {
    // Construct outside the capture: the boot line now fires in the constructor, so building the
    // function inside the window would mask the very regression this guards.
    var fn = new VpcFunction();

    var stdout = await CaptureAsync(() => fn.Handler(Event("/health", "GET", null)));

    Assert.DoesNotContain(BootMarker, stdout, StringComparison.Ordinal);
  }

  [Fact]
  public async Task Constructor_LogsBootOnce()
  {
    var stdout = await CaptureAsync(() =>
    {
      _ = new VpcFunction();
      return Task.CompletedTask;
    });

    Assert.Equal(1, Count(stdout, BootMarker));
  }

  [Fact]
  public async Task DashboardRoute_IsGone_404()
  {
    var fn = new VpcFunction();

    var resp = await fn.Handler(Event("/api/v1/authoring/dashboard", "GET", new[] { "super_admin" }));

    Assert.Equal(404, resp.StatusCode);
    using var doc = JsonDocument.Parse(resp.Body ?? "{}");
    Assert.Equal("NOT_FOUND", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
  }
}
