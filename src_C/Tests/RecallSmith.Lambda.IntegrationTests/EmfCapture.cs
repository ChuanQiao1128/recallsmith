using System.Text.Json;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Reads back the EMF gauge lines a best-effort path writes to stdout. Redirecting Console is safe only in
/// the serial Postgres collection, which is the only place this is used.
/// </summary>
internal static class EmfCapture
{
  public static async Task<string> StdoutAsync(Func<Task> action)
  {
    var oldOut = Console.Out;
    var stdout = new StringWriter();
    Console.SetOut(stdout);
    try
    {
      await action().ConfigureAwait(false);
    }
    finally
    {
      Console.SetOut(oldOut);
    }
    return stdout.ToString();
  }

  /// <summary>The summed value of every EMF line in <paramref name="text"/> that declares metric <paramref name="name"/>.</summary>
  public static double GaugeSum(string text, string name)
  {
    double sum = 0;
    foreach (var line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    {
      if (!line.StartsWith('{') || !line.Contains("\"_aws\"", StringComparison.Ordinal)) continue;
      using var doc = JsonDocument.Parse(line);
      var root = doc.RootElement;
      var declared = root.GetProperty("_aws").GetProperty("CloudWatchMetrics").EnumerateArray()
        .SelectMany(m => m.GetProperty("Metrics").EnumerateArray())
        .Any(m => m.GetProperty("Name").GetString() == name);
      if (declared && root.TryGetProperty(name, out var value)) sum += value.GetDouble();
    }
    return sum;
  }
}
