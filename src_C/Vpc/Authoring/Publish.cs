using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public static class Publish
{
  private static readonly string? ContentBucket = Environment.GetEnvironmentVariable("CONTENT_BUCKET");
  private static readonly string? PremiumBucket = Environment.GetEnvironmentVariable("PREMIUM_BUCKET");

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

  private static string MakeBuildId()
  {
    // 20251214T094955Z-a1b2c3d4
    var utc = DateTime.UtcNow;
    var rand = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
    return $"{utc:yyyyMMdd'T'HHmmss'Z'}-{rand}";
  }

  private static async Task PutJson(string bucket, string key, object obj, string cacheControl)
  {
    var json = JsonSerializer.Serialize(obj);
    var put = new PutObjectRequest
    {
      BucketName = bucket,
      Key = key,
      ContentBody = json,
      ContentType = "application/json; charset=utf-8",
    };
    put.Headers.CacheControl = cacheControl;
    await S3().PutObjectAsync(put);
  }

  private static string InferTier(long deckType, object? tierValue)
  {
    var t = (Convert.ToString(tierValue, CultureInfo.InvariantCulture) ?? string.Empty).Trim().ToLowerInvariant();
    if (t is "free" or "premium") return t;
    return deckType == 1 ? "free" : "premium";
  }

  private static int ToInt(object? v, int fallback)
  {
    if (v is null) return fallback;
    if (v is int i) return i;
    if (v is long l) return (int)l;
    if (int.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return n;
    return fallback;
  }

  private static int ClampPreviewCount(object? previewCardsValue, int fullCount)
  {
    var full = Math.Max(0, ToInt(fullCount, 0));
    var raw = ToInt(previewCardsValue, 0);

    if (raw > 0) return full > 0 ? Math.Min(raw, full) : raw;
    if (full > 0) return Math.Min(10, full);
    return 0;
  }

  public static async Task<APIGatewayProxyResponse> HandleAuthoringPublish(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    if (req.Method != "POST") return res.MethodNotAllowed("Method not allowed");
    if (string.IsNullOrEmpty(ContentBucket)) return res.BadRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");

      var body = doc.RootElement;
      if (!body.TryGetProperty("deckId", out var deckIdEl)) return res.BadRequest("VALIDATION_ERROR", "deckId is required");

      var deckIdInt = Validation.RequireInteger(deckIdEl.ToString(), "deckId");
      var note = body.TryGetProperty("note", out var noteEl) && noteEl.ValueKind != JsonValueKind.Null ? noteEl.ToString().Trim() : null;

      var mode = (req.Query.TryGetValue("mode", out var m) ? m : string.Empty).Trim().ToLowerInvariant() == "preview"
        ? "preview"
        : "publish";

      var isSuperAdmin = auth.IsSuperAdmin;
      var adminSub = auth.UserSub;

      var denyDeck = await Helpers.RequireDeckWrite(conn, adminSub, deckIdInt, isSuperAdmin, res);
      if (denyDeck is not null) return denyDeck;

      const string deckSql = """
        select
          id,
          slug,
          title,
          author,
          description,
          locale,
          deck_type as "deckType",
          version,
          tier,
          total_cards as "totalCards",
          preview_cards as "previewCards",
          is_deleted as "isDeleted",
          updated_at as "updatedAt"
        from decks
        where id = $1
        limit 1
        """;

      var deckRows = await DbUtil.QueryAsync(conn, null, deckSql, [deckIdInt]);
      if (deckRows.Count == 0) return res.NotFound("Deck not found");

      var deck = deckRows[0];
      if (Convert.ToInt32(deck["isDeleted"], CultureInfo.InvariantCulture) == 1)
      {
        return res.BadRequest("DECK_DELETED", "Deck is deleted (cannot publish)");
      }

      var deckSlug = (Convert.ToString(deck["slug"], CultureInfo.InvariantCulture) ?? string.Empty).Trim();
      if (string.IsNullOrEmpty(deckSlug) || deckSlug.Contains('/') || deckSlug.Contains("..", StringComparison.Ordinal))
      {
        throw new ValidationError("deck.slug contains invalid characters", "deckSlug");
      }

      const string cardsSql = """
        select
          stable_uid as "stableUid",
          order_in_deck as "orderInDeck",
          difficulty,
          question,
          explanation,
          code_language as "codeLanguage",
          code_snippet as "codeSnippet",
          real_world_usage as "realWorldUsage",
          revision
        from cards
        where deck_id = $1 and is_deleted = 0
        order by order_in_deck asc, id asc
        """;

      var cardRows = await DbUtil.QueryAsync(conn, null, cardsSql, [deckIdInt]);

      var deckType = Convert.ToInt64(deck["deckType"], CultureInfo.InvariantCulture);
      var tier = InferTier(deckType, deck.TryGetValue("tier", out var tv) ? tv : null);

      if (tier == "premium" && string.IsNullOrEmpty(PremiumBucket))
      {
        return res.BadRequest("CONFIG_ERROR", "Missing env PREMIUM_BUCKET");
      }

      var baseCards = cardRows.Select(c => new
      {
        stableUid = Convert.ToString(c["stableUid"], CultureInfo.InvariantCulture),
        orderInDeck = Convert.ToInt32(c["orderInDeck"], CultureInfo.InvariantCulture),
        difficulty = Convert.ToInt32(c.TryGetValue("difficulty", out var dif) ? (dif ?? 2) : 2, CultureInfo.InvariantCulture),
        question = Convert.ToString(c["question"], CultureInfo.InvariantCulture),
        explanation = Convert.ToString(c.TryGetValue("explanation", out var ex) ? ex : null, CultureInfo.InvariantCulture) ?? string.Empty,
        codeLanguage = c.TryGetValue("codeLanguage", out var cl) ? cl : null,
        codeSnippet = Convert.ToString(c.TryGetValue("codeSnippet", out var cs) ? cs : null, CultureInfo.InvariantCulture) ?? string.Empty,
        realWorldUsage = Convert.ToString(c.TryGetValue("realWorldUsage", out var rw) ? rw : null, CultureInfo.InvariantCulture) ?? string.Empty,
        revision = Convert.ToInt32(c.TryGetValue("revision", out var rv) ? (rv ?? 1) : 1, CultureInfo.InvariantCulture),
      }).ToList();

      var baseDeckJson = new
      {
        slug = deckSlug,
        title = Convert.ToString(deck["title"], CultureInfo.InvariantCulture),
        locale = Convert.ToString(deck.TryGetValue("locale", out var lo) ? lo : null, CultureInfo.InvariantCulture) ?? "en-US",
        deckType = (int)deckType,
        version = Convert.ToString(deck.TryGetValue("version", out var ver) ? ver : null, CultureInfo.InvariantCulture) ?? "1",
        totalCards = ToInt(deck.TryGetValue("totalCards", out var tc) ? tc : null, baseCards.Count),
        cards = baseCards,
      };

      if (mode == "preview")
      {
        return res.Ok(new
        {
          mode = "preview",
          deckId = deckIdInt,
          deckSlug,
          tier,
          cardCount = baseCards.Count,
          export = baseDeckJson,
        });
      }

      var buildId = MakeBuildId();

      var fullDeckToWrite = new
      {
        baseDeckJson.slug,
        baseDeckJson.title,
        baseDeckJson.locale,
        baseDeckJson.deckType,
        version = buildId,
        totalCards = baseCards.Count,
        cards = baseCards,
      };

      string bucket;
      string key;
      if (tier == "premium")
      {
        bucket = PremiumBucket!;
        key = $"{PremiumPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
      }
      else
      {
        bucket = ContentBucket!;
        key = $"{ContentPrefix}/decks/{deckSlug}/builds/{buildId}/deck.json";
      }

      await PutJson(bucket, key, fullDeckToWrite, "public, max-age=31536000, immutable");

      object? preview = null;
      if (tier == "premium")
      {
        var previewBuildId = $"{buildId}-preview";
        var previewCount = ClampPreviewCount(deck.TryGetValue("previewCards", out var pc) ? pc : null, baseCards.Count);

        var previewDeckToWrite = new
        {
          baseDeckJson.slug,
          baseDeckJson.title,
          baseDeckJson.locale,
          baseDeckJson.deckType,
          version = previewBuildId,
          totalCards = previewCount,
          cards = baseCards.Take(previewCount).ToList(),
        };

        var previewKey = $"{ContentPrefix}/decks/{deckSlug}/previews/{previewBuildId}/deck.json";
        await PutJson(ContentBucket!, previewKey, previewDeckToWrite, "public, max-age=31536000, immutable");

        preview = new { previewBuildId, previewKey, previewCards = previewCount };
      }

      try
      {
        const string publishSql = """
          insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, published_by_admin_sub, note)
          values ($1,$2,$3,$4,$5,$6)
          """;

        await DbUtil.ExecuteAsync(conn, null, publishSql, [deckIdInt, deckSlug, buildId, $"s3://{bucket}/{key}", adminSub, note]);
      }
      catch (PostgresException pg) when (pg.SqlState == "42P01")
      {
        // deck_publishes doesn't exist in some envs; ignore
      }

      return res.Ok(new
      {
        mode = "publish",
        deckId = deckIdInt,
        deckSlug,
        tier,
        buildId,
        cardCount = baseCards.Count,
        bucket,
        key,
        preview,
        manifestKey = ManifestKey,
      });
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      return res.Error500(ex);
    }
  }
}
