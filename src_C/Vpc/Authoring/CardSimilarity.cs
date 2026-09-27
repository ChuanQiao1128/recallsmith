using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

public sealed record SimilarityQuery(string Text, IReadOnlyList<long>? DeckIds, int Limit = 5, double Threshold = 0.3, IReadOnlyList<long>? ExcludeCardIds = null);

public sealed record SimilarityMatch(long CardId, long DeckId, string DeckSlug, string StableUid, string Question, double Similarity, bool LikelyDuplicate);

public sealed record SimilarityResult(string Engine, double Threshold, IReadOnlyList<SimilarityMatch> Matches);

/// <summary>
/// POST /api/v1/authoring/cards/similar (contract §8.2) and the reusable similarity check behind it.
/// With pg_trgm installed the database scores the cards; without it (prod's app role cannot create the
/// extension, §14 #9) <see cref="Trigram.Similarity"/> scores them in process with identical results.
/// Only the engine choice is cached, never a result.
/// </summary>
public static class CardSimilarity
{
  public const string EnginePgTrgm = "pg_trgm";
  public const string EngineFallback = "fallback";
  public const int MaxTextLength = 4000;
  public const int DefaultLimit = 5;
  public const int MaxLimit = 20;
  public const double DefaultThreshold = 0.3;
  public const double LikelyDuplicateThreshold = 0.6;
  public const int FallbackCandidateLimit = 5000;
  public const int MaxExcludeCardIds = 500;
  public static readonly TimeSpan EngineCacheTtl = TimeSpan.FromMinutes(5);

  /// <summary>Test seam (InternalsVisibleTo): "pg_trgm" | "fallback" | null. Always null in production.</summary>
  internal static string? TestForceEngine;

  private sealed record EngineCache(string Engine, DateTime DetectedAtUtc);

  private static EngineCache? _engineCache;

  internal static void ResetEngineCache() => Volatile.Write(ref _engineCache, null);

  public static async Task<SimilarityResult> FindAsync(NpgsqlConnection conn, SimilarityQuery query, CancellationToken ct = default)
  {
    var text = (query.Text ?? string.Empty).Trim();
    var limit = Math.Clamp(query.Limit, 1, MaxLimit);
    var threshold = query.Threshold;

    var engine = await ResolveEngineAsync(conn, ct);

    // An empty deck list is "no decks": nothing to search, no card query.
    if (query.DeckIds is { Count: 0 }) return new SimilarityResult(engine, threshold, []);

    if (engine == EnginePgTrgm)
    {
      try
      {
        var rows = await PgTrgmRowsAsync(conn, text, query, limit, threshold, ct);
        return new SimilarityResult(EnginePgTrgm, threshold, rows);
      }
      catch (PostgresException ex) when (ex.SqlState == "42883")
      {
        // The extension row said yes but similarity() is not callable: answer in process from now on.
        Volatile.Write(ref _engineCache, new EngineCache(EngineFallback, DateTime.UtcNow));
        Log.Event("warn", new { tag = "similarity", reason = "pg_trgm_function_missing", engine = EngineFallback, sqlState = ex.SqlState });
      }
    }

    var matches = await FallbackRowsAsync(conn, text, query, limit, threshold, ct);
    return new SimilarityResult(EngineFallback, threshold, matches);
  }

  private static async Task<string> ResolveEngineAsync(NpgsqlConnection conn, CancellationToken ct)
  {
    var forced = TestForceEngine;
    if (forced is not null) return forced;

    var cached = Volatile.Read(ref _engineCache);
    if (cached is not null && DateTime.UtcNow - cached.DetectedAtUtc < EngineCacheTtl) return cached.Engine;

    await using var cmd = DbUtil.CreateCommand(conn, null, "select exists(select 1 from pg_extension where extname = 'pg_trgm')", []);
    var installed = await cmd.ExecuteScalarAsync(ct) is true;
    var engine = installed ? EnginePgTrgm : EngineFallback;

    Volatile.Write(ref _engineCache, new EngineCache(engine, DateTime.UtcNow));
    Log.Event("info", new { tag = "similarity", reason = "engine_detected", engine });
    return engine;
  }

