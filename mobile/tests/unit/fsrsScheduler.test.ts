// scheduleWithFsrs: the app-level FSRS adapter (contract R24-00 §4.2).
//
// The memory model itself is pinned by fsrs.test.ts against ts-fsrs reference
// vectors; this file pins what the adapter adds on top: which memory state a
// progress row stands for, the 10 minute relearn step, the ladder fields old
// clients and the server still read, the learning check, the horizon cap and
// the kill switch.
import { afterEach, describe, expect, it } from 'vitest';

import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import { initState, nextState, type FsrsGrade } from '../../src/review/fsrs';
import { scheduleWithFsrs } from '../../src/review/fsrsScheduler';
import {
  MAX_NEXT_REVIEW_HORIZON_MS,
  inferStageFromIntervalMs,
  scheduleNextReview,
  type CardProgress,
  type ReviewRating,
} from '../../src/review/model';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
const GRADE: Record<ReviewRating, FsrsGrade> = { again: 1, hard: 2, good: 3, easy: 4 };

function fresh(): CardProgress {
  return { stableUid: 'uid-a', stage: 0, lastReviewedAt: undefined, nextReviewAt: 0, lastSeenRevision: 1 };
}

/** A card first reviewed `good` at T0 by this device: state anchored to T0. */
function reviewedGoodAtT0(): CardProgress {
  return {
    stableUid: 'uid-a',
    stage: 1,
    lastReviewedAt: T0,
    nextReviewAt: T0 + 3 * DAY_MS,
    lastSeenRevision: 1,
    lapses: 0,
    hardStreak: 0,
    fsrsStability: initState(3).stability,
    fsrsDifficulty: initState(3).difficulty,
    fsrsAnchorAt: T0,
  };
}

afterEach(() => {
  applyRemoteFeatures(null);
});

describe('scheduleWithFsrs: a never reviewed card', () => {
  const cases: Array<[ReviewRating, number, number, number]> = [
    // rating, stability, difficulty, stage
    ['again', 0.4026, 7.1949, 0],
    ['hard', 1.1839, 6.4883, 1],
    ['good', 3.173, 5.2824, 1],
    ['easy', 15.6911, 3.2245, 4],
  ];

  it.each(cases)('%s starts from initState', (rating, s, d, stage) => {
    const next = scheduleWithFsrs(fresh(), rating, T0);
    expect(next.fsrsStability).toBeCloseTo(s, 4);
    expect(next.fsrsDifficulty).toBeCloseTo(d, 4);
    expect(next.fsrsAnchorAt).toBe(T0);
    expect(next.lastReviewedAt).toBe(T0);
    expect(next.stage).toBe(stage);
    const expectedDue = rating === 'again' ? T0 + 10 * MINUTE_MS : T0 + initState(GRADE[rating]).days * DAY_MS;
    expect(next.nextReviewAt).toBe(expectedDue);
  });

  it('schedules 1, 2, 3 and 16 days for hard, good, easy (again stays 10 minutes)', () => {
    expect(scheduleWithFsrs(fresh(), 'hard', T0).nextReviewAt).toBe(T0 + 2 * DAY_MS);
    expect(scheduleWithFsrs(fresh(), 'good', T0).nextReviewAt).toBe(T0 + 3 * DAY_MS);
    expect(scheduleWithFsrs(fresh(), 'easy', T0).nextReviewAt).toBe(T0 + 16 * DAY_MS);
    expect(scheduleWithFsrs(fresh(), 'again', T0).nextReviewAt).toBe(T0 + 10 * MINUTE_MS);
  });
});

