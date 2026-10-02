// mobile/src/features/gacha/mcq/mcqVerdict.ts
// Pure verdict → rating mapping (plan §5.3) and a read-only ladder preview.
// The scheduler is consumed, never re-implemented: describeScheduledRating formats the output of the
// scheduler that saves the rating (scheduleWithFsrs, or scheduleFocusReview in a focus run) and nothing
// else (D00 §0, no ladder copy).
import type { ReviewRating, CardProgress } from '../../../review/model';
import { scheduleWithFsrs } from '../../../review/fsrsScheduler';
import type { McqExport } from '../../../types/deckExport';
import { capNextReviewToExam } from '../../goal/studyGoal';
import { mcqRequiredCount } from './normalizeMcq';
import { MCQ_FAST_MS } from './mcqConstants';

export type McqVerdict = 'correct' | 'partial' | 'wrong';
export type McqConfidence = 'sure' | 'unsure';
export type McqReviewStage = 'first_review' | 'repeat_review';

/** picks = option KEYS. [] → 'wrong' ("I don't know"). N = requiredCount(mcq), k = |picks ∩ correct keys|.
 *  N === 1: picks[0] correct → 'correct', else 'wrong'. N ≥ 2: k === N → 'correct'; k === N − 1 → 'partial'
 *  (exactly one wrong, plan §5.2/§5.4); else 'wrong'. Extra or unknown keys never make a verdict better. Pure. */
export function resolveMcqVerdict(picks: readonly string[], mcq: McqExport): McqVerdict {
  const correct = new Set(mcq.options.filter((o) => o.correct === true).map((o) => o.key));
  const n = mcqRequiredCount(mcq);
  if (picks.length === 0 || n < 1) return 'wrong';   // gap #2: no correct option → 'wrong'
  if (n === 1) return correct.has(picks[0]) ? 'correct' : 'wrong';
  const k = new Set(picks.filter((key) => correct.has(key))).size;   // gap #3: distinct correct picks
  if (k === n) return 'correct';
  if (k === n - 1) return 'partial';
  return 'wrong';
}

/** responseMs ≤ MCQ_FAST_MS.upToFourOptions when optionCount ≤ 4, else ≤ MCQ_FAST_MS.fiveOrSix. A non-finite or
 *  negative responseMs is never fast. */
export function isFastResponse(responseMs: number, optionCount: number): boolean {
  if (!Number.isFinite(responseMs) || responseMs < 0) return false;   // gap #5
  const budget = optionCount <= 4 ? MCQ_FAST_MS.upToFourOptions : MCQ_FAST_MS.fiveOrSix;
  return responseMs <= budget;
}

export type McqVerdictInput = {
  verdict: McqVerdict;
  confidence: McqConfidence;      // which submit button; "I don't know" passes 'unsure' (row 1 ignores it)
  changedPick: boolean;           // the submitted set differs from the FIRST complete set (§2.5)
  responseMs: number;             // options shown → submit (NOT dwellTimeMs)
  optionCount: number;            // shownOrder.length
  reviewStage: McqReviewStage;    // same rule as SessionCardScreen.tsx:463 (isLearned(current.progress))
  stage: number;                  // current.progress.stage BEFORE the rating
  hardStreak: number;             // current.progress.hardStreak ?? 0 BEFORE the rating
  redeal?: boolean;               // attemptIndex >= 1: a same-run redeal after a lapse (plan §5.4, review 2026-09-22)
};

