using System.Globalization;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.Vpc.Qa;

public sealed record QaCardState(long CardId, string StableUid, string ContentSha256, bool ReviewedAtCurrentHash);

public sealed record QaOpenBlocker(long FindingId, long CardId, string StableUid, string Category, string Message);

public sealed record QaGateState(IReadOnlyList<QaCardState> Changed, IReadOnlyList<QaOpenBlocker> OpenBlockers);

/// <summary>
/// The AI QA publish gate (R18 J13, contract §7.2 <c>scope=changed</c> and §7.10). A card is "changed" when it is
/// live and new or updated since the deck's live build. The gate refuses a publish only when both
/// <see cref="EnabledEnv"/> and <see cref="RequiredEnv"/> are truthy; otherwise it never blocks and runs no query.
/// </summary>
public static class QaGate
{
  public const string EnabledEnv = "AI_QA_ENABLED";
  public const string RequiredEnv = "AI_QA_REQUIRED";

  private const int MaxListed = 10;

  /// <summary>Live cards of the deck that are new or changed since the live build, in deck order.</summary>
  public static Task<List<Dictionary<string, object?>>> LoadChangedCardRowsAsync(NpgsqlConnection conn, long deckId, CancellationToken ct = default)
  {
    ct.ThrowIfCancellationRequested();
    return DbUtil.QueryAsync(conn, null,
      $"""
      select {CardContentHash.CardColumnsSql}
      from cards c
      join decks d on d.id = c.deck_id
      where c.deck_id = $1 and c.is_deleted = 0
        and (d.live_build_id is null or c.updated_at > coalesce(
          (select p.created_at from deck_publishes p where p.deck_id = d.id and p.build_id = d.live_build_id),
          '-infinity'::timestamptz))
      order by c.order_in_deck, c.id
      """,
      [deckId]);
  }

  public static async Task<QaGateState> ComputeAsync(NpgsqlConnection conn, long deckId, CancellationToken ct = default)
  {
    var rows = await LoadChangedCardRowsAsync(conn, deckId, ct);
    var cards = rows.Select(r => (
      CardId: Convert.ToInt64(r["id"], CultureInfo.InvariantCulture),
      StableUid: Convert.ToString(r["stableUid"], CultureInfo.InvariantCulture) ?? string.Empty,
      Hash: CardContentHash.Compute(r))).ToList();

    var ids = cards.Select(c => c.CardId).ToArray();
    var hashes = cards.Select(c => c.Hash).ToArray();

    // Both QA tables are always queried, even for an empty card list, so a missing table surfaces as 42P01.
    var reviewed = await ReviewedCardIdsAsync(conn, ids, hashes, ct);

    ct.ThrowIfCancellationRequested();
    var blockerRows = await DbUtil.QueryAsync(conn, null,
      """
      select f.id, f.card_id, f.category, f.message
      from ai_qa_findings f
      join unnest($1::bigint[], $2::text[]) as x(card_id, content_sha256)
        on x.card_id = f.card_id and x.content_sha256 = f.content_sha256
      where f.severity = 'blocker' and f.resolution = 'open'
      order by f.id
      """,
      [ids, hashes]);

    var position = new Dictionary<long, int>();
    for (var i = 0; i < cards.Count; i++) position[cards[i].CardId] = i;

    var changed = cards.Select(c => new QaCardState(c.CardId, c.StableUid, c.Hash, reviewed.Contains(c.CardId))).ToList();
    var blockers = blockerRows
      .Select(r =>
      {
        var cardId = Convert.ToInt64(r["card_id"], CultureInfo.InvariantCulture);
        return new QaOpenBlocker(
          Convert.ToInt64(r["id"], CultureInfo.InvariantCulture),
          cardId,
          cards[position[cardId]].StableUid,
          Convert.ToString(r["category"], CultureInfo.InvariantCulture) ?? string.Empty,
          Convert.ToString(r["message"], CultureInfo.InvariantCulture) ?? string.Empty);
      })
      .OrderBy(b => position[b.CardId])
      .ThenBy(b => b.FindingId)
      .ToList();

    return new QaGateState(changed, blockers);
  }

  /// <summary>The ids among <paramref name="cardIds"/> that have a <c>done</c> item at the paired content hash.</summary>
  internal static async Task<HashSet<long>> ReviewedCardIdsAsync(NpgsqlConnection conn, long[] cardIds, string[] hashes, CancellationToken ct = default)
  {
    ct.ThrowIfCancellationRequested();
    var rows = await DbUtil.QueryAsync(conn, null,
      """
      select distinct i.card_id
      from ai_qa_items i
      join unnest($1::bigint[], $2::text[]) as x(card_id, content_sha256)
        on x.card_id = i.card_id and x.content_sha256 = i.content_sha256
      where i.status = 'done'
      """,
      [cardIds, hashes]);
    return rows.Select(r => Convert.ToInt64(r["card_id"], CultureInfo.InvariantCulture)).ToHashSet();
  }

  /// <summary>
  /// null = the publish may proceed. Unless both flags are truthy this returns null without any query.
  /// </summary>
  public static async Task<APIGatewayProxyResponse?> EvaluatePublishAsync(NpgsqlConnection conn, long deckId, Res res, CancellationToken ct = default)
  {
    if (!(Env.Flag(EnabledEnv) && Env.Flag(RequiredEnv))) return null;

    QaGateState state;
    try
    {
      state = await ComputeAsync(conn, deckId, ct);
    }
    catch (PostgresException pg) when (pg.SqlState == "42P01")
    {
      return NotReady(res);
    }

    var missing = state.Changed.Where(c => !c.ReviewedAtCurrentHash).ToList();
    if (missing.Count > 0)
    {
      Log.Event("info", new { tag = "ai_qa", outcome = "publish_refused", code = "AI_QA_REQUIRED", deckId, cards = missing.Count });
      return Helpers.ErrorEnvelope(res, 409, "AI_QA_REQUIRED",
        $"AI QA required for {missing.Count} card(s): {string.Join(", ", missing.Take(MaxListed).Select(c => c.StableUid))}");
    }

    if (state.OpenBlockers.Count > 0)
    {
      Log.Event("info", new { tag = "ai_qa", outcome = "publish_refused", code = "AI_QA_BLOCKED", deckId, blockers = state.OpenBlockers.Count });
      return Helpers.ErrorEnvelope(res, 409, "AI_QA_BLOCKED",
        $"AI QA blocked by {state.OpenBlockers.Count} open blocker finding(s): {string.Join(", ", state.OpenBlockers.Take(MaxListed).Select(b => $"{b.StableUid}: {b.Category}"))}");
    }

    return null;
  }

  /// <summary>503 SERVER_NOT_READY_AI_QA: migration 031 has not run.</summary>
  internal static APIGatewayProxyResponse NotReady(Res res) =>
    Helpers.ErrorEnvelope(res, 503, "SERVER_NOT_READY_AI_QA", "AI QA tables are missing; run the database migration");
}
