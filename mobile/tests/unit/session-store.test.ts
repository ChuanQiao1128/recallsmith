import { beforeEach, describe, expect, it } from 'vitest';
import type { RoutePreviewNode } from '../../src/features/gacha/contracts';
import { resetSessionStore, useSessionStore } from '../../src/features/gacha/session/sessionStore';
import { EMPTY_REWARD_OUTCOME } from '../../src/features/gacha/rewards/rewardResolver';
import type { RatingRewardStep } from '../../src/features/gacha/rewards/sessionRewards';

const PAID_STEP: RatingRewardStep = {
  newCardPaid: true,
  dueClearPaid: false,
  pulls: 1,
  walletBefore: { availablePulls: 0, reservePulls: 0 },
  walletAfter: { availablePulls: 1, reservePulls: 0 },
  applied: { availablePulls: 1, reservePulls: 0, appliedToAvailable: 1, appliedToReserve: 0, dropped: 0 },
  newCardsLearnedToday: 1,
};

const ZERO_STEP: RatingRewardStep = {
  newCardPaid: false,
  dueClearPaid: false,
  pulls: 0,
  walletBefore: null,
  walletAfter: null,
  applied: null,
  newCardsLearnedToday: 0,
};

const routeNodes: RoutePreviewNode[] = [
  { id: 'warmup-0', role: 'warmup', title: 'Warm-up node', subtitle: 'Start easy' },
  { id: 'boss-1', role: 'boss', title: 'Boss check', subtitle: 'Finish strong' },
];

describe('sessionStore', () => {
  beforeEach(() => {
    resetSessionStore();
  });

  it('starts a session with route metadata and counters reset', () => {
    useSessionStore.getState().startSession({
      sessionId: 'sess-1',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 123,
    });

    const state = useSessionStore.getState();
    expect(state.sessionId).toBe('sess-1');
    expect(state.slug).toBe('csharp');
    expect(state.route).toEqual(routeNodes);
    expect(state.currentIndex).toBe(0);
    expect(state.completedCount).toBe(0);
    expect(state.streakEarned).toBe(false);
    expect(state.sessionRatings).toEqual([]);
    expect(state.startedAt).toBe(123);
  });

  it('records ratings, advances session progress, and earns streak on first non-again rating', () => {
    useSessionStore.getState().startSession({
      sessionId: 'sess-2',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 456,
    });

    useSessionStore.getState().recordRating({ stableUid: 'card-1', rating: 'again' });
    useSessionStore.getState().advanceSession();
    useSessionStore.getState().recordRating({ stableUid: 'card-2', rating: 'good' });
    useSessionStore.getState().advanceSession();

    const state = useSessionStore.getState();
    expect(state.currentIndex).toBe(2);
    expect(state.completedCount).toBe(2);
    expect(state.streakEarned).toBe(true);
    expect(state.sessionRatings).toEqual([
      { stableUid: 'card-1', rating: 'again' },
      { stableUid: 'card-2', rating: 'good' },
    ]);
  });

  it('resets back to the empty session state', () => {
    useSessionStore.getState().startSession({
      sessionId: 'sess-3',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 789,
    });

    resetSessionStore();
    const state = useSessionStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.slug).toBeNull();
    expect(state.route).toEqual([]);
    expect(state.currentIndex).toBe(0);
    expect(state.completedCount).toBe(0);
    expect(state.streakEarned).toBe(false);
    expect(state.sessionRatings).toEqual([]);
    expect(state.startedAt).toBeNull();
  });

  it('accumulates reward steps into the session outcome', () => {
    useSessionStore.getState().startSession({
      sessionId: 'sess-4',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 111,
    });

    useSessionStore.getState().recordRewardStep(PAID_STEP, 'card-1');
    useSessionStore.getState().recordRewardStep(ZERO_STEP, 'card-2');

    const outcome = useSessionStore.getState().rewardOutcome;
    expect(outcome.rewardPulls).toBe(1);
    expect(outcome.newCardUids).toEqual(['card-1']);

    // A fresh session clears the accumulated outcome.
    useSessionStore.getState().startSession({
      sessionId: 'sess-5',
      slug: 'csharp',
      route: routeNodes,
      startedAt: 222,
    });
    expect(useSessionStore.getState().rewardOutcome).toEqual(EMPTY_REWARD_OUTCOME);
  });
});
