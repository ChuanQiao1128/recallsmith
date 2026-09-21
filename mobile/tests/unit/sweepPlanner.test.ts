import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { countLearned, pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';
import { buildSweepRoute } from '../../src/features/gacha/planner/sessionBuilder';
import { buildRatedSessionState, modeLabel } from '../../src/features/gacha/session/sessionReviewHelpers';
import { scheduleNextReview } from '../../src/review/model';
import type { ReviewRating } from '../../src/review/model';
import { SESSION_MAIN_ROUTE_DEFAULT, SWEEP_SPREAD_DAYS } from '../../src/features/gacha/constants';
import {
  accumulateRewardOutcome,
  EMPTY_REWARD_OUTCOME,
  resolveSessionReward,
} from '../../src/features/gacha/rewards/rewardResolver';
import { ZERO_REWARD_STEP } from '../../src/features/gacha/rewards/sessionRewards';

// Sweep ordering never reads the clock, so a single fixed `now` is enough; the
// learned lastReviewedAt values stay strictly below it and both due and not-due
// learned cards occur (nextReviewAt is placed either side of `now`).
const NOW_MS = 2_500_000_000_000;
const NOW = new Date(NOW_MS);
const DAY = 86_400_000;

type Fixture = {
  deck: any;
  progress: any[];
  ownedSet: Set<string> | null;
};

const cardSpecArb = fc.record({
  difficulty: fc.integer({ min: 1, max: 3 }),
  prog: fc.oneof(
    fc.record({ kind: fc.constant('new' as const) }),
    fc.record({
      kind: fc.constant('learned' as const),
      stage: fc.integer({ min: 0, max: 6 }),
      lastReviewedAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
      due: fc.boolean(),
    }),
  ),
});

const fixtureArb: fc.Arbitrary<Fixture> = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc.record({
      specs: fc.array(cardSpecArb, { minLength: n, maxLength: n }),
      orders: fc.shuffledSubarray(
        Array.from({ length: n }, (_, i) => i + 1),
        { minLength: n, maxLength: n },
      ),
      ownedPick: fc.subarray(Array.from({ length: n }, (_, i) => `c${i}`)),
      gated: fc.boolean(),
    }),
  )
  .map(({ specs, orders, ownedPick, gated }) => {
    const cards = specs.map((spec, i) => ({
      StableUid: `c${i}`,
      OrderInDeck: orders[i],
      Difficulty: spec.difficulty,
      Question: `Q${i}`,
      Revision: 1,
    }));
    const progress = specs.map((spec, i) => {
      if (spec.prog.kind === 'new') {
        return { stableUid: `c${i}`, stage: 0, nextReviewAt: 0 };
      }
      return {
        stableUid: `c${i}`,
        stage: spec.prog.stage,
        lastReviewedAt: spec.prog.lastReviewedAt,
        nextReviewAt: spec.prog.due ? NOW_MS - DAY : NOW_MS + 5 * DAY,
        lastSeenRevision: 1,
      };
    });
    const deck = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Locale: 'en-US',
      Version: '1',
      DeckType: 1,
      TotalCards: cards.length,
      Cards: cards,
    };
    const ownedSet = gated ? new Set(ownedPick) : null;
    return { deck: deck as any, progress: progress as any, ownedSet };
  });

const isLearned = (p: any) => typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0;

function expectedSweepOrder(fixture: Fixture): string[] {
  const { deck, progress, ownedSet } = fixture;
  const owns = (uid: string) => ownedSet === null || ownedSet.has(uid);
  const byUid = new Map<string, any>(deck.Cards.map((c: any) => [c.StableUid, c]));
  return progress
    .filter((p) => owns(p.stableUid) && isLearned(p))
    .slice()
    .sort(
      (a, b) => a.lastReviewedAt - b.lastReviewedAt || byUid.get(a.stableUid).OrderInDeck - byUid.get(b.stableUid).OrderInDeck,
    )
    .map((p) => p.stableUid);
}

