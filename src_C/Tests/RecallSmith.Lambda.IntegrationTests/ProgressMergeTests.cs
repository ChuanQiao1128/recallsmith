using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The three algebraic laws of the progress merge, checked exhaustively over a
/// small hand-picked state set. No database: ProgressMerge is the pure
/// transcription of the merge rules, which is the whole reason it exists.
///
/// Two of the three hold. The third does not, and that is the finding, not a
/// bug: which layer guarantees which property is the thing worth being able to
/// say out loud.
/// </summary>
public class ProgressMergeTests
{
  private const long T = 1_700_000_000_000;

  // Deliberately includes states that tie on last_reviewed_at with different
  // due_at/rating: ties are where an order-dependent merge gives itself away.
  private static readonly ProgressState[] States =
  [
    new(Status: 0, ReviewCount: 0, LastRating: null, LastReviewedAtMs: 0, DueAtMs: 0, LastSeenRevision: 0),
    new(Status: 1, ReviewCount: 1, LastRating: 1, LastReviewedAtMs: T, DueAtMs: T + 600_000, LastSeenRevision: 0),
    new(Status: 1, ReviewCount: 1, LastRating: 4, LastReviewedAtMs: T, DueAtMs: T + 86_400_000, LastSeenRevision: 3),
    new(Status: 1, ReviewCount: 2, LastRating: 3, LastReviewedAtMs: T, DueAtMs: T + 86_400_000, LastSeenRevision: 1),
    new(Status: 1, ReviewCount: 5, LastRating: 2, LastReviewedAtMs: T + 5_000, DueAtMs: T + 5_000, LastSeenRevision: 2),
    new(Status: 2, ReviewCount: 3, LastRating: 3, LastReviewedAtMs: T + 90_000, DueAtMs: T + 172_800_000, LastSeenRevision: 7),
  ];

  [Fact]
  public void Merge_IsCommutative()
  {
    foreach (var a in States)
    {
      foreach (var b in States)
      {
        Assert.Equal(ProgressMerge.Merge(a, b), ProgressMerge.Merge(b, a));
      }
    }
  }

  [Fact]
  public void Merge_IsAssociative()
  {
    foreach (var a in States)
    {
      foreach (var b in States)
      {
        foreach (var c in States)
        {
          Assert.Equal(
            ProgressMerge.Merge(ProgressMerge.Merge(a, b), c),
            ProgressMerge.Merge(a, ProgressMerge.Merge(b, c)));
        }
      }
    }
  }

  /// <summary>
  /// The law that does NOT hold, pinned as a contract.
  ///
  /// review_count is additive, and addition is not idempotent: merging a state
  /// with itself doubles the counter. Production is idempotent anyway because
  /// duplicates never reach this function -- the event_id primary key drops
  /// them one CTE earlier, so a replayed push contributes inc = 0.
  ///
  /// In other words: idempotence is supplied by the DEDUPE layer, not by the
  /// merge function. Anyone who later writes to user_progress while bypassing
  /// user_progress_events (a backfill script, an admin fixup, a "quick" direct
  /// upsert) loses it silently, and every affected user's review_count inflates
  /// with no undo path. This test is the tripwire for that change.
  /// </summary>
  [Fact]
  public void Merge_IsNotIdempotent_BecauseCountersAdd_IdempotenceComesFromEventIdDedupe()
  {
    foreach (var a in States)
    {
      var doubled = ProgressMerge.Merge(a, a);

      Assert.Equal(a.ReviewCount * 2, doubled.ReviewCount);

      if (a.ReviewCount == 0)
      {
        // The only fixed point is the zero of the additive column: every other
        // column really is idempotent on its own.
        Assert.Equal(a, doubled);
      }
      else
      {
        Assert.NotEqual(a, doubled);
      }

      // Everything except the counter survives self-merge unchanged, which is
      // what "the counter is the only non-lattice column" means concretely.
      Assert.Equal(a with { ReviewCount = doubled.ReviewCount }, doubled);
    }
  }

  /// <summary>
  /// The property the counter actually has instead of idempotence: a duplicate
  /// that has been through event_id dedupe carries inc = 0, and merging a
  /// zero-count delta changes nothing.
  /// </summary>
  [Fact]
  public void Merge_WithDedupedDuplicate_IsIdentity()
  {
    foreach (var a in States)
    {
      var deduped = a with { ReviewCount = 0 };
      Assert.Equal(a, ProgressMerge.Merge(a, deduped));
      Assert.Equal(a, ProgressMerge.Merge(deduped, a));
    }
  }
}
