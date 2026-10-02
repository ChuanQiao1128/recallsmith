// A Mistake Book focus run deals cards whether or not they are due. A Hard, Good or Easy on a card
// that is not due is practice (scheduleFocusReview): the schedule stays, and so must the card's
// FSRS memory state. These tests pin that a practice tap neither makes the stored state look stale
// (anchor ≠ lastReviewedAt) nor shortens the elapsed time the next real review is measured over.
import { afterEach, describe, expect, it } from 'vitest';

import { applyRemoteFeatures } from '../../src/config/featureFlags';
import { scheduleFocusReview } from '../../src/features/gacha/mistakes/focusSession';
import { nextState } from '../../src/review/fsrs';
import { scheduleWithFsrs } from '../../src/review/fsrsScheduler';
import type { CardProgress } from '../../src/review/model';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

/** Good, Good, Good on the due days (contract §4.1 vector): S 34.5776, D 5.2635, due in 35 days. */
function anchoredAtT0(): CardProgress {
  return {
    stableUid: 'uid-a',
    stage: 5,
    lastReviewedAt: T0,
    nextReviewAt: T0 + 35 * DAY_MS,
    lastSeenRevision: 1,
    lapses: 0,
    hardStreak: 0,
    fsrsStability: 34.5776,
    fsrsDifficulty: 5.2635,
    fsrsAnchorAt: T0,
  };
}

const STORED = { stability: 34.5776, difficulty: 5.2635 };

afterEach(() => {
  applyRemoteFeatures(null);
});

describe('focus practice keeps the FSRS memory state', () => {
  it('practice leaves the schedule and the stored S/D alone and keeps the state trusted', () => {
    const practiceAt = T0 + 30 * DAY_MS;
    const after = scheduleFocusReview(anchoredAtT0(), 'good', new Date(practiceAt));

    expect(after.lastReviewedAt).toBe(practiceAt);
    expect(after.nextReviewAt).toBe(T0 + 35 * DAY_MS);
    expect(after.stage).toBe(5);
    expect(after.fsrsStability).toBe(34.5776);
    expect(after.fsrsDifficulty).toBe(5.2635);
    expect(after.fsrsAnchorAt).toBe(practiceAt);
  });

  it.each(['hard', 'good', 'easy'] as const)(
    'a %s practice on day 30, then Good on the due day 35, equals nextState(stored, good, 35 days)',
    (practice) => {
      const practiced = scheduleFocusReview(anchoredAtT0(), practice, new Date(T0 + 30 * DAY_MS));
      const dueAt = T0 + 35 * DAY_MS;
      const reviewed = scheduleFocusReview(practiced, 'good', new Date(dueAt));

      const expected = nextState(STORED, 3, 35);
      expect(reviewed.fsrsStability).toBeCloseTo(expected.stability, 6);
      expect(reviewed.fsrsDifficulty).toBeCloseTo(expected.difficulty, 6);
      expect(reviewed.nextReviewAt).toBe(dueAt + expected.days * DAY_MS);
      expect(expected.days).toBe(90);
      expect(reviewed.fsrsAnchorAt).toBe(dueAt);
      expect(reviewed.fsrsReviewedAt).toBe(dueAt);
    },
  );

  it('two practice taps still measure the next review from the real one', () => {
    const once = scheduleFocusReview(anchoredAtT0(), 'good', new Date(T0 + 10 * DAY_MS));
    const twice = scheduleFocusReview(once, 'easy', new Date(T0 + 20 * DAY_MS));
    const dueAt = T0 + 36 * DAY_MS;
    const reviewed = scheduleWithFsrs(twice, 'hard', dueAt);

    const expected = nextState(STORED, 2, 36);
    expect(reviewed.fsrsStability).toBeCloseTo(expected.stability, 6);
    expect(reviewed.nextReviewAt).toBe(dueAt + expected.days * DAY_MS);
  });

  it('practice does not revive a state that was already stale', () => {
    // Another device reviewed the card at day 1: anchor (T0) ≠ lastReviewedAt (day 1).
    const stale: CardProgress = { ...anchoredAtT0(), lastReviewedAt: T0 + DAY_MS, nextReviewAt: T0 + 11 * DAY_MS };
    const practiced = scheduleFocusReview(stale, 'good', new Date(T0 + 5 * DAY_MS));
    expect(practiced.fsrsAnchorAt).toBe(T0);

    // The next real review derives the state as for any stale row: S from nextReviewAt minus
    // lastReviewedAt (now the practice time), elapsed from lastReviewedAt.
    const dueAt = T0 + 11 * DAY_MS;
    const reviewed = scheduleWithFsrs(practiced, 'good', dueAt);
    const expected = nextState({ stability: 6, difficulty: 5 }, 3, 6);
    expect(reviewed.fsrsStability).toBeCloseTo(expected.stability, 6);
  });

  it('a review from another device after practice still makes the state stale', () => {
    const practiceAt = T0 + 30 * DAY_MS;
    const practiced = scheduleFocusReview(anchoredAtT0(), 'good', new Date(practiceAt));
    // Sync merge (case A): the remote review moves lastReviewedAt / nextReviewAt, local FSRS fields stay.
    const remoteAt = T0 + 33 * DAY_MS;
    const merged: CardProgress = { ...practiced, lastReviewedAt: remoteAt, nextReviewAt: remoteAt + 8 * DAY_MS };

    const dueAt = remoteAt + 8 * DAY_MS;
    const reviewed = scheduleWithFsrs(merged, 'good', dueAt);
    const expected = nextState({ stability: 8, difficulty: 5 }, 3, 8);
    expect(reviewed.fsrsStability).toBeCloseTo(expected.stability, 6);
  });

  it('a ladder review (flag off) after practice still makes the state stale', () => {
    const practiced = scheduleFocusReview(anchoredAtT0(), 'good', new Date(T0 + 30 * DAY_MS));
    applyRemoteFeatures({ features: { fsrs: { enabled: false } } } as never);
    const ladder = scheduleWithFsrs(practiced, 'good', T0 + 35 * DAY_MS);
    applyRemoteFeatures(null);

    expect(ladder.fsrsAnchorAt).not.toBe(ladder.lastReviewedAt);
    const reviewed = scheduleWithFsrs(ladder, 'good', ladder.nextReviewAt);
    const stability = (ladder.nextReviewAt - (ladder.lastReviewedAt as number)) / DAY_MS;
    const expected = nextState({ stability, difficulty: 5 }, 3, stability);
    expect(reviewed.fsrsStability).toBeCloseTo(expected.stability, 6);
  });
});
