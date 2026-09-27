// src/lib/draftReview.ts
//
// Pure rules for the AI draft review queue (R18 contract §8.3). The lint is the
// importer's own rule set, reached the way the MCP server's lint_card reaches it
// (§8.4): serialise the draft as deck Markdown and parse it back, so a draft the
// console calls clean is one the importer would take. The uid, difficulty and
// MCQ rules therefore arrive through parseDeckMarkdown, never by direct import.
import type { CardFormValues } from '../components/CardForm';
import type { DraftCard, DraftRejectReason } from '../types/draft';
import { parseDeckMarkdown, serializeDeckMarkdown } from './deckImport';
import type { DeckCardContent } from './deckImport';

/** Contract §3.5, in picker order. `defect` marks the reasons the ledger counts as caught defects (§9.1b). */
export const DRAFT_REJECT_REASONS: ReadonlyArray<{ value: DraftRejectReason; label: string; defect: boolean }> = [
  { value: 'incorrect', label: 'Incorrect', defect: true },
  { value: 'ambiguous', label: 'Ambiguous', defect: true },
  { value: 'duplicate', label: 'Duplicate', defect: true },
  { value: 'unsupported_source', label: 'Not supported by the source', defect: true },
  { value: 'off_topic', label: 'Off topic', defect: false },
  { value: 'low_value', label: 'Low value', defect: false },
  { value: 'other', label: 'Other', defect: false },
];

export const DRAFT_NOTE_MAX_LENGTH = 500;

/** The same shape as the MCP lint_card output (§8.4). */
export type DraftLint = {
  ok: boolean;
  issues: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
};

export function draftToDeckCardContent(card: DraftCard): DeckCardContent {
  const content: DeckCardContent = {
    stableUid: card.stableUid,
    difficulty: card.difficulty,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: card.codeSnippet ?? null,
    codeLanguage: card.codeLanguage ?? null,
    realWorldUsage: card.realWorldUsage ?? null,
  };
  if (card.topic && card.topic.trim() !== '') content.topic = card.topic;
  if (card.mcq) content.mcq = card.mcq;
  if (card.source) content.source = { url: card.source.url, quote: card.source.quote };
  return content;
}

export function lintDraftCard(deckSlug: string, card: DraftCard): DraftLint {
  const parsed = parseDeckMarkdown(serializeDeckMarkdown(deckSlug, [draftToDeckCardContent(card)]));
  const issues = parsed.errors.map(issue => ({ code: issue.code as string, message: issue.message }));
  const source = card.source as DraftCard['source'] | undefined | null;
  if (!source || !(source.url ?? '').trim() || !(source.quote ?? '').trim()) {
    issues.push({ code: 'SOURCE_REQUIRED', message: 'A draft needs a source URL and a supporting quote.' });
  }
  const warnings = parsed.warnings.map(warning => ({ code: warning.code as string, message: warning.message }));
  return { ok: issues.length === 0, issues, warnings };
}

export function draftToFormValues(card: DraftCard): CardFormValues {
  return {
    question: card.question ?? '',
    stableUid: card.stableUid ?? '',
    explanation: card.explanation ?? '',
    realWorldUsage: card.realWorldUsage ?? '',
    codeSnippet: card.codeSnippet ?? '',
    codeLanguage: card.codeLanguage ?? '',
    difficulty: card.difficulty,
    // The server assigns both on accept. CardForm's draft variant hides the two
    // fields; these values only satisfy its positive-number checks.
    orderInDeck: 10,
    revision: 1,
    topic: card.topic ?? '',
    sourceUrl: card.source?.url ?? '',
    sourceQuote: card.source?.quote ?? '',
  };
}

function trimmedOrNull(value: string | undefined): string | null {
  const t = (value ?? '').trim();
  return t === '' ? null : t;
}

export function formValuesToDraftCard(values: CardFormValues, base: DraftCard): DraftCard {
  return {
    stableUid: values.stableUid.trim(),
    difficulty: values.difficulty,
    topic: trimmedOrNull(values.topic),
    question: values.question.trim(),
    explanation: (values.explanation ?? '').trim(),
    codeSnippet: trimmedOrNull(values.codeSnippet),
    codeLanguage: trimmedOrNull(values.codeLanguage),
    realWorldUsage: trimmedOrNull(values.realWorldUsage),
    // The form never edits MCQ options; the stored blob rides along unchanged.
    mcq: base.mcq ?? null,
    source: { url: (values.sourceUrl ?? '').trim(), quote: (values.sourceQuote ?? '').trim() },
  };
}

export function reviewDurationMs(openedAt: number, now: number): number {
  return Math.max(0, Math.round(now - openedAt));
}

/**
 * The most review time one decision reports (feeds the ledger's actual minutes,
 * contract §9.3). Anything longer is a draft left open, not time spent on it.
 */
export const REVIEW_MS_CAP = 30 * 60_000;

/**
 * Review time that counts only while the page is visible: a draft left open in
 * a background tab over lunch must not zero out that accept's minutes saved.
 * `visibleSince` is when the current visible stretch began, or null while the
 * page is hidden.
 */
export type ReviewClock = { visibleMs: number; visibleSince: number | null };

export function startReviewClock(now: number, visible: boolean): ReviewClock {
  return { visibleMs: 0, visibleSince: visible ? now : null };
}

export function setReviewClockVisible(clock: ReviewClock, visible: boolean, now: number): ReviewClock {
  if (visible) return clock.visibleSince === null ? { ...clock, visibleSince: now } : clock;
  if (clock.visibleSince === null) return clock;
  return { visibleMs: clock.visibleMs + reviewDurationMs(clock.visibleSince, now), visibleSince: null };
}

/** Visible time so far, capped at REVIEW_MS_CAP. */
export function reviewClockMs(clock: ReviewClock, now: number): number {
  const running = clock.visibleSince === null ? 0 : reviewDurationMs(clock.visibleSince, now);
  return Math.min(REVIEW_MS_CAP, clock.visibleMs + running);
}

export function sourceHostLabel(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return null;
    return parsed.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function draftDecisionMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'DRAFT_NOT_PENDING':
      return 'This draft was already decided, in another tab or by another reviewer. The list has been refreshed.';
    case 'STABLE_UID_TAKEN':
      return 'A live card already uses this stable uid. Edit the uid, then use Accept with edits.';
    case 'DRAFT_NOT_FOUND':
      return 'This draft no longer exists.';
    default:
      return fallback;
  }
}
