namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// The per-column merge of user_progress, written as a pure function.
///
/// This is a SPEC, not a code path: the production merge is the
/// `on conflict ... do update` block of the ingest SQL in ProgressEvents.cs
/// (not one line of which changes for this file), and it stays there because
/// running it in the database is what makes it atomic with the event insert.
/// What the SQL cannot do is be handed to a test that asks "is this thing
/// associative?". So the rules are transcribed once, in a language where the
/// algebra can be executed.
///
/// One operator per column, chosen by what the column MEANS:
///   status, last_reviewed_at, last_seen_revision -> greatest(): facts that can
///     only ever move one way.
///   review_count -> addition: a count of events, not a state.
///   last_rating, due_at -> last-writer-wins keyed on event time: "the state as
///     of the most recent review", which is meaningless without an order.
///
/// Together those give a join semilattice on everything except review_count,
/// which is where the interesting result lives (see ProgressMergeTests).
///
/// Known gap against the SQL, deliberately left in: the SQL breaks an exact
/// last_reviewed_at tie by arrival (`excluded &gt;= current`), so two devices
/// reviewing one card in the same millisecond get an order-dependent answer.
/// This spec adds a content tiebreak (due_at, then rating) so the algebra
/// closes. Any input where the two disagree is exactly that tie, and nothing
/// upstream prevents it -- event_id dedupe removes identical events, not
/// simultaneous ones. Measured: dropping the content tiebreak here and keeping
/// only the timestamp comparison makes Merge_IsCommutative fail while
/// Merge_IsAssociative still passes, so the tie is the entire gap.
/// </summary>
public readonly record struct ProgressState(
  int Status,
  int ReviewCount,
  int? LastRating,
  long LastReviewedAtMs,
  long DueAtMs,
  int LastSeenRevision);

public static class ProgressMerge
{
  public static ProgressState Merge(ProgressState current, ProgressState incoming)
  {
    // Not "incoming is newer" but "incoming is the max under a total order":
    // that is what makes the choice independent of which argument it arrived as.
    var incomingWins = CompareRecency(incoming, current) >= 0;

    return new ProgressState(
      Status: Math.Max(current.Status, incoming.Status),
      ReviewCount: current.ReviewCount + incoming.ReviewCount,
      LastRating: incomingWins ? incoming.LastRating : current.LastRating,
      LastReviewedAtMs: Math.Max(current.LastReviewedAtMs, incoming.LastReviewedAtMs),
      DueAtMs: incomingWins ? incoming.DueAtMs : current.DueAtMs,
      LastSeenRevision: Math.Max(current.LastSeenRevision, incoming.LastSeenRevision));
  }

  private static int CompareRecency(ProgressState a, ProgressState b)
  {
    if (a.LastReviewedAtMs != b.LastReviewedAtMs) return a.LastReviewedAtMs.CompareTo(b.LastReviewedAtMs);
    if (a.DueAtMs != b.DueAtMs) return a.DueAtMs.CompareTo(b.DueAtMs);
    return (a.LastRating ?? 0).CompareTo(b.LastRating ?? 0);
  }
}
