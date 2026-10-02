// The horizon guard in scheduleWithFsrs, tested on its own. fsrs.ts already clamps every interval
// to MAX_INTERVAL_DAYS (90), which equals MAX_NEXT_REVIEW_HORIZON_MS, so with the real model the
// guard never changes a result and the horizon tests in fsrsScheduler.test.ts would pass without
// it. Here the model is replaced by one that asks for far more than the horizon, so these tests
// fail if the guard is removed or loosened.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/review/fsrs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/review/fsrs')>();
  return {
    ...real,
    initState: () => ({ stability: 400, difficulty: 5, days: 400 }),
    nextState: () => ({ stability: 400, difficulty: 5, days: 400 }),
  };
});

import { scheduleWithFsrs } from '../../src/review/fsrsScheduler';
import { MAX_NEXT_REVIEW_HORIZON_MS, type CardProgress } from '../../src/review/model';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

describe('scheduleWithFsrs: horizon guard beyond the model clamp', () => {
  it('caps an interval past the horizon on a reviewed card', () => {
    const start: CardProgress = {
      stableUid: 'uid-a',
      stage: 6,
      lastReviewedAt: T0,
      nextReviewAt: T0 + 60 * DAY_MS,
      lastSeenRevision: 1,
      fsrsStability: 60,
      fsrsDifficulty: 3,
      fsrsAnchorAt: T0,
    };
    const now = T0 + 60 * DAY_MS;
    const next = scheduleWithFsrs(start, 'easy', now);
    expect(next.nextReviewAt).toBe(now + MAX_NEXT_REVIEW_HORIZON_MS);
  });

  it('caps an interval past the horizon on a first review', () => {
    const start: CardProgress = { stableUid: 'uid-a', stage: 0, lastReviewedAt: undefined, nextReviewAt: 0, lastSeenRevision: 1 };
    const next = scheduleWithFsrs(start, 'easy', T0);
    expect(next.nextReviewAt).toBe(T0 + MAX_NEXT_REVIEW_HORIZON_MS);
  });
});
