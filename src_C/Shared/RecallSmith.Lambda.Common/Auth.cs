using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RecallSmith.Lambda.Common;

public sealed record AuthContext(
  IReadOnlyDictionary<string, JsonElement> Claims,
  string? UserSub,
  string? Username,
  List<string> Groups,
  bool IsSuperAdmin,
  bool IsEditor,
  bool IsAdmin);

public readonly record struct InternalSignatureVerifyResult(bool Ok, string? Reason);

public static class Auth
{
  private static Dictionary<string, JsonElement> DecodeJwtWithoutVerify(string? authHeader)
  {
    if (string.IsNullOrWhiteSpace(authHeader)) return [];

    const string prefix = "bearer ";
    if (!authHeader.TrimStart().StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return [];

    var token = authHeader.Trim()[prefix.Length..].Trim();
    var parts = token.Split('.');
    if (parts.Length != 3) return [];

    try
    {
      var payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(parts[1]));
      using var doc = JsonDocument.Parse(payloadJson);
      if (doc.RootElement.ValueKind != JsonValueKind.Object) return [];
      return ToDictionary(doc.RootElement);
    }
    catch
    {
      return [];
    }
  }

  private static Dictionary<string, JsonElement> ExtractClaims(LambdaRequest req)
  {
    var evt = req.RawEvent;
    if (evt.TryGetProperty("requestContext", out var rc) && rc.ValueKind == JsonValueKind.Object)
    {
      if (rc.TryGetProperty("authorizer", out var authz) && authz.ValueKind == JsonValueKind.Object)
      {
        if (authz.TryGetProperty("jwt", out var jwt) && jwt.ValueKind == JsonValueKind.Object)
        {
          if (jwt.TryGetProperty("claims", out var claims) && claims.ValueKind == JsonValueKind.Object)
          {
            return ToDictionary(claims);
          }
        }

        if (authz.TryGetProperty("claims", out var legacyClaims) && legacyClaims.ValueKind == JsonValueKind.Object)
        {
          return ToDictionary(legacyClaims);
        }
      }
    }

    // fallback for local/dev (NOT SECURE)
    req.Headers.TryGetValue("authorization", out var authHeader);
    return DecodeJwtWithoutVerify(authHeader);
  }

  public static AuthContext GetAuthContext(LambdaRequest req)
  {
    var claims = ExtractClaims(req);

    claims.TryGetValue("cognito:groups", out var g1);
    claims.TryGetValue("cognito_groups", out var g2);
    claims.TryGetValue("groups", out var g3);

    var rawGroups = g1.ValueKind != JsonValueKind.Undefined ? (JsonElement?)g1
      : g2.ValueKind != JsonValueKind.Undefined ? (JsonElement?)g2
      : g3.ValueKind != JsonValueKind.Undefined ? (JsonElement?)g3
      : null;

    var groups = Validation.ParseGroups(rawGroups);
    var groupsLower = groups.Select(g => g.ToLowerInvariant()).ToList();
    var set = new HashSet<string>(groupsLower, StringComparer.Ordinal);

    var isSuperAdmin = set.Contains("super_admin");
    var isEditor = set.Contains("editor") || groupsLower.Any(g => g.StartsWith("editor_", StringComparison.Ordinal));
    var isAdmin = isSuperAdmin || isEditor;

    var userSub = GetStringClaim(claims, "sub");
    var username =
      GetStringClaim(claims, "cognito:username") ??
      GetStringClaim(claims, "username");

    return new AuthContext(
      Claims: claims,
      UserSub: userSub,
      Username: username,
      Groups: groups,
      IsSuperAdmin: isSuperAdmin,
      IsEditor: isEditor,
      IsAdmin: isAdmin);
  }

  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RequireUser(AuthContext auth, Res res)
  {
    if (string.IsNullOrWhiteSpace(auth.UserSub)) return res.Forbidden("Requires authenticated user");
    return null;
  }

  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RequireAdmin(AuthContext auth, Res res)
  {
    if (!auth.IsAdmin) return res.Forbidden("Requires editor or super_admin");
    return null;
  }

  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RequireSuperAdmin(AuthContext auth, Res res)
  {
    if (!auth.IsSuperAdmin) return res.Forbidden("Requires super_admin");
    return null;
  }

  public static InternalSignatureVerifyResult VerifyInternalSignature(LambdaRequest req)
  {
    var secret = Environment.GetEnvironmentVariable("INTERNAL_SHARED_SECRET");
    if (string.IsNullOrEmpty(secret)) return new InternalSignatureVerifyResult(false, "Missing INTERNAL_SHARED_SECRET");

    var tsRaw = Validation.GetHeader(req, "x-internal-timestamp");
    var sigRaw = Validation.GetHeader(req, "x-internal-signature");
    if (string.IsNullOrEmpty(tsRaw) || string.IsNullOrEmpty(sigRaw))
    {
      return new InternalSignatureVerifyResult(false, "Missing internal headers");
    }

    if (!long.TryParse(tsRaw, out var ts) || ts <= 0) return new InternalSignatureVerifyResult(false, "Bad timestamp");

    var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var skewMs = Math.Abs(now - ts);
    if (skewMs > 5 * 60 * 1000) return new InternalSignatureVerifyResult(false, "Timestamp expired");

    var rawBody = Validation.GetRawBody(req);
    var msg = $"{ts}.{rawBody}";
    var expected = "v1=" + HmacSha256Hex(secret, msg);

    try
    {
      var a = Encoding.UTF8.GetBytes(sigRaw);
      var b = Encoding.UTF8.GetBytes(expected);
      if (a.Length != b.Length) return new InternalSignatureVerifyResult(false, "Signature length mismatch");
      var ok = CryptographicOperations.FixedTimeEquals(a, b);
      return ok ? new InternalSignatureVerifyResult(true, null) : new InternalSignatureVerifyResult(false, "Bad signature");
    }
    catch
    {
      return new InternalSignatureVerifyResult(false, "Signature verify error");
    }
  }

  private static string? GetStringClaim(IReadOnlyDictionary<string, JsonElement> claims, string key)
  {
    if (!claims.TryGetValue(key, out var el)) return null;
    if (el.ValueKind == JsonValueKind.Undefined || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind == JsonValueKind.String) return el.GetString();
    return el.ToString();
  }

  private static string HmacSha256Hex(string secret, string message)
  {
    using var h = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var bytes = h.ComputeHash(Encoding.UTF8.GetBytes(message));
    return Convert.ToHexString(bytes).ToLowerInvariant();
  }

  private static byte[] Base64UrlDecode(string input)
  {
    var s = input.Replace('-', '+').Replace('_', '/');
    switch (s.Length % 4)
    {
      case 2: s += "=="; break;
      case 3: s += "="; break;
    }
    return Convert.FromBase64String(s);
  }

  private static Dictionary<string, JsonElement> ToDictionary(JsonElement obj)
  {
    var dict = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
    foreach (var p in obj.EnumerateObject())
    {
      dict[p.Name] = p.Value.Clone();
    }
    return dict;
  }
}
