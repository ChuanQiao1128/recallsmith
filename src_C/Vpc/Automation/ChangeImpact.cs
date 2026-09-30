using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>A live card whose <c>source.url</c> is exactly a changed or gone watched page (R20 V07).</summary>
public sealed record AffectedCard(long CardId, long DeckId, string DeckSlug, string StableUid, string Question, bool QuoteMissing);

/// <summary>A live card a new release-notes item possibly affects, with its full-text rank (R20 V07).</summary>
public sealed record PossiblyAffectedCard(long CardId, long DeckId, string DeckSlug, string StableUid, string Question, double Rank);

/// <summary>A release-notes item of the digest's week with its possibly affected cards.</summary>
public sealed record DigestFeedItem(string? Title, string Url, IReadOnlyList<PossiblyAffectedCard> Cards);

/// <summary>
/// Deterministic change impact of the source watch (R20 V07, contract R20-00 §6). No model call and no card edit:
/// <list type="bullet">
/// <item>A <c>changed</c>/<c>gone</c> page event stores <c>details.affectedCards</c>, the live cards (card and deck not
/// deleted) whose <c>source-&gt;&gt;'url'</c> equals the page URL, by id, at most <see cref="MaxAffectedCards"/>, and
/// <c>details.needsHumanReview</c>, true when such cards exist and the AI QA re-check is unavailable (AI QA off, or
/// the re-check could not start and was dropped).</item>
/// <item>A new matching release-notes item gets <c>possibly_affected_cards</c> (migration 039): the top
/// <see cref="MaxPossiblyAffectedCards"/> live cards by built-in PostgreSQL full-text search of
/// <c>to_tsvector('english', question || ' ' || explanation)</c> against the item's title and summary, ranked with
/// <c>ts_rank_cd</c>, at least <see cref="MinFeedRank"/>.</item>
/// </list>
/// Item text is untrusted: it is only a bound query parameter and is never logged.
/// </summary>
public static class ChangeImpact
{
  public const int MaxAffectedCards = 200;
  public const int MaxPossiblyAffectedCards = 5;
  public const int MaxEmailCards = 20;
  public const int RecentFeedItems = 20;
  public const int MaxQueryTextLength = 2000;

  /// <summary>
  /// The minimum <c>ts_rank_cd</c> (normalization 0) of a possibly affected card. The item's terms are OR-ed (every
  /// lexeme of <c>plainto_tsquery</c>, whose AND would need every word of a headline in one card), so each occurrence
  /// of a query term in the card is one cover worth 0.1: 0.2 needs at least two term hits. One shared generic word
  /// ("Amazon" once) ranks 0.1 and is left out; a card on the item's topic ranks well above.
  /// </summary>
  public const double MinFeedRank = 0.2;

  private const string CardDocument = "to_tsvector('english', c.question || ' ' || coalesce(c.explanation, ''))";

  // ---------------------------------------------------------------------------------------------
  // page events
  // ---------------------------------------------------------------------------------------------