describe('scheduleWithFsrs: a reviewed card with its own anchored state', () => {
  it('reviewed on the due day matches the reference sequence (S 10.7389, 11 days)', () => {
    const now = T0 + 3 * DAY_MS;
    const next = scheduleWithFsrs(reviewedGoodAtT0(), 'good', now);
    expect(next.fsrsStability).toBeCloseTo(10.7389, 4);
    expect(next.fsrsDifficulty).toBeCloseTo(5.273, 4);
    expect(next.nextReviewAt).toBe(now + 11 * DAY_MS);
    expect(next.stage).toBe(3); // 8 <= 11 < 15
    expect(next.fsrsAnchorAt).toBe(now);
    expect(next.lastReviewedAt).toBe(now);
  });

  it('uses the real elapsed days: late grows stability more, early grows it less', () => {
    const onTime = scheduleWithFsrs(reviewedGoodAtT0(), 'good', T0 + 3 * DAY_MS);
    const late = scheduleWithFsrs(reviewedGoodAtT0(), 'good', T0 + 10 * DAY_MS);
    const early = scheduleWithFsrs(reviewedGoodAtT0(), 'good', T0 + 1 * DAY_MS);

    const state = { stability: initState(3).stability, difficulty: initState(3).difficulty };
    expect(late.fsrsStability).toBeCloseTo(nextState(state, 3, 10).stability, 10);
    expect(early.fsrsStability).toBeCloseTo(nextState(state, 3, 1).stability, 10);
    expect(late.fsrsStability!).toBeGreaterThan(onTime.fsrsStability!);
    expect(early.fsrsStability!).toBeLessThan(onTime.fsrsStability!);
    expect(late.nextReviewAt - (T0 + 10 * DAY_MS)).toBe(nextState(state, 3, 10).days * DAY_MS);
    expect(early.nextReviewAt - (T0 + 1 * DAY_MS)).toBe(nextState(state, 3, 1).days * DAY_MS);
  });

  it('again keeps the 10 minute relearn step, drops two rungs and counts a lapse', () => {
    const start = { ...reviewedGoodAtT0(), stage: 5, lapses: 1 };
    const now = T0 + 3 * DAY_MS;
    const next = scheduleWithFsrs(start, 'again', now);
    expect(next.nextReviewAt).toBe(now + 10 * MINUTE_MS);
    expect(next.stage).toBe(3);
    expect(next.lapses).toBe(2);
    expect(next.hardStreak).toBe(0);
    const expected = nextState({ stability: initState(3).stability, difficulty: initState(3).difficulty }, 1, 3);
    expect(next.fsrsStability).toBeCloseTo(expected.stability, 10);
    expect(next.fsrsDifficulty).toBeCloseTo(expected.difficulty, 10);
  });

  it('updates hardStreak exactly as the ladder does (third hard resets it)', () => {
    let p: CardProgress = { ...reviewedGoodAtT0(), hardStreak: 1 };
    p = scheduleWithFsrs(p, 'hard', T0 + 3 * DAY_MS);
    expect(p.hardStreak).toBe(2);
    p = scheduleWithFsrs(p, 'hard', p.nextReviewAt);
    expect(p.hardStreak).toBe(0);
    p = scheduleWithFsrs(p, 'good', p.nextReviewAt);
    expect(p.hardStreak).toBe(0);
    expect(p.lapses).toBe(0);
  });

  it('clears revisionDemotedAt and keeps unrelated fields', () => {
    const start = { ...reviewedGoodAtT0(), revisionDemotedAt: T0 + DAY_MS, lastSeenRevision: 4 };
    const next = scheduleWithFsrs(start, 'good', T0 + 3 * DAY_MS);
    expect(next.revisionDemotedAt).toBeUndefined();
    expect(next.lastSeenRevision).toBe(4);
    expect(next.stableUid).toBe('uid-a');
  });
});

