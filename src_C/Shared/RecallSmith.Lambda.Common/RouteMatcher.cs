using System.Text;

namespace RecallSmith.Lambda.Common;

public static class RouteMatcher
{
  public static Dictionary<string, string>? Match(string pattern, string path)
  {
    var p = Split(pattern);
    var s = Split(path);
    if (p.Count != s.Count) return null;

    var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
    for (var i = 0; i < p.Count; i++)
    {
      var a = p[i];
      var b = s[i];
      if (a.StartsWith(':'))
      {
        parameters[a[1..]] = Uri.UnescapeDataString(b);
        continue;
      }

      if (!string.Equals(a, b, StringComparison.Ordinal)) return null;
    }

    return parameters;
  }

  private static List<string> Split(string value)
  {
    return value
      .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .ToList();
  }
}
