using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace RecallSmith.Lambda.Common;

/// <summary>
/// Fetches the raw JWKS document (RFC 7517) for one issuer. The verifier owns the cache and
/// the retry policy; a provider only knows how to get the bytes. Injected so the unit tests
/// can serve a key set they minted in-process, and count how often it was asked for.
/// </summary>
public interface IJwksProvider
{
  /// <param name="issuer">The full issuer URL, e.g. https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_xxx.</param>
  /// <returns>The JWKS JSON. Any exception means "unavailable" and is treated as a rejection.</returns>
  Task<string> FetchAsync(string issuer, CancellationToken ct);
}

/// <summary>GET {issuer}/.well-known/jwks.json with a hard 3 s budget.</summary>
/// <remarks>
/// One static HttpClient for the container's lifetime, which is the documented way to use it
/// and also the cheap way: the TLS handshake to Cognito is paid once per cold start, not once
/// per token. 3 s rather than the client's 100 s default because a slow JWKS endpoint must not
/// turn into a slow API -- the caller answers 401 on timeout and the next request tries again.
/// </remarks>
public sealed class HttpJwksProvider : IJwksProvider
{
  public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(3);

  private static readonly HttpClient Client = new() { Timeout = Timeout };

  public async Task<string> FetchAsync(string issuer, CancellationToken ct)
  {
    var url = issuer.TrimEnd('/') + "/.well-known/jwks.json";
    using var response = await Client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
    response.EnsureSuccessStatusCode();
    return await response.Content.ReadAsStringAsync(ct);
  }
}

/// <summary>
/// The JWKS documents shipped inside the deployment package, one file per pool id under
/// <c>Jwks/</c> next to the assembly. They seed the verifier's cache at cold start so that a
/// function with no internet egress (core-vpc: VPC, no NAT) can verify without a network call.
/// </summary>
/// <remarks>
/// Public keys only, so a stale or missing file can never make a forged token pass: it can
/// only make a genuine one fail, and then only for a key the file does not list. Cognito user
/// pool signing keys are not rotated on a schedule, so the expected life of these files is the
/// life of the pools. If a pool is ever recreated, re-run the curl in the csproj comment.
/// </remarks>
public static class BundledJwks
{
  public const string Directory = "Jwks";

  public static string? Read(string issuer) => Read(issuer, AppContext.BaseDirectory);

  public static string? Read(string issuer, string baseDirectory)
  {
    var poolId = issuer.TrimEnd('/');
    var slash = poolId.LastIndexOf('/');
    if (slash >= 0) poolId = poolId[(slash + 1)..];
    if (poolId.Length == 0 || poolId.Contains("..", StringComparison.Ordinal)) return null;

    var path = Path.Combine(baseDirectory, Directory, poolId + ".json");
    try
    {
      return File.Exists(path) ? File.ReadAllText(path) : null;
    }
    catch
    {
      return null;
    }
  }
}

/// <summary>
/// The outcome of verifying one bearer token. <see cref="Reason"/> is a short stable code
/// ("ok", "expired", "signature", ...) meant for logs and for the 401 message; it never
/// carries any part of the token.
/// </summary>
public sealed record JwtVerifyResult(bool Ok, string Reason, IReadOnlyDictionary<string, JsonElement>? Claims)
{
  public static JwtVerifyResult Fail(string reason) => new(false, reason, null);
}