/** Plan §5.3, top-down, first hit (rows :295-301). Total: any finite or non-finite numbers, any combination.
 *  1 wrong                                                    → 'again'
 *  2 partial                                                  → 'hard'
 *  3 correct, unsure                                          → 'hard'
 *  4 correct, sure, first_review                              → 'good'
 *  5 correct, sure, repeat_review, (changedPick || !fast)     → 'good'
 *  6 correct, sure, repeat_review, !changedPick, fast, !redeal, stage >= 1 && hardStreak === 0 → 'easy'
 *  7 correct, sure, repeat_review, !changedPick, fast, otherwise (incl. redeal)             → 'good'
 *  The redeal cap (plan §5.4 "重发永远到不了 easy"): `again` drops the stage by two, so a card that was at
 *  stage >= 3 comes back ten minutes later at stage >= 1 and would otherwise satisfy row 6 — the lapse it
 *  just recorded must not be undone by one fast re-answer. `redeal === true` therefore caps at 'good'.
 *  Cautious fallbacks (gap #1): an unrecognised verdict → 'again'; an unrecognised confidence → 'hard';
 *  an unrecognised reviewStage → 'good'; changedPick !== false counts as changed. Never throws; no clock. */
export function mapMcqVerdictToRating(input: McqVerdictInput): ReviewRating {
  if (input.verdict !== 'correct') {
    return input.verdict === 'partial' ? 'hard' : 'again';   // row 2 / row 1 (any non-correct)
  }
  if (input.confidence !== 'sure') return 'hard';            // row 3 (unsure or unrecognised)
  if (input.reviewStage !== 'repeat_review') return 'good';  // row 4 (first_review or unrecognised)
  const changed = input.changedPick !== false;
  const fast = isFastResponse(input.responseMs, input.optionCount);
  if (changed || !fast) return 'good';                       // row 5
  if (input.redeal === true) return 'good';                  // row 7 (redeal cap, plan §5.4)
  return input.stage >= 1 && input.hardStreak === 0 ? 'easy' : 'good';   // rows 6 / 7
}

export const RATING_LABEL: Readonly<Record<ReviewRating, 'Again' | 'Hard' | 'Good' | 'Easy'>> = Object.freeze({ again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' });

/** The scheduler a preview runs: scheduleWithFsrs (the ladder when features.fsrs is off), or scheduleFocusReview in a focus run. */
export type RatingScheduler = (p: CardProgress, rating: ReviewRating, now: Date) => CardProgress;

const scheduleWithFsrsAt: RatingScheduler = (p, rating, now) => scheduleWithFsrs(p, rating, now.getTime());

function formatPracticeGap(delta: number): string {
  if (delta < 3_600_000) {
    const minutes = Math.max(1, Math.round(delta / 60_000));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  if (delta < 86_400_000) {
    const hours = Math.round(delta / 3_600_000);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(delta / 86_400_000);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Pure preview of a rating: after = schedule(before, rating, now) (read-only import), where schedule is the
 *  function that will save the rating (scheduleWithFsrs by default, scheduleFocusReview in a focus run).
 *  The line formats after.nextReviewAt's delta from now; before is never mutated (the scheduler spreads).
 *  When a non-Again rating leaves stage and nextReviewAt as they were (focus practice), the line says so and
 *  names the gap to the unchanged nextReviewAt instead of a ladder step that is never applied.
 *  With an exam date, after is capped exactly as the save caps it (R22 §7), so the line shows the capped day. */
export function describeScheduledRating(
  before: CardProgress,
  rating: ReviewRating,
  now: Date,
  schedule: RatingScheduler = scheduleWithFsrsAt,
  examDate: string | null = null,
): { after: CardProgress; line: string } {
  const after = capNextReviewToExam(schedule(before, rating, now), examDate, now.getTime());
  const delta = after.nextReviewAt - now.getTime();
  if (rating !== 'again' && after.stage === before.stage && after.nextReviewAt === before.nextReviewAt) {
    return { after, line: `Practice · schedule unchanged · back in ${formatPracticeGap(delta)}` };
  }
  const days = Math.round(delta / 86_400_000);
  const gap = delta < 3_600_000 ? '10 minutes' : `${days} day${days === 1 ? '' : 's'}`;
  const stays = rating === 'hard' && after.stage === before.stage ? ' · the card stays where it is' : '';
  const line = `Scheduled as ${RATING_LABEL[rating]}${stays} · back in ${gap}`;
  return { after, line };
}
