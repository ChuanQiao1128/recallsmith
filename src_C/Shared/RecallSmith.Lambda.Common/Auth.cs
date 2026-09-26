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
/// <param name="AdminDenyReason">
/// Non-null when the claims carried an admin group (<c>super_admin</c>/<c>editor</c>) but failed
/// the console binding: <c>"admin_issuer"</c> when the token was not minted by the console pool,
/// or <c>"admin_client"</c> when it was not minted by a configured console app client. The three
/// role flags are then false while the identity (sub, username, groups) is preserved, so
/// <see cref="Auth.RequireUser"/> still passes and <see cref="Auth.RequireAdmin"/>/
/// <see cref="Auth.RequireSuperAdmin"/> answer 403 "Requires a console token". Null when the
/// binding passed or the claims never carried an admin group.
/// </param>
public sealed record AuthContext(
  IReadOnlyDictionary<string, JsonElement> Claims,
  string? UserSub,
  string? Username,
  List<string> Groups,
  bool IsSuperAdmin,
  bool IsEditor,
  bool IsAdmin,
  string? RejectReason = null,
  string? AdminDenyReason = null);

/// <summary>
/// The two environment-driven knobs of bearer verification, parsed once per container.
/// </summary>
/// <param name="Issuers">Canonical issuer URLs (AUTH_ISSUERS, defaulting to today's two pools).</param>
/// <param name="AllowUnverified">
/// True only when AUTH_ALLOW_UNVERIFIED=1 AND API_ENV is not "production". This is the old
/// "decode the payload and believe it" path, kept for local development against a gateway that
/// has no authorizer, and it cannot be switched on in production by any environment variable.
/// </param>
/// <param name="ConsoleIssuer">
/// The canonical issuer URL of the console pool. The admin role flags are granted only to claims
/// that came from this issuer (see <see cref="Auth.ConsoleBindingFailure"/>). Always set by
/// <see cref="Parse"/>; null only for a hand-built <see cref="AuthOptions"/>, which turns the
/// binding off.
/// </param>
/// <param name="ConsoleClientIds">
/// The console app client ids (AUTH_CONSOLE_CLIENT_IDS). When non-empty, an admin token must also
/// carry a matching <c>client_id</c> (access tokens) or <c>aud</c> (id tokens). Empty means the
/// client check is off and only the issuer is enforced.
/// </param>
public sealed record AuthOptions(IReadOnlyList<string> Issuers, bool AllowUnverified, string? ConsoleIssuer = null, IReadOnlyList<string>? ConsoleClientIds = null)
{
  public const string IssuersEnv = "AUTH_ISSUERS";
  public const string AllowUnverifiedEnv = "AUTH_ALLOW_UNVERIFIED";
  public const string ApiEnvEnv = "API_ENV";
  public const string ConsoleIssuerEnv = "AUTH_CONSOLE_ISSUER";
  public const string ConsoleClientIdsEnv = "AUTH_CONSOLE_CLIENT_IDS";
  public const string DefaultConsolePool = "ap-southeast-2_4Vf8uCXKt";

  /// <summary>Pure: the whole policy as a function of its strings, so it can be tested without touching the process environment.</summary>
  public static AuthOptions Parse(string? issuersEnv, string? allowUnverifiedEnv, string? apiEnv, string? consoleIssuerEnv = null, string? consoleClientIdsEnv = null)
  {
    var issuers = CognitoJwtVerifier.ParseIssuers(issuersEnv);
    var flagOn = string.Equals(allowUnverifiedEnv?.Trim(), "1", StringComparison.Ordinal);
    var isProduction = string.Equals(apiEnv?.Trim(), "production", StringComparison.OrdinalIgnoreCase);

    // Always set, fail closed: a malformed AUTH_CONSOLE_ISSUER throws in NormalizeIssuer just as
    // a malformed AUTH_ISSUERS does, rather than silently disabling the console binding.
    var consoleIssuer = CognitoJwtVerifier.NormalizeIssuer(
      string.IsNullOrWhiteSpace(consoleIssuerEnv) ? DefaultConsolePool : consoleIssuerEnv);

    var consoleClientIds = (consoleClientIdsEnv ?? string.Empty)
      .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Distinct(StringComparer.Ordinal)
      .ToList();

    return new AuthOptions(
      issuers,
      AllowUnverified: flagOn && !isProduction,
      ConsoleIssuer: consoleIssuer,
      ConsoleClientIds: consoleClientIds);
  }

  public static AuthOptions FromEnvironment() => Parse(
    Environment.GetEnvironmentVariable(IssuersEnv),
    Environment.GetEnvironmentVariable(AllowUnverifiedEnv),
    Environment.GetEnvironmentVariable(ApiEnvEnv),
    Environment.GetEnvironmentVariable(ConsoleIssuerEnv),
    Environment.GetEnvironmentVariable(ConsoleClientIdsEnv));
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
    if (authorizerClaims is not null) return LogAdminDeny(Build(authorizerClaims, rejectReason: null, gatewayVerified: true), req);

