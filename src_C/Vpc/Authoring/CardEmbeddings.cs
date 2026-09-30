using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Authoring;

/// <summary>
/// Card embeddings and semantic similarity (R20 V06, contract R20-00 §5). Vectors are computed on the owner's Mac
/// (<c>BAAI/bge-small-en-v1.5</c>, 384 dims, L2-normalised; V04 <c>dc-evals embed-cards --push</c>) and pushed here;
/// the server never calls a model. The pgvector extension is optional: prod's app role cannot create it, so migration
/// 038 creates <c>card_embeddings</c> only when <c>vector</c> exists, and every route that needs it answers
/// <c>503 VECTOR_NOT_READY</c> until then. <c>/cards/similar</c> only switches to the vector engine when it is ready
/// and the caller sent an embedding; otherwise its trigram behaviour is unchanged. Only the readiness answer is
/// cached (5 minutes, like <see cref="CardSimilarity"/>), never a result.
/// </summary>
public static class CardEmbeddings
{
  public const string Model = "BAAI/bge-small-en-v1.5";
  public const int Dim = 384;
  /// <summary>
  /// At most 100 items per PUT (contract R20-00 §10.1): one 384-dim full-precision vector as Python json.dumps writes it
  /// is about 8.5 KB, so 200 items (about 1.7 MB) would always exceed the 1 MiB request body cap in VpcFunction.
  /// </summary>
  public const int MaxItems = 100;
  public const int MaxKeyLength = 128;
  public const double SemanticDuplicateThreshold = 0.90;
  public const int DefaultDuplicateLimit = 50;
  public const int MaxDuplicateLimit = 200;
  public const string EngineVector = "vector";
  public const string EngineNone = "none";
  public const string NotReadyCode = "VECTOR_NOT_READY";
  public static readonly TimeSpan ReadyCacheTtl = TimeSpan.FromMinutes(5);

  private static readonly Regex Sha256Hex = new("^[0-9a-fA-F]{64}$", RegexOptions.Compiled);

  private sealed record ReadyCache(bool Ready, DateTime DetectedAtUtc);

  private static ReadyCache? _readyCache;

  internal static void ResetReadyCache() => Volatile.Write(ref _readyCache, null);

  // ---------------------------------------------------------------- canonical text

  /// <summary>The text a card's embedding is computed from: <c>question.Trim() + "\n\n" + explanation.Trim()</c>.</summary>
  public static string CanonicalText(string? question, string? explanation) =>
    (question ?? string.Empty).Trim() + "\n\n" + (explanation ?? string.Empty).Trim();