  /// <summary>Scope clauses shared by both engines; parameters are appended after the ones already bound.</summary>
  private static string ScopeWhere(SimilarityQuery query, List<object?> parameters)
  {
    var where = new List<string> { "c.is_deleted = 0", "d.is_deleted = 0" };
    if (query.DeckIds is not null)
    {
      parameters.Add(query.DeckIds.ToArray());
      where.Add($"c.deck_id = any(${parameters.Count})");
    }
    if (query.ExcludeCardIds is { Count: > 0 })
    {
      parameters.Add(query.ExcludeCardIds.ToArray());
      where.Add($"not (c.id = any(${parameters.Count}))");
    }
    return string.Join(" and ", where);
  }

  private static async Task<List<SimilarityMatch>> PgTrgmRowsAsync(
    NpgsqlConnection conn, string text, SimilarityQuery query, int limit, double threshold, CancellationToken ct)
  {
    var parameters = new List<object?> { text };
    var where = ScopeWhere(query, parameters);
    parameters.Add(threshold);
    var thresholdParam = parameters.Count;
    parameters.Add(limit);
    var limitParam = parameters.Count;

    var sql = $"""
      select c.id, c.deck_id, d.slug, c.stable_uid, c.question, similarity(c.question, $1) as sim
      from cards c
      join decks d on d.id = c.deck_id
      where {where} and similarity(c.question, $1) >= ${thresholdParam}
      order by sim desc, c.id asc
      limit ${limitParam}
      """;

    var matches = new List<SimilarityMatch>();
    await using var cmd = DbUtil.CreateCommand(conn, null, sql, parameters);
    await using var reader = await cmd.ExecuteReaderAsync(ct);
    while (await reader.ReadAsync(ct))
    {
      matches.Add(ToMatch(
        reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
        reader.GetFloat(5)));
    }
    return matches;
  }

  private static async Task<List<SimilarityMatch>> FallbackRowsAsync(
    NpgsqlConnection conn, string text, SimilarityQuery query, int limit, double threshold, CancellationToken ct)
  {
    var parameters = new List<object?>();
    var where = ScopeWhere(query, parameters);
    parameters.Add(FallbackCandidateLimit);

    var sql = $"""
      select c.id, c.deck_id, d.slug, c.stable_uid, c.question
      from cards c
      join decks d on d.id = c.deck_id
      where {where}
      order by c.id desc
      limit ${parameters.Count}
      """;

    var scored = new List<(long Id, long DeckId, string Slug, string Uid, string Question, float Score)>();
    await using (var cmd = DbUtil.CreateCommand(conn, null, sql, parameters))
    await using (var reader = await cmd.ExecuteReaderAsync(ct))
    {
      while (await reader.ReadAsync(ct))
      {
        var question = reader.GetString(4);
        var score = Trigram.Similarity(question, text);
        if ((double)score < threshold) continue;
        scored.Add((reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), question, score));
      }
    }

