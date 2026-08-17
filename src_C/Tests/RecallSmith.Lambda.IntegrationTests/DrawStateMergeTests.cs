using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The algebra of the three draw-state operators, checked exhaustively over
/// small hand-picked sets. No database: DrawStateMerge is the pure
/// transcription of the SQL merge, which is the whole reason it exists.
///
/// All three laws hold for all three operators here, which is the interesting
/// contrast with ProgressMergeTests: review_count is an addition and therefore
/// not idempotent, so the review merge can never be replayed safely without the
/// event_id dedupe underneath it. Nothing in the draw state counts events, so
/// this endpoint can be retried blind.
/// </summary>
public class DrawStateMergeTests
{
  private const long T = 1_700_000_000_000;

  private static readonly string[][] OwnedSets =
  [
    [],
    ["a"],
    ["a", "b"],
    ["b", "c"],
    ["c"],
  ];

  // Two snapshots tie on the stamp with different contents on purpose. Ties are
  // not exotic here: a client stamps 0 for any value whose change it never
  // observed, so every device's first sync ties with every other's, and a tie is
  // where an order-dependent merge gives itself away.
  private static readonly PitySnapshot[] Pities =
  [
    new(Draws: 0, Threshold: 10, UpdatedAtMs: 0),
    new(Draws: 3, Threshold: 10, UpdatedAtMs: T),
    new(Draws: 7, Threshold: 10, UpdatedAtMs: T),
    new(Draws: 9, Threshold: 20, UpdatedAtMs: T + 1),
    new(Draws: 0, Threshold: 10, UpdatedAtMs: T + 5_000),
  ];

  private static readonly WalletSnapshot[] Wallets =
  [
    new(AvailablePulls: 0, ReservePulls: 0, UpdatedAtMs: 0),
    new(AvailablePulls: 3, ReservePulls: 0, UpdatedAtMs: T),
    new(AvailablePulls: 1, ReservePulls: 2, UpdatedAtMs: T),
    new(AvailablePulls: 5, ReservePulls: 5, UpdatedAtMs: T + 900),
  ];

  [Fact]
  public void Owned_UnionIsCommutativeAssociativeAndIdempotent()
  {
    foreach (var a in OwnedSets)
    {
      Assert.Equal(DrawStateMerge.MergeOwned(a, a), DrawStateMerge.MergeOwned(a, []));

      foreach (var b in OwnedSets)
      {
        Assert.Equal(DrawStateMerge.MergeOwned(a, b), DrawStateMerge.MergeOwned(b, a));

        foreach (var c in OwnedSets)
        {
          Assert.Equal(
            DrawStateMerge.MergeOwned(DrawStateMerge.MergeOwned(a, b), c),
            DrawStateMerge.MergeOwned(a, DrawStateMerge.MergeOwned(b, c)));
        }
      }
    }
  }

  [Fact]
  public void Owned_UnionNeverShrinks()
  {
    // The property the whole grow-only choice rests on, stated as a test: no
    // pairing of inputs can drop a card that either side had. This is what
    // makes it safe for the client to apply the server's answer over its own
    // collection, and for the server to accept a partial push.
    foreach (var a in OwnedSets)
    {
      foreach (var b in OwnedSets)
      {
        var merged = DrawStateMerge.MergeOwned(a, b);
        foreach (var uid in a) Assert.Contains(uid, merged);
        foreach (var uid in b) Assert.Contains(uid, merged);
      }
    }
  }

  [Fact]
  public void Pity_MergeIsCommutativeAssociativeAndIdempotent()
  {
    foreach (var a in Pities)
    {
      Assert.Equal(a, DrawStateMerge.MergePity(a, a));

      foreach (var b in Pities)
      {
        Assert.Equal(DrawStateMerge.MergePity(a, b), DrawStateMerge.MergePity(b, a));

        foreach (var c in Pities)
        {
          Assert.Equal(
            DrawStateMerge.MergePity(DrawStateMerge.MergePity(a, b), c),
            DrawStateMerge.MergePity(a, DrawStateMerge.MergePity(b, c)));
        }
      }
    }
  }

  [Fact]
  public void Pity_KeepsTheSnapshotWhole()
  {
    // The atomic-group claim, made checkable: whatever comes out is one of the
    // two inputs, never a field taken from each. A merge that picked the higher
    // draws and the other side's threshold would pass a "newest wins" test and
    // still describe a state no device was ever in.
    foreach (var a in Pities)
    {
      foreach (var b in Pities)
      {
        var merged = DrawStateMerge.MergePity(a, b);
        Assert.True(merged == a || merged == b);
      }
    }
  }

  [Fact]
  public void Wallet_MergeIsCommutativeAssociativeAndIdempotent()
  {
    foreach (var a in Wallets)
    {
      Assert.Equal(a, DrawStateMerge.MergeWallet(a, a));

      foreach (var b in Wallets)
      {
        Assert.Equal(DrawStateMerge.MergeWallet(a, b), DrawStateMerge.MergeWallet(b, a));

        foreach (var c in Wallets)
        {
          Assert.Equal(
            DrawStateMerge.MergeWallet(DrawStateMerge.MergeWallet(a, b), c),
            DrawStateMerge.MergeWallet(a, DrawStateMerge.MergeWallet(b, c)));
        }
      }
    }
  }

  [Fact]
  public void Wallet_FreshInstallCannotZeroAnUnstampedBalance()
  {
    // The scenario the tie rule exists for. A device that played offline for
    // months uploads 11 pulls with stamp 0, because it never watched that value
    // change and refuses to claim a time it does not know. A fresh install then
    // syncs with an empty wallet and the same stamp 0. A merge that read only
    // the stamp would call this a tie and hand it to whoever spoke last.
    var longOffline = new WalletSnapshot(AvailablePulls: 11, ReservePulls: 0, UpdatedAtMs: 0);
    var freshInstall = new WalletSnapshot(AvailablePulls: 0, ReservePulls: 0, UpdatedAtMs: 0);

    Assert.Equal(longOffline, DrawStateMerge.MergeWallet(longOffline, freshInstall));
    Assert.Equal(longOffline, DrawStateMerge.MergeWallet(freshInstall, longOffline));
  }

  [Fact]
  public void Wallet_LosesOneOfTwoConcurrentSpends()
  {
    // Not a bug report, a pinned trade-off. Two devices start at 5 available
    // pulls, each spends offline, and the later stamp wins outright: the
    // earlier device's spend is undone rather than added. The day the wallet
    // becomes an event log this test should fail and be rewritten, which is
    // exactly the alarm we want.
    var deviceA = new WalletSnapshot(AvailablePulls: 4, ReservePulls: 0, UpdatedAtMs: T);
    var deviceB = new WalletSnapshot(AvailablePulls: 3, ReservePulls: 0, UpdatedAtMs: T + 1_000);

    var merged = DrawStateMerge.MergeWallet(deviceA, deviceB);

    Assert.Equal(3, merged.AvailablePulls);
    Assert.NotEqual(2, merged.AvailablePulls);
  }
}
