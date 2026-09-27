namespace RecallSmith.Lambda.Vpc.Qa;

/// <summary>
/// Feature flags of the AI QA gate (R18 J13, contract §7.5). Every flag is read from the environment on every
/// call, never cached, so a test (or a redeploy with a new env file) changes the behaviour immediately.
/// </summary>
public static class Env
{
  /// <summary>Trimmed <c>1</c>, <c>true</c> or <c>yes</c>, case-insensitive: the <c>RouteMetrics.IsDisabled</c> rule.</summary>
  public static bool IsTruthy(string? value)
  {
    var v = (value ?? string.Empty).Trim();
    return v.Equals("1", StringComparison.Ordinal) ||
           v.Equals("true", StringComparison.OrdinalIgnoreCase) ||
           v.Equals("yes", StringComparison.OrdinalIgnoreCase);
  }

  public static bool Flag(string name) => IsTruthy(Environment.GetEnvironmentVariable(name));
}
