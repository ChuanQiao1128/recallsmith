using System.Text.RegularExpressions;

namespace RecallSmith.Lambda.Common;

public static class SqlUtil
{
  private static readonly Regex DollarParam = new("\\$(\\d+)", RegexOptions.Compiled);

  // Converts "$1" -> "@p1" etc, so we can keep Node-style SQL in C#.
  public static string ToNpgsql(string sql) => DollarParam.Replace(sql, m => "@p" + m.Groups[1].Value);
}