  /// <summary>The live cards citing exactly <paramref name="url"/>, by id, capped at <see cref="MaxAffectedCards"/>.</summary>
  public static async Task<List<AffectedCard>> AffectedCardsAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string url,
    IReadOnlyCollection<long> missingQuoteCardIds)
  {
    var rows = await DbUtil.QueryAsync(conn, tx,
      $"""
      select c.id, c.deck_id, d.slug, c.stable_uid, c.question
      from cards c join decks d on d.id = c.deck_id
      where c.is_deleted = 0 and d.is_deleted = 0 and c.source->>'url' = $1
      order by c.id
      limit {MaxAffectedCards}
      """, [url]);
    return rows.Select(r =>
    {
      var id = RunnerRoutes.Long(r["id"]);
      return new AffectedCard(id, RunnerRoutes.Long(r["deck_id"]), (string)r["slug"]!, (string)r["stable_uid"]!, (string)r["question"]!,
        missingQuoteCardIds.Contains(id));
    }).ToList();
  }

  /// <summary>The camelCase JSON shape stored in <c>details.affectedCards</c> and returned by the watch route.</summary>
  public static object ToJson(AffectedCard c) =>
    new { cardId = c.CardId, deckId = c.DeckId, deckSlug = c.DeckSlug, stableUid = c.StableUid, question = c.Question, quoteMissing = c.QuoteMissing };

  public static object ToJson(PossiblyAffectedCard c) =>
    new { cardId = c.CardId, deckId = c.DeckId, deckSlug = c.DeckSlug, stableUid = c.StableUid, question = c.Question, rank = c.Rank };

  /// <summary><c>details.affectedCards</c> of an event's details (empty when absent or malformed).</summary>
  public static List<AffectedCard> ParseAffected(JsonElement details)
  {
    var list = new List<AffectedCard>();
    if (details.ValueKind != JsonValueKind.Object || !details.TryGetProperty("affectedCards", out var arr) || arr.ValueKind != JsonValueKind.Array)
    {
      return list;
    }
    foreach (var c in arr.EnumerateArray())
    {
      if (c.ValueKind != JsonValueKind.Object) continue;
      list.Add(new AffectedCard(Int64(c, "cardId"), Int64(c, "deckId"), Str(c, "deckSlug"), Str(c, "stableUid"), Str(c, "question"),
        c.TryGetProperty("quoteMissing", out var q) && q.ValueKind == JsonValueKind.True));
    }
    return list;
  }

  /// <summary><c>details.needsHumanReview</c> (false when absent).</summary>
  public static bool ParseNeedsHumanReview(JsonElement details) =>
    details.ValueKind == JsonValueKind.Object && details.TryGetProperty("needsHumanReview", out var v) && v.ValueKind == JsonValueKind.True;

  /// <summary>The console editor of one card.</summary>
  public static string EditUrl(string consoleBaseUrl, long deckId, long cardId) =>
    $"{consoleBaseUrl.TrimEnd('/')}/decks/cards/edit?deckId={deckId.ToString(CultureInfo.InvariantCulture)}&cardId={cardId.ToString(CultureInfo.InvariantCulture)}";

  // ---------------------------------------------------------------------------------------------
  // release-notes items
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// The live cards (of <paramref name="deckId"/> when given) matching <paramref name="text"/> by full-text search, rank
  /// at least <see cref="MinFeedRank"/>, highest first (ties by card id), at most <see cref="MaxPossiblyAffectedCards"/>.
  /// Blank or stop-word-only text matches nothing.
  /// </summary>
  public static async Task<List<PossiblyAffectedCard>> PossiblyAffectedAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string text, long? deckId)
  {
    if (string.IsNullOrWhiteSpace(text)) return [];
    var query = text.Length > MaxQueryTextLength ? text[..MaxQueryTextLength] : text;
    var rows = await DbUtil.QueryAsync(conn, tx,
      $"""
      with q as (
        select nullif(replace(plainto_tsquery('english', $1)::text, ' & ', ' | '), '') as t
      ), ranked as (
        select c.id, c.deck_id, d.slug, c.stable_uid, c.question, ts_rank_cd({CardDocument}, q.t::tsquery) as rank
        from q, cards c join decks d on d.id = c.deck_id
        where q.t is not null and c.is_deleted = 0 and d.is_deleted = 0 and ($2::bigint is null or c.deck_id = $2::bigint)
          and {CardDocument} @@ q.t::tsquery
      )
      select id, deck_id, slug, stable_uid, question, rank from ranked
      where round(rank::numeric, 4) >= $3::numeric
      order by rank desc, id
      limit {MaxPossiblyAffectedCards}
      """, [query, deckId, (decimal)MinFeedRank]);
    return rows.Select(r => new PossiblyAffectedCard(RunnerRoutes.Long(r["id"]), RunnerRoutes.Long(r["deck_id"]), (string)r["slug"]!,
      (string)r["stable_uid"]!, (string)r["question"]!,
      Math.Round(Convert.ToDouble(r["rank"], CultureInfo.InvariantCulture), 4, MidpointRounding.AwayFromZero))).ToList();
  }

  /// <summary>One new release-notes item to analyse after the report's commit.</summary>
  public sealed record FeedItemImpact(long TargetId, string ItemKey, string? Title, string? Summary, long? DeckId);

  /// <summary>
  /// Stores <c>possibly_affected_cards</c> on each new item (best effort after the report's commit, never throws).
  /// Before migration 039 the column is missing: the step is skipped with one log line.
  /// </summary>
  public static async Task RecordFeedItemsAsync(NpgsqlConnection conn, IReadOnlyList<FeedItemImpact> items)
  {
    foreach (var item in items)
    {
      try
      {
        var text = string.Join(' ', new[] { item.Title, item.Summary }.Where(s => !string.IsNullOrWhiteSpace(s)));
        var cards = await PossiblyAffectedAsync(conn, null, text, item.DeckId);
        await DbUtil.ExecuteAsync(conn, null,
          "update source_watch_feed_items set possibly_affected_cards = $3::jsonb where target_id = $1 and item_key = $2",
          [item.TargetId, item.ItemKey, JsonSerializer.Serialize(cards.Select(ToJson))]);
      }
      catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
      {
        Log.Event("info", new { tag = "source_watch", reason = "impact_not_migrated", targetId = item.TargetId });
        return;
      }
      catch (Exception ex)
      {
        Log.Event("warn", new { tag = "source_watch", reason = "feed_impact_failed", targetId = item.TargetId, error = ex.Message });
      }
    }
  }

  /// <summary>The latest analysed items for the watch route (empty before migration 039).</summary>
  public static async Task<List<object>> RecentFeedItemsAsync(NpgsqlConnection conn)
  {
    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select target_id, item_key, title, url, first_seen_at, possibly_affected_cards::text as cards
        from source_watch_feed_items
        where possibly_affected_cards is not null
        order by first_seen_at desc, target_id desc, item_key
        limit {RecentFeedItems}
        """, []);
      return rows.Select(r => (object)new
      {
        id = $"{RunnerRoutes.Long(r["target_id"]).ToString(CultureInfo.InvariantCulture)}:{(string)r["item_key"]!}",
        title = r["title"] as string,
        url = (string)r["url"]!,
        firstSeenAt = RunnerRoutes.Timestamp(r["first_seen_at"]),
        possiblyAffectedCards = ParsePossiblyAffected(r["cards"] as string).Select(ToJson).ToList(),
      }).ToList();
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      Log.Event("info", new { tag = "source_watch", reason = "impact_not_migrated" });
      return [];
    }
  }

  /// <summary>
  /// The digest's release notes: the number of items analysed in [<paramref name="start"/>, <paramref name="end"/>) and
  /// those with at least one possibly affected card (oldest first). Zero and empty before migration 039.
  /// </summary>
  public static async Task<(long New, List<DigestFeedItem> Items)> DigestFeedItemsAsync(NpgsqlConnection conn, DateTime start, DateTime end)
  {
    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select title, url, possibly_affected_cards::text as cards
        from source_watch_feed_items
        where possibly_affected_cards is not null and first_seen_at >= $1 and first_seen_at < $2
        order by first_seen_at, target_id, item_key
        """, [start, end]);
      var items = rows.Select(r => new DigestFeedItem(r["title"] as string, (string)r["url"]!, ParsePossiblyAffected(r["cards"] as string)))
        .Where(i => i.Cards.Count > 0).ToList();
      return (rows.Count, items);
    }
    catch (PostgresException ex) when (ex.SqlState is "42P01" or "42703")
    {
      Log.Event("info", new { tag = "source_watch", reason = "impact_not_migrated" });
      return (0, []);
    }
  }

  private static List<PossiblyAffectedCard> ParsePossiblyAffected(string? json)
  {
    var list = new List<PossiblyAffectedCard>();
    if (json is null) return list;
    using var doc = JsonDocument.Parse(json);
    if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
    foreach (var c in doc.RootElement.EnumerateArray())
    {
      if (c.ValueKind != JsonValueKind.Object) continue;
      var rank = c.TryGetProperty("rank", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetDouble() : 0;
      list.Add(new PossiblyAffectedCard(Int64(c, "cardId"), Int64(c, "deckId"), Str(c, "deckSlug"), Str(c, "stableUid"), Str(c, "question"), rank));
    }
    return list;
  }

  private static long Int64(JsonElement el, string name) =>
    el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;

  private static string Str(JsonElement el, string name) =>
    el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : string.Empty;
}