describe('scheduleWithFsrs: missing or stale memory state', () => {
  it('derives S from the scheduled interval and D from lapses and hardStreak when the anchor is stale', () => {
    // Another device reviewed the card at T0 (anchor still says T0 - 20 days).
    const start: CardProgress = {
      stableUid: 'uid-a',
      stage: 3,
      lastReviewedAt: T0,
      nextReviewAt: T0 + 8 * DAY_MS,
      lapses: 2,
      hardStreak: 1,
      fsrsStability: 40,
      fsrsDifficulty: 2,
      fsrsAnchorAt: T0 - 20 * DAY_MS,
    };
    const now = T0 + 8 * DAY_MS;
    const next = scheduleWithFsrs(start, 'good', now);
    const expected = nextState({ stability: 8, difficulty: 6.3 }, 3, 8);
    expect(next.fsrsStability).toBeCloseTo(expected.stability, 10);
    expect(next.fsrsDifficulty).toBeCloseTo(expected.difficulty, 10);
    expect(next.nextReviewAt).toBe(now + expected.days * DAY_MS);
    expect(next.fsrsAnchorAt).toBe(now);
  });

  it('derives the same state when the fields are missing entirely (pre-FSRS row)', () => {
    const start: CardProgress = {
      stableUid: 'uid-a',
      stage: 3,
      lastReviewedAt: T0,
      nextReviewAt: T0 + 8 * DAY_MS,
      lapses: 2,
      hardStreak: 1,
    };
    const next = scheduleWithFsrs(start, 'good', T0 + 8 * DAY_MS);
    expect(next.fsrsStability).toBeCloseTo(nextState({ stability: 8, difficulty: 6.3 }, 3, 8).stability, 10);
  });

  it('floors the derived stability at half a day (a card left on the 10 minute step)', () => {
    const start: CardProgress = {
      stableUid: 'uid-a',
      stage: 0,
      lastReviewedAt: T0,
      nextReviewAt: T0 + 10 * MINUTE_MS,
      lapses: 1,
    };
    const now = T0 + DAY_MS;
    const next = scheduleWithFsrs(start, 'good', now);
    const expected = nextState({ stability: 0.5, difficulty: 5.5 }, 3, 1);
    expect(next.fsrsStability).toBeCloseTo(expected.stability, 10);
    expect(next.fsrsDifficulty).toBeCloseTo(expected.difficulty, 10);
  });

  it('falls back to the ladder interval of the stage when nextReviewAt is not set', () => {
    const start: CardProgress = { stableUid: 'uid-a', stage: 4, lastReviewedAt: T0, nextReviewAt: 0 };
    const now = T0 + 15 * DAY_MS;
    const next = scheduleWithFsrs(start, 'good', now);
    const expected = nextState({ stability: 15, difficulty: 5 }, 3, 15);
    expect(next.fsrsStability).toBeCloseTo(expected.stability, 10);
  });

  it('clamps the derived difficulty to 10', () => {
    const start: CardProgress = {
      stableUid: 'uid-a',
      stage: 2,
      lastReviewedAt: T0,
      nextReviewAt: T0 + 4 * DAY_MS,
      lapses: 30,
    };
    const next = scheduleWithFsrs(start, 'good', T0 + 4 * DAY_MS);
    const expected = nextState({ stability: 4, difficulty: 10 }, 3, 4);
    expect(next.fsrsDifficulty).toBeCloseTo(expected.difficulty, 10);
  });
});

describe('scheduleWithFsrs: ladder stage mapping', () => {
  it('maps the interval to the largest ladder rung not above it', () => {
    // 15+ days lands on stage 4, which mastery counts as mastered.
    expect(scheduleWithFsrs(fresh(), 'easy', T0).stage).toBe(4);
    for (const days of [1, 2, 3, 4, 7, 8, 14, 15, 29, 30, 59, 60, 90]) {
      expect(inferStageFromIntervalMs(days * DAY_MS)).toBe(
        [1, 2, 4, 8, 15, 30, 60].filter((rung) => rung <= days).length - 1,
      );
    }
  });

  it('every non-again result has a stage that matches its interval', () => {
    const ratings: ReviewRating[] = ['hard', 'good', 'easy'];
    for (const rating of ratings) {
      const now = T0 + 3 * DAY_MS;
      const next = scheduleWithFsrs(reviewedGoodAtT0(), rating, now);
      expect(next.stage).toBe(inferStageFromIntervalMs(next.nextReviewAt - now));
    }
  });
});

