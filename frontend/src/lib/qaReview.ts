// src/lib/qaReview.ts
//
// The AI QA page's decisions as pure data: scopes, severities and categories
// (contract §7.6), the pre-run cost estimate, the polling limits, and how
// findings group into cards. DeckQaPage wires these to state and to the DOM.

import type { QaFinding, QaItem } from '../api/qa';

export const QA_SCOPES = ['changed', 'all', 'cards'] as const;
export const QA_SEVERITIES = ['blocker', 'major', 'minor'] as const;

export const QA_CATEGORIES = [
  'incorrect_answer',
  'multiple_correct',
  'answer_leak',
  'ambiguous_stem',
  'outdated_fact',
  'qualifier_mismatch',
  'source_unsupported',
  'weak_distractor',
  'other',
] as const;

export const QA_CATEGORY_LABELS: Record<string, string> = {
  incorrect_answer: 'Incorrect answer',
  multiple_correct: 'More than one correct answer',
  answer_leak: 'Answer leaked in the question',
  ambiguous_stem: 'Ambiguous question',
  outdated_fact: 'Possibly outdated fact',
  qualifier_mismatch: 'Qualifier does not match the answers',
  source_unsupported: 'Not supported by the cited source',
  weak_distractor: 'Weak distractor',
  other: 'Other',
};

// Fallbacks only. The server reads the real limits from AI_QA_MAX_CARDS and
// AI_QA_DAILY_USD_CAP (contract §7.2, defaults 200 and 10); the page uses the
// values GET …/qa/status returns and falls back to these defaults when the
// response does not carry them.
export const QA_MAX_CARDS = 200;
export const QA_DAILY_USD_CAP = 10;

export interface QaLimits {
  maxCards: number;
  dailyUsdCap: number;
  /** Today's spend, when the server reports it. */
  spentTodayUsd: number | null;
  /** True when both limits came from the server rather than the defaults. */
  fromServer: boolean;
}

export function qaLimits(
  status: { maxCards: number | null; dailyUsdCap: number | null; spentTodayUsd: number | null } | null,
): QaLimits {
  return {
    maxCards: status?.maxCards ?? QA_MAX_CARDS,
    dailyUsdCap: status?.dailyUsdCap ?? QA_DAILY_USD_CAP,
    spentTodayUsd: status?.spentTodayUsd ?? null,
    fromServer: status?.maxCards != null && status?.dailyUsdCap != null,
  };
}

/** What is left of today's cap; the whole cap when today's spend is unknown. */
export function qaCapRemainingUsd(limits: QaLimits): number {
  return Math.max(0, limits.dailyUsdCap - (limits.spentTodayUsd ?? 0));
}

// The plan's per-card budget priced at the §7.5 default list prices. An
// estimate only: the provider bills separately.
export const QA_EST_INPUT_TOKENS_PER_CARD = 3000;
export const QA_EST_OUTPUT_TOKENS_PER_CARD = 1200;
export const QA_PRICE_INPUT_PER_MTOK = 5;
export const QA_PRICE_OUTPUT_PER_MTOK = 25;

export function estimateQaCostUsd(cardCount: number): number {
  const perCard =
    (QA_EST_INPUT_TOKENS_PER_CARD * QA_PRICE_INPUT_PER_MTOK +
      QA_EST_OUTPUT_TOKENS_PER_CARD * QA_PRICE_OUTPUT_PER_MTOK) /
    1_000_000;
  return cardCount * perCard;
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount > 0 && amount < 0.01) return '<$0.01';
  return `$${amount.toFixed(2)}`;
}

export const QA_POLL_INTERVAL_MS = 3000;
export const QA_POLL_MAX_FAILURES = 5;

export function isQaRunActive(run: { effectiveStatus: string }): boolean {
  return run.effectiveStatus === 'queued' || run.effectiveStatus === 'running';
}

export function qaCardsToReview(status: { changedCards: number; reviewedCurrent: number }): number {
  return Math.max(0, status.changedCards - status.reviewedCurrent);
}

/** A card passes when it has no blocker and no major finding (§7.6). */
export function cardPasses(findings: ReadonlyArray<{ severity: string }>): boolean {
  return !findings.some(f => f.severity === 'blocker' || f.severity === 'major');
}

function severityRank(severity: string): number {
  const i = (QA_SEVERITIES as readonly string[]).indexOf(severity);
  return i === -1 ? QA_SEVERITIES.length : i;
}

/**
 * What the page can honestly say about one card of a run:
 * - flagged: a blocker or major finding, whatever the item status;
 * - passed: the card was reviewed (item done, or findings exist without an
 *   item row) and nothing above minor came back;
 * - pending: the item is still queued, so it has not been reviewed yet;
 * - not_reviewed: the item ended error, refused or skipped.
 */
