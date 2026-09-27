// src/lib/qaGate.ts
//
// The deck list's view of the pre-publish AI QA gate: which publish refusals
// come from the gate, and where the page that resolves them lives.
//
// NO IMPORTS. DeckListPage imports this and sits in the eager bundle that
// tests/bundleFirstLoad.test.ts budgets, so it must stay plain constants.

export const QA_PUBLISH_GATE_CODES = ['AI_QA_REQUIRED', 'AI_QA_BLOCKED'] as const;

export function isQaPublishGateCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && (QA_PUBLISH_GATE_CODES as readonly string[]).includes(code);
}

export function qaPageHref(deckId: number, runId?: string | null): string {
  const base = `/decks/qa?deckId=${deckId}`;
  return runId ? `${base}&runId=${encodeURIComponent(runId)}` : base;
}

/**
 * The line the publish confirm dialog adds from GET …/qa/status (contract
 * §7.10), or null when there is nothing to warn about. `openBlockers` is the
 * list the server returns (capped server-side); the unreviewed count comes from
 * the counters, which are not capped.
 *
 * With AI QA switched off on the server (AI_QA_ENABLED=0, the launch default)
 * there is nothing to warn about: the server still counts unreviewed cards,
 * but no run can start, so a warning and an "Open AI QA" link would be a dead
 * end that teaches authors to ignore the QA line.
 */
export function qaPublishPreviewLine(status: {
  enabled: boolean;
  changedCards: number;
  reviewedCurrent: number;
  openBlockers: readonly unknown[];
  wouldBlock: boolean;
}): string | null {
  if (!status.enabled) return null;
  const blockers = status.openBlockers.length;
  const notReviewed = Math.max(0, status.changedCards - status.reviewedCurrent);
  if (blockers === 0 && notReviewed === 0) return null;
  const counts = `AI QA: ${blockers} open blocker(s), ${notReviewed} card(s) not reviewed.`;
  return status.wouldBlock
    ? `${counts} The server will refuse this publish until they are resolved.`
    : `${counts} AI QA is advisory, so publishing is not blocked.`;
}
