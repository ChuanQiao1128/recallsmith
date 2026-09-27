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
