namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The automation's reason codes (R18A A03, contract A00 §5.9 and §6.6). <see cref="DecisionReasons"/> equals the
/// <c>ck_automation_decisions_reason</c> list of migration 036 (034's list plus <c>AUTHOR_NOT_GATED</c>, R18D M1) and <see cref="PublishReasons"/> the
/// <c>ck_automation_publishes_reason</c> list (a test compares them with the constraint text).
/// </summary>
public static class AutomationReasons
{
  public static readonly IReadOnlyList<string> DecisionReasons = ["RUN_NOT_RUNNING", "DECK_MISMATCH", "DECK_NOT_ALLOWED", "EXISTING_CARD",
    "LIKELY_DUPLICATE", "UNGROUNDED", "SOURCE_HOST_NOT_ALLOWED", "QA_UNAVAILABLE", "AI_QA_DAILY_CAP", "ENQUEUE_RETRY", "ENQUEUE_FAILED",
    "QA_TIMEOUT", "QA_ERROR", "QA_HASH_MISMATCH", "QA_FLAGGED", "REVIEWER_NOT_GATED", "MODE_OFF", "DECK_DELETED", "DECIDED_BY_HUMAN",
    "AUTHOR_NOT_GATED"];

  /// <summary>Event-only reason: a human acted on a decision automation had already finished (A00 §5.7).</summary>
  public const string HumanAction = "HUMAN_ACTION";

  /// <summary>A00 §6.6, used by A04.</summary>
  public static readonly IReadOnlyList<string> PublishReasons = ["DECK_DELETED", "AUTO_PUBLISH_DISABLED", "DECK_NEVER_PUBLISHED",
    "PUBLISH_IN_PROGRESS", "PUBLISH_WAIT_TIMEOUT", "DECK_HAS_HUMAN_CHANGES", "MCQ_PUBLISH_GATE", "AI_QA_REQUIRED", "AI_QA_BLOCKED",
    "AI_QA_STALE", "CONFIG_ERROR", "SERVER_NOT_READY_AI_QA", "PUBLISH_FAILED"];

  /// <summary>Reasons whose <c>auto-route</c> ledger row is a failure: QA or enqueue broke, rather than routing as designed.</summary>
  public static readonly IReadOnlyList<string> LedgerFailureReasons = ["QA_ERROR", "QA_TIMEOUT", "QA_HASH_MISMATCH", "QA_UNAVAILABLE", "ENQUEUE_FAILED"];

  /// <summary>
  /// The ledger outcome of a live decision routed to a human with <paramref name="reason"/> (A00 §5.9):
  /// <c>failure</c> for <see cref="LedgerFailureReasons"/>, <c>success</c> for every other decision reason.
  /// Throws <see cref="ArgumentException"/> for anything that is not a decision reason.
  /// </summary>
  public static string LedgerOutcome(string reason)
  {
    if (!DecisionReasons.Contains(reason, StringComparer.Ordinal))
    {
      throw new ArgumentException($"{reason} is not an automation decision reason", nameof(reason));
    }
    return LedgerFailureReasons.Contains(reason, StringComparer.Ordinal) ? "failure" : "success";
  }
}