  /// <summary>Lower-hex SHA-256 of the UTF-8 bytes of <see cref="CanonicalText"/>; V04 computes the same value.</summary>
  public static string TextSha256(string? question, string? explanation) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalText(question, explanation)))).ToLowerInvariant();

  // ---------------------------------------------------------------- readiness

  /// <summary>"Vector ready" = the <c>vector</c> extension row exists AND <c>card_embeddings</c> exists. Cached 5 minutes.</summary>
  public static async Task<bool> IsReadyAsync(NpgsqlConnection conn, NpgsqlTransaction? tx = null, CancellationToken ct = default)
  {
    var cached = Volatile.Read(ref _readyCache);
    if (cached is not null && DateTime.UtcNow - cached.DetectedAtUtc < ReadyCacheTtl) return cached.Ready;

    await using var cmd = DbUtil.CreateCommand(conn, tx,
      "select exists(select 1 from pg_extension where extname = 'vector') and to_regclass('public.card_embeddings') is not null", []);
    var ready = await cmd.ExecuteScalarAsync(ct) is true;

    Volatile.Write(ref _readyCache, new ReadyCache(ready, DateTime.UtcNow));
    Log.Event("info", new { tag = "embeddings", reason = "vector_detected", ready });
    return ready;
  }

  /// <summary>A vector query failed because the table, column, type or operator is gone: forget the cached answer.</summary>
  internal static bool IsMissingVectorObject(PostgresException ex) => ex.SqlState is "42P01" or "42703" or "42704" or "42883";

  internal static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, NotReadyCode,
      "Card embeddings are not ready: install the vector extension and run migration 038_card_embeddings");

  // ---------------------------------------------------------------- vector helpers

  /// <summary>pgvector's text input form, <c>[v1,v2,…]</c>, bound as text and cast with <c>::vector</c>.</summary>
  internal static string VectorLiteral(IReadOnlyList<double> values) =>
    "[" + string.Join(",", values.Select(v => v.ToString("R", CultureInfo.InvariantCulture))) + "]";

  /// <summary>
  /// A JSON array of exactly <see cref="Dim"/> finite numbers, not all zero (a zero vector has no cosine).
  /// Anything else is a <see cref="ValidationError"/> naming <paramref name="field"/>.
  /// </summary>
  internal static double[] ParseVector(JsonElement el, string field)
  {
    if (el.ValueKind != JsonValueKind.Array || el.GetArrayLength() != Dim)
    {
      throw new ValidationError($"{field} must be an array of {Dim} numbers", field);
    }
    var values = new double[Dim];
    var i = 0;
    var nonZero = false;
    foreach (var item in el.EnumerateArray())
    {
      if (item.ValueKind != JsonValueKind.Number || !item.TryGetDouble(out var v) || !double.IsFinite(v))
      {
        throw new ValidationError($"{field} values must be finite numbers (no NaN or Infinity)", field);
      }
      nonZero |= v != 0;
      values[i++] = v;
    }
    if (!nonZero) throw new ValidationError($"{field} must not be the zero vector", field);
    return values;
  }

  /// <summary>The optional <c>embedding</c> of <c>POST /cards/similar</c>: absent or null → null.</summary>
  internal static double[]? ParseOptionalEmbedding(JsonElement body)
  {
    if (!body.TryGetProperty("embedding", out var el) || el.ValueKind == JsonValueKind.Null) return null;
    return ParseVector(el, "embedding");
  }

  private static double Round(double cosine) => Math.Round(cosine, 4, MidpointRounding.AwayFromZero);

  /// <summary>
  /// The vector engine behind <c>POST /cards/similar</c>: cosine similarity between <paramref name="embedding"/> and
  /// every stored embedding in scope (cards and decks not deleted), at least <c>Threshold</c>, highest first.
  /// <c>likelyDuplicate</c> is cosine ≥ <see cref="SemanticDuplicateThreshold"/>. Throws PostgresException when a
  /// vector object is missing; the caller checks <see cref="IsReadyAsync"/> first.
  /// </summary>
  public static async Task<SimilarityResult> FindSimilarAsync(NpgsqlConnection conn, SimilarityQuery query, IReadOnlyList<double> embedding,
    CancellationToken ct = default)
  {
    var limit = Math.Clamp(query.Limit, 1, CardSimilarity.MaxLimit);
    if (query.DeckIds is { Count: 0 }) return new SimilarityResult(EngineVector, query.Threshold, []);

    var parameters = new List<object?> { VectorLiteral(embedding) };
    var where = CardSimilarity.ScopeWhere(query, parameters);
    parameters.Add(query.Threshold);
    var thresholdParam = parameters.Count;
    parameters.Add(limit);
    var limitParam = parameters.Count;

    var sql = $"""
      select c.id, c.deck_id, d.slug, c.stable_uid, c.question, 1 - (e.embedding <=> $1::vector) as cosine
      from card_embeddings e
      join cards c on c.id = e.card_id
      join decks d on d.id = c.deck_id
      where {where} and 1 - (e.embedding <=> $1::vector) >= ${thresholdParam}
      order by cosine desc, c.id asc
      limit ${limitParam}
      """;

    var matches = new List<SimilarityMatch>();
    await using (var cmd = DbUtil.CreateCommand(conn, null, sql, parameters))
    await using (var reader = await cmd.ExecuteReaderAsync(ct))
    {
      while (await reader.ReadAsync(ct))
      {
        var cosine = Round(reader.GetDouble(5));
        matches.Add(new SimilarityMatch(reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
          cosine, cosine >= SemanticDuplicateThreshold));
      }
    }
    return new SimilarityResult(EngineVector, query.Threshold, matches);
  }

  // ---------------------------------------------------------------- PUT /api/v1/admin/card-embeddings

  private sealed record Item(string DeckSlug, string StableUid, string TextSha256, double[] Embedding);

  /// <summary>
  /// <c>PUT /api/v1/admin/card-embeddings</c> (super_admin): <c>{model, dim, items:[{deckSlug, stableUid, textSha256,
  /// embedding}]}</c>, 1..<see cref="MaxItems"/> items. The server recomputes each card's <see cref="TextSha256"/>: an item whose hash
  /// differs is not stored (<c>staleText</c>), an item naming no live card is not stored (<c>unknownCards</c>).
  /// </summary>
  public static async Task<APIGatewayProxyResponse> HandleUpsert(LambdaRequest req, Res res, AuthContext auth)
  {
    if (!req.Method.Equals("PUT", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("VALIDATION_ERROR", "Invalid JSON body");
      var items = ParseUpsertBody(doc.RootElement);

      if (!await IsReadyAsync(conn)) return NotReady(res);

      var current = await LoadCardsAsync(conn, items);
      var unknown = new List<string>();
      var stale = new List<string>();
      var ids = new List<long>();
      var hashes = new List<string>();
      var vectors = new List<string>();
      foreach (var item in items)
      {
        if (!current.TryGetValue((item.DeckSlug, item.StableUid), out var card)) { unknown.Add(item.StableUid); continue; }
        if (!string.Equals(card.Sha, item.TextSha256, StringComparison.Ordinal)) { stale.Add(item.StableUid); continue; }
        ids.Add(card.Id);
        hashes.Add(card.Sha);
        vectors.Add(VectorLiteral(item.Embedding));
      }

      var upserted = 0;
      AdminAuditEntry entry;
      bool persisted;
      await using (var tx = await conn.BeginTransactionAsync())
      {
        if (ids.Count > 0)
        {
          upserted = await DbUtil.ExecuteAsync(conn, tx,
            """
            insert into card_embeddings (card_id, model, dim, text_sha256, embedding, updated_at)
            select u.card_id, $4, $5, u.sha, u.emb::vector, now()
            from unnest($1::bigint[], $2::text[], $3::text[]) as u(card_id, sha, emb)
            on conflict (card_id) do update
              set model = excluded.model, dim = excluded.dim, text_sha256 = excluded.text_sha256,
                  embedding = excluded.embedding, updated_at = now()
            """,
            [ids.ToArray(), hashes.ToArray(), vectors.ToArray(), Model, Dim]);
        }
        entry = AdminAudit.Entry(auth, res, "card_embeddings.upsert", "card_embeddings", null,
          new { model = Model, dim = Dim, items = items.Count, upserted, unknownCards = unknown.Count, staleText = stale.Count });
        persisted = await AdminAudit.RecordAsync(conn, tx, entry);
        await tx.CommitAsync();
      }
      AdminAudit.Emit(entry, persisted);

      return res.Ok(new { upserted, unknownCards = unknown, staleText = stale });
    }
    catch (ValidationError ex)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (PostgresException ex) when (IsMissingVectorObject(ex))
    {
      ResetReadyCache();
      return NotReady(res);
    }
    catch (Exception ex)
    {
      var handled = Helpers.HandlePgError(ex, res);
      if (handled is not null) return handled;
      return res.Error500(ex);
    }
  }

  private static List<Item> ParseUpsertBody(JsonElement body)
  {
    if (body.ValueKind != JsonValueKind.Object) throw new ValidationError("Body must be a JSON object", "body");

    if (!body.TryGetProperty("model", out var model) || model.ValueKind != JsonValueKind.String || model.GetString() != Model)
    {
      throw new ValidationError($"model must be \"{Model}\"", "model");
    }
    if (!body.TryGetProperty("dim", out var dim) || dim.ValueKind != JsonValueKind.Number || !dim.TryGetInt32(out var d) || d != Dim)
    {
      throw new ValidationError($"dim must be {Dim}", "dim");
    }
    if (!body.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array
        || items.GetArrayLength() < 1 || items.GetArrayLength() > MaxItems)
    {
      throw new ValidationError($"items must be an array of 1..{MaxItems} items", "items");
    }

    var parsed = new List<Item>();
    var seen = new HashSet<(string, string)>();
    var index = 0;
    foreach (var el in items.EnumerateArray())
    {
      var at = $"items[{index++}]";
      if (el.ValueKind != JsonValueKind.Object) throw new ValidationError($"{at} must be an object", at);
      var deckSlug = RequiredKey(el, "deckSlug", at);
      var stableUid = RequiredKey(el, "stableUid", at);
      if (!el.TryGetProperty("textSha256", out var sha) || sha.ValueKind != JsonValueKind.String || !Sha256Hex.IsMatch(sha.GetString()!))
      {
        throw new ValidationError($"{at}.textSha256 must be a 64-character hex SHA-256", $"{at}.textSha256");
      }
      if (!el.TryGetProperty("embedding", out var embedding)) throw new ValidationError($"{at}.embedding is required", $"{at}.embedding");
      var vector = ParseVector(embedding, $"{at}.embedding");
      if (!seen.Add((deckSlug, stableUid))) throw new ValidationError($"{at} repeats {deckSlug}/{stableUid}", at);
      parsed.Add(new Item(deckSlug, stableUid, sha.GetString()!.ToLowerInvariant(), vector));
    }
    return parsed;
  }

  private static string RequiredKey(JsonElement el, string key, string at)
  {
    if (!el.TryGetProperty(key, out var v) || v.ValueKind != JsonValueKind.String)
    {
      throw new ValidationError($"{at}.{key} must be a string", $"{at}.{key}");
    }
    var s = (v.GetString() ?? string.Empty).Trim();
    if (s.Length == 0 || s.Length > MaxKeyLength) throw new ValidationError($"{at}.{key} must be 1..{MaxKeyLength} characters", $"{at}.{key}");
    return s;
  }

  /// <summary>Live cards (card and deck not deleted) named by the items, with the server's current text hash.</summary>
  private static async Task<Dictionary<(string, string), (long Id, string Sha)>> LoadCardsAsync(NpgsqlConnection conn, List<Item> items)
  {
    var rows = await DbUtil.QueryAsync(conn, null,
      """
      select d.slug, c.stable_uid, c.id, c.question, c.explanation
      from unnest($1::text[], $2::text[]) as k(slug, uid)
      join decks d on d.slug = k.slug and d.is_deleted = 0
      join cards c on c.deck_id = d.id and c.stable_uid = k.uid and c.is_deleted = 0
      """,
      [items.Select(i => i.DeckSlug).ToArray(), items.Select(i => i.StableUid).ToArray()]);

    var map = new Dictionary<(string, string), (long, string)>();
    foreach (var r in rows)
    {
      map[((string)r["slug"]!, (string)r["stable_uid"]!)] =
        (Convert.ToInt64(r["id"], CultureInfo.InvariantCulture), TextSha256(r["question"] as string, r["explanation"] as string));
    }
    return map;
  }

  // ---------------------------------------------------------------- GET /api/v1/admin/card-embeddings/status

  /// <summary>
  /// <c>GET /api/v1/admin/card-embeddings/status?deckId=</c> (admin): <c>{engine, model, cards, embedded, stale}</c>
  /// over the given deck (deck read) or every deck the caller may read. Never 503: without the vector store the
  /// engine is <c>"none"</c> and nothing is embedded.
  /// </summary>
  public static async Task<APIGatewayProxyResponse> HandleStatus(LambdaRequest req, Res res, AuthContext auth)
  {
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      long? deckId = null;
      if (req.Query.TryGetValue("deckId", out var raw) && !string.IsNullOrWhiteSpace(raw))
      {
        if (!long.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed < 1)
        {
          throw new ValidationError("deckId must be a positive integer", "deckId");
        }
        deckId = parsed;
      }

      IReadOnlyList<long>? deckIds;
      if (deckId is not null)
      {
        var denyDeck = await RequireLiveDeckReadAsync(conn, auth, deckId.Value, res);
        if (denyDeck is not null) return denyDeck;
        deckIds = [deckId.Value];
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

      var parameters = new List<object?>();
      var scope = "c.is_deleted = 0 and d.is_deleted = 0";
      if (deckIds is not null)
      {
        parameters.Add(deckIds.ToArray());
        scope += " and c.deck_id = any($1)";
      }

      var cards = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null,
        $"select count(*) from cards c join decks d on d.id = c.deck_id where {scope}", parameters), CultureInfo.InvariantCulture);

      var engine = EngineNone;
      long embedded = 0, stale = 0;
      if (await IsReadyAsync(conn))
      {
        try
        {
          var rows = await DbUtil.QueryAsync(conn, null,
            $"""
            select c.question, c.explanation, e.text_sha256
            from card_embeddings e
            join cards c on c.id = e.card_id
            join decks d on d.id = c.deck_id
            where {scope}
            """,
            parameters);
          engine = EngineVector;
          embedded = rows.Count;
          stale = rows.Count(r => !string.Equals((string)r["text_sha256"]!,
            TextSha256(r["question"] as string, r["explanation"] as string), StringComparison.Ordinal));
        }
        catch (PostgresException ex) when (IsMissingVectorObject(ex))
        {
          ResetReadyCache();
        }
      }

      return res.Ok(new { engine, model = Model, cards, embedded, stale });
    }
    catch (ValidationError ex)
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

  // ---------------------------------------------------------------- GET /api/v1/admin/decks/:deckId/semantic-duplicates

  /// <summary>
  /// <c>GET /api/v1/admin/decks/:deckId/semantic-duplicates?minCosine=0.90&amp;limit=50</c> (admin + deck read):
  /// every unordered pair of live cards in the deck whose embeddings have cosine ≥ minCosine, once each (a has the
  /// lower card id), highest first.
  /// </summary>
  public static async Task<APIGatewayProxyResponse> HandleSemanticDuplicates(LambdaRequest req, Res res, AuthContext auth, string deckIdRaw)
  {
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    try
    {
      if (!long.TryParse(deckIdRaw, NumberStyles.None, CultureInfo.InvariantCulture, out var deckId) || deckId < 1)
      {
        throw new ValidationError("deckId must be a positive integer", "deckId");
      }
      var minCosine = SemanticDuplicateThreshold;
      if (req.Query.TryGetValue("minCosine", out var rawMin) && !string.IsNullOrWhiteSpace(rawMin))
      {
        if (!double.TryParse(rawMin, NumberStyles.Float, CultureInfo.InvariantCulture, out minCosine) || !(minCosine >= 0 && minCosine <= 1))
        {
          throw new ValidationError("minCosine must be a number in 0..1", "minCosine");
        }
      }
      var limit = DefaultDuplicateLimit;
      if (req.Query.TryGetValue("limit", out var rawLimit) && !string.IsNullOrWhiteSpace(rawLimit))
      {
        if (!int.TryParse(rawLimit, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit < 1 || limit > MaxDuplicateLimit)
        {
          throw new ValidationError($"limit must be an integer in 1..{MaxDuplicateLimit}", "limit");
        }
      }

      if (!await IsReadyAsync(conn)) return NotReady(res);

      var denyDeck = await RequireLiveDeckReadAsync(conn, auth, deckId, res);
      if (denyDeck is not null) return denyDeck;

      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select a.id as a_id, a.stable_uid as a_uid, a.question as a_question,
               b.id as b_id, b.stable_uid as b_uid, b.question as b_question,
               1 - (ea.embedding <=> eb.embedding) as cosine
        from card_embeddings ea
        join cards a on a.id = ea.card_id
        join card_embeddings eb on eb.card_id > ea.card_id
        join cards b on b.id = eb.card_id
        where a.deck_id = $1 and b.deck_id = $1 and a.is_deleted = 0 and b.is_deleted = 0
          and 1 - (ea.embedding <=> eb.embedding) >= $2
        order by cosine desc, a.id asc, b.id asc
        limit $3
        """,
        [deckId, minCosine, limit]);

      var pairs = rows.Select(r => new
      {
        cosine = Round(Convert.ToDouble(r["cosine"], CultureInfo.InvariantCulture)),
        a = new { cardId = Convert.ToInt64(r["a_id"], CultureInfo.InvariantCulture), stableUid = (string)r["a_uid"]!, question = (string)r["a_question"]! },
        b = new { cardId = Convert.ToInt64(r["b_id"], CultureInfo.InvariantCulture), stableUid = (string)r["b_uid"]!, question = (string)r["b_question"]! },
      }).ToList();

      return res.Ok(new { engine = EngineVector, minCosine, pairs });
    }
    catch (ValidationError ex)
    {
      return res.BadRequest("VALIDATION_ERROR", ex.Message);
    }
    catch (PostgresException ex) when (IsMissingVectorObject(ex))
    {
      ResetReadyCache();
      return NotReady(res);
    }
    catch (Exception ex)
    {
      var handled = Helpers.HandlePgError(ex, res);
      if (handled is not null) return handled;
      return res.Error500(ex);
    }
  }

  /// <summary>404 DECK_NOT_FOUND for a missing or deleted deck, then the deck-read grant (super_admin always passes).</summary>
  private static async Task<APIGatewayProxyResponse?> RequireLiveDeckReadAsync(NpgsqlConnection conn, AuthContext auth, long deckId, Res res)
  {
    var rows = await DbUtil.QueryAsync(conn, null, "select id from decks where id = $1 and is_deleted = 0", [deckId]);
    if (rows.Count == 0) return Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", "Deck not found");
    return await Helpers.RequireDeckRead(conn, auth.UserSub, deckId, auth.IsSuperAdmin, res);
  }
}