    var token = ExtractBearer(req);
    if (token is null) return Build(new Dictionary<string, JsonElement>(StringComparer.Ordinal), rejectReason: null, gatewayVerified: false);

    if (Options.AllowUnverified) return LogAdminDeny(Build(DecodeJwtWithoutVerify(token), rejectReason: null, gatewayVerified: false), req);

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
      return Build(new Dictionary<string, JsonElement>(StringComparer.Ordinal), rejectReason: result.Reason, gatewayVerified: false);
    }

    return LogAdminDeny(Build(result.Claims!, rejectReason: null, gatewayVerified: false), req);
  }

  /// <summary>
  /// One structured warn line when a verified identity carried an admin group but failed the
  /// console binding. Never logs a claim value -- only the reason code and the request's own
  /// coordinates -- and returns the context unchanged so it composes into the return path.
  /// </summary>
  private static AuthContext LogAdminDeny(AuthContext ctx, LambdaRequest req)
  {
    if (ctx.AdminDenyReason is not null)
    {
      Log.Warn(JsonSerializer.Serialize(new
      {
        tag = "auth",
        reason = ctx.AdminDenyReason,
        traceId = req.TraceId,
        method = req.Method,
        path = req.Path,
      }));
    }
    return ctx;
  }

  /// <summary>
  /// The console binding: returns null when <paramref name="claims"/> may carry console admin
  /// roles, otherwise the reason a token minted outside the console pool or client is denied them.
  /// Pure so it can be tested without a request. <paramref name="gatewayVerified"/> is true only
  /// for claims the API Gateway authorizer produced (or an IAM-level invoke), where an absent
  /// <c>iss</c>/client claim is trusted by design; false for anything this code decoded itself.
  /// </summary>
  public static string? ConsoleBindingFailure(IReadOnlyDictionary<string, JsonElement> claims, AuthOptions options, bool gatewayVerified)
  {
    // Binding off: only a hand-constructed AuthOptions can leave ConsoleIssuer null; Parse always sets it.
    if (options.ConsoleIssuer is null) return null;

    var iss = GetStringClaim(claims, "iss")?.TrimEnd('/');
    if (iss is null)
    {
      if (!gatewayVerified) return "admin_issuer";
    }
    else if (!string.Equals(iss, options.ConsoleIssuer, StringComparison.Ordinal))
    {
      return "admin_issuer";
    }

    if (options.ConsoleClientIds is { Count: > 0 } clientIds)
    {
      var clients = GetClientClaims(claims);
      if (clients.Count == 0)
      {
        if (!gatewayVerified) return "admin_client";
      }
      else if (!clients.Any(c => clientIds.Contains(c, StringComparer.Ordinal)))
      {
        return "admin_client";
      }
    }

    return null;
  }

  /// <summary>
  /// The client-identifying values on the token: <c>client_id</c> (access tokens) when present,
  /// else <c>aud</c> (id tokens; a string, or an array of strings). Empty when neither is present.
  /// </summary>
  private static List<string> GetClientClaims(IReadOnlyDictionary<string, JsonElement> claims)
  {
    var clientId = GetStringClaim(claims, "client_id");
    if (clientId is not null) return [clientId];

    if (!claims.TryGetValue("aud", out var aud)) return [];
    if (aud.ValueKind == JsonValueKind.String)
    {
      var s = aud.GetString();
      return s is null ? [] : [s];
    }
    if (aud.ValueKind == JsonValueKind.Array)
    {
      var list = new List<string>();
      foreach (var el in aud.EnumerateArray())
      {
        if (el.ValueKind == JsonValueKind.String)
        {
          var s = el.GetString();
          if (s is not null) list.Add(s);
        }
      }
      return list;
    }
    return [];
  }

  private static AuthContext Build(IReadOnlyDictionary<string, JsonElement> claims, string? rejectReason, bool gatewayVerified)
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

    // The console binding: an admin group only counts when the claims came from the console pool
    // and, when configured, a console app client. A token that fails the binding keeps its
    // identity (sub/username/groups) but loses its roles; the gates then answer 403.
    string? adminDenyReason = null;
    if (isSuperAdmin || isEditor)
    {
      adminDenyReason = ConsoleBindingFailure(claims, Options, gatewayVerified);
      if (adminDenyReason is not null)
      {
        isSuperAdmin = false;
        isEditor = false;
        isAdmin = false;
      }
    }

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
      RejectReason: rejectReason,
      AdminDenyReason: adminDenyReason);
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
    if (auth.AdminDenyReason is not null) return res.Forbidden("Requires a console token");
    if (!auth.IsAdmin) return res.Forbidden("Requires editor or super_admin");
    return null;
  }

  public static Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse? RequireSuperAdmin(AuthContext auth, Res res)
  {
    var bad = RejectIfBadToken(auth, res);
    if (bad is not null) return bad;
    if (auth.AdminDenyReason is not null) return res.Forbidden("Requires a console token");
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
