// F03 (contract R24-00 §4.3): every review goes through scheduleWithFsrs while
// features.fsrs.enabled is on, the exam cap still wraps the result, and the
// ladder comes back exactly when the flag is off.
import { afterEach, describe, expect, it } from 'vitest';

import { applyRemoteFeatures } from '../../src/config/featureFlags';
import type { RemoteConfig } from '../../src/config/remoteConfig';
import { scheduleFocusReview } from '../../src/features/gacha/mistakes/focusSession';
import { describeScheduledRating } from '../../src/features/gacha/mcq/mcqVerdict';
import { examReviewCapMs } from '../../src/features/goal/studyGoal';
import { buildRatedSessionState } from '../../src/features/gacha/session/sessionReviewHelpers';
import { scheduleWithFsrs } from '../../src/review/fsrsScheduler';
import { scheduleNextReview, type CardProgress, type ReviewRating } from '../../src/review/model';
import type { CardExport } from '../../src/types/deckExport';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const T = Date.UTC(2026, 9, 1, 9, 0, 0);
const now = new Date(T);

const flagOff = () => applyRemoteFeatures({ features: { fsrs: { enabled: false } } } as unknown as RemoteConfig);

afterEach(() => {
  applyRemoteFeatures(null);
});

function card(uid: string): CardExport {
  return { StableUid: uid, OrderInDeck: 1, Difficulty: 1, Question: `Q ${uid}` };
}

function fresh(uid = 'a'): CardProgress {
  return { stableUid: uid, stage: 0, nextReviewAt: 0 };
}

function rate(
  progress: CardProgress,
  rating: ReviewRating,
  extra: { learningCheck?: boolean; focusRun?: boolean; examDate?: string | null } = {},
) {
  return buildRatedSessionState({
    current: { card: card(progress.stableUid), progress },
    progress: [progress],
    rating,
    mode: 'mixed',
    sessionDone: 0,
    sessionLimit: 5,
    now,
    cardIndex: null,
    ...extra,
  }).updatedOne;
}

describe('buildRatedSessionState schedules with FSRS', () => {
  it('a first Good is the FSRS first interval (3 days), with the memory state stored', () => {
    const next = rate(fresh(), 'good');
    expect(next.nextReviewAt).toBe(T + 3 * DAY_MS);
    expect(next.fsrsStability).toBeCloseTo(3.173, 4);
    expect(next.fsrsDifficulty).toBeCloseTo(5.2824, 4);
    expect(next.fsrsAnchorAt).toBe(T);
    expect(next).toMatchObject({ ...scheduleWithFsrs(fresh(), 'good', T), lastSeenRevision: 1 });
  });

  it('a passed learning check (hard) is initState(hard) and due tomorrow', () => {
    const next = rate(fresh(), 'hard', { learningCheck: true });
    expect(next.nextReviewAt).toBe(T + DAY_MS);
    expect(next.stage).toBe(0);
    expect(next.fsrsStability).toBeCloseTo(1.1839, 4);
    expect(next.fsrsDifficulty).toBeCloseTo(6.4883, 4);
  });

  it('a failed learning check (again) keeps the 10 minute relearn step', () => {
    const next = rate(fresh(), 'again', { learningCheck: true });
    expect(next.nextReviewAt).toBe(T + 10 * MINUTE_MS);
    expect(next.lapses).toBe(1);
  });

  it('an ordinary hard is not treated as a learning check', () => {
    expect(rate(fresh(), 'hard').nextReviewAt).toBe(T + 2 * DAY_MS);
  });

  it('the exam cap still wraps the FSRS result', () => {
    // Exam on 2026-10-04: no review after the start of 2026-10-03 (local day), before the FSRS 3 days.
    const next = rate(fresh(), 'good', { examDate: '2026-10-04' });
    expect(next.nextReviewAt).toBe(examReviewCapMs('2026-10-04', T));
    expect(next.nextReviewAt).toBeLessThan(T + 3 * DAY_MS);
    expect(next.fsrsStability).toBeCloseTo(3.173, 4);
    expect(next.fsrsAnchorAt).toBe(T);
  });

  it('flag off -> the ladder, exactly as before FSRS', () => {
    flagOff();
    const next = rate(fresh(), 'good');
    expect(next).toEqual({ ...scheduleNextReview(fresh(), 'good', now), lastSeenRevision: 1 });
    expect(next.nextReviewAt).toBe(T + 2 * DAY_MS);
    expect(next.fsrsAnchorAt).toBeUndefined();
    // The learning check is the ladder's hard too.
    expect(rate(fresh(), 'hard', { learningCheck: true }).nextReviewAt).toBe(T + DAY_MS);
  });
});

describe('scheduleFocusReview falls back to FSRS for a due card', () => {
  const due: CardProgress = { stableUid: 'b', stage: 1, lastReviewedAt: T - 2 * DAY_MS, nextReviewAt: T - 1000 };

  it('flag on -> scheduleWithFsrs', () => {
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      expect(scheduleFocusReview(due, rating, now)).toEqual(scheduleWithFsrs(due, rating, T));
    }
  });

  it('flag off -> scheduleNextReview', () => {
    flagOff();
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      expect(scheduleFocusReview(due, rating, now)).toEqual(scheduleNextReview(due, rating, now));
    }
  });
});

describe('describeScheduledRating previews FSRS by default', () => {
  it('flag on -> a first Good reads 3 days', () => {
    const { after, line } = describeScheduledRating(fresh(), 'good', now);
    expect(after).toEqual(scheduleWithFsrs(fresh(), 'good', T));
    expect(line).toBe('Scheduled as Good · back in 3 days');
  });

  it('flag off -> the ladder preview (2 days)', () => {
    flagOff();
    const { after, line } = describeScheduledRating(fresh(), 'good', now);
    expect(after).toEqual(scheduleNextReview(fresh(), 'good', now));
    expect(line).toBe('Scheduled as Good · back in 2 days');
  });
});