/// <summary>
/// Verifies a Cognito-issued JWT the way an API Gateway JWT authorizer would, in-process:
/// RS256 signature against the issuer's JWKS, issuer in the allowed set, exp/nbf with 60 s of
/// skew, and token_use of access or id.
/// </summary>
/// <remarks>
/// <para>
/// This exists because the HTTP API in front of core-vpc has <c>AuthorizationType NONE</c> on
/// every route, so nothing between the internet and <see cref="Auth"/> checks a signature.
/// Until the gateway authorizers land this class IS the authentication of the API, and it is
/// written to stay correct after they land too: a token the gateway already verified never
/// reaches it (see <see cref="Auth.GetAuthContextAsync"/>), so the cost of keeping it is one
/// code path that only runs for requests the gateway did not vouch for.
/// </para>
/// <para>
/// Key handling. The JWKS for each issuer is read from the bundled copy (<see cref="BundledJwks"/>)
/// or fetched on first use, and cached for the life of the container; a token whose
/// <c>kid</c> is not in the cache triggers one re-fetch from the live source, which
/// is how a rotated Cognito key is picked up without a redeploy. Fruitless re-fetches are
/// rate-limited (<see cref="RefreshCooldown"/>): without a floor, any unauthenticated caller
/// could make every request cost an outbound HTTPS round trip just by inventing a <c>kid</c>,
/// which is a 3 s stall per request for the price of a random string. A key that is genuinely
/// new is found by the first refresh; the cooldown only starts after a refresh that did not
/// find what it was sent for.
/// </para>
/// <para>
/// Fail closed, everywhere. A JWKS that cannot be fetched or parsed, an unknown key, an
/// algorithm other than RS256 (including <c>none</c>), a missing <c>kid</c> -- each is a
/// rejection, never a pass-through. There is no mode of this class that accepts a token it did
/// not verify; the unverified decode lives in <see cref="Auth"/> behind its own flag.
/// </para>
/// </remarks>
public sealed class CognitoJwtVerifier
{
  /// <summary>The two pools that exist today: console (4Vf8uCXKt) and mobile (04hd6iisb).</summary>
  public const string DefaultIssuers = "ap-southeast-2_4Vf8uCXKt,ap-southeast-2_04hd6iisb";

  public static readonly TimeSpan ClockSkew = TimeSpan.FromSeconds(60);
  public static readonly TimeSpan RefreshCooldown = TimeSpan.FromSeconds(30);

  private const string RequiredAlgorithm = "RS256";

  private readonly IJwksProvider _jwks;
  private readonly Func<string, string?>? _seed;
  private readonly HashSet<string> _issuers;
  private readonly ConcurrentDictionary<string, KeySet> _cache = new(StringComparer.Ordinal);
  private readonly ConcurrentDictionary<string, DateTimeOffset> _lastFruitlessRefresh = new(StringComparer.Ordinal);
  private readonly SemaphoreSlim _fetchGate = new(1, 1);
  private readonly JsonWebTokenHandler _handler = new();

  /// <param name="jwks">The live source, consulted on a cold cache with no seed and on an unknown kid.</param>
  /// <param name="issuers">Pool ids or issuer URLs; see <see cref="NormalizeIssuer"/>.</param>
  /// <param name="seed">
  /// Optional cold-start fill: given an issuer, the JWKS JSON to start from, or null for "none
  /// bundled". Production passes <see cref="BundledJwks.Read(string)"/>; tests pass what they
  /// need or nothing.
  /// </param>
  public CognitoJwtVerifier(IJwksProvider jwks, IEnumerable<string> issuers, Func<string, string?>? seed = null)
  {
    _jwks = jwks;
    _seed = seed;
    _issuers = new HashSet<string>(issuers.Select(NormalizeIssuer), StringComparer.Ordinal);
    if (_issuers.Count == 0) throw new ArgumentException("At least one issuer is required", nameof(issuers));
  }

  public IReadOnlyCollection<string> Issuers => _issuers;