describe('sweep planner', () => {
  it('orders a sweep by longest-unseen first over owned learned cards only', () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        const { deck, progress, ownedSet } = fixture;
        const owns = (uid: string) => ownedSet === null || ownedSet.has(uid);
        const expected = expectedSweepOrder(fixture);
        const picked = pickNextCard({ deck, progress, now: NOW, mode: 'sweep', ownedSet });

        if (expected.length === 0) {
          expect(picked).toBeNull();
          return;
        }
        expect(picked).not.toBeNull();
        expect(picked!.card.StableUid).toBe(expected[0]);
        expect(isLearned(picked!.progress)).toBe(true);
        expect(owns(picked!.card.StableUid)).toBe(true);
      }),
    );
  });

  it('walks the whole learned set once in lastReviewedAt order when each pick is rated', () => {
    fc.assert(
      fc.property(fixtureArb, fc.constantFrom<ReviewRating>('again', 'hard', 'good', 'easy'), (fixture, rating) => {
        const { deck, ownedSet } = fixture;
        const expected = expectedSweepOrder(fixture);
        const learnedCount = countLearned(fixture.progress, ownedSet);
        expect(learnedCount).toBe(expected.length);

        let working = fixture.progress.map((p) => ({ ...p }));
        let prevUid: string | null = null;
        const walked: string[] = [];
        for (let i = 0; i < learnedCount; i += 1) {
          const now = new Date(2_000_000_000_000 + 1 + i);
          const picked = pickNextCard({ deck, progress: working, now, mode: 'sweep', avoidUid: prevUid, ownedSet });
          expect(picked).not.toBeNull();
          walked.push(picked!.card.StableUid);
          const rated = { ...scheduleNextReview(picked!.progress, rating, now) };
          working = working.map((p) => (p.stableUid === picked!.card.StableUid ? rated : p));
          prevUid = picked!.card.StableUid;
        }

        expect(walked).toEqual(expected);
        expect(new Set(walked).size).toBe(walked.length);
      }),
    );
  });

  it('ignores the due bucket in sweep mode', () => {
    const deck = {
      Slug: 'csharp',
      Title: 'C# Interview',
      Locale: 'en-US',
      Version: '1',
      DeckType: 1,
      TotalCards: 2,
      Cards: [
        { StableUid: 'due', OrderInDeck: 1, Difficulty: 1, Question: 'Qd', Revision: 1 },
        { StableUid: 'old', OrderInDeck: 2, Difficulty: 1, Question: 'Qo', Revision: 1 },
      ],
    } as any;
    const progress = [
      { stableUid: 'due', stage: 2, lastReviewedAt: 2_000_000_000_000, nextReviewAt: NOW_MS - DAY, lastSeenRevision: 1 },
      { stableUid: 'old', stage: 2, lastReviewedAt: 1_000_000_000_000, nextReviewAt: NOW_MS + 5 * DAY, lastSeenRevision: 1 },
    ] as any;

    expect(pickNextCard({ deck, progress, now: NOW, mode: 'sweep' })?.card.StableUid).toBe('old');
    expect(pickNextCard({ deck, progress, now: NOW, mode: 'review-due' })?.card.StableUid).toBe('due');
  });

  it('spreads the learned count over SWEEP_SPREAD_DAYS days and caps a run at five', () => {
    expect(SWEEP_SPREAD_DAYS).toBe(7);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (learnedCount) => {
        const route = buildSweepRoute({ slug: 'csharp', deckTitle: 'C# Interview', learnedCount, dueCount: 0, newCount: 0 });
        const dailyTarget = Math.ceil(learnedCount / SWEEP_SPREAD_DAYS);
        // Nothing learned → empty route (limit 0, no nodes), never a one-node run over nothing.
        const expectedLimit = learnedCount > 0 ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, dailyTarget)) : 0;
        expect(route.limit).toBe(expectedLimit);
        expect(route.mode).toBe('sweep');
        expect(route.minimumGoal).toBe(1);
        expect(route.nodes.length).toBe(route.limit);
        if (learnedCount > 0) {
          expect(route.nodes[0].role).toBe('warmup');
          expect(route.summary).toContain(`about ${dailyTarget} a day for 7 days`);
        } else {
          expect(route.summary).toMatch(/no learned cards/i);
        }
        expect(route.nodes.some((node) => node.role === 'elite' || node.role === 'boss')).toBe(false);
      }),
    );
  });

  it('plans a sweep route from deck progress and leaves the other modes untouched', () => {
    fc.assert(
      fc.property(fixtureArb, ({ deck, progress, ownedSet }) => {
        const learnedCount = countLearned(progress, ownedSet);
        const expectedLimit =
          learnedCount > 0 ? Math.max(1, Math.min(SESSION_MAIN_ROUTE_DEFAULT, Math.ceil(learnedCount / SWEEP_SPREAD_DAYS))) : 0;

        const sweep = planChallengeRoute({ deck, progress, now: NOW, mode: 'sweep', ownedSet });
        const plain = planChallengeRoute({ deck, progress, now: NOW, ownedSet });
        const mixed = planChallengeRoute({ deck, progress, now: NOW, ownedSet, mode: 'mixed' });

        expect(sweep.mode).toBe('sweep');
        expect(sweep.limit).toBe(expectedLimit);
        expect(sweep.dueCount).toBe(plain.dueCount);
        expect(sweep.newCount).toBe(plain.newCount);
        expect(plain).toEqual(mixed);
        expect(mixed.mode).toBe('mixed');
      }),
    );
  });

  it('reschedules a sweep rating exactly like any other mode', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ReviewRating>('again', 'hard', 'good', 'easy'),
        fc.integer({ min: 0, max: 6 }),
        (rating, stage) => {
          const card = { StableUid: 'c0', OrderInDeck: 1, Difficulty: 1, Question: 'Q0', Revision: 1 };
          const cardProgress = {
            stableUid: 'c0',
            stage,
            lastReviewedAt: 1_500_000_000_000,
            nextReviewAt: NOW_MS - DAY,
            lastSeenRevision: 1,
          };
          const progress = [cardProgress] as any;
          const cardIndex = { cards: [card], cardMap: new Map([['c0', card]]) } as any;
          const base = {
            current: { card, progress: cardProgress } as any,
            progress,
            rating,
            sessionDone: 0,
            sessionLimit: 5,
            now: NOW,
            cardIndex,
            ownedSet: null,
          };

          const sweep = buildRatedSessionState({ ...base, mode: 'sweep' as const });
          const mixed = buildRatedSessionState({ ...base, mode: 'mixed' as const });
          const expected = { ...scheduleNextReview(cardProgress, rating, NOW), lastSeenRevision: 1 };

          expect(sweep.updatedOne).toEqual(expected);
          expect(sweep.updatedOne).toEqual(mixed.updatedOne);
          expect(sweep.remainingDueCount).toBe(mixed.remainingDueCount);
        },
      ),
    );
  });

  it('a full sweep run resolves to zero pulls and leaves the wallet untouched', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).chain((limit) =>
          fc.record({
            limit: fc.constant(limit),
            sessionDone: fc.integer({ min: 0, max: limit }),
            availablePulls: fc.integer({ min: 0, max: 60 }),
            reservePulls: fc.integer({ min: 0, max: 5 }),
          }),
        ),
        ({ limit, sessionDone, availablePulls, reservePulls }) => {
          const wallet = { availablePulls, reservePulls };
          let outcome = EMPTY_REWARD_OUTCOME;
          for (let k = 0; k < sessionDone; k += 1) {
            outcome = accumulateRewardOutcome(outcome, { ...ZERO_REWARD_STEP, newCardsLearnedToday: k }, `c${k}`);
          }

          const resolved = resolveSessionReward({ sessionDone, sessionLimit: limit, minimumGoal: 1, wallet, reward: outcome });

          expect(resolved.rewardPulls).toBe(0);
          expect(resolved.walletAfter.availablePulls).toBe(wallet.availablePulls);
          expect(resolved.walletAfter.reservePulls).toBe(wallet.reservePulls);
          expect(outcome.newCardPulls).toBe(0);
        },
      ),
    );
  });

  it('labels sweep mode Review all', () => {
    expect(modeLabel('sweep')).toBe('Review all');
    expect(modeLabel('review-due')).toBe('Review Due');
    expect(modeLabel('learn-new')).toBe('Learn');
    expect(modeLabel('mixed')).toBe('Mixed');
  });
});
