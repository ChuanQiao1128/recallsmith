using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The per-deck pull pools of the draw-state sync (release 1.7, economy option
/// A), end to end against a real Postgres. Sibling of
/// DrawStateSyncIntegrationTests: the interesting behaviour is SQL that no pure
/// function reaches -- the lexicographic ROW comparison that decides each pool's
/// last-writer-wins tie per (user, deck), the request-level slug fold, the
/// to_regclass probe that keeps a pre-migration deploy answering, and the
/// legacy user_wallet staying byte-for-byte independent of the new table.
///
/// Isolation is by user_sub, so the suite is rerunnable against a dirty
/// container.
/// </summary>
[Collection(PostgresCollection.Name)]
public class DeckWalletSyncIntegrationTests
{
  private readonly PostgresFixture _db;

  // Well in the past, so no fixture stamp accidentally trips the future-clock
  // clamp and hides the behaviour actually under test.
  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds();

  private const long ClientClockSlackMs = 5 * 60 * 1000;

  public DeckWalletSyncIntegrationTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewUser(string tag) => $"it-i02-{tag}-{Guid.NewGuid():N}";

  // A deck that carries a pull pool. owned is always present (possibly empty),
  // pity is never sent.
  private static object PoolDeck(string slug, int available, int reserve, long stamp, IEnumerable<string>? owned = null) => new
  {
    deckSlug = slug,
    owned = (owned ?? Array.Empty<string>()).ToArray(),
    pulls = new { availablePulls = available, reservePulls = reserve, updatedAtMs = stamp },
  };

  // Exactly the old DeckIn shape, with NO pulls property at all: what a 1.6.1
  // client sends.
  private static object LegacyDeck(
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

  private static JsonElement PullsOut(JsonElement data, string slug) =>
    DeckOut(data, slug).GetProperty("pulls");

  private static string[] OwnedOut(JsonElement data, string slug) =>
    DeckOut(data, slug).GetProperty("owned").EnumerateArray().Select(e => e.GetString()!).ToArray();

  private static int DeckCount(JsonElement data, string slug) =>
    data.GetProperty("decks").EnumerateArray().Count(d => d.GetProperty("deckSlug").GetString() == slug);

  private async Task<(int Available, int Reserve, long Stamp)> PoolAsync(string userSub, string slug)
  {
    var rows = await _db.QueryAsync(
      "select available_pulls, reserve_pulls, updated_at_ms from user_deck_wallet where user_sub = $1 and deck_slug = $2",
      userSub,
      slug);
    Assert.Single(rows);
    return (
      Convert.ToInt32(rows[0]["available_pulls"]),
      Convert.ToInt32(rows[0]["reserve_pulls"]),
      Convert.ToInt64(rows[0]["updated_at_ms"]));
  }

  private async Task<long> PoolRowCountAsync(string userSub) =>
    Convert.ToInt64(await _db.ScalarAsync(
      "select count(*) from user_deck_wallet where user_sub = $1", userSub));

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

  // ------------------------------------------------------ round trip

  [Fact]
  public async Task DeckPulls_RoundTrip_EachDeckGetsItsOwnRow()
  {
    var user = NewUser("roundtrip");

    var data = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(null, PoolDeck("deck-a", 5, 1, Base), PoolDeck("deck-b", 2, 0, Base)));

    var a = PullsOut(data, "deck-a");
    Assert.Equal(5, a.GetProperty("availablePulls").GetInt32());
    Assert.Equal(1, a.GetProperty("reservePulls").GetInt32());
    Assert.Equal(Base, a.GetProperty("updatedAtMs").GetInt64());

    var b = PullsOut(data, "deck-b");
    Assert.Equal(2, b.GetProperty("availablePulls").GetInt32());
    Assert.Equal(0, b.GetProperty("reservePulls").GetInt32());
    Assert.Equal(Base, b.GetProperty("updatedAtMs").GetInt64());

    Assert.Equal((5, 1, Base), await PoolAsync(user, "deck-a"));
    Assert.Equal((2, 0, Base), await PoolAsync(user, "deck-b"));

    // A pulls-only push never creates a legacy wallet row.
    Assert.Empty(await _db.QueryAsync("select 1 from user_wallet where user_sub = $1", user));
  }

  [Fact]
  public async Task DeckPulls_DeckWithOnlyPulls_IsStoredAndReturned()
  {
    var user = NewUser("pulls-only");

    var data = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(null, new { deckSlug = "pulls-only", pulls = new { availablePulls = 3, reservePulls = 0, updatedAtMs = Base } }));

    var deck = DeckOut(data, "pulls-only");
    Assert.Empty(deck.GetProperty("owned").EnumerateArray());
    Assert.Equal(JsonValueKind.Null, deck.GetProperty("pity").ValueKind);

    var pulls = deck.GetProperty("pulls");
    Assert.Equal(3, pulls.GetProperty("availablePulls").GetInt32());
    Assert.Equal(0, pulls.GetProperty("reservePulls").GetInt32());
    Assert.Equal(Base, pulls.GetProperty("updatedAtMs").GetInt64());

    Assert.Equal((3, 0, Base), await PoolAsync(user, "pulls-only"));

    Assert.Empty(await _db.QueryAsync("select 1 from user_draw_owned where user_sub = $1", user));
    Assert.Empty(await _db.QueryAsync("select 1 from user_draw_meta where user_sub = $1", user));
  }

  [Fact]
  public async Task DeckPulls_ResponseCarriesNullPullsForADeckWithoutARow()
  {
    var user = NewUser("nullpulls");

    var data = await LambdaHost.PostDrawStateSyncAsync(user, Body(null, LegacyDeck("deck-a", ["a"])));

    Assert.Equal(JsonValueKind.Null, PullsOut(data, "deck-a").ValueKind);
  }

  [Fact]
  public async Task DeckPulls_LaterStampWins_AndOtherDecksAreUntouched()
  {
    var user = NewUser("laterstamp");

    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(null, PoolDeck("deck-a", 9, 0, Base), PoolDeck("deck-b", 4, 0, Base)));

    await LambdaHost.PostDrawStateSyncAsync(user, Body(null, PoolDeck("deck-a", 1, 0, Base + 1000)));

    Assert.Equal((1, 0, Base + 1000), await PoolAsync(user, "deck-a"));
    Assert.Equal((4, 0, Base), await PoolAsync(user, "deck-b"));
  }

  [Fact]
  public async Task DeckPulls_TieResolvesTowardTheRicherBalance_InEitherOrder()
  {
    var poor = PoolDeck("deck-a", 3, 0, Base);
    var rich = PoolDeck("deck-a", 7, 1, Base);

    var forward = NewUser("tie-fwd");
    await LambdaHost.PostDrawStateSyncAsync(forward, Body(null, poor));
    await LambdaHost.PostDrawStateSyncAsync(forward, Body(null, rich));

    var reverse = NewUser("tie-rev");
    await LambdaHost.PostDrawStateSyncAsync(reverse, Body(null, rich));
    await LambdaHost.PostDrawStateSyncAsync(reverse, Body(null, poor));

    Assert.Equal((7, 1, Base), await PoolAsync(forward, "deck-a"));
    Assert.Equal((7, 1, Base), await PoolAsync(reverse, "deck-a"));
  }

  [Fact]
  public async Task DeckPulls_UnknownStampNeverWipesARealBalance()
  {
    var user = NewUser("unknownstamp");

    await LambdaHost.PostDrawStateSyncAsync(user, Body(null, PoolDeck("deck-a", 12, 3, Base)));
    var data = await LambdaHost.PostDrawStateSyncAsync(user, Body(null, PoolDeck("deck-a", 0, 0, 0)));

    var pulls = PullsOut(data, "deck-a");
    Assert.Equal(12, pulls.GetProperty("availablePulls").GetInt32());
    Assert.Equal(3, pulls.GetProperty("reservePulls").GetInt32());
    Assert.Equal(Base, pulls.GetProperty("updatedAtMs").GetInt64());

    Assert.Equal((12, 3, Base), await PoolAsync(user, "deck-a"));
  }

  [Fact]
  public async Task DeckPulls_FutureStampIsClampedToServerNowPlusFiveMinutes()
  {
    var user = NewUser("clamp");
    var farFuture = DateTimeOffset.UtcNow.AddYears(5).ToUnixTimeMilliseconds();

    var data = await LambdaHost.PostDrawStateSyncAsync(user, Body(null, PoolDeck("deck-a", 4, 1, farFuture)));

    var serverTimeMs = data.GetProperty("serverTimeMs").GetInt64();
    var ceiling = serverTimeMs + ClientClockSlackMs;

    var pool = await PoolAsync(user, "deck-a");
    Assert.InRange(pool.Stamp, ceiling - 10_000, ceiling);

    // Clamped, not discarded: a later honest push under a real (older) stamp
    // cannot win against the clamped future stamp.
    await LambdaHost.PostDrawStateSyncAsync(user, Body(null, PoolDeck("deck-a", 9, 0, Base)));
    var after = await PoolAsync(user, "deck-a");
    Assert.Equal(4, after.Available);
  }

  [Fact]
  public async Task DeckPulls_RepeatedDeckSlugInOneRequestIsFolded()
  {
    var user = NewUser("dupslug");
    const string D = "deck-a";

    var data = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(
        null,
        PoolDeck(D, 2, 0, Base, ["a"]),
        LegacyDeck(D, ["b"]),
        PoolDeck(D, 5, 0, Base, ["a"])));

    Assert.Equal(1, DeckCount(data, D));
    Assert.Equal(new[] { "a", "b" }, OwnedOut(data, D));

    var pulls = PullsOut(data, D);
    Assert.Equal(5, pulls.GetProperty("availablePulls").GetInt32());
    Assert.Equal(0, pulls.GetProperty("reservePulls").GetInt32());
    Assert.Equal(Base, pulls.GetProperty("updatedAtMs").GetInt64());

    Assert.Equal((5, 0, Base), await PoolAsync(user, D));
  }

  [Fact]
  public async Task DeckPulls_NegativeCountsClampToZero_AndNonObjectPullsIsIgnored()
  {
    var user = NewUser("negclamp");

    var data = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(null, new { deckSlug = "deck-a", owned = Array.Empty<string>(), pulls = new { availablePulls = -3, reservePulls = -1, updatedAtMs = Base } }));

    var pulls = PullsOut(data, "deck-a");
    Assert.Equal(0, pulls.GetProperty("availablePulls").GetInt32());
    Assert.Equal(0, pulls.GetProperty("reservePulls").GetInt32());
    Assert.Equal(Base, pulls.GetProperty("updatedAtMs").GetInt64());

    Assert.Equal((0, 0, Base), await PoolAsync(user, "deck-a"));

    // A non-object pulls is not a pool: neither a number nor null writes a row.
    var user2 = NewUser("nonobject");
    var data2 = await LambdaHost.PostDrawStateSyncAsync(
      user2,
      Body(
        null,
        new { deckSlug = "deck-num", owned = Array.Empty<string>(), pulls = 5 },
        new { deckSlug = "deck-null", owned = Array.Empty<string>(), pulls = (object?)null }));

    Assert.Equal(JsonValueKind.Null, PullsOut(data2, "deck-num").ValueKind);
    Assert.Equal(JsonValueKind.Null, PullsOut(data2, "deck-null").ValueKind);
    Assert.Equal(0L, await PoolRowCountAsync(user2));
  }

  [Fact]
  public async Task DeckPulls_LegacyShapedRequest_LeavesDeckRowsUntouched()
  {
    var user = NewUser("legacyshape");

    // Seed a real pool.
    await LambdaHost.PostDrawStateSyncAsync(user, Body(null, PoolDeck("deck-a", 6, 1, Base + 500)));

    // A 1.6.1-shaped body: a top-level wallet and a legacy deck with no pulls.
    var data = await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(Wallet(3, 0, Base + 9000), LegacyDeck("deck-a", ["x"], draws: 2, threshold: 10, stamp: Base + 9000)));

    Assert.Equal((6, 1, Base + 500), await PoolAsync(user, "deck-a"));
    Assert.Equal((3, 0, Base + 9000), await WalletAsync(user));

    var wallet = data.GetProperty("wallet");
    var walletProps = wallet.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray();
    Assert.Equal(new[] { "availablePulls", "reservePulls", "updatedAtMs" }, walletProps);

    Assert.Equal(new[] { "x" }, OwnedOut(data, "deck-a"));
    Assert.Equal(2, DeckOut(data, "deck-a").GetProperty("pity").GetProperty("draws").GetInt32());

    var pulls = PullsOut(data, "deck-a");
    Assert.Equal(6, pulls.GetProperty("availablePulls").GetInt32());
    Assert.Equal(1, pulls.GetProperty("reservePulls").GetInt32());
    Assert.Equal(Base + 500, pulls.GetProperty("updatedAtMs").GetInt64());
  }

  [Fact]
  public async Task DeckPulls_LegacyWalletIsIndependentOfDeckRows()
  {
    var user = NewUser("independent");

    await LambdaHost.PostDrawStateSyncAsync(user, Body(Wallet(4, 1, Base), PoolDeck("deck-a", 6, 0, Base)));
    Assert.Equal((4, 1, Base), await WalletAsync(user));
    Assert.Equal((6, 0, Base), await PoolAsync(user, "deck-a"));

    // The 1.7 client zeroing the legacy pool after its split: no decks at all.
    await LambdaHost.PostDrawStateSyncAsync(user, Body(Wallet(0, 0, Base + 1)));

    Assert.Equal((0, 0, Base + 1), await WalletAsync(user));
    Assert.Equal((6, 0, Base), await PoolAsync(user, "deck-a"));
  }

  [Fact]
  public async Task DeckPulls_PureMergeSpecPredictsWhatTheDatabaseDid()
  {
    var user = NewUser("spec");
    var wa = new WalletSnapshot(2, 9, Base);
    var wb = new WalletSnapshot(2, 5, Base);

    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(null, PoolDeck("deck-a", wa.AvailablePulls, wa.ReservePulls, wa.UpdatedAtMs)));
    await LambdaHost.PostDrawStateSyncAsync(
      user,
      Body(null, PoolDeck("deck-a", wb.AvailablePulls, wb.ReservePulls, wb.UpdatedAtMs)));

    var expected = DrawStateMerge.MergeWallet(wa, wb);
    Assert.Equal((expected.AvailablePulls, expected.ReservePulls, expected.UpdatedAtMs), await PoolAsync(user, "deck-a"));
  }

  [Fact]
  public async Task DeckPulls_Pre025Schema_SyncStillAnswersWithoutPulls()
  {
    var scratchCs = await _db.CreateScratchDatabaseAsync("i02_pre025");
    await using (var conn = new NpgsqlConnection(scratchCs))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 24);
    }

    var user = NewUser("pre025");
    var prevDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", "i02_pre025");
    DrawStateSync.ResetDeckWalletProbe();
    Pg.Reset();
    try
    {
      var data = await LambdaHost.PostDrawStateSyncAsync(
        user,
        Body(Wallet(2, 0, Base), PoolDeck("deck-a", 5, 0, Base, ["a"])));

      Assert.Equal(new[] { "a" }, OwnedOut(data, "deck-a"));
      Assert.Equal(2, data.GetProperty("wallet").GetProperty("availablePulls").GetInt32());
      Assert.Equal(JsonValueKind.Null, PullsOut(data, "deck-a").ValueKind);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", prevDb);
      Pg.Reset();
      DrawStateSync.ResetDeckWalletProbe();
    }
  }

  [Fact]
  public async Task Migration025_TableIsOwnedByTheUserRowAndCascadesOnDelete()
  {
    var fk = await _db.QueryAsync(
      """
      select c.confdeltype as del
      from pg_constraint c
      where c.contype = 'f'
        and c.confrelid = 'users'::regclass
        and c.conrelid = 'user_deck_wallet'::regclass
      """);
    Assert.Single(fk);
    Assert.Equal("c", Convert.ToString(fk[0]["del"]));

    var pkCols = await _db.QueryAsync(
      """
      select a.attname as col
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'user_deck_wallet'::regclass and i.indisprimary
      """);
    var cols = pkCols.Select(r => (string)r["col"]!).ToHashSet(StringComparer.Ordinal);
    Assert.True(cols.SetEquals(new[] { "user_sub", "deck_slug" }), $"pk columns were {string.Join(", ", cols)}");

    var user = NewUser("cascade");
    await LambdaHost.PostDrawStateSyncAsync(user, Body(null, PoolDeck("deck-a", 1, 0, Base)));
    Assert.Equal(1L, await PoolRowCountAsync(user));

    await using (var conn = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(conn, null, "delete from users where user_sub = $1", [user]);
    }

    Assert.Equal(0L, await PoolRowCountAsync(user));
  }

  [Fact]
  public async Task Migration025_IsIdempotent()
  {
    var scratchCs = await _db.CreateScratchDatabaseAsync("i02_twice");
    await using var conn = new NpgsqlConnection(scratchCs);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 25);

    var path = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "025_user_deck_wallet.sql");
    var sql = await File.ReadAllTextAsync(path);
    await DbUtil.ExecuteAsync(conn, null, sql, []);

    var pkCount = await DbUtil.ExecuteScalarAsync(
      conn, null,
      "select count(*) from pg_constraint where conrelid = 'user_deck_wallet'::regclass and contype = 'p'",
      []);
    Assert.Equal(1L, Convert.ToInt64(pkCount, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Migration025_LeavesUserWalletShapeUnchanged()
  {
    var rows = await _db.QueryAsync(
      """
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'user_wallet'
      order by ordinal_position
      """);

    var cols = rows.Select(r => (string)r["column_name"]!).ToArray();
    Assert.Equal(new[] { "user_sub", "available_pulls", "reserve_pulls", "updated_at_ms" }, cols);
  }
}
