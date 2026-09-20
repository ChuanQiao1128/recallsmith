import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  FORECAST_START,
  FORECAST_STEP,
  computeTomorrowLoad,
  forecastLine,
  type TomorrowLoad,
} from '../../src/features/gacha/planner/loadForecast';
import { buildUpcoming } from '../../src/features/gacha/selectors/progressSelectors';
import type { CardProgress } from '../../src/review/model';

// Fixed local NOW so the today/tomorrow day boundaries are deterministic.
const NOW = new Date(2026, 3, 23, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

const progressArb = fc.array(
  fc.record({
    stableUid: fc.string({ minLength: 1, maxLength: 8 }),
    stage: fc.integer({ min: 0, max: 6 }),
    lastReviewedAt: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: NOW.getTime() })),
    nextReviewAt: fc.integer({ min: NOW.getTime() - 3 * DAY_MS, max: NOW.getTime() + 3 * DAY_MS }),
  }),
  { maxLength: 40 },
) as fc.Arbitrary<CardProgress[]>;

describe('computeTomorrowLoad / forecastLine', () => {
  it('flags a milestone at 20 and at every 10th new card after it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), (k) =>
        computeTomorrowLoad({
          progress: [],
          now: NOW,
          newCardsLearnedToday: FORECAST_START + k * FORECAST_STEP,
        }).milestone === true,
      ),
    );
  });

  it('never flags a milestone below 20 or between steps', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 2000 }), (n) => {
        const milestone = computeTomorrowLoad({ progress: [], now: NOW, newCardsLearnedToday: n }).milestone;
        return milestone === (n >= FORECAST_START && (n - FORECAST_START) % FORECAST_STEP === 0);
      }),
    );
    const flagOf = (n: number) =>
      computeTomorrowLoad({ progress: [], now: NOW, newCardsLearnedToday: n }).milestone;
    for (const n of [0, 1, 19, 21, 29, 31]) expect(flagOf(n)).toBe(false);
    for (const n of [20, 30, 40, 100]) expect(flagOf(n)).toBe(true);
  });

  it("reads tomorrow's due count off the two-day calendar", () => {
    fc.assert(
      fc.property(progressArb, (progress) => {
        const load = computeTomorrowLoad({ progress, now: NOW, newCardsLearnedToday: 0 });
        return load.tomorrowDue === buildUpcoming(progress, NOW, 2)[1].count;
      }),
    );

    const fixture: CardProgress[] = [
      { stableUid: 'due-tomorrow', stage: 3, lastReviewedAt: NOW.getTime() - DAY_MS, nextReviewAt: NOW.getTime() + DAY_MS },
      { stableUid: 'due-today', stage: 3, lastReviewedAt: NOW.getTime() - DAY_MS, nextReviewAt: NOW.getTime() },
      { stableUid: 'overdue', stage: 3, lastReviewedAt: NOW.getTime() - 2 * DAY_MS, nextReviewAt: NOW.getTime() - DAY_MS },
      { stableUid: 'new', stage: 0, nextReviewAt: 0 },
      { stableUid: 'due-in-5', stage: 3, lastReviewedAt: NOW.getTime() - DAY_MS, nextReviewAt: NOW.getTime() + 5 * DAY_MS },
    ];
    expect(computeTomorrowLoad({ progress: fixture, now: NOW, newCardsLearnedToday: 0 }).tomorrowDue).toBe(1);
  });

  it('counts only owned cards when a gate is passed', () => {
    const twoDueTomorrow: CardProgress[] = [
      { stableUid: 'owned', stage: 3, lastReviewedAt: NOW.getTime() - DAY_MS, nextReviewAt: NOW.getTime() + DAY_MS },
      { stableUid: 'unowned', stage: 3, lastReviewedAt: NOW.getTime() - DAY_MS, nextReviewAt: NOW.getTime() + DAY_MS },
    ];
    expect(
      computeTomorrowLoad({ progress: twoDueTomorrow, now: NOW, ownedSet: null, newCardsLearnedToday: 0 }).tomorrowDue,
    ).toBe(2);
    expect(
      computeTomorrowLoad({
        progress: twoDueTomorrow,
        now: NOW,
        ownedSet: new Set(['owned']),
        newCardsLearnedToday: 0,
      }).tomorrowDue,
    ).toBe(1);
  });

  it('says nothing off a milestone', () => {
    fc.assert(
      fc.property(progressArb, fc.integer({ min: 0, max: 500 }), (progress, n) => {
        const load = computeTomorrowLoad({ progress, now: NOW, newCardsLearnedToday: n });
        const line = forecastLine(load);
        return load.milestone ? typeof line === 'string' : line === null;
      }),
    );
  });

  it('pins the forecast copy for zero, one and many cards', () => {
    const withDue = (tomorrowDue: number): TomorrowLoad => ({
      newCardsLearnedToday: FORECAST_START,
      tomorrowDue,
      milestone: true,
    });
    expect(forecastLine(withDue(0))).toBe('At this pace, about 0 cards come due tomorrow.');
    expect(forecastLine(withDue(1))).toBe('At this pace, about 1 card comes due tomorrow.');
    expect(forecastLine(withDue(12))).toBe('At this pace, about 12 cards come due tomorrow.');
    expect(FORECAST_START).toBe(20);
    expect(FORECAST_STEP).toBe(10);
  });
});
