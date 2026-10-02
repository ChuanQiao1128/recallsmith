// R22 §1.5, §7: with an exam date set, no review is scheduled after the day before the exam.
// The cap wraps the scheduler at its one call site (buildRatedSessionState); the frozen model.ts is untouched.
// The scheduler is scheduleWithFsrs (R24 §4.3: FSRS while features.fsrs is on, the ladder otherwise).
import { describe, expect, it } from 'vitest';

import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { scheduleFocusReview } from '../../src/features/gacha/mistakes/focusSession';
import { type CardProgress, type ReviewRating } from '../../src/review/model';
import { scheduleWithFsrs } from '../../src/review/fsrsScheduler';
import type { CardExport } from '../../src/types/deckExport';

// Local times: the exam date is a local calendar day.
const NOW = new Date(2026, 9, 2, 9, 0, 0);
const EXAM = '2026-10-07';
const CAP_MS = new Date(2026, 9, 6, 0, 0, 0).getTime();
const DAY = 86_400_000;

const CARD: CardExport = { StableUid: 'a', OrderInDeck: 1, Difficulty: 1, Question: 'Q a', Revision: 2 };

function progressAt(stage: number, extra?: Partial<CardProgress>): CardProgress {
  return { stableUid: 'a', stage, lastReviewedAt: NOW.getTime() - 10 * DAY, nextReviewAt: NOW.getTime() - 1, ...extra };
}

/** What the session saves before the cap. */
function schedule(before: CardProgress, rating: ReviewRating): CardProgress {
  return scheduleWithFsrs(before, rating, NOW.getTime());
}

function rate(before: CardProgress, rating: ReviewRating, examDate?: string | null, focusRun = false) {
  return buildRatedSessionState({
    current: { card: CARD, progress: before },
    progress: [before],
    rating,
    mode: 'review-due',
    sessionDone: 0,
    sessionLimit: 5,
    now: NOW,
    cardIndex: null,
    focusRun,
    examDate,
  });
}

describe('exam cap on the session scheduler', () => {
  it('pulls a good rating that would land after the exam back to the start of the day before', () => {
    const before = progressAt(3);
    const uncapped = schedule(before, 'good');
    expect(uncapped.nextReviewAt).toBeGreaterThan(CAP_MS);

    const { updatedOne, updatedProgress } = rate(before, 'good', EXAM);
    expect(updatedOne.nextReviewAt).toBe(CAP_MS);
    // Only the date moves: stage, lapses and the revision stamp are the scheduler's.
    expect(updatedOne).toEqual({ ...uncapped, nextReviewAt: CAP_MS, lastSeenRevision: 2 });
    // The saved array carries the capped value, so progressAfter sends it to the server.
    expect(updatedProgress[0].nextReviewAt).toBe(CAP_MS);
  });

  it('leaves a review that already lands before the cap unchanged', () => {
    // A first Good is 3 days out, before the cap 3.6 days away.
    const before: CardProgress = { stableUid: 'a', stage: 0, nextReviewAt: 0 };
    const { updatedOne } = rate(before, 'good', EXAM);
    expect(updatedOne.nextReviewAt).toBe(schedule(before, 'good').nextReviewAt);
    expect(updatedOne.nextReviewAt).toBe(NOW.getTime() + 3 * DAY);
    expect(updatedOne.nextReviewAt).toBeLessThan(CAP_MS);
    expect(rate(before, 'again', EXAM).updatedOne.nextReviewAt).toBe(NOW.getTime() + 10 * 60_000);
  });

  it('leaves every rating unchanged with no goal or no exam date', () => {
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const expected = schedule(progressAt(4), rating).nextReviewAt;
      expect(rate(progressAt(4), rating).updatedOne.nextReviewAt).toBe(expected);
      expect(rate(progressAt(4), rating, null).updatedOne.nextReviewAt).toBe(expected);
    }
  });

  it('does not cap when the exam is tomorrow (the day before is not in the future)', () => {
    const before = progressAt(3);
    const expected = schedule(before, 'good').nextReviewAt;
    expect(rate(before, 'good', '2026-10-03').updatedOne.nextReviewAt).toBe(expected);
    // An exam today or already past does not cap either.
    expect(rate(before, 'good', '2026-10-02').updatedOne.nextReviewAt).toBe(expected);
    expect(rate(before, 'good', '2026-09-01').updatedOne.nextReviewAt).toBe(expected);
  });

  it('caps the focus-run scheduler too', () => {
    const before = progressAt(3);
    expect(scheduleFocusReview(before, 'easy', NOW).nextReviewAt).toBeGreaterThan(CAP_MS);
    expect(rate(before, 'easy', EXAM, true).updatedOne.nextReviewAt).toBe(CAP_MS);
  });
});
