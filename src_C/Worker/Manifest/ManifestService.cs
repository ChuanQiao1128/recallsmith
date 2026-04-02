using System.Globalization;
using Amazon;
using Amazon.S3;
using Amazon.S3.Model;
using Npgsql;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Worker.Manifest;

/// <summary>
/// Manifest 重建服务
/// 从 Vpc/Authoring/ManifestRebuild.cs 提取并适配
/// </summary>
public class ManifestService : IManifestService
{
  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
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

  // Used by SnapStart runtime hooks
  public static void Reset()
  {
    var c = _s3;
    _s3 = null;
    if (c is null) return;
    try { c.Dispose(); } catch { /* best-effort */ }
  }

  public async Task RebuildAsync()
  {
    if (string.IsNullOrEmpty(ContentBucket))
    {
      throw new InvalidOperationException("Missing env CONTENT_BUCKET");
    }

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) throw new InvalidOperationException("Failed to open database connection");

    var generatedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // 查询所有未删除的 deck
    const string decksSql = """
      SELECT 
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
      FROM decks
      WHERE is_deleted = 0
      ORDER BY manifest_order ASC, slug ASC;
      """;

    var decks = await DbUtil.QueryAsync(conn, null, decksSql, []);

    // 查询最新的成功发布记录
    var latest = new Dictionary<string, string>(StringComparer.Ordinal);
    try
    {
      const string latestSql = """
        SELECT DISTINCT ON (deck_slug)
          deck_slug,
          build_id,
          s3_key,
          created_at
        FROM deck_publishes
        WHERE status = 'SUCCESS'
        ORDER BY deck_slug, created_at DESC;
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

      // Filter out draft decks
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
  }

  private async Task PutJson(string key, object obj)
  {
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

  private static string NormalizePrefix(string? p, string defName)
  {
    var s = (p ?? defName).Trim();
    s = s.TrimStart('/');
    s = s.TrimEnd('/');
    return string.IsNullOrEmpty(s) ? defName : s;
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
}
