using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RecallSmith.Lambda.Common;

/// <param name="RejectReason">
/// Non-null when the request carried a bearer token that failed verification (see
/// <see cref="CognitoJwtVerifier"/>): the short reason code, never any part of the token. The
/// context is then anonymous -- no sub, no groups -- and every <c>Require*</c> gate answers
/// 401 rather than 403, so a client with an expired token is told to sign in again instead of
/// being told it lacks a role. Null for a request with no token, a token the API Gateway
/// authorizer already verified, or a token this code verified.
/// </param>
public sealed record AuthContext(
  IReadOnlyDictionary<string, JsonElement> Claims,
  string? UserSub,
  string? Username,
  List<string> Groups,
  bool IsSuperAdmin,
  bool IsEditor,
  bool IsAdmin,
  string? RejectReason = null);

/// <summary>
/// The two environment-driven knobs of bearer verification, parsed once per container.
/// </summary>
/// <param name="Issuers">Canonical issuer URLs (AUTH_ISSUERS, defaulting to today's two pools).</param>
/// <param name="AllowUnverified">
/// True only when AUTH_ALLOW_UNVERIFIED=1 AND API_ENV is not "production". This is the old
/// "decode the payload and believe it" path, kept for local development against a gateway that
/// has no authorizer, and it cannot be switched on in production by any environment variable.
/// </param>
public sealed record AuthOptions(IReadOnlyList<string> Issuers, bool AllowUnverified)
{
  public const string IssuersEnv = "AUTH_ISSUERS";
  public const string AllowUnverifiedEnv = "AUTH_ALLOW_UNVERIFIED";
  public const string ApiEnvEnv = "API_ENV";

  /// <summary>Pure: the whole policy as a function of three strings, so it can be tested without touching the process environment.</summary>
  public static AuthOptions Parse(string? issuersEnv, string? allowUnverifiedEnv, string? apiEnv)
  {
    var issuers = CognitoJwtVerifier.ParseIssuers(issuersEnv);
    var flagOn = string.Equals(allowUnverifiedEnv?.Trim(), "1", StringComparison.Ordinal);
    var isProduction = string.Equals(apiEnv?.Trim(), "production", StringComparison.OrdinalIgnoreCase);
    return new AuthOptions(issuers, AllowUnverified: flagOn && !isProduction);
  }

  public static AuthOptions FromEnvironment() => Parse(
    Environment.GetEnvironmentVariable(IssuersEnv),
    Environment.GetEnvironmentVariable(AllowUnverifiedEnv),
    Environment.GetEnvironmentVariable(ApiEnvEnv));
}

public readonly record struct InternalSignatureVerifyResult(bool Ok, string? Reason);

public static class Auth
{
  private static readonly object ConfigLock = new();
  private static AuthOptions? _options;
  private static CognitoJwtVerifier? _verifier;
  private static IJwksProvider _jwksProvider = new HttpJwksProvider();
  private static Func<string, string?>? _jwksSeed = BundledJwks.Read;

  /// <summary>The active policy. Read lazily from the environment; the first read is where the dev-mode warning is printed.</summary>
  public static AuthOptions Options
  {
    get
    {
      lock (ConfigLock)
      {
        return _options ??= LoadOptionsFromEnvironment();
      }
    }
  }

  private static CognitoJwtVerifier Verifier
  {
    get
    {
      lock (ConfigLock)
      {
        return _verifier ??= new CognitoJwtVerifier(_jwksProvider, Options.Issuers, _jwksSeed);
      }
    }
  }

  /// <summary>
  /// Called from the function constructors so the policy is read, and its warning printed,
  /// during INIT rather than on the first request. Also builds the verifier, so the first
  /// request pays for a JWKS fetch at most and not for construction too.
  /// </summary>
  public static void EnsureConfigured() => _ = Verifier;

  /// <summary>
  /// Test seam: swap the policy, the live JWKS source and (by default, none) the cold-start
  /// seed. Pair with <see cref="ResetToEnvironment"/>.
  /// </summary>
  public static void Configure(AuthOptions options, IJwksProvider jwksProvider, Func<string, string?>? jwksSeed = null)
  {
    lock (ConfigLock)
    {
      _options = options;
      _jwksProvider = jwksProvider;
      _jwksSeed = jwksSeed;
      _verifier = null;
    }
  }

  public static void ResetToEnvironment()
  {
    lock (ConfigLock)
    {
      _options = null;
      _jwksProvider = new HttpJwksProvider();
      _jwksSeed = BundledJwks.Read;
      _verifier = null;
    }
  }

