// The non-blocking suggestion tier of the MCQ importer (plan §4.5). These are
// hints, not gates: a warning never enters ParsedDeck.errors, never becomes an
// INVALID_CARD conflict in planImport, and never blocks the import. The page
// renders them in an amber "suggestions — not blocking" panel and lint-deck.mts
// prints them; nothing in the pipeline keys a decision off them. The codes here
// deliberately stay out of McqIssueCode / ImportIssueCode (the blocking tiers).
import type { McqBlob } from '../types/mcq';

export type McqWarningCode =
  | 'MCQ_WARN_CORRECT_LONGEST'
  | 'MCQ_WARN_WHY_SHORT'
  | 'MCQ_WARN_STEM_LONG'
  | 'MCQ_WARN_FIRST_SENTENCE_LONG'
  | 'MCQ_WARN_SHAPE'
  | 'MCQ_WARN_NO_USAGE';

export interface ImportWarning { code: McqWarningCode; severity: 'warning'; line: number; message: string; stableUid: string }
export interface McqWarningInput { question: string; realWorldUsage: string | null; mcq: McqBlob }
export type McqWarning = { code: McqWarningCode; message: string };

export const MCQ_WARN_LONGEST_RATIO = 1.4;
export const MCQ_WARN_WHY_MIN_CHARS = 40;
export const MCQ_WARN_STEM_MAX_WORDS = 120;
export const MCQ_WARN_FIRST_SENTENCE_MAX_CHARS = 140;
export const MCQ_WARN_SHAPES: ReadonlyArray<readonly [number, number]> = [[1, 4], [2, 5], [3, 6]];

/** Up to and including the first `.`, `?` or `!` followed by whitespace or the end; the whole trimmed stem when there is none. */
export function firstSentence(question: string): string {
  const trimmed = question.trim();
  const match = trimmed.match(/^[\s\S]*?[.?!](?=\s|$)/);
  return match ? match[0] : trimmed;
}

/** Words = runs of non-whitespace in the trimmed text; '' → 0. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function len(value: string): number {
  return typeof value === 'string' ? value.trim().length : 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Total: never throws, runs on cards the blocking rules refuse. Order of the result = the union above (WHY_SHORT once per option, in stored order). */
export function warnMcq(card: McqWarningInput): McqWarning[] {
  const warnings: McqWarning[] = [];
  const mcq = card.mcq;
  const options = Array.isArray(mcq.options) ? mcq.options : [];
  const correct = options.filter((option) => option.correct === true);
  const wrong = options.filter((option) => option.correct !== true);

  // MCQ_WARN_CORRECT_LONGEST — the longest answer gives itself away.
  if (wrong.length > 0) {
    const wrongMedian = median(wrong.map((option) => len(option.text)));
    if (wrongMedian > 0) {
      const giveaway = correct.find((option) => len(option.text) >= MCQ_WARN_LONGEST_RATIO * wrongMedian);
      if (giveaway) {
        warnings.push({
          code: 'MCQ_WARN_CORRECT_LONGEST',
          message: `Correct option "${giveaway.key}" is ${len(giveaway.text)} characters, at least 1.4x the median wrong option (${wrongMedian}); the longest answer gives itself away.`,
        });
      }
    }
  }

  // MCQ_WARN_WHY_SHORT — once per option whose WHY is a too-short string.
  for (const option of options) {
    if (typeof option.why === 'string' && len(option.why) < MCQ_WARN_WHY_MIN_CHARS) {
      warnings.push({
        code: 'MCQ_WARN_WHY_SHORT',
        message: `WHY for option "${option.key}" is ${len(option.why)} characters; under 40 it rarely explains the trap.`,
      });
    }
  }

  // MCQ_WARN_STEM_LONG — the stem stops being a scenario.
  const words = wordCount(card.question);
  if (words > MCQ_WARN_STEM_MAX_WORDS) {
    warnings.push({
      code: 'MCQ_WARN_STEM_LONG',
      message: `Question is ${words} words; over 120 the stem stops being a scenario and becomes a reading test.`,
    });
  }

  // MCQ_WARN_FIRST_SENTENCE_LONG — card faces clip after about 140.
  const firstSentenceChars = firstSentence(card.question).length;
  if (firstSentenceChars > MCQ_WARN_FIRST_SENTENCE_MAX_CHARS) {
    warnings.push({
      code: 'MCQ_WARN_FIRST_SENTENCE_LONG',
      message: `First sentence is ${firstSentenceChars} characters; card faces clip after about 140, so lead with the point.`,
    });
  }

  // MCQ_WARN_SHAPE — off the exam shapes.
  const isKnownShape = MCQ_WARN_SHAPES.some(([c, o]) => c === correct.length && o === options.length);
  if (!isKnownShape) {
    warnings.push({
      code: 'MCQ_WARN_SHAPE',
      message: `${correct.length} correct of ${options.length} options; the exam shapes are 1 of 4, 2 of 5 and 3 of 6.`,
    });
  }

  // MCQ_WARN_NO_USAGE — no real-world line.
  if (card.realWorldUsage === null || card.realWorldUsage.trim() === '') {
    warnings.push({
      code: 'MCQ_WARN_NO_USAGE',
      message: 'No USAGE: section; MCQ cards read better with a real-world line under the explanation.',
    });
  }

  return warnings;
}

/** `line ${line}: ${message}` — the same shape as formatIssue. */
export function formatWarning(w: Pick<ImportWarning, 'line' | 'message'>): string {
  return `line ${w.line}: ${w.message}`;
}

/** Stable: by line, then code (string order), then original index. */
export function sortWarnings(warnings: readonly ImportWarning[]): ImportWarning[] {
  return warnings
    .map((warning, index) => ({ warning, index }))
    .sort((a, b) => {
      if (a.warning.line !== b.warning.line) return a.warning.line - b.warning.line;
      if (a.warning.code !== b.warning.code) return a.warning.code < b.warning.code ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.warning);
}