describe('scheduleWithFsrs: learning check', () => {
  it('stores initState(hard) and promises tomorrow', () => {
    const next = scheduleWithFsrs(fresh(), 'hard', T0, { learningCheck: true });
    expect(next.fsrsStability).toBeCloseTo(1.1839, 4);
    expect(next.fsrsDifficulty).toBeCloseTo(6.4883, 4);
    expect(next.fsrsAnchorAt).toBe(T0);
    expect(next.nextReviewAt).toBe(T0 + DAY_MS);
    expect(next.lastReviewedAt).toBe(T0);
    expect(next.stage).toBe(0);
  });

  it('uses initState(hard) even on a card that already has state', () => {
    const now = T0 + 3 * DAY_MS;
    const next = scheduleWithFsrs(reviewedGoodAtT0(), 'hard', now, { learningCheck: true });
    expect(next.fsrsStability).toBeCloseTo(1.1839, 4);
    expect(next.nextReviewAt).toBe(now + DAY_MS);
  });
});

describe('scheduleWithFsrs: horizon cap', () => {
  it('never schedules beyond MAX_NEXT_REVIEW_HORIZON_MS', () => {
    const start: CardProgress = {
      ...reviewedGoodAtT0(),
      fsrsStability: 85,
      fsrsDifficulty: 3,
      nextReviewAt: T0 + 85 * DAY_MS,
    };
    const now = T0 + 85 * DAY_MS;
    const next = scheduleWithFsrs(start, 'easy', now);
    expect(next.nextReviewAt - now).toBeLessThanOrEqual(MAX_NEXT_REVIEW_HORIZON_MS);
    expect(next.nextReviewAt).toBe(now + 90 * DAY_MS);
    expect(next.stage).toBe(6);
  });

  it('caps a broken clock far in the past too (elapsed huge, interval still capped)', () => {
    const start: CardProgress = { ...reviewedGoodAtT0(), fsrsStability: 500, fsrsDifficulty: 1 };
    const now = T0 + 3000 * DAY_MS;
    const next = scheduleWithFsrs(start, 'easy', now);
    expect(next.nextReviewAt).toBeLessThanOrEqual(now + MAX_NEXT_REVIEW_HORIZON_MS);
  });
});

describe('scheduleWithFsrs: kill switch features.fsrs.enabled', () => {
  const off = () => applyRemoteFeatures({ features: { fsrs: { enabled: false } } } as unknown as RemoteConfig);

  it('is on by default', () => {
    expect(scheduleWithFsrs(fresh(), 'good', T0).fsrsAnchorAt).toBe(T0);
  });

  it('off -> exactly the ladder result, for every rating', () => {
    off();
    const ratings: ReviewRating[] = ['again', 'hard', 'good', 'easy'];
    for (const rating of ratings) {
      const start = reviewedGoodAtT0();
      const now = T0 + 3 * DAY_MS;
      expect(scheduleWithFsrs(start, rating, now)).toEqual(scheduleNextReview(start, rating, new Date(now)));
    }
  });

  it('off -> the learning check is the ladder too', () => {
    off();
    expect(scheduleWithFsrs(fresh(), 'hard', T0, { learningCheck: true })).toEqual(
      scheduleNextReview(fresh(), 'hard', new Date(T0)),
    );
  });

  it('a non-boolean remote value keeps FSRS on', () => {
    applyRemoteFeatures({ features: { fsrs: { enabled: 'no' } } } as unknown as RemoteConfig);
    expect(scheduleWithFsrs(fresh(), 'good', T0).fsrsAnchorAt).toBe(T0);
  });
});