  /// <summary>
  /// Accepts either a bare pool id ("ap-southeast-2_xxx", region taken from the prefix) or a
  /// full issuer URL, and returns the canonical issuer URL Cognito writes into <c>iss</c>.
  /// </summary>
  public static string NormalizeIssuer(string raw)
  {
    var s = raw.Trim().TrimEnd('/');
    if (s.Length == 0) throw new ArgumentException("Empty issuer", nameof(raw));
    if (s.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || s.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
    {
      return s;
    }

    var underscore = s.IndexOf('_');
    if (underscore <= 0) throw new ArgumentException($"Not a Cognito pool id or issuer URL: {raw}", nameof(raw));
    var region = s[..underscore];
    return $"https://cognito-idp.{region}.amazonaws.com/{s}";
  }

  /// <summary>AUTH_ISSUERS parsing: comma-separated pool ids or URLs; unset/blank means the defaults.</summary>
  public static IReadOnlyList<string> ParseIssuers(string? env)
  {
    var source = string.IsNullOrWhiteSpace(env) ? DefaultIssuers : env;
    return source
      .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Select(NormalizeIssuer)
      .Distinct(StringComparer.Ordinal)
      .ToList();
  }

  public async Task<JwtVerifyResult> VerifyAsync(string token, CancellationToken ct = default)
  {
    JsonWebToken jwt;
    try
    {
      if (string.IsNullOrWhiteSpace(token) || !_handler.CanReadToken(token)) return JwtVerifyResult.Fail("malformed");
      jwt = _handler.ReadJsonWebToken(token);
    }
    catch
    {
      return JwtVerifyResult.Fail("malformed");
    }

    // Everything below that can be decided from the header and the unverified payload is
    // decided BEFORE any key lookup. That ordering is the point: an alg=none token, a foreign
    // issuer or a refresh token must not be able to cause a JWKS fetch, because the fetch is
    // the only expensive thing here and the only thing that touches the network.
    if (!string.Equals(jwt.Alg, RequiredAlgorithm, StringComparison.Ordinal)) return JwtVerifyResult.Fail("alg");

    var issuer = (jwt.Issuer ?? string.Empty).TrimEnd('/');
    if (!_issuers.Contains(issuer)) return JwtVerifyResult.Fail("issuer");

    if (!jwt.TryGetPayloadValue<string>("token_use", out var tokenUse) ||
        (tokenUse != "access" && tokenUse != "id"))
    {
      return JwtVerifyResult.Fail("token_use");
    }

    var kid = jwt.Kid;
    if (string.IsNullOrEmpty(kid)) return JwtVerifyResult.Fail("kid");

    JsonWebKey? key;
    try
    {
      key = await ResolveKeyAsync(issuer, kid, ct);
    }
    catch (OperationCanceledException) when (ct.IsCancellationRequested)
    {
      throw;
    }
    catch
    {
      return JwtVerifyResult.Fail("jwks_unavailable");
    }
    if (key is null) return JwtVerifyResult.Fail("unknown_kid");

    var parameters = new TokenValidationParameters
    {
      ValidateIssuer = true,
      ValidIssuer = issuer,
      // Cognito access tokens carry client_id, not aud; the authorizer that will eventually
      // sit in front of this checks the audience per pool. Here the issuer set is the trust
      // boundary, and an id token from a pool we trust is as good as its access token.
      ValidateAudience = false,
      ValidateLifetime = true,
      RequireExpirationTime = true,
      ClockSkew = ClockSkew,
      RequireSignedTokens = true,
      IssuerSigningKey = key,
      ValidAlgorithms = [RequiredAlgorithm],
    };

    TokenValidationResult result;
    try
    {
      result = await _handler.ValidateTokenAsync(token, parameters);
    }
    catch
    {
      return JwtVerifyResult.Fail("invalid");
    }
    if (!result.IsValid) return JwtVerifyResult.Fail(ReasonFor(result.Exception));

    // The claims as JSON, not as the handler's flattened ClaimsIdentity: cognito:groups is an
    // array and Auth's group parsing already understands arrays, strings and the "[a b]"
    // spelling the API Gateway authorizer uses. Re-reading the payload segment is safe because
    // the signature just verified covers exactly those bytes.
    try
    {
      var payloadJson = Encoding.UTF8.GetString(Base64UrlEncoder.DecodeBytes(jwt.EncodedPayload));
      using var doc = JsonDocument.Parse(payloadJson);
      if (doc.RootElement.ValueKind != JsonValueKind.Object) return JwtVerifyResult.Fail("malformed");
      var claims = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
      foreach (var p in doc.RootElement.EnumerateObject()) claims[p.Name] = p.Value.Clone();
      return new JwtVerifyResult(true, "ok", claims);
    }
    catch
    {
      return JwtVerifyResult.Fail("malformed");
    }
  }

  private static string ReasonFor(Exception? ex) => ex switch
  {
    SecurityTokenExpiredException => "expired",
    SecurityTokenNotYetValidException => "not_yet_valid",
    SecurityTokenNoExpirationException => "no_exp",
    SecurityTokenInvalidSignatureException => "signature",
    SecurityTokenInvalidIssuerException => "issuer",
    SecurityTokenInvalidAlgorithmException => "alg",
    _ => "invalid",
  };

  /// <summary>
  /// The key for (issuer, kid) from the cache, fetching on a cold cache and re-fetching once
  /// when the kid is unknown. Null means "not in the JWKS"; a thrown exception means "could
  /// not get the JWKS", and the caller keeps the two apart.
  /// </summary>
  /// <remarks>
  /// The cooldown is keyed on the last refresh that came back WITHOUT the kid it was looking
  /// for, not on the last fetch of any kind. The cold fetch never counts, so a key rotated
  /// seconds after a container started is still found by its first refresh; only a refresh
  /// that already proved fruitless suppresses the next one. That is the narrowest rule that
  /// still denies an unauthenticated caller the ability to trigger a fetch per request.
  /// </remarks>
  private async Task<JsonWebKey?> ResolveKeyAsync(string issuer, string kid, CancellationToken ct)
  {
    if (_cache.TryGetValue(issuer, out var cached) && cached.ByKid.TryGetValue(kid, out var hit)) return hit;

    await _fetchGate.WaitAsync(ct);
    try
    {
      // Re-check under the gate: a request that queued behind a fetch for the same issuer
      // gets that fetch's result instead of starting its own.
      var isRefresh = _cache.TryGetValue(issuer, out cached);

      // Cold cache: the bundled document, when there is one, is the first fill. It costs no
      // network, and a kid it does not list falls through to the live source exactly as an
      // unknown kid does against a fetched set.
      if (!isRefresh && _seed is not null)
      {
        var seeded = TryParseKeySet(_seed(issuer));
        if (seeded is not null && seeded.ByKid.Count > 0)
        {
          _cache[issuer] = cached = seeded;
          isRefresh = true;
        }
      }

      if (isRefresh)
      {
        if (cached!.ByKid.TryGetValue(kid, out hit)) return hit;
        if (_lastFruitlessRefresh.TryGetValue(issuer, out var last) && DateTimeOffset.UtcNow - last < RefreshCooldown) return null;
      }

      KeySet fresh;
      try
      {
        fresh = await FetchKeySetAsync(issuer, ct);
      }
      catch
      {
        // A refresh that could not reach the source counts against the cooldown just as one
        // that came back empty-handed: the cache still holds good keys, and retrying a dead
        // endpoint once per request is the stall an invented kid would otherwise buy.
        if (isRefresh) _lastFruitlessRefresh[issuer] = DateTimeOffset.UtcNow;
        throw;
      }

      _cache[issuer] = fresh;
      if (fresh.ByKid.TryGetValue(kid, out hit)) return hit;
      if (isRefresh) _lastFruitlessRefresh[issuer] = DateTimeOffset.UtcNow;
      return null;
    }
    finally
    {
      _fetchGate.Release();
    }
  }

  private static KeySet? TryParseKeySet(string? json)
  {
    if (string.IsNullOrWhiteSpace(json)) return null;
    try
    {
      return ParseKeySet(json);
    }
    catch
    {
      return null;
    }
  }

  private async Task<KeySet> FetchKeySetAsync(string issuer, CancellationToken ct)
  {
    var json = await _jwks.FetchAsync(issuer, ct);
    return ParseKeySet(json);
  }

  private static KeySet ParseKeySet(string json)
  {
    var set = new JsonWebKeySet(json);
    var byKid = new Dictionary<string, JsonWebKey>(StringComparer.Ordinal);
    foreach (var k in set.Keys)
    {
      if (string.IsNullOrEmpty(k.Kid)) continue;
      // Only RSA signing keys are eligible. A JWKS entry of another type with a matching kid
      // would otherwise be handed to the RS256 validator, which is a confusing failure at
      // best and a downgrade surface at worst.
      if (!string.Equals(k.Kty, "RSA", StringComparison.Ordinal)) continue;
      if (!string.IsNullOrEmpty(k.Use) && !string.Equals(k.Use, "sig", StringComparison.Ordinal)) continue;
      byKid[k.Kid] = k;
    }
    return new KeySet(byKid, DateTimeOffset.UtcNow);
  }

  private sealed record KeySet(IReadOnlyDictionary<string, JsonWebKey> ByKid, DateTimeOffset FetchedAt);
}