  private static AuthOptions LoadOptionsFromEnvironment()
  {
    var options = AuthOptions.FromEnvironment();
    if (options.AllowUnverified)
    {
      // Loud on purpose. This line means the API believes any bearer token it is handed.
      Log.Warn(JsonSerializer.Serialize(new
      {
        level = "warn",
        tag = "auth",
        reason = "unverified_jwt_enabled",
        message = $"{AuthOptions.AllowUnverifiedEnv}=1 and {AuthOptions.ApiEnvEnv} is not production: bearer tokens are decoded WITHOUT signature verification. Never run this outside local/dev.",
      }));
    }
    return options;
  }

  /// <summary>The token from "Authorization: Bearer ...", or null when the header is absent or uses another scheme.</summary>
  private static string? ExtractBearer(LambdaRequest req)
  {
    req.Headers.TryGetValue("authorization", out var authHeader);
    if (string.IsNullOrWhiteSpace(authHeader)) return null;

    const string prefix = "bearer ";
    if (!authHeader.TrimStart().StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return null;

    var token = authHeader.Trim()[prefix.Length..].Trim();
    return token.Length == 0 ? null : token;
  }

  /// <summary>
  /// The pre-2026-09-22 behaviour: read the payload and believe it. Reachable only through
  /// <see cref="AuthOptions.AllowUnverified"/>, which cannot be true in production.
  /// </summary>
  private static Dictionary<string, JsonElement> DecodeJwtWithoutVerify(string token)
  {
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

  /// <summary>
  /// Claims the API Gateway JWT authorizer already verified, or null when the event carries
  /// none. First choice, unchanged: when a gateway authorizer is configured this is the only
  /// path that runs, and the in-process verifier below is never consulted.
  /// </summary>
  private static Dictionary<string, JsonElement>? TryGetAuthorizerClaims(LambdaRequest req)
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

    return null;
  }

  /// <summary>
  /// The caller's identity, in order of trust: claims the gateway authorizer verified; else the
  /// bearer token verified in-process against the issuer's JWKS; else anonymous. A bearer that
  /// fails verification yields an anonymous context carrying <see cref="AuthContext.RejectReason"/>,
  /// and one structured log line -- never a throw, because webhooks and internal routes carry
  /// non-JWT Authorization headers through this same dispatch and decide for themselves.
  /// </summary>
  public static async Task<AuthContext> GetAuthContextAsync(LambdaRequest req, CancellationToken ct = default)
  {
    var authorizerClaims = TryGetAuthorizerClaims(req);
    if (authorizerClaims is not null) return Build(authorizerClaims, rejectReason: null);

    var token = ExtractBearer(req);
    if (token is null) return Build(new Dictionary<string, JsonElement>(StringComparer.Ordinal), rejectReason: null);

    if (Options.AllowUnverified) return Build(DecodeJwtWithoutVerify(token), rejectReason: null);

    var result = await Verifier.VerifyAsync(token, ct);
    if (!result.Ok)
    {
      var line = JsonSerializer.Serialize(new
      {
        tag = "auth",
        reason = result.Reason,
        traceId = req.TraceId,
        method = req.Method,
        path = req.Path,
      });
      // A bearer that is not even JWT-shaped is a webhook secret or noise, not an attack on
      // the signature check; it goes to the info log so the warn stream stays about tokens
      // that tried and failed.
      if (result.Reason == "malformed") Log.Info(line); else Log.Warn(line);
      return Build(new Dictionary<string, JsonElement>(StringComparer.Ordinal), rejectReason: result.Reason);
    }

    return Build(result.Claims!, rejectReason: null);
  }

  private static AuthContext Build(IReadOnlyDictionary<string, JsonElement> claims, string? rejectReason)
  {
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
      IsAdmin: isAdmin,
      RejectReason: rejectReason);
  }

  /// <summary>
  /// 401 for a token that was presented and rejected, before any role check. Sits in front of
  /// all three gates so that no route has to remember it; a route that reads
  /// <c>auth.IsSuperAdmin</c> directly still denies (the context is anonymous), it just says 403.
  /// Public for the one route (premium-url) that has its own login wording.
  /// </summary>
  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RejectIfBadToken(AuthContext auth, Res res)
  {
    if (auth.RejectReason is null) return null;
    return res.Unauthorized($"Invalid bearer token ({auth.RejectReason})");
  }

  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RequireUser(AuthContext auth, Res res)
  {
    var bad = RejectIfBadToken(auth, res);
    if (bad is not null) return bad;
    if (string.IsNullOrWhiteSpace(auth.UserSub)) return res.Forbidden("Requires authenticated user");
    return null;
  }

  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RequireAdmin(AuthContext auth, Res res)
  {
    var bad = RejectIfBadToken(auth, res);
    if (bad is not null) return bad;
    if (!auth.IsAdmin) return res.Forbidden("Requires editor or super_admin");
    return null;
  }

  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RequireSuperAdmin(AuthContext auth, Res res)
  {
    var bad = RejectIfBadToken(auth, res);
    if (bad is not null) return bad;
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
