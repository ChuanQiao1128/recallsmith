using System.Globalization;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class ManifestRebuild
{
  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");

  private static string NormalizePrefix(string? p, string defName)
  {
    var s = (p ?? defName).Trim();
    s = s.TrimStart('/');
    s = s.TrimEnd('/');
    return string.IsNullOrEmpty(s) ? defName : s;
  }

  private static readonly string ContentPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content");
  private static readonly string PremiumPrefix = NormalizePrefix(Environment.GetEnvironmentVariable("PREMIUM_PREFIX"), "premium");
  private static readonly string ManifestKey = $"{ContentPrefix}/manifest.json";

  private static AmazonS3Client? _s3;
  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  // Used by SnapStart runtime hooks to ensure we don't reuse pre-snapshot network state.
  public static void Reset()
  {
    var c = _s3;
    _s3 = null;
    if (c is null) return;
    try { c.Dispose(); } catch { /* best-effort */ }
  }

  private static async Task PutJson(string key, object obj)
  {
    if (string.IsNullOrEmpty(ContentBucket)) throw new InvalidOperationException("Missing env CONTENT_BUCKET");
    var put = new PutObjectRequest
    {
      BucketName = ContentBucket,
      Key = key,
      ContentBody = System.Text.Json.JsonSerializer.Serialize(obj),
      ContentType = "application/json; charset=utf-8",
    };
    put.Headers.CacheControl = "public, max-age=60, s-maxage=60";
    await S3().PutObjectAsync(put);
  }

  private static int ToInt(object? v, int fallback)
  {
    if (v is null) return fallback;
    if (v is int i) return i;
    if (v is long l) return (int)l;
    if (int.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return n;
    return fallback;
  }

  private static long ToLong(object? v, long fallback)
  {
    if (v is null) return fallback;
    if (v is long l) return l;
    if (v is int i) return i;
    if (long.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return n;
    return fallback;
  }

  private static string InferTier(int deckType, object? tierValue)
  {
    var t = (Convert.ToString(tierValue, CultureInfo.InvariantCulture) ?? string.Empty).Trim().ToLowerInvariant();
    if (t is "free" or "premium") return t;
    return deckType == 1 ? "free" : "premium";
  }

  private static string NormalizeAvailability(object? v)
  {
    var a = (Convert.ToString(v, CultureInfo.InvariantCulture) ?? "live").Trim().ToLowerInvariant();
    return a is "live" or "coming" or "retired" ? a : "live";
  }

  private static string DeriveDownloadMode(string tier, string availability)
  {
    if (availability != "live") return "none";
    return tier == "premium" ? "auth" : "public";
  }

  private static int? DerivePreviewCards(string tier, string availability, object? previewCards, int totalCards)
  {
    if (tier != "premium" || availability != "live") return null;

    var total = Math.Max(0, totalCards);
    var raw = ToInt(previewCards, 0);
    if (raw > 0) return total > 0 ? Math.Min(raw, total) : raw;
    if (total > 0) return Math.Min(10, total);
    return 10;
  }

  public static async Task<APIGatewayProxyResponse> HandleManifestRebuild(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");
    if (string.IsNullOrEmpty(ContentBucket)) return res.BadRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars");

    var generatedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    const string decksSql = """
      select
        slug,
        title,
        locale,
        deck_type as "deckType",
        manifest_order as "order",
        tier,
        availability,
        eta,
        retired_at_ms as "retiredAtMs",
        total_cards as "totalCards",
        preview_cards as "previewCards",
        version
      from decks
      where is_deleted = 0
      order by manifest_order asc, slug asc;
      """;

    var decks = await DbUtil.QueryAsync(conn, null, decksSql, []);

    var latest = new Dictionary<string, string>(StringComparer.Ordinal);
    try
    {
      const string latestSql = """
        select distinct on (deck_slug)
          deck_slug,
          build_id,
          s3_key,
          created_at
        from deck_publishes
        where status = 'SUCCESS'
        order by deck_slug, created_at desc;
        """;

      var rows = await DbUtil.QueryAsync(conn, null, latestSql, []);
      foreach (var r in rows)
      {
        var slug = Convert.ToString(r["deck_slug"], CultureInfo.InvariantCulture) ?? string.Empty;
        var buildId = Convert.ToString(r["build_id"], CultureInfo.InvariantCulture) ?? string.Empty;
        if (!string.IsNullOrEmpty(slug) && !string.IsNullOrEmpty(buildId))
        {
          latest[slug] = buildId;
        }
      }
    }
    catch (PostgresException pg) when (pg.SqlState == "42P01")
    {
      // deck_publishes missing in some envs
    }
    catch
    {
      // allow system continue
    }

    var outDecks = decks.Select(d =>
    {
      var slug = Convert.ToString(d["slug"], CultureInfo.InvariantCulture) ?? string.Empty;
      var deckType = ToInt(d.TryGetValue("deckType", out var dt) ? dt : null, 1);

      var tier = InferTier(deckType, d.TryGetValue("tier", out var tv) ? tv : null);
      var availability = NormalizeAvailability(d.TryGetValue("availability", out var av) ? av : null);
      var order = ToInt(d.TryGetValue("order", out var or) ? or : null, 1000);
      var totalCards = Math.Max(0, ToInt(d.TryGetValue("totalCards", out var tc) ? tc : null, 0));

      var downloadMode = DeriveDownloadMode(tier, availability);
      var buildId = availability == "live" && latest.TryGetValue(slug, out var b) ? b : null;

      // ✅ Filter out draft decks:
      // If a deck is 'live' but has no corresponding build_id in deck_publishes,
      // it's a draft that has never been published. It must be excluded from manifest.json
      // to prevent it from appearing on mobile clients.
      if (availability == "live" && string.IsNullOrEmpty(buildId))
      {
        return null;
      }

      var version = availability == "live" && !string.IsNullOrEmpty(buildId)
        ? buildId
        : Convert.ToString(d.TryGetValue("version", out var ver) ? ver : null, CultureInfo.InvariantCulture) ?? "1";

      var path = tier == "free" && availability == "live" && !string.IsNullOrEmpty(buildId)
        ? $"decks/{slug}/builds/{buildId}/deck.json"
        : null;

      var previewCards = DerivePreviewCards(tier, availability, d.TryGetValue("previewCards", out var pc) ? pc : null, totalCards);
      var previewBuildId = tier == "premium" && availability == "live" && !string.IsNullOrEmpty(buildId)
        ? $"{buildId}-preview"
        : null;

      var previewPath = tier == "premium" && availability == "live" && !string.IsNullOrEmpty(previewBuildId)
        ? $"decks/{slug}/previews/{previewBuildId}/deck.json"
        : null;

      return new
      {
        order,
        slug,
        title = d.TryGetValue("title", out var t) ? t : null,
        locale = Convert.ToString(d.TryGetValue("locale", out var lo) ? lo : null, CultureInfo.InvariantCulture) ?? "en-US",
        deckType,
        tier,
        availability,

        retiredAtMs = availability == "retired"
          ? (d.TryGetValue("retiredAtMs", out var ra) && ra is not null ? ToLong(ra, generatedAtMs) : generatedAtMs)
          : (long?)null,
        eta = availability == "coming" ? (d.TryGetValue("eta", out var eta) ? eta : null) : null,

        downloadMode,
        totalCards,
        version,
        buildId,

        path,
        sha256 = (string?)null,

        previewCards = previewPath is not null ? previewCards : null,
        previewVersion = previewBuildId,
        previewBuildId,
        previewPath,
        previewSha256 = (string?)null,

        patches = (object?)null,
        previewPatches = (object?)null,
      };
    }).Where(x => x is not null).ToList();

    var manifest = new
    {
      schemaVersion = 2,
      prefix = ContentPrefix,
      generatedAtMs,
      decks = outDecks,
    };

    await PutJson(ManifestKey, manifest);

    return res.Ok(new { ok = true, manifestKey = ManifestKey, generatedAtMs, deckCount = outDecks.Count });
  }
}
