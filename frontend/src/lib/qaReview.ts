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
// values GET …/qa/status returns in data.limits and falls back to these
// defaults, labelled as defaults, when the response does not carry them.
export const QA_MAX_CARDS = 200;
export const QA_DAILY_USD_CAP = 10;

export interface QaLimits {
  maxCards: number;
  dailyUsdCap: number;
  /** Today's spend, when the server reports it. */
  spentTodayUsd: number | null;
  /** Today's spend reserved by runs still in flight, when the server reports it. */
  reservedTodayUsd: number | null;
  /**
   * The amount the server reserves per card against the daily cap
   * (AI_QA_EST_USD_PER_CARD), when it reports it; else the page prices cards
   * at the server's documented default (QA_EST_USD_PER_CARD_DEFAULT).
   */
  estUsdPerCard: number | null;
  /** True when both limits came from the server rather than the defaults. */
  fromServer: boolean;
}

export function qaLimits(
  status: {
    maxCards: number | null;
    dailyUsdCap: number | null;
    spentTodayUsd: number | null;
    reservedTodayUsd?: number | null;
    estUsdPerCard?: number | null;
  } | null,
): QaLimits {
  return {
    maxCards: status?.maxCards ?? QA_MAX_CARDS,
    dailyUsdCap: status?.dailyUsdCap ?? QA_DAILY_USD_CAP,
    spentTodayUsd: status?.spentTodayUsd ?? null,
    reservedTodayUsd: status?.reservedTodayUsd ?? null,
    estUsdPerCard: status?.estUsdPerCard ?? null,
    fromServer: status?.maxCards != null && status?.dailyUsdCap != null,
  };
}

/**
 * What is left of today's cap after what was spent and what running runs have
 * reserved; the whole cap when neither is known.
 */
export function qaCapRemainingUsd(limits: QaLimits): number {
  return Math.max(0, limits.dailyUsdCap - (limits.spentTodayUsd ?? 0) - (limits.reservedTodayUsd ?? 0));
}

// What the server reserves per card against the daily cap when a run starts
// (AI_QA_EST_USD_PER_CARD, default 0.05 in QaRuns.DefaultEstUsdPerCard). The
// page's estimate uses the same figure, so its cap warning agrees with the
// server's refusal (frontend-console-23); the rate the status reports in
// data.limits.estUsdPerCard wins over this default. An estimate only: the
// provider bills separately.
export const QA_EST_USD_PER_CARD_DEFAULT = 0.05;

export function estimateQaCostUsd(cardCount: number, perCardUsd: number | null = null): number {
  return cardCount * (perCardUsd ?? QA_EST_USD_PER_CARD_DEFAULT);
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
  AI_QA_DAILY_CAP:
    "This run's estimate is more than what is left of today's AI QA cap. Narrow the scope, or try again after midnight UTC.",
  DECK_NOT_FOUND: 'This deck no longer exists.',
};

/**
 * The start refusal text, with the run size limit filled in where it applies.
 * For AI_QA_TOO_MANY_CARDS the limit is quoted only when it came from the
 * server; otherwise the page knows only its fallback, so it shows the server's
 * own message, which names the real AI_QA_MAX_CARDS.
 */
export function qaStartErrorMessage(code: string, fallback: string, limits: QaLimits): string {
  if (code === 'AI_QA_TOO_MANY_CARDS') {
    if (!limits.fromServer) return fallback.trim() !== '' ? fallback : QA_START_ERROR_MESSAGES.AI_QA_TOO_MANY_CARDS;
    return `Too many cards for one run (the limit is ${limits.maxCards}). Narrow the scope.`;
  }
  if (code === 'AI_QA_DAILY_CAP') {
    // The server's text names today's spend, the reserved spend and this run's
    // estimate, which is exactly what the author needs; it is kept, with what to
    // do about it (frontend-console-23). Waiting is not the only way out: a
    // narrower scope may fit what is left.
    const server = fallback.trim().replace(/\.$/, '');
    return server === ''
      ? QA_START_ERROR_MESSAGES.AI_QA_DAILY_CAP
      : `${server}. Narrow the scope, or try again after midnight UTC.`;
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