export type QaCardVerdict = 'passed' | 'flagged' | 'pending' | 'not_reviewed';

export function cardVerdict(
  itemStatus: string | null,
  findings: ReadonlyArray<{ severity: string }>,
): QaCardVerdict {
  if (!cardPasses(findings)) return 'flagged';
  if (itemStatus === 'done') return 'passed';
  if (itemStatus === null) return findings.length > 0 ? 'passed' : 'pending';
  if (itemStatus === 'queued') return 'pending';
  return 'not_reviewed';
}

export interface QaCardGroup {
  cardId: number;
  stableUid: string;
  question: string | null;
  itemStatus: string | null;
  itemErrorCode: string | null;
  verdict: QaCardVerdict;
  /** True only when verdict is 'passed'. */
  passes: boolean;
  findings: QaFinding[];
}

/**
 * One group per reviewed card: every item appears, and a finding whose item is
 * missing still gets a group. Cards with a blocker come first, then major, then
 * minor, then clean; within a tier by stableUid. Findings run blocker → minor,
 * then by id.
 */
export function groupFindingsByCard(
  findings: readonly QaFinding[],
  items: readonly Pick<QaItem, 'cardId' | 'stableUid' | 'status' | 'errorCode'>[],
  cards?: ReadonlyArray<{ id: number; stableUid: string; question: string }>,
): QaCardGroup[] {
  const cardById = new Map((cards ?? []).map(c => [c.id, c]));
  const groups = new Map<number, QaCardGroup>();

  const groupFor = (cardId: number, stableUid: string): QaCardGroup => {
    let group = groups.get(cardId);
    if (!group) {
      const card = cardById.get(cardId);
      group = {
        cardId,
        stableUid: stableUid || card?.stableUid || `card-${cardId}`,
        question: card?.question ?? null,
        itemStatus: null,
        itemErrorCode: null,
        verdict: 'pending',
        passes: false,
        findings: [],
      };
      groups.set(cardId, group);
    }
    return group;
  };

  for (const item of items) {
    const group = groupFor(item.cardId, item.stableUid);
    group.itemStatus = item.status;
    group.itemErrorCode = item.errorCode;
  }
  for (const finding of findings) {
    groupFor(finding.cardId, '').findings.push(finding);
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.findingId - b.findingId);
    group.verdict = cardVerdict(group.itemStatus, group.findings);
    group.passes = group.verdict === 'passed';
  }

  const tier = (group: QaCardGroup): number =>
    group.findings.length === 0 ? QA_SEVERITIES.length : severityRank(group.findings[0].severity);

  return result.sort((a, b) => tier(a) - tier(b) || a.stableUid.localeCompare(b.stableUid));
}

export const QA_START_ERROR_MESSAGES: Record<string, string> = {
  AI_QA_DISABLED: 'AI QA is switched off on the server.',
  CONFIG_ERROR: 'The AI QA queue is not configured on the server yet.',
  AI_QA_RUN_IN_PROGRESS: 'A run is already in progress for this deck; its progress is shown below.',
  AI_QA_NOTHING_TO_REVIEW: 'Nothing to review: every changed card already has a review of its current content.',
  AI_QA_TOO_MANY_CARDS: 'Too many cards for one run. Narrow the scope.',
  AI_QA_DAILY_CAP: "Today's AI QA spend has reached the daily cap. Try again after midnight UTC.",
  DECK_NOT_FOUND: 'This deck no longer exists.',
};

/** The start refusal text, with the run size limit filled in where it applies. */
export function qaStartErrorMessage(code: string, fallback: string, limits: QaLimits): string {
  if (code === 'AI_QA_TOO_MANY_CARDS') {
    return `Too many cards for one run (the limit is ${limits.maxCards}). Narrow the scope.`;
  }
  return QA_START_ERROR_MESSAGES[code] ?? fallback;
}

export const QA_ITEM_ERROR_LABELS: Record<string, string> = {
  PROVIDER_ACCESS_DENIED: 'The model provider refused access (check Bedrock model access or the provider setting).',
  PROVIDER_AUTH: 'The model provider rejected the credentials.',
  PROVIDER_RATE_LIMITED: 'The model provider rate-limited the review.',
  PROVIDER_ERROR: 'The model provider returned a server error.',
  PROVIDER_TIMEOUT: 'The model provider did not answer in time.',
  SCHEMA_INVALID: 'The review came back in an unreadable shape.',
  MAX_TOKENS: 'The review ran out of output tokens before finishing.',
  REFUSAL: 'The model declined to review this card.',
  DISABLED: 'AI QA was switched off when this card came up for review.',
  CONFIG: 'The AI QA service is misconfigured.',
};

/** The label for an item error code; an unknown code displays as itself. */
export function qaItemErrorLabel(code: string): string {
  return QA_ITEM_ERROR_LABELS[code] ?? code;
}