    return scored
      .OrderByDescending(s => s.Score)
      .ThenBy(s => s.Id)
      .Take(limit)
      .Select(s => ToMatch(s.Id, s.DeckId, s.Slug, s.Uid, s.Question, s.Score))
      .ToList();
  }

  private static SimilarityMatch ToMatch(long cardId, long deckId, string slug, string uid, string question, float score)
  {
    var similarity = Math.Round((double)score, 4, MidpointRounding.AwayFromZero);
    return new SimilarityMatch(cardId, deckId, slug, uid, question, similarity, similarity >= LikelyDuplicateThreshold);
  }

  public static async Task<APIGatewayProxyResponse> HandleSimilar(LambdaRequest req, Res res, AuthContext auth)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = doc.RootElement;
      if (body.ValueKind != JsonValueKind.Object) throw new ValidationError("Body must be a JSON object", "body");

      var text = ParseText(body);
      var deckSlug = ParseOptionalSlug(body);
      var deckId = OptionalInteger(body, "deckId");
      var limitRaw = OptionalInteger(body, "limit");
      if (limitRaw is not null && (limitRaw < 1 || limitRaw > MaxLimit)) throw new ValidationError($"limit must be an integer in 1..{MaxLimit}", "limit");
      var limit = (int)(limitRaw ?? DefaultLimit);
      var threshold = ParseThreshold(body);
      var exclude = ParseExcludeCardIds(body);

      IReadOnlyList<long>? deckIds;
      if (deckSlug is not null || deckId is not null)
      {
        long? resolved = null;
        if (deckId is not null)
        {
          var rows = await DbUtil.QueryAsync(conn, null, "select id, slug from decks where id = $1 and is_deleted = 0", [deckId.Value]);
          if (rows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");
          resolved = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
        }
        if (deckSlug is not null)
        {
          var rows = await DbUtil.QueryAsync(conn, null, "select id, slug from decks where slug = $1 and is_deleted = 0", [deckSlug]);
          if (rows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");
          var bySlug = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
          if (resolved is not null && resolved.Value != bySlug) throw new ValidationError("deckId and deckSlug name different decks", "deckId");
          resolved = bySlug;
        }

        var denyDeck = await Helpers.RequireDeckRead(conn, auth.UserSub, resolved!.Value, auth.IsSuperAdmin, res);
        if (denyDeck is not null) return denyDeck;
        deckIds = [resolved.Value];
      }
      else if (auth.IsSuperAdmin)
      {
        deckIds = null;
      }
      else
      {
        if (string.IsNullOrEmpty(auth.UserSub)) return res.Forbidden("Requires authenticated admin user");
        var rows = await DbUtil.QueryAsync(conn, null,
          "select deck_id from admin_deck_permissions where admin_sub = $1 and can_read = 1", [auth.UserSub]);
        deckIds = rows.Select(r => Convert.ToInt64(r["deck_id"], CultureInfo.InvariantCulture)).ToList();
      }

      var result = await FindAsync(conn, new SimilarityQuery(text, deckIds, limit, threshold, exclude));
      return res.Ok(result);
    }
    catch (Exception ex) when (ex is ValidationError)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (Exception ex)
    {
      var handled = Helpers.HandlePgError(ex, res);
      if (handled is not null) return handled;
      return res.Error500(ex);
    }
  }

  private static string ParseText(JsonElement body)
  {
    if (!body.TryGetProperty("text", out var el) || el.ValueKind != JsonValueKind.String)
    {
      throw new ValidationError("text must be a string", "text");
    }
    var raw = el.GetString() ?? string.Empty;
    if (raw.Length > MaxTextLength) throw new ValidationError($"text too long (max {MaxTextLength})", "text");
    var text = raw.Trim();
    if (text.Length == 0) throw new ValidationError("text must not be blank", "text");
    return text;
  }

  private static string? ParseOptionalSlug(JsonElement body)
  {
    if (!body.TryGetProperty("deckSlug", out var el) || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind != JsonValueKind.String) throw new ValidationError("deckSlug must be a string or null", "deckSlug");
    var slug = (el.GetString() ?? string.Empty).Trim();
    if (slug.Length == 0) throw new ValidationError("deckSlug must not be blank", "deckSlug");
    return slug;
  }

  /// <summary>Absent or JSON null → null; a JSON integer → its value; anything else → ValidationError.</summary>
  private static long? OptionalInteger(JsonElement body, string key)
  {
    if (!body.TryGetProperty(key, out var el) || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out var v)) return v;
    throw new ValidationError($"{key} must be an integer", key);
  }

  private static double ParseThreshold(JsonElement body)
  {
    if (!body.TryGetProperty("threshold", out var el) || el.ValueKind == JsonValueKind.Null) return DefaultThreshold;
    if (el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var v) && v >= 0 && v <= 1) return v;
    throw new ValidationError("threshold must be a number in 0..1", "threshold");
  }

  private static IReadOnlyList<long>? ParseExcludeCardIds(JsonElement body)
  {
    if (!body.TryGetProperty("excludeCardIds", out var el) || el.ValueKind == JsonValueKind.Null) return null;
    if (el.ValueKind != JsonValueKind.Array || el.GetArrayLength() > MaxExcludeCardIds)
    {
      throw new ValidationError($"excludeCardIds must be an array of at most {MaxExcludeCardIds} integers", "excludeCardIds");
    }
    var ids = new List<long>();
    foreach (var item in el.EnumerateArray())
    {
      if (item.ValueKind != JsonValueKind.Number || !item.TryGetInt64(out var id))
      {
        throw new ValidationError($"excludeCardIds must be an array of at most {MaxExcludeCardIds} integers", "excludeCardIds");
      }
      ids.Add(id);
    }
    return ids;
  }
}
