using System.Globalization;
using Npgsql;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The ai_drafts lifecycle invariants as database constraints (R18 Y02, backend-design-18, migration 033): a pending
/// draft carries no decision, a decided draft records when and by whom, and only an accepted draft points at a card.
/// Any writer (ad-hoc SQL, a future route) is held to them, not only the Drafts handlers. Also checks that 033 is
/// safe to re-run and leaves a constraint NOT VALID, rather than failing, when an existing row violates it.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DraftInvariantsTests
{
  private readonly PostgresFixture _db;
  public DraftInvariantsTests(PostgresFixture db) => _db = db;

  private async Task<(long DeckId, long CardId)> SeedAsync()
  {
    var deckId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into decks (slug, title, author) values ($1, 'deck y02 drafts', 'tests') returning id", $"it-y02-drafts-{Guid.NewGuid():N}"),
      CultureInfo.InvariantCulture);
    var cardId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, 'Synthetic question?', 1) returning id",
      deckId, $"y02-{Guid.NewGuid():N}"[..20]), CultureInfo.InvariantCulture);
    return (deckId, cardId);
  }

  private Task<object?> InsertAsync(long deckId, string status, bool decided, bool decider, long? acceptedCardId) =>
    _db.ScalarAsync(
      """
      insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, status, card, submitted_by_sub,
        decided_at, decided_by_sub, accepted_card_id)
      values ($1, $2, $3, 'y02-draft', $4, '{}'::jsonb, 'it-y02',
        case when $5 then now() else null end, case when $6 then 'it-y02-editor' else null end, $7::bigint)
      returning id
      """,
      deckId, Guid.NewGuid(), Guid.NewGuid().ToString("N"), status, decided, decider, acceptedCardId);

  private static async Task AssertCheckViolationAsync(Func<Task> write, string constraint)
  {
    var ex = await Assert.ThrowsAsync<PostgresException>(write);
    Assert.Equal("23514", ex.SqlState);
    Assert.Equal(constraint, ex.ConstraintName);
  }

  [Fact]
  public async Task Constraints_AcceptTheLifecycleStates()
  {
    var (deckId, cardId) = await SeedAsync();
    Assert.NotNull(await InsertAsync(deckId, "pending", decided: false, decider: false, acceptedCardId: null));
    Assert.NotNull(await InsertAsync(deckId, "accepted", decided: true, decider: true, acceptedCardId: cardId));
    // on delete set null: an accepted draft whose card was hard-deleted keeps its decision.
    Assert.NotNull(await InsertAsync(deckId, "accepted", decided: true, decider: true, acceptedCardId: null));
    Assert.NotNull(await InsertAsync(deckId, "rejected", decided: true, decider: true, acceptedCardId: null));
  }

  [Fact]
  public async Task Constraints_RejectStatesTheStateMachineForbids()
  {
    var (deckId, cardId) = await SeedAsync();

    await AssertCheckViolationAsync(() => InsertAsync(deckId, "pending", decided: true, decider: false, acceptedCardId: null), "ck_ai_drafts_decided");
    await AssertCheckViolationAsync(() => InsertAsync(deckId, "pending", decided: false, decider: true, acceptedCardId: null), "ck_ai_drafts_decided");
    await AssertCheckViolationAsync(() => InsertAsync(deckId, "accepted", decided: false, decider: true, acceptedCardId: cardId), "ck_ai_drafts_decided");
    await AssertCheckViolationAsync(() => InsertAsync(deckId, "rejected", decided: true, decider: false, acceptedCardId: null), "ck_ai_drafts_decided");
    await AssertCheckViolationAsync(() => InsertAsync(deckId, "pending", decided: false, decider: false, acceptedCardId: cardId), "ck_ai_drafts_accept");
    await AssertCheckViolationAsync(() => InsertAsync(deckId, "rejected", decided: true, decider: true, acceptedCardId: cardId), "ck_ai_drafts_accept");

    // An ad-hoc update that reopens a decided draft without clearing its decision is refused too.
    var id = await InsertAsync(deckId, "rejected", decided: true, decider: true, acceptedCardId: null);
    await AssertCheckViolationAsync(() => _db.QueryAsync("update ai_drafts set status = 'pending' where id = $1", id), "ck_ai_drafts_decided");
  }

  [Fact]
  public async Task Migration033_IsIdempotent_AndLeavesAViolatedConstraintNotValid()
  {
    var sql = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "033_ai_qa_drafts_round2.sql"));
    var scratch = await _db.CreateScratchDatabaseAsync("it_y02_m033");
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 32);

    // A pre-033 row that an ad-hoc writer left inconsistent: accepted, but with no decision recorded.
    await using (var cmd = new NpgsqlCommand(
      """
      insert into decks (slug, title, author) values ('it-y02-m033', 'deck', 'tests');
      insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, status, card, submitted_by_sub)
      select id, gen_random_uuid(), 'k1', 'uid-1', 'accepted', '{}'::jsonb, 'it-y02' from decks where slug = 'it-y02-m033';
      """, conn))
    {
      await cmd.ExecuteNonQueryAsync();
    }

    for (var i = 0; i < 2; i++)
    {
      await using var cmd = new NpgsqlCommand(sql, conn);
      await cmd.ExecuteNonQueryAsync();
    }

    async Task<bool?> Validated(string name)
    {
      await using var cmd = new NpgsqlCommand("select convalidated from pg_constraint where conname = $1 and conrelid = 'ai_drafts'::regclass", conn);
      cmd.Parameters.AddWithValue(name);
      return await cmd.ExecuteScalarAsync() as bool?;
    }

    Assert.False(await Validated("ck_ai_drafts_decided"));
    Assert.True(await Validated("ck_ai_drafts_accept"));

    // Once the row is repaired, re-running 033 validates the constraint.
    await using (var repair = new NpgsqlCommand("update ai_drafts set decided_at = now(), decided_by_sub = 'it-y02-repair' where client_draft_key = 'k1'", conn))
    {
      await repair.ExecuteNonQueryAsync();
    }
    await using (var rerun = new NpgsqlCommand(sql, conn))
    {
      await rerun.ExecuteNonQueryAsync();
    }
    Assert.True(await Validated("ck_ai_drafts_decided"));
  }
}
