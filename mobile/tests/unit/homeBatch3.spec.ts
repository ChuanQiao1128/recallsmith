import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

/**
 * C03 (H3 Home batch 3): the F9 sublines keyed on draw.state, the F10 locked
 * labels and Caught-up copy, the F11 masteredCount read, and the route-preview
 * formula that must match C02's planner. buildHomeVM cases are pure; the
 * masteredCount cases drive loadHomeDeckSummaries over a real in-memory storage,
 * copied from homeOwnedGate.spec.ts.
 */

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
  },
}));

const DECK = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 3,
  Cards: [
    { StableUid: 'stranger', OrderInDeck: 1, Difficulty: 1, Question: 'Stranger question' },
    { StableUid: 'drawn', OrderInDeck: 2, Difficulty: 1, Question: 'Drawn question' },
    { StableUid: 'grand', OrderInDeck: 3, Difficulty: 1, Question: 'Grandfather question' },
  ],
} as any;

vi.mock('../../src/content/activeDeck', () => ({
  loadActiveDeckSlug: vi.fn(async () => 'csharp'),
  setActiveDeckSlug: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  listManifestDecks: vi.fn(async () => [
    {
      slug: 'csharp',
      title: 'C# Interview',
      locale: 'en-US',
      version: '1',
      deckType: 1,
      availability: 'live',
      totalCards: 3,
      order: 1,
    },
  ]),
  resolveDeckBySlug: vi.fn(async () => DECK),
  checkManifestForUpdates: vi.fn(async () => ({})),
  installDeckFromUrl: vi.fn(async () => true),
}));

