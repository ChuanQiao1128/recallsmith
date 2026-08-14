namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// The pity counter of one (user, deck) as of one client stamp. Draws and
/// Threshold travel together: a count without the threshold it counts toward is
/// not a state anyone can act on.
/// </summary>
public readonly record struct PitySnapshot(int Draws, int Threshold, long UpdatedAtMs);

public readonly record struct WalletSnapshot(int AvailablePulls, int ReservePulls, long UpdatedAtMs);

/// <summary>
/// The merge rules of the draw-state sync, written as pure functions.
///
/// Like ProgressMerge, this is a SPEC and not a code path: production merges in
/// SQL (DrawStateSync.cs), because doing it in the database is what makes it
/// atomic and concurrent-safe. What SQL cannot do is answer "is this
/// commutative?", so the rules are transcribed once into a language where the
/// algebra can be executed.
///
/// Three tables, three operators, chosen by what each piece of data means:
///   owned  -> set union. A revealed card is revealed forever, there is no
///             unown operation, so union is idempotent and order independent.
///             This is the only one of the three that loses nothing, which is
///             why the collection (the state users care most about) got the
///             operator that cannot go wrong.
///   pity   -> last-writer-wins on updated_at_ms. A counter toward a promise,
///             not an accumulating fact: adding two devices' counters would
///             invent draws nobody made.
///   wallet -> last-writer-wins on updated_at_ms. Same shape, same accepted
///             loss (see the migration comment in 014_draw_state_sync.sql).
///
/// Unlike ProgressMerge, this spec has NO known gap against its SQL. The tie
/// rule below (order by the whole snapshot, stamp first, contents after) is
/// written into the ON CONFLICT predicates in DrawStateSync.cs as a lexicographic
/// row comparison, so the laws checked here are laws of the production merge and
/// not of a lookalike. It had to be: clients send stamp 0 for any value whose
/// change they never observed, so ties are not a rare collision here, they are
/// the normal first-sync case, and "whoever arrives last wins" would let a fresh
/// install zero out a device that had played for months offline.
/// </summary>
public static class DrawStateMerge
{
  /// <summary>
  /// Set union, returned sorted so the result is a value and not a traversal
  /// order. Sorting is what lets the law tests compare results directly.
  /// </summary>
  public static IReadOnlyList<string> MergeOwned(IEnumerable<string> current, IEnumerable<string> incoming)
  {
    var set = new SortedSet<string>(StringComparer.Ordinal);
    foreach (var uid in current) if (!string.IsNullOrWhiteSpace(uid)) set.Add(uid.Trim());
    foreach (var uid in incoming) if (!string.IsNullOrWhiteSpace(uid)) set.Add(uid.Trim());
    return set.ToList();
  }

  public static PitySnapshot MergePity(PitySnapshot current, PitySnapshot incoming)
  {
    // "incoming is the max under a total order", not "incoming is newer": that
    // is what makes the answer independent of which side it arrived as.
    return ComparePity(incoming, current) >= 0 ? incoming : current;
  }

  public static WalletSnapshot MergeWallet(WalletSnapshot current, WalletSnapshot incoming)
  {
    return CompareWallet(incoming, current) >= 0 ? incoming : current;
  }

  private static int ComparePity(PitySnapshot a, PitySnapshot b)
  {
    if (a.UpdatedAtMs != b.UpdatedAtMs) return a.UpdatedAtMs.CompareTo(b.UpdatedAtMs);
    // The snapshot is an atomic pair: draws without its threshold describes no
    // reachable state, so the tiebreak orders the pair rather than picking a
    // field from each side.
    if (a.Draws != b.Draws) return a.Draws.CompareTo(b.Draws);
    return a.Threshold.CompareTo(b.Threshold);
  }

  private static int CompareWallet(WalletSnapshot a, WalletSnapshot b)
  {
    if (a.UpdatedAtMs != b.UpdatedAtMs) return a.UpdatedAtMs.CompareTo(b.UpdatedAtMs);
    if (a.AvailablePulls != b.AvailablePulls) return a.AvailablePulls.CompareTo(b.AvailablePulls);
    return a.ReservePulls.CompareTo(b.ReservePulls);
  }
}
