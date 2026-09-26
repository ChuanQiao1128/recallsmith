// Vpc/Authoring/Dashboard.cs
// 合并 Dashboard 数据，减少前端请求次数
using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class Dashboard
{
  public static async Task<APIGatewayProxyResponse> HandleDashboard(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "GET") return res.MethodNotAllowed();

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars");

    try
    {
      // 并行查询 decks 和 manifest 数据
      var decksTask = LoadDecksAsync(conn);
      var manifestTask = LoadManifestDataAsync(conn);

      await Task.WhenAll(decksTask, manifestTask);

      var decks = await decksTask;
      var (meta, deckManifests) = await manifestTask;

      return res.Ok(new
      {
        decks,
        manifest = new
        {
          meta,
          decks = deckManifests
        }
      });
    }
    catch (Exception ex)
    {
      Log.Error("Dashboard error:", ex);
      return res.Error500(ex);
    }
  }

  private static async Task<List<object>> LoadDecksAsync(NpgsqlConnection conn)
  {
    const string sql = """
      SELECT 
        id,
        slug,
        title,
        author,
        description,
        locale,
        deck_type as "deckType",
        version,
        tier,
        availability,
        manifest_order as "manifestOrder",
        total_cards as "totalCards",
        preview_cards as "previewCards",
        retired_at_ms as "retiredAtMs",
        eta,
        is_deleted as "isDeleted",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM decks
      WHERE is_deleted = 0
      ORDER BY manifest_order ASC, created_at DESC
      """;

    var rows = await DbUtil.QueryAsync(conn, null, sql, []);
    
    return rows.Select(r => new
    {
      id = Convert.ToInt32(r["id"]),
      slug = Convert.ToString(r["slug"]),
      title = Convert.ToString(r["title"]),
      author = Convert.ToString(r["author"]),
      description = Convert.ToString(r["description"]),
      locale = Convert.ToString(r["locale"]) ?? "en-US",
      deckType = Convert.ToInt32(r["deckType"]),
      version = Convert.ToInt32(r["version"]),
      tier = Convert.ToString(r["tier"]),
      availability = Convert.ToString(r["availability"]),
      manifestOrder = r["manifestOrder"] != null ? Convert.ToInt32(r["manifestOrder"]) : (int?)null,
      totalCards = r["totalCards"] != null ? Convert.ToInt32(r["totalCards"]) : (int?)null,
      previewCards = r["previewCards"] != null ? Convert.ToInt32(r["previewCards"]) : (int?)null,
      retiredAtMs = r["retiredAtMs"] != null ? Convert.ToInt64(r["retiredAtMs"]) : (long?)null,
      eta = Convert.ToString(r["eta"]),
      isDeleted = Convert.ToInt32(r["isDeleted"]),
      createdAt = Convert.ToInt64(r["createdAt"]),
      updatedAt = Convert.ToInt64(r["updatedAt"])
    }).ToList<object>();
  }

  private static async Task<(object meta, List<object> decks)> LoadManifestDataAsync(NpgsqlConnection conn)
  {
    var generatedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // 查询 decks
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

    // 查询最新发布记录
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
    catch { /* ignore */ }

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
    }).Where(x => x is not null).Cast<object>().ToList();

    var meta = new
    {
      schemaVersion = 2,
      prefix = "content",
      generatedAtMs,
      deckCount = outDecks.Count
    };

    return (meta, outDecks);
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