vi.mock('../../src/sync/progressSync', () => ({
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

import type { DeckSummary } from '../../src/features/gacha/contracts';
import { buildHomeVM } from '../../src/features/gacha/selectors/homeSelectors';
import { loadHomeDeckSummaries } from '../../src/features/gacha/home/deckActionResolver';
import { buildChallengeRoute } from '../../src/features/gacha/planner/sessionBuilder';
import { FREE_PULL_CAP, FREE_PULL_OVERFLOW_CAP } from '../../src/features/gacha/constants';
import { resolveDeckBySlug } from '../../src/content/deckRepository';
import { saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import type { CardProgress } from '../../src/review/model';

const DAY = 86_400_000;

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

function homeVM(params: {
  deck?: DeckSummary;
  deckSummaries?: DeckSummary[];
  wallet: { availablePulls: number; reservePulls: number };
  statusHint?: Parameters<typeof buildHomeVM>[0]['statusHint'];
}) {
  const deckSummaries = params.deckSummaries ?? [params.deck as DeckSummary];
  return buildHomeVM({
    selectedSlug: 'csharp',
    hasSignedInUser: true,
    deckSummaries,
    wallet: params.wallet,
    statusHint: params.statusHint,
  });
}

const EMPTY = { availablePulls: 0, reservePulls: 0 };

describe('C03 Home F9 / F10 / F11', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
  });

  it('says a free pull returns tomorrow when the selected deck is caught up', () => {
    const vm = homeVM({ deck: makeDeck({ dueToday: 0, newToday: 0 }), wallet: EMPTY });
    expect(vm.draw.state).toBe('locked');
    expect(vm.draw.label).toBe('No cards due · a free pull returns tomorrow');

    const withHint = homeVM({
      deck: makeDeck({ dueToday: 0, newToday: 0 }),
      wallet: EMPTY,
      statusHint: 'today_full_clear',
    });
    expect(withHint.draw.label).toBe('No cards due · a free pull returns tomorrow');
  });

  it('asks for the due cards when only due work remains', () => {
    const vm = homeVM({ deck: makeDeck({ dueToday: 2, newToday: 0 }), wallet: EMPTY });
    expect(vm.draw.state).toBe('locked');
    expect(vm.draw.label).toBe('Clear today’s due cards to earn a pull');
  });

  it('asks for a new card in every other locked case', () => {
    const decks = [
      makeDeck({ dueToday: 0, newToday: 1 }),
      makeDeck({ dueToday: 3, newToday: 2 }),
      makeDeck({ canStudy: false, dueToday: 0, newToday: 0 }),
    ];
    for (const deck of decks) {
      const vm = homeVM({ deck, wallet: EMPTY });
      expect(vm.draw.state).toBe('locked');
      expect(vm.draw.label).toBe('Learn a new card to earn a pull');
      expect(vm.draw.label).not.toBe('Review today’s cards to earn a pull');
    }
    const noDeck = homeVM({ deckSummaries: [], wallet: EMPTY });
    expect(noDeck.draw.state).toBe('locked');
    expect(noDeck.draw.label).toBe('Learn a new card to earn a pull');
    expect(noDeck.draw.label).not.toBe('Review today’s cards to earn a pull');
  });

  it('keeps the three unlocked draw states untouched', () => {
    const available = homeVM({
      deck: makeDeck({ dueToday: 0, newToday: 0 }),
      wallet: { availablePulls: 1, reservePulls: 0 },
    });
    expect(available.draw.state).toBe('available');
    expect(available.draw.label).toBe('1 pull ready');

    const reserve = homeVM({
      deck: makeDeck({ dueToday: 0, newToday: 0 }),
      wallet: { availablePulls: 1, reservePulls: 2 },
    });
    expect(reserve.draw.state).toBe('reserve');
    expect(reserve.draw.label).toBe('1 pull ready · 2 more waiting');

    const full = homeVM({
      deck: makeDeck({ dueToday: 0, newToday: 0 }),
      wallet: { availablePulls: FREE_PULL_CAP, reservePulls: FREE_PULL_OVERFLOW_CAP },
    });
    expect(full.draw.state).toBe('wallet-full');
    expect(full.draw.label).toBe(`Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})`);
  });

  it('tells a done-for-today user that each new card earns a pull while locked', () => {
    const locked = homeVM({
      deck: makeDeck({ dueToday: 1, newToday: 1 }),
      wallet: EMPTY,
      statusHint: 'today_done',
    });
    expect(locked.hero.subline).toBe('Minimum goal done. Each new card you learn earns a pull.');
    expect(locked.hero.headline).toBe('Minimum goal already done');

    const withPulls = homeVM({
      deck: makeDeck({ dueToday: 1, newToday: 1 }),
      wallet: { availablePulls: 2, reservePulls: 0 },
      statusHint: 'today_done',
    });
    expect(withPulls.hero.subline).toBe('You can stop here or spend pulls and keep momentum.');
    expect(withPulls.hero.headline).toBe('Minimum goal already done');
  });

  it('tells a full-clear user to learn a new card while locked', () => {
    const locked = homeVM({
      deck: makeDeck({ dueToday: 0, newToday: 0 }),
      wallet: EMPTY,
      statusHint: 'today_full_clear',
    });
    expect(locked.hero.subline).toBe('Route done. Learn a new card to earn your next pull.');

    const withPulls = homeVM({
      deck: makeDeck({ dueToday: 0, newToday: 0 }),
      wallet: { availablePulls: 2, reservePulls: 0 },
      statusHint: 'today_full_clear',
    });
    expect(withPulls.hero.subline).toBe('Great close. Pulls are ready when you want them.');
  });

  it('leaves the wallet-full subline alone', () => {
    const vm = homeVM({
      deck: makeDeck({ dueToday: 3, newToday: 1 }),
      wallet: { availablePulls: FREE_PULL_CAP, reservePulls: FREE_PULL_OVERFLOW_CAP },
    });
    expect(vm.cta.kind).toBe('wallet_full');
    expect(vm.hero.subline).toBe(
      'Pulls are full. Today’s review still comes first; spend a pull afterwards.',
    );
    expect(vm.drawStatusLabel).toMatch(/unlock after you clear today’s work/i);
  });

  it('counts mastered cards by stage, not by having been reviewed', async () => {
    const now = Date.now();
    const progress: CardProgress[] = [
      { stableUid: 'stranger', stage: 4, lastReviewedAt: now - DAY, nextReviewAt: now + 30 * DAY, lastSeenRevision: 1 },
      { stableUid: 'drawn', stage: 2, lastReviewedAt: now - DAY, nextReviewAt: now + 3 * DAY, lastSeenRevision: 1 },
      { stableUid: 'grand', stage: 0, nextReviewAt: 0, lastSeenRevision: 0 },
    ];
    await saveDeckProgress(DECK, progress);
    await saveDrawState('csharp', { owned: ['grand'], pity: null });

    const { deckSummaries } = await loadHomeDeckSummaries({ premium: false });
    expect(deckSummaries[0].masteredCount).toBe(1);
    expect(deckSummaries[0].masteredApprox).toBe(2);
    expect(deckSummaries[0].newToday).toBe(1);
    expect(deckSummaries[0].dueToday).toBe(0);
    // Owned = the studied cards (grandfathered) + the drawn-and-unstudied one;
    // this is the number Home's fourth tile shows for the selected deck.
    expect(deckSummaries[0].ownedCards).toBe(3);
  });

  it('reports masteredCount 0 for a deck that is not studiable', async () => {
    vi.mocked(resolveDeckBySlug).mockResolvedValueOnce(null as any);
    const { deckSummaries } = await loadHomeDeckSummaries({ premium: false });
    expect(deckSummaries[0].canStudy).toBe(false);
    expect(deckSummaries[0].masteredCount).toBe(0);
    expect(deckSummaries[0].masteredApprox).toBe(0);
    expect(deckSummaries[0].ownedCards).toBe(0);
  });

  it('previews exactly as many nodes as the planner would schedule', () => {
    const table: Array<[number, number, number]> = [
      [0, 1, 1],
      [3, 2, 5],
      [1, 2, 3],
    ];
    for (const [due, fresh, expected] of table) {
      const vm = homeVM({
        deckSummaries: [makeDeck({ dueToday: due, newToday: fresh })],
        wallet: EMPTY,
      });
      const route = buildChallengeRoute({
        slug: 'csharp',
        deckTitle: 'C# Interview',
        dueCount: due,
        newCount: fresh,
      });
      expect(vm.routePreview).toHaveLength(expected);
      expect(vm.routePreview).toHaveLength(route.limit);
    }
  });

  it('previews as many nodes as the planner limit for any due/new pair', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 }), (due, fresh) => {
        const vm = homeVM({
          deckSummaries: [makeDeck({ dueToday: due, newToday: fresh })],
          wallet: EMPTY,
        });
        const route = buildChallengeRoute({
          slug: 'csharp',
          deckTitle: 'C# Interview',
          dueCount: due,
          newCount: fresh,
        });
        expect(vm.routePreview.length).toBe(route.limit);
        expect(vm.counts.normalCount + vm.counts.eliteCount + vm.counts.bossCount).toBe(route.limit);
        expect(vm.counts.bossCount).toBe(route.nodes.filter((n) => n.role === 'boss').length);
      }),
    );
  });
});
