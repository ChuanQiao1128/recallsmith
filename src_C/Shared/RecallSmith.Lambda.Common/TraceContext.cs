using System.Text.RegularExpressions;

namespace RecallSmith.Lambda.Common;

/// <summary>
/// The X-Ray id of the current invocation and of the producer that caused it (H00 §3.3). Parsing
/// only: nothing here sends a segment; the Lambda runtime owns the trace, this class reads it.
/// </summary>
/// <remarks>
/// <see cref="CurrentRoot"/> reads <c>_X_AMZN_TRACE_ID</c> on every call and never caches it,
/// because Lambda rewrites that variable for every invocation of a warm container. The parse is
/// deliberately strict (lower-case hex, exact length) so a client-sent <c>x-dc-trace-id</c> can
/// only ever put a well-formed root on a line, never free text.
/// </remarks>
public static class TraceContext
{
  public const string EnvVar = "_X_AMZN_TRACE_ID";
  public const string UpstreamHeader = "x-dc-trace-id";
  public const string XrayField = "xrayTraceId";
  public const string UpstreamField = "upstreamTraceId";

  private const int RootLength = 35;

  private static readonly Regex RootPattern =
    new("^1-[0-9a-f]{8}-[0-9a-f]{24}$", RegexOptions.CultureInvariant);

  /// <summary>The validated root of this invocation's <c>_X_AMZN_TRACE_ID</c>, or null.</summary>
  public static string? CurrentRoot()
  {
    try
    {
      return RootFromHeader(Environment.GetEnvironmentVariable(EnvVar));
    }
    catch
    {
      return null;
    }
  }

  /// <summary>
  /// <c>"Root=1-…;Parent=…;Sampled=…"</c> (Root at any position) or a bare <c>"1-…"</c> →
  /// the validated root; anything else → null. Never throws.
  /// </summary>
  public static string? RootFromHeader(string? value)
  {
    try
    {
      if (string.IsNullOrWhiteSpace(value)) return null;

      var v = value.Trim();
      string? candidate = null;
      if (!v.Contains('='))
      {
        candidate = v;
      }
      else
      {
        foreach (var raw in v.Split(';'))
        {
          var segment = raw.Trim();
          if (segment.StartsWith("Root=", StringComparison.Ordinal))
          {
            candidate = segment["Root=".Length..].Trim();
            break;
          }
        }
      }

      if (candidate is null || candidate.Length != RootLength) return null;
      return RootPattern.IsMatch(candidate) ? candidate : null;
    }
    catch
    {
      return null;
    }
  }
}
