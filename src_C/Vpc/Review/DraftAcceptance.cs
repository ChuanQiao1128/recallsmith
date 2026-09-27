using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.Vpc.Review;

/// <summary>
/// The accept transaction body of a draft (R18A A03, contract A00 §5.5), shared by the human accept route
/// (<see cref="Drafts.HandleAccept"/>) and the automation's auto-accept (<c>DraftQaResults</c>, actor
/// <see cref="AutomationActor"/>). The caller owns the transaction: this locks the draft, then the live deck, checks
/// the stable uid against every card of the deck (live and deleted), inserts the card, marks the draft accepted by
/// <c>actorSub</c> and appends the review event. It never commits; a refusal is a <see cref="DraftAcceptanceException"/>
/// whose message is exactly the human route's response message.
/// </summary>
public static class DraftAcceptance
{
  public const string AutomationActor = "automation";

  public const string DraftNotFound = "DRAFT_NOT_FOUND", DraftNotPending = "DRAFT_NOT_PENDING", DeckNotFound = "DECK_NOT_FOUND",
    StableUidTaken = "STABLE_UID_TAKEN";

  public sealed record Accepted(long CardId, string StableUid, string Action);

  public sealed class DraftAcceptanceException(string code, string message) : Exception(message)
  {
    public string Code { get; } = code;
  }

  public static async Task<Accepted> AcceptInTransactionAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long draftId, long deckId,
    string actorSub, DraftCard? edited, int? reviewMs, CancellationToken ct = default)
  {
    ct.ThrowIfCancellationRequested();

    var draftRows = await DbUtil.QueryAsync(conn, tx, "select status, card from ai_drafts where id = $1 for update", [draftId]);
    if (draftRows.Count == 0) throw new DraftAcceptanceException(DraftNotFound, "Draft not found");
    if ((string)draftRows[0]["status"]! != "pending")
    {
      throw new DraftAcceptanceException(DraftNotPending, $"Draft {draftId} has already been decided");
    }

    var deckRows = await DbUtil.QueryAsync(conn, tx, "select id from decks where id = $1 and is_deleted = 0 for update", [deckId]);
    if (deckRows.Count == 0) throw new DraftAcceptanceException(DeckNotFound, "Deck not found");

    DraftCard stored;
    using (var storedDoc = JsonDocument.Parse((string)draftRows[0]["card"]!))
    {
      stored = DraftCard.Parse(storedDoc.RootElement);
    }
    // Card content only: source.grounding is review metadata, so an edit that drops it is not an edit and the
    // published card (final.SourceJson) never carries it.
    var storedJson = stored.ToJson(includeGrounding: false);
    var final = edited ?? stored;
    var finalJson = final.ToJson(includeGrounding: false);
    var action = edited is not null && finalJson != storedJson ? "edited_accepted" : "accepted";
    var stableUid = final.StableUid;

    var taken = await DbUtil.QueryAsync(conn, tx,
      "select id, is_deleted from cards where deck_id = $1 and stable_uid = $2", [deckId, stableUid]);
    if (taken.Count > 0)
    {
      var deleted = Convert.ToInt32(taken[0]["is_deleted"], CultureInfo.InvariantCulture) == 1;
      var takenId = Convert.ToInt64(taken[0]["id"], CultureInfo.InvariantCulture);
      throw new DraftAcceptanceException(StableUidTaken,
        $"stableUid {stableUid} is already used by card {takenId} in this deck{(deleted ? " (deleted)" : string.Empty)}");
    }

    var inserted = await DbUtil.ExecuteScalarAsync(conn, tx,
      """
      insert into cards (deck_id, stable_uid, question, explanation, code_snippet, code_language, real_world_usage,
        difficulty, order_in_deck, revision, topic, mcq, source)
      values ($1, $2, $3, $4, $5, $6, $7, $8,
        (select coalesce(max(order_in_deck), 0) + 10 from cards where deck_id = $1),
        1, $9, $10::jsonb, $11::jsonb)
      returning id
      """,
      [deckId, stableUid, final.Question, final.Explanation, final.CodeSnippet, final.CodeLanguage, final.RealWorldUsage,
       final.Difficulty, final.Topic, final.McqJson, final.SourceJson]);
    var cardId = Convert.ToInt64(inserted, CultureInfo.InvariantCulture);

    await DbUtil.ExecuteAsync(conn, tx,
      """
      update ai_drafts
      set status = 'accepted', accepted_card_id = $2, decided_at = now(), decided_by_sub = $3, updated_at = now()
      where id = $1
      """,
      [draftId, cardId, actorSub]);

    var edits = action == "edited_accepted";
    await DbUtil.ExecuteAsync(conn, tx,
      """
      insert into ai_review_events (draft_id, action, actor_sub, review_ms, before_card, after_card)
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      """,
      [draftId, action, actorSub, reviewMs, edits ? storedJson : null, edits ? finalJson : null]);

    return new Accepted(cardId, stableUid, action);
  }
}
