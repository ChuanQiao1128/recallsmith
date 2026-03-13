using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RecallSmith.Lambda.Common;

public sealed class ValidationError : Exception
{
  public string? Field { get; }

  public ValidationError(string message, string? field = null) : base(message)
  {
    Field = field;
  }
}

public static class Validation
{
  private static readonly Regex DbNameRegex = new("^[a-zA-Z_][a-zA-Z0-9_]{0,62}$", RegexOptions.Compiled);

  public static string? GetHeader(LambdaRequest req, string name)
  {
    if (req.Headers.TryGetValue(name, out var v)) return v;
    return null;
  }

  public static string GetRawBody(LambdaRequest req) => req.RawBody;

  public static JsonDocument? ParseJsonBody(LambdaRequest req)
  {
    var raw = GetRawBody(req);
    if (string.IsNullOrEmpty(raw)) return null;
    try
    {
      return JsonDocument.Parse(raw);
    }
    catch
    {
      return null;
    }
  }

  public static List<string> ParseGroups(JsonElement? raw)
  {
    if (raw is null) return [];
    var v = raw.Value;
    if (v.ValueKind == JsonValueKind.Undefined || v.ValueKind == JsonValueKind.Null) return [];

    if (v.ValueKind == JsonValueKind.Array)
    {
      var outList = new List<string>();
      foreach (var item in v.EnumerateArray())
      {
        if (item.ValueKind == JsonValueKind.Null || item.ValueKind == JsonValueKind.Undefined) continue;
        outList.Add(item.ToString());
      }
      return outList;
    }

    var s = v.ValueKind == JsonValueKind.String ? (v.GetString() ?? string.Empty) : v.ToString();
    s = s.Trim();
    if (s.Length == 0) return [];

    // 1) JSON array
    try
    {
      using var doc = JsonDocument.Parse(s);
      if (doc.RootElement.ValueKind == JsonValueKind.Array)
      {
        return doc.RootElement.EnumerateArray().Select(x => x.ToString()).ToList();
      }
    }
    catch
    {
      // ignore
    }

    // 2) [a,b]
    if (s.StartsWith('[') && s.EndsWith(']')) s = s[1..^1];

    // 3) split by comma or whitespace
    var parts = Regex.Split(s, "[,\\s]+");
    return parts
      .Select(x => x.Trim())
      .Select(x =>
      {
        if (x.Length >= 2 && x.StartsWith('"') && x.EndsWith('"')) return x[1..^1];
        if (x.Length >= 2 && x.StartsWith('\'') && x.EndsWith('\'')) return x[1..^1];
        return x;
      })
      .Where(x => x.Length > 0)
      .ToList();
  }

  public static bool ParseBoolean(string? value, bool defaultValue = false)
  {
    if (value is null) return defaultValue;
    var s = value.Trim().ToLowerInvariant();
    if (s is "1" or "true" or "yes" or "y") return true;
    if (s is "0" or "false" or "no" or "n") return false;
    return defaultValue;
  }

  public static long EnsureInteger(string? value, string fieldName)
  {
    if (!long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
    {
      throw new ValidationError($"{fieldName} must be an integer", fieldName);
    }
    return n;
  }

  public static long EnsureInteger(object? value, string fieldName)
  {
    if (value is null) throw new ValidationError($"{fieldName} must be an integer", fieldName);
    return EnsureInteger(Convert.ToString(value, CultureInfo.InvariantCulture), fieldName);
  }

  public static long RequireInteger(string? value, string fieldName)
  {
    if (string.IsNullOrWhiteSpace(value))
    {
      throw new ValidationError($"{fieldName} is required", fieldName);
    }
    return EnsureInteger(value, fieldName);
  }

  public static long RequireInteger(object? value, string fieldName)
  {
    if (value is null) throw new ValidationError($"{fieldName} is required", fieldName);
    return RequireInteger(Convert.ToString(value, CultureInfo.InvariantCulture), fieldName);
  }

  public static long? ParseOptionalInteger(string? value, string fieldName)
  {
    if (string.IsNullOrWhiteSpace(value)) return null;
    return EnsureInteger(value, fieldName);
  }

  public static long? ParseOptionalMs(string? value)
  {
    if (string.IsNullOrWhiteSpace(value)) return null;
    var s = value.Trim();
    if (Regex.IsMatch(s, "^\\d+$"))
    {
      if (long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var ms)) return ms;
      return null;
    }

    if (!DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
    {
      return null;
    }

    return dto.ToUnixTimeMilliseconds();
  }

  // Supports: /dev/api/v1/... stage prefix
  public static string NormalizePath(string? rawPath)
  {
    var p = string.IsNullOrWhiteSpace(rawPath) ? "/" : rawPath;
    if (!p.StartsWith('/')) p = "/" + p;

    // trim trailing slash
    if (p.Length > 1 && p.EndsWith('/')) p = p[..^1];

    var parts = p.Split('/', StringSplitOptions.RemoveEmptyEntries);
    if (parts.Length >= 2)
    {
      var rest = "/" + string.Join("/", parts.Skip(1));
      if (rest == "/health" || rest.StartsWith("/api/", StringComparison.Ordinal)) return rest;
    }

    return p;
  }

  public static bool IsValidDbName(string name) => DbNameRegex.IsMatch(name);

  public static string DecodeBody(string? body, bool isBase64Encoded)
  {
    if (string.IsNullOrEmpty(body)) return string.Empty;
    if (!isBase64Encoded) return body;

    try
    {
      return Encoding.UTF8.GetString(Convert.FromBase64String(body));
    }
    catch
    {
      return string.Empty;
    }
  }
}
