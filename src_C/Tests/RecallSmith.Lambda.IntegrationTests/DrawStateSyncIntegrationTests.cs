using System.Text.Json;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The draw-state sync endpoint, end to end, against a real Postgres.
///
/// WHY these cases and not the DrawStateMerge laws again: the laws are about a
/// C# transcription, and everything that can actually break in production lives
/// in SQL that no unit test reaches. Three things in particular only exist once
/// a planner runs them: the ON CONFLICT DO NOTHING that makes the collection
/// idempotent, the lexicographic ROW comparison that decides pity and wallet
/// ties (a bare `>=` on the stamp would pass every pure-function test that
/// compares only stamps, and would still let a reinstall wipe an account), and
/// the request-level slug dedupe, whose absence is not a wrong answer but a
/// hard error from Postgres itself ("ON CONFLICT DO UPDATE command cannot
/// affect row a second time").
///
/// Isolation is by user_sub. Every test mints its own, so the suite is
/// rerunnable against a container that already holds rows from earlier runs.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DrawStateSyncIntegrationTests
{
  private readonly PostgresFixture _db;

  private const string Deck = "draw-basics";

  // Well in the past, so no fixture stamp accidentally trips the future-clock
  // clamp and hides the behaviour actually under test.
  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds();

  private const long ClientClockSlackMs = 5 * 60 * 1000;

  public DrawStateSyncIntegrationTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewUser(string tag) => $"it-draw-{tag}-{Guid.NewGuid():N}";

  private static object DeckIn(
    string slug,
    IEnumerable<string>? owned = null,
    int? draws = null,
    int threshold = 0,
    long stamp = 0) => new
    {
      deckSlug = slug,
      owned = (owned ?? Array.Empty<string>()).ToArray(),
      pity = draws is null ? null : (object)new { draws = draws.Value, threshold, updatedAtMs = stamp },
    };

  private static object Wallet(int available, int reserve, long stamp) =>
    new { availablePulls = available, reservePulls = reserve, updatedAtMs = stamp };

  private static object Body(object? wallet, params object[] decks) => new { decks, wallet };

  private static JsonElement DeckOut(JsonElement data, string slug)
  {
    foreach (var d in data.GetProperty("decks").EnumerateArray())
    {
      if (d.GetProperty("deckSlug").GetString() == slug) return d;
    }

    Assert.Fail($"deck {slug} missing from response: {data}");
    return default;
  }

  private static string[] OwnedOut(JsonElement data, string slug) =>
    DeckOut(data, slug).GetProperty("owned").EnumerateArray().Select(e => e.GetString()!).ToArray();

  private static int DeckCount(JsonElement data, string slug) =>
    data.GetProperty("decks").EnumerateArray().Count(d => d.GetProperty("deckSlug").GetString() == slug);

  private async Task<long> OwnedRowCountAsync(string userSub) =>
    Convert.ToInt64(await _db.ScalarAsync(
      "select count(*) from user_draw_owned where user_sub = $1", userSub));

  private async Task<(int Draws, int Threshold, long Stamp)> MetaAsync(string userSub, string slug)
  {
    var rows = await _db.QueryAsync(
      "select pity_draws, pity_threshold, updated_at_ms from user_draw_meta where user_sub = $1 and deck_slug = $2",
      userSub,
      slug);
    Assert.Single(rows);
    return (
      Convert.ToInt32(rows[0]["pity_draws"]),
      Convert.ToInt32(rows[0]["pity_threshold"]),
      Convert.ToInt64(rows[0]["updated_at_ms"]));
  }

  private async Task<(int Available, int Reserve, long Stamp)> WalletAsync(string userSub)
  {
    var rows = await _db.QueryAsync(
      "select available_pulls, reserve_pulls, updated_at_ms from user_wallet where user_sub = $1",
      userSub);
    Assert.Single(rows);
    return (
      Convert.ToInt32(rows[0]["available_pulls"]),
      Convert.ToInt32(rows[0]["reserve_pulls"]),
      Convert.ToInt64(rows[0]["updated_at_ms"]));
  }

  // ------------------------------------------------------- D1: owned union

  [Fact]
  public async Task D1_OwnedIsIdempotent_WithinOneRequestAndAcrossRequests()
  {
    var user = NewUser("owned");

    // Duplicates inside a single request. The handler does NOT dedupe uids (it
    // only dedupes slugs), so this pair of identical rows reaches one INSERT
    // statement and it is ON CONFLICT DO NOTHING that has to absorb it. Without
    // the clause this is not a wrong count, it is a unique violation.
    var first = await LambdaHost.PostDrawStateSyncAsync(user, Body(null, DeckIn(Deck, ["u1", "u2", "u1"])));
    Assert.Equal(new[] { "u1", "u2" }, OwnedOut(first, Deck));
    Assert.Equal(2L, await OwnedRowCountAsync(user));

    // created_at is captured so the replay below can prove DO NOTHING really
    // did nothing, rather than doing an invisible update that happens to leave
    // the same values.
    var createdBefore = await _db.ScalarAsync(
      "select created_at from user_draw_owned where user_sub = $1 and deck_slug = $2 and stable_uid = $3",
      user,
      Deck,
      "u1");

    // The same request again: a retry after a timeout looks exactly like this,
    // and it must be a no-op.
    var replay = await LambdaHost.PostDrawStateSyncAsync(user, Body(null, DeckIn(Deck, ["u1", "u2", "u1"])));
    Assert.Equal(new[] { "u1", "u2" }, OwnedOut(replay, Deck));
    Assert.Equal(2L, await OwnedRowCountAsync(user));

    var createdAfter = await _db.ScalarAsync(
      "select created_at from user_draw_owned where user_sub = $1 and deck_slug = $2 and stable_uid = $3",
      user,
      Deck,
      "u1");
    Assert.Equal(createdBefore, createdAfter);

    // A partial push that overlaps: the operator is union, so the server keeps
    // what this device no longer mentions and adds what it brings.
    var third = await LambdaHost.PostDrawStateSyncAsync(user, Body(null, DeckIn(Deck, ["u2", "u3"])));
    Assert.Equal(new[] { "u1", "u2", "u3" }, OwnedOut(third, Deck));
    Assert.Equal(3L, await OwnedRowCountAsync(user));

    // The same uid under a different deck is a different card, so the primary
    // key must not collapse them.
    var other = await LambdaHost.PostDrawStateSyncAsync(user, Body(null, DeckIn("other-deck", ["u1"])));
    Assert.Equal(new[] { "u1", "u2", "u3" }, OwnedOut(other, Deck));
    Assert.Equal(new[] { "u1" }, OwnedOut(other, "other-deck"));
    Assert.Equal(4L, await OwnedRowCountAsync(user));
  }

  // --------------------------------------------------- D2: pity tie-breaking

  [Fact]
  public async Task D2_PityTieResolvesTowardMoreProgress_InEitherOrder()
  {
    // Same stamp, different contents. This is the ordinary case and not an
    // exotic one: a client sends 0 for any value whose change it never watched,
    // so every device's first sync ties with every other device's.
    var behind = DeckIn(Deck, draws: 3, threshold: 10, stamp: Base);
    var ahead = DeckIn(Deck, draws: 7, threshold: 10, stamp: Base);

    var forward = NewUser("pity-fwd");
    await LambdaHost.PostDrawStateSyncAsync(forward, Body(null, behind));
    await LambdaHost.PostDrawStateSyncAsync(forward, Body(null, ahead));

    var reverse = NewUser("pity-rev");
    await LambdaHost.PostDrawStateSyncAsync(reverse, Body(null, ahead));
    await LambdaHost.PostDrawStateSyncAsync(reverse, Body(null, behind));

    var forwardState = await MetaAsync(forward, Deck);
    var reverseState = await MetaAsync(reverse, Deck);

    Assert.Equal(forwardState, reverseState);
    Assert.Equal((7, 10, Base), forwardState);
  }

  [Fact]
  public async Task D2_PityColumnsMoveAsOneSnapshot_NeverMixedAcrossDevices()
  {
    // The four-column same-predicate rule, stated where it can actually fail: a
    // threshold from device A next to a draw count from device B describes a
    // pity state no device was ever in. The winner here is decided by draws
    // (9 > 5 at an equal stamp), so its threshold must travel with it.
    var deviceA = DeckIn(Deck, draws: 5, threshold: 30, stamp: Base);
    var deviceB = DeckIn(Deck, draws: 9, threshold: 10, stamp: Base);

    var forward = NewUser("pity-cols-fwd");
    await LambdaHost.PostDrawStateSyncAsync(forward, Body(null, deviceA));
    await LambdaHost.PostDrawStateSyncAsync(forward, Body(null, deviceB));

    var reverse = NewUser("pity-cols-rev");
    await LambdaHost.PostDrawStateSyncAsync(reverse, Body(null, deviceB));
    await LambdaHost.PostDrawStateSyncAsync(reverse, Body(null, deviceA));

    Assert.Equal((9, 10, Base), await MetaAsync(forward, Deck));
    Assert.Equal((9, 10, Base), await MetaAsync(reverse, Deck));
  }

  [Fact]
  public async Task D2_LaterStampWinsEvenWhenItCarriesLessProgress()
  {
    // The tie rule must not quietly become "bigger counter always wins": a
    // genuine reset (pity consumed, counter back to 0) is a real event, and a
    // real stamp has to beat a stale larger count. Stamp is the FIRST element
    // of the row comparison precisely so that content only decides ties.
    var user = NewUser("pity-reset");
    await LambdaHost.PostDrawStateSyncAsync(user, Body(null, DeckIn(Deck, draws: 9, threshold: 10, stamp: Base)));
    await LambdaHost.PostDrawStateSyncAsync(user, Body(null, DeckIn(Deck, draws: 0, threshold: 10, stamp: Base + 1000)));

    Assert.Equal((0, 10, Base + 1000), await MetaAsync(user, Deck));
  }

  // ------------------------------------------------------- D3: clock clamp

  [Fact]
  public async Task D3_FutureClientStampIsClampedToServerNowPlusFiveMinutes()
  {
    var user = NewUser("clamp");
    var farFuture = DateTimeOffset.UtcNow.AddYears(5).ToUnixTimeMilliseconds();

    var data = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(4, 1, farFuture), DeckIn(Deck, draws: 2, threshold: 10, stamp: farFuture)));

    var serverTimeMs = data.GetProperty("serverTimeMs").GetInt64();
    var ceiling = serverTimeMs + ClientClockSlackMs;

    var wallet = await WalletAsync(user);
    var meta = await MetaAsync(user, Deck);

    // The clamp is computed at handler entry and serverTimeMs at handler exit,
    // so the stored value sits just below the ceiling rather than exactly on
    // it. A generous window still fails hard if the clamp is missing, because
    // the unclamped value is five years out.
    Assert.InRange(wallet.Stamp, ceiling - 10_000, ceiling);
    Assert.InRange(meta.Stamp, ceiling - 10_000, ceiling);

    // Clamped is not discarded: the pull really happened, so the snapshot still
    // has to win over an older one.
    var later = await LambdaHost.PostDrawStateSyncAsync(user, Body(Wallet(9, 0, Base), DeckIn(Deck)));
    Assert.Equal(4, later.GetProperty("wallet").GetProperty("availablePulls").GetInt32());

    // And a second device with an equally broken clock cannot ratchet the
    // stamp any further into the future, so the account is never locked to a
    // stamp no honest client can beat.
    await LambdaHost.PostDrawStateSyncAsync(user, Body(Wallet(6, 2, farFuture + 999_999), DeckIn(Deck)));
    var after = await WalletAsync(user);
    Assert.InRange(after.Stamp, ceiling - 10_000, ceiling + 10_000);
    Assert.Equal(6, after.Available);
  }

  // ------------------------------------------------- D4: reinstall recovery

  [Fact]
  public async Task D4_EmptySnapshotWithUnknownStampNeverWipesTheAccount()
  {
    // The bug this endpoint exists to prevent, run end to end: reinstall the
    // app, open it before the first sync pulls anything down, and it pushes an
    // empty collection, a zeroed pity counter and a zeroed wallet, all stamped
    // 0 because it has never observed any of them change.
    var user = NewUser("reinstall");

    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(12, 3, Base), DeckIn(Deck, ["a", "b"], draws: 7, threshold: 10, stamp: Base)));

    var recovered = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(0, 0, 0), DeckIn(Deck, Array.Empty<string>(), draws: 0, threshold: 0, stamp: 0)));

    // The response is what the fresh install adopts, so the assertion belongs
    // on it and not only on the tables.
    Assert.Equal(new[] { "a", "b" }, OwnedOut(recovered, Deck));
    var pity = DeckOut(recovered, Deck).GetProperty("pity");
    Assert.Equal(7, pity.GetProperty("draws").GetInt32());
    Assert.Equal(10, pity.GetProperty("threshold").GetInt32());
    Assert.Equal(12, recovered.GetProperty("wallet").GetProperty("availablePulls").GetInt32());
    Assert.Equal(3, recovered.GetProperty("wallet").GetProperty("reservePulls").GetInt32());

    Assert.Equal((7, 10, Base), await MetaAsync(user, Deck));
    Assert.Equal((12, 3, Base), await WalletAsync(user));
  }

  [Fact]
  public async Task D4_UnknownStampOnBothSidesStillFavoursTheRicherState()
  {
    // The harder half of the same story. Above, the account had a real stamp,
    // so any stamp comparison would have saved it. Here the account's own state
    // was itself uploaded under an unknown stamp (a device that played for
    // months offline and never watched the clock), so both sides are 0 and the
    // stamp decides nothing. With a plain `>=` the reinstall arrives last and
    // wins; only the content tiebreak keeps the collection.
    var user = NewUser("reinstall-tie");

    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(8, 2, 0), DeckIn(Deck, ["a", "b", "c"], draws: 6, threshold: 10, stamp: 0)));

    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(0, 0, 0), DeckIn(Deck, Array.Empty<string>(), draws: 0, threshold: 0, stamp: 0)));

    Assert.Equal((6, 10, 0L), await MetaAsync(user, Deck));
    Assert.Equal((8, 2, 0L), await WalletAsync(user));
    Assert.Equal(3L, await OwnedRowCountAsync(user));
  }

  // ------------------------------------------------ D5: duplicate deck slugs

  [Fact]
  public async Task D5_RepeatedDeckSlugInOneRequestIsFoldedNotSentTwice()
  {
    // Two entries for one deck in a single request. The interesting failure is
    // not an incorrect merge, it is Postgres refusing the whole statement with
    // "ON CONFLICT DO UPDATE command cannot affect row a second time", which
    // would fail the entire sync including the collection.
    var user = NewUser("dupslug");

    var data = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(
        null,
        DeckIn(Deck, ["a"], draws: 2, threshold: 10, stamp: Base),
        DeckIn(Deck, ["b", "a"], draws: 5, threshold: 10, stamp: Base)));

    // Folded, so the deck appears once and carries the union of both entries.
    Assert.Equal(1, DeckCount(data, Deck));
    Assert.Equal(new[] { "a", "b" }, OwnedOut(data, Deck));
    Assert.Equal(2L, await OwnedRowCountAsync(user));

    // The request-level fold uses the same operator as the row-level one, so a
    // stamp tie inside one request resolves the same way it would across two.
    Assert.Equal((5, 10, Base), await MetaAsync(user, Deck));

    // Three entries, one of them pity-less, mixed with a genuinely different
    // deck: the dedupe has to survive a slug that is not adjacent to its twin.
    var user2 = NewUser("dupslug-gap");
    var data2 = await LambdaHost.PostDrawStateSyncAsync(
      user2,
      Body(
        null,
        DeckIn(Deck, ["a"], draws: 1, threshold: 10, stamp: Base),
        DeckIn("other-deck", ["z"], draws: 4, threshold: 20, stamp: Base),
        DeckIn(Deck, ["c"]),
        DeckIn(Deck, ["d"], draws: 3, threshold: 10, stamp: Base + 5)));

    Assert.Equal(1, DeckCount(data2, Deck));
    Assert.Equal(new[] { "a", "c", "d" }, OwnedOut(data2, Deck));
    Assert.Equal(new[] { "z" }, OwnedOut(data2, "other-deck"));
    Assert.Equal((3, 10, Base + 5), await MetaAsync(user2, Deck));
    Assert.Equal((4, 20, Base), await MetaAsync(user2, "other-deck"));
  }

  // ------------------------------------------------------ migration 014 shape

  [Fact]
  public async Task Migration014_TablesAreOwnedByTheUserRowAndCascadeOnDelete()
  {
    // The FK to users(user_sub) is the reason DrawStateSync upserts the parent
    // row before anything else, and ON DELETE CASCADE is the account-deletion
    // path. Both are claims about a schema that had never been applied to a
    // real server before this suite.
    var fks = await _db.QueryAsync(
      """
      select c.conrelid::regclass::text as tbl, c.confdeltype as del
      from pg_constraint c
      where c.contype = 'f'
        and c.confrelid = 'users'::regclass
        and c.conrelid::regclass::text in ($1, $2, $3)
      order by tbl
      """,
      "user_draw_owned",
      "user_draw_meta",
      "user_wallet");

    Assert.Equal(3, fks.Count);
    Assert.All(fks, r => Assert.Equal("c", Convert.ToString(r["del"])));

    var user = NewUser("cascade");
    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(1, 1, Base), DeckIn(Deck, ["a"], draws: 1, threshold: 10, stamp: Base)));
    Assert.Equal(1L, await OwnedRowCountAsync(user));

    await using (var conn = await _db.OpenAsync())
    {
      await RecallSmith.Lambda.Db.DbUtil.ExecuteAsync(conn, null, "delete from users where user_sub = $1", [user]);
    }

    Assert.Equal(0L, await OwnedRowCountAsync(user));
    Assert.Empty(await _db.QueryAsync("select 1 from user_draw_meta where user_sub = $1", user));
    Assert.Empty(await _db.QueryAsync("select 1 from user_wallet where user_sub = $1", user));
  }

  // ---------------------------------------------- spec agrees with the SQL

  [Fact]
  public async Task PureMergeSpecPredictsWhatTheDatabaseDid()
  {
    // DrawStateMerge is only worth its exhaustive law tests if it is the same
    // function the database runs. Here both are given the same two snapshots
    // and their answers are compared, which is the one assertion that ties the
    // pure suite to production.
    var user = NewUser("spec");
    var a = new PitySnapshot(Draws: 4, Threshold: 30, UpdatedAtMs: Base);
    var b = new PitySnapshot(Draws: 4, Threshold: 40, UpdatedAtMs: Base);
    var wa = new WalletSnapshot(AvailablePulls: 2, ReservePulls: 9, UpdatedAtMs: Base);
    var wb = new WalletSnapshot(AvailablePulls: 2, ReservePulls: 5, UpdatedAtMs: Base);

    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(wa.AvailablePulls, wa.ReservePulls, wa.UpdatedAtMs), DeckIn(Deck, draws: a.Draws, threshold: a.Threshold, stamp: a.UpdatedAtMs)));
    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(wb.AvailablePulls, wb.ReservePulls, wb.UpdatedAtMs), DeckIn(Deck, draws: b.Draws, threshold: b.Threshold, stamp: b.UpdatedAtMs)));

    var expectedPity = DrawStateMerge.MergePity(a, b);
    var expectedWallet = DrawStateMerge.MergeWallet(wa, wb);

    Assert.Equal((expectedPity.Draws, expectedPity.Threshold, expectedPity.UpdatedAtMs), await MetaAsync(user, Deck));
    Assert.Equal((expectedWallet.AvailablePulls, expectedWallet.ReservePulls, expectedWallet.UpdatedAtMs), await WalletAsync(user));
  }
}
