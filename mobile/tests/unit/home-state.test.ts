import { describe, expect, it } from 'vitest';
import { resolveHomeState } from '../../src/features/gacha/home/homeStateMachine';
import { buildHomeVM } from '../../src/features/gacha/selectors/homeSelectors';
import type { DeckSummary } from '../../src/features/gacha/contracts';

function makeDeck(overrides: Partial<DeckSummary> = {}): DeckSummary {
  return {
    slug: 'csharp',
    title: 'C# Interview',
    locale: 'en-US',
    version: '1',
    deckType: 1,
    totalCards: 50,
    localCards: 50,
    studyCards: 50,
    canStudy: true,
    dueToday: 3,
    plannedToday: 3,
    newToday: 2,
    masteredApprox: 8,
    percent: 0.16,
    ...overrides,
  };
}

describe('home state machine', () => {
  it('returns reward-ready when the user has pulls and no pressure', () => {
    expect(
      resolveHomeState({
        dueCount: 0,
        newCount: 0,
        wallet: { availablePulls: 2, reservePulls: 0 },
        streakCount: 3,
      }),
    ).toBe('reward-ready');
  });

  it('returns backlog when due count is heavy', () => {
    expect(
      resolveHomeState({
        dueCount: 24,
        newCount: 0,
        wallet: { availablePulls: 0, reservePulls: 0 },
        streakCount: 4,
      }),
    ).toBe('backlog');
  });
});

describe('home selector runtime status inference', () => {
  it('derives today_partial without statusHint when session progress exists', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 4, newToday: 1 })],
      wallet: { availablePulls: 0, reservePulls: 0 },
      runtimeStatus: { qualifiedToday: false, completedToday: 1, completedRouteToday: false },
    });

    expect(vm.cta.kind).toBe('today_partial');
  });

  it('derives today_done without statusHint when streak is already qualified today', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 2, newToday: 1 })],
      wallet: { availablePulls: 1, reservePulls: 0 },
      runtimeStatus: { qualifiedToday: true, completedToday: 1, completedRouteToday: false },
    });

    expect(vm.cta.kind).toBe('today_done');
  });

  it('derives today_full_clear without statusHint when route is fully completed', () => {
    const vm = buildHomeVM({
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      deckSummaries: [makeDeck({ dueToday: 0, newToday: 0 })],
      wallet: { availablePulls: 2, reservePulls: 0 },
      runtimeStatus: { qualifiedToday: true, completedToday: 2, completedRouteToday: true },
    });

    expect(vm.cta.kind).toBe('today_full_clear');
  });
});
