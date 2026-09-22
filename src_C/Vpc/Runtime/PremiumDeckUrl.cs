using System.Globalization;
using System.Text.Json;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Runtime;

public static class PremiumDeckUrl
{
  private const string PremiumUrlImpl = "premiumDeckUrl-v7";

  private static string GetRegion()
  {
    var r = (Environment.GetEnvironmentVariable("AWS_REGION") ?? string.Empty).Trim();
    return string.IsNullOrEmpty(r) ? "ap-southeast-2" : r;
  }

  private static Lazy<AmazonS3Client> S3Lazy =
    new(() => new AmazonS3Client(RegionEndpoint.GetBySystemName(GetRegion())));

  // Used by SnapStart runtime hooks to ensure we don't reuse pre-snapshot network state.
  public static void Reset()
  {
    if (S3Lazy.IsValueCreated)
    {
      try { S3Lazy.Value.Dispose(); } catch { /* best-effort */ }
    }
    S3Lazy = new Lazy<AmazonS3Client>(() => new AmazonS3Client(RegionEndpoint.GetBySystemName(GetRegion())));
  }

  private static string? SafeSlug(string? s)
  {
    var v = (s ?? string.Empty).Trim();
    if (!System.Text.RegularExpressions.Regex.IsMatch(v, "^[a-z0-9-]+$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
    {
      return null;
    }
    return v.ToLowerInvariant();
  }

  private static int ToInt(string? v, int def)
  {
    if (int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) && n > 0) return n;
    return def;
  }

  private static bool ToBool(string? v)
  {
    var s = (v ?? string.Empty).Trim().ToLowerInvariant();
    return s is "1" or "true" or "yes";
  }

  private static string PickHeader(LambdaRequest req, string name)
  {
    return req.Headers.TryGetValue(name, out var v) ? (v ?? string.Empty).Trim() : string.Empty;
  }

  private static string ReadDevBypassHeader(LambdaRequest req)
  {
    var candidates = new[] { "x-dev-bypass", "X-Dev-Bypass", "x_dev_bypass", "X_DEV_BYPASS" };
    foreach (var k in candidates)
    {
      var v = PickHeader(req, k);
      if (!string.IsNullOrEmpty(v)) return v;
    }
    return string.Empty;
  }

  private static HashSet<string> ParseAllowlist(string? raw)
  {
    var s = (raw ?? string.Empty).Trim();
    if (s.Length == 0) return [];
    return s
      .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Where(x => x.Length > 0)
      .ToHashSet(StringComparer.Ordinal);
  }

  private sealed record PremiumInfo(bool Ok, bool Premium, string? Env, string? ProductId, long? ExpiresAtMs, string Reason);

  private static async Task<PremiumInfo> IsPremiumFromDb(string userSub)
  {
    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null)
    {
      return new PremiumInfo(
        Ok: false,
        Premium: false,
        Env: null,
        ProductId: null,
        ExpiresAtMs: null,
        Reason: "NO_DB_POOL");
    }

    const string sql = """
      select premium_active, premium_env, product_id, expires_at_ms
      from user_premium_state
      where app_user_id = $1
      limit 1;
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, [userSub]);
    var row = rows.Count > 0 ? rows[0] : null;

    var expiresAtMs = row is null ? null : ToLong(row.TryGetValue("expires_at_ms", out var e) ? e : null);
    var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    var premium = expiresAtMs is not null
      ? expiresAtMs > nowMs
      : row is not null && ToBool(Convert.ToString(row.TryGetValue("premium_active", out var pa) ? pa : null, CultureInfo.InvariantCulture));

    var env = row is not null ? Convert.ToString(row.TryGetValue("premium_env", out var penv) ? penv : null, CultureInfo.InvariantCulture) : null;
    var productId = row is not null ? Convert.ToString(row.TryGetValue("product_id", out var pid) ? pid : null, CultureInfo.InvariantCulture) : null;

    return new PremiumInfo(
      Ok: true,
      Premium: premium,
      Env: env,
      ProductId: productId,
      ExpiresAtMs: expiresAtMs,
      Reason: premium ? "ACTIVE" : "NOT_ACTIVE");
  }

  public static async Task<APIGatewayProxyResponse> HandlePremiumDeckUrl(
    LambdaRequest req,
    IReadOnlyDictionary<string, string> query,
    Res res,
    AuthContext auth)
  {
    if (req.Method != "GET") return res.MethodNotAllowed();

    var traceId = res.TraceId;
    var slug = SafeSlug(query.TryGetValue("slug", out var s) ? s : null);
    if (string.IsNullOrEmpty(slug)) return res.BadRequest("Missing/invalid slug");

    var apiEnv = (Environment.GetEnvironmentVariable("API_ENV") ?? string.Empty).Trim().ToLowerInvariant();
    var isProdEnv = apiEnv == "production";

    // always require login; a bearer that failed verification is a 401, not a missing login
    var badToken = Auth.RejectIfBadToken(auth, res);
    if (badToken is not null) return badToken;
    var userSub = (auth.UserSub ?? string.Empty).Trim();
    if (string.IsNullOrEmpty(userSub)) return res.Forbidden("Requires login");

    var devFlag = query.TryGetValue("dev", out var dev) && dev == "1";
    var devHeaderRaw = ReadDevBypassHeader(req);
    var devHeader = devHeaderRaw == "1";

    var allowlist = ParseAllowlist(Environment.GetEnvironmentVariable("DEV_BYPASS_ALLOWLIST_SUBS"));
    var allowlistEnabled = allowlist.Count > 0;
    var allowlisted = allowlistEnabled && allowlist.Contains(userSub);

    var allowDevBypass =
      !isProdEnv &&
      (Environment.GetEnvironmentVariable("ALLOW_DEV_PREMIUM") ?? string.Empty) == "1" &&
      (devFlag || devHeader) &&
      allowlisted;

    Log.Info(JsonSerializer.Serialize(new
    {
      traceId,
      impl = PremiumUrlImpl,
      step = "dev_bypass_eval",
      slug,
      apiEnv = string.IsNullOrEmpty(apiEnv) ? null : apiEnv,
      devFlag,
      devHeader,
      devHeaderRaw = string.IsNullOrEmpty(devHeaderRaw) ? null : devHeaderRaw,
      allowDevBypass,
      allowlistEnabled,
      allowlisted,
      ALLOW_DEV_PREMIUM = Environment.GetEnvironmentVariable("ALLOW_DEV_PREMIUM"),
      DISALLOW_SANDBOX_PREMIUM = Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM"),
    }));

    var contentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
    var premiumBucket = Environment.GetEnvironmentVariable("PREMIUM_BUCKET");

    var contentPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content");
    var premiumPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium");

    var expiresInSec = ToInt(Environment.GetEnvironmentVariable("PREMIUM_URL_EXPIRES_SEC"), 60);
    var s3GetTimeoutMs = ToInt(Environment.GetEnvironmentVariable("S3_GET_TIMEOUT_MS"), 6000);
    var s3BodyTimeoutMs = ToInt(Environment.GetEnvironmentVariable("S3_BODY_TIMEOUT_MS"), 6000);

    if (string.IsNullOrEmpty(contentBucket)) return res.BadRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");
    if (string.IsNullOrEmpty(premiumBucket)) return res.BadRequest("CONFIG_ERROR", "Missing env PREMIUM_BUCKET");

    PremiumInfo? premiumInfo = null;
    if (!allowDevBypass)
    {
      try
      {
        Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "premium_check_start", userSub }));
        premiumInfo = await IsPremiumFromDb(userSub);
        Log.Info(JsonSerializer.Serialize(new
        {
          traceId,
          impl = PremiumUrlImpl,
          step = "premium_check_done",
          premium = premiumInfo.Premium,
          premiumEnv = premiumInfo.Env,
          expiresAtMs = premiumInfo.ExpiresAtMs,
        }));

        if (!premiumInfo.Premium) return res.Forbidden("Requires premium entitlement");

        if (ToBool(Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM")))
        {
          if (string.Equals((premiumInfo.Env ?? string.Empty).Trim(), "sandbox", StringComparison.OrdinalIgnoreCase))
          {
            return res.Forbidden("Sandbox premium not allowed in this environment");
          }
        }
      }
      catch (Exception ex)
      {
        Log.Error("premium check failed:", ex);
        return res.Error500(ex);
      }
    }
    else
    {
      Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "dev_bypass_enabled", slug, userSub }));
    }

    try
    {
      // Reuse the AWS SDK client across invocations (saves connection/handler setup).
      var s3 = S3Lazy.Value;

      // 1) load manifest
      var manifestKey = $"{contentPrefix}/manifest.json";
      Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "s3_get_manifest_start", manifestKey }));

      string manifestText;
      {
        using var getCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(s3GetTimeoutMs));
        using var obj = await s3.GetObjectAsync(
          new GetObjectRequest { BucketName = contentBucket, Key = manifestKey },
          getCts.Token);

        Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "s3_get_manifest_done" }));

        // 2) read body safely
        Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "manifest_read_start" }));

        using var bodyCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(s3BodyTimeoutMs));
        using var sr = new StreamReader(obj.ResponseStream);
        manifestText = await sr.ReadToEndAsync(bodyCts.Token);
      }

      Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "manifest_read_done", bytes = manifestText.Length }));

      using var manifestDoc = JsonDocument.Parse(manifestText);
      var manifestRoot = manifestDoc.RootElement;

      // 3) find deck
      var deck = FindDeck(manifestRoot, slug);
      if (deck is null) return res.NotFound($"Deck not found in manifest: {slug}");

      var downloadMode = GetStringLower(deck.Value, "downloadMode");
      var tier = GetStringLower(deck.Value, "tier");

      if (!(downloadMode == "auth" || tier == "premium"))
      {
        return res.BadRequest($"Not a premium deck: {slug}");
      }

      var buildId = GetString(deck.Value, "buildId") ?? GetString(deck.Value, "version") ?? string.Empty;
      buildId = buildId.Trim();
      if (string.IsNullOrEmpty(buildId) || buildId == "coming") return res.BadRequest($"Deck not publishable: {slug}");

      // 4) presign from PREMIUM bucket
      var premiumKey = $"{premiumPrefix}/decks/{slug}/builds/{buildId}/deck.json";
      Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "presign_start", slug, buildId, premiumKey, allowDevBypass }));

      var url = s3.GetPreSignedURL(new GetPreSignedUrlRequest
      {
        BucketName = premiumBucket,
        Key = premiumKey,
        Verb = HttpVerb.GET,
        Expires = DateTime.UtcNow.AddSeconds(expiresInSec),
        ResponseHeaderOverrides = new ResponseHeaderOverrides
        {
          ContentType = "application/json",
          CacheControl = "no-cache",
        },
      });

      Log.Info(JsonSerializer.Serialize(new { traceId, impl = PremiumUrlImpl, step = "presign_done" }));

      return res.Ok(new
      {
        slug,
        buildId,
        expiresInSec,
        url,
        devBypass = allowDevBypass,
      });
    }
    catch (Exception ex)
    {
      Log.Error("handlePremiumDeckUrl error:", ex);
      return res.Error500(ex);
    }
  }

  private static long? ToLong(object? v)
  {
    if (v is null) return null;
    if (v is long l) return l;
    if (v is int i) return i;
    if (v is decimal d) return (long)d;
    if (v is double dd) return (long)Math.Floor(dd);
    var s = Convert.ToString(v, CultureInfo.InvariantCulture);
    return long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;
  }

  private static string NormalizePrefix(string? p, string defName)
  {
    var s = (p ?? defName).Trim();
    s = s.TrimStart('/');
    s = s.TrimEnd('/');
    return string.IsNullOrEmpty(s) ? defName : s;
  }

  private static JsonElement? FindDeck(JsonElement manifestRoot, string slugLower)
  {
    if (!manifestRoot.TryGetProperty("decks", out var decks) || decks.ValueKind != JsonValueKind.Array) return null;
    foreach (var d in decks.EnumerateArray())
    {
      if (d.ValueKind != JsonValueKind.Object) continue;
      var s = GetString(d, "slug");
      if (!string.IsNullOrEmpty(s) && string.Equals(s.Trim(), slugLower, StringComparison.OrdinalIgnoreCase))
      {
        return d;
      }
    }
    return null;
  }

  private static string? GetString(JsonElement obj, string prop)
  {
    return obj.TryGetProperty(prop, out var el) && el.ValueKind != JsonValueKind.Null && el.ValueKind != JsonValueKind.Undefined
      ? el.ToString()
      : null;
  }

  private static string GetStringLower(JsonElement obj, string prop)
  {
    return (GetString(obj, prop) ?? string.Empty).Trim().ToLowerInvariant();
  }
}
