import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Home's single data source, driven end to end over a real (in-memory)
 * storage: real review/storage, real drawStateStore, real planner. The only
 * fakes are the deck manifest and the two side effects (remote progress cache,
 * reminder scheduling) -- everything the gate has to flow through is the
 * shipping code.
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

const syncDailyRemindersMock = vi.fn(async (_params: { remainingDueCount: number; now: Date }) => {});
vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: (params: any) => syncDailyRemindersMock(params),
}));

import { loadHomeDeckSummaries } from '../../src/features/gacha/home/deckActionResolver';
import { buildHomeVM } from '../../src/features/gacha/selectors/homeSelectors';
import { saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import type { CardProgress } from '../../src/review/model';

const DAY_MS = 86_400_000;

function learnedDueToday(stableUid: string): CardProgress {
  const now = Date.now();
  return {
    stableUid,
    stage: 2,
    lastReviewedAt: now - DAY_MS,
    nextReviewAt: now,
    lastSeenRevision: 1,
  };
}

function untouched(stableUid: string): CardProgress {
  return { stableUid, stage: 0, nextReviewAt: 0, lastSeenRevision: 0 };
}

/**
 * The whole product question in one fixture:
 *   stranger -- never drawn, never studied  (the gate's only real target)
 *   drawn    -- drawn, never studied        (the pull that must feel like it gave something)
 *   grand    -- studied on a 1.4.0 client, never drawn (grandfathered)
 */
async function seedFixture() {
  await saveDeckProgress(DECK, [untouched('stranger'), untouched('drawn'), learnedDueToday('grand')]);
  await saveDrawState('csharp', { owned: ['drawn'], pity: null });
}

describe('Home deck summaries under the ownership gate', () => {
  beforeEach(async () => {
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage(null);
    syncDailyRemindersMock.mockClear();
    await seedFixture();
  });

  it('counts only cards this account holds as fresh', async () => {
    const { deckSummaries } = await loadHomeDeckSummaries({ premium: false });

    // Fresh = drawn-but-unstudied. 'stranger' is in the deck file and in the
    // progress array and is still not on offer, because nobody ever pulled it.
    expect(deckSummaries[0].newToday).toBe(1);
  });

  it('measures progress against the collection, not the deck file', async () => {
    const { deckSummaries } = await loadHomeDeckSummaries({ premium: false });

    // One of the two cards this account holds has been studied.
    expect(deckSummaries[0].percent).toBeCloseTo(1 / 2, 6);
  });

  it('leaves every count that is derived from studied cards exactly where it was', async () => {
    // Not decoration. resolveEffectiveOwned grandfathers every studied card,
    // so "studied" implies "owned" and the gate provably cannot move due
    // counts, the calendar, the reminder payload or the mastered count. This
    // pins that implication: if a future change narrows the union (say cards
    // could expire), these four move together and this test says so first.
    const { deckSummaries, allUpcoming30 } = await loadHomeDeckSummaries({ premium: false });

    expect(deckSummaries[0].dueToday).toBe(1);
    expect(deckSummaries[0].masteredApprox).toBe(1);
    expect(allUpcoming30[0].count).toBe(1);
    expect(syncDailyRemindersMock).toHaveBeenCalledWith(
      expect.objectContaining({ remainingDueCount: 1 }),
    );
  });

  it('hands the primary button to the draw once the deck stops offering work', async () => {
    // The redistribution the PRD asks for, pinned end to end rather than from a
    // hand-written DeckSummary: the gate produces the summary, and the same
    // summary drives the state machine. A new account lands in empty_deck --
    // it holds no card, so ownedCount is 0 and there is no route to preview --
    // and the CTA becomes the first pull. (nothing_to_learn is the neighbour
    // state for an account that owns cards with nothing scheduled.) This is
    // the loop working, not an empty-state bug.
    store.clear();
    invalidateDrawStateCache();
    await saveDeckProgress(DECK, [untouched('stranger'), untouched('drawn'), untouched('grand')]);
    await saveDrawState('csharp', { owned: [], pity: null });

    const { deckSummaries, updates, allUpcoming30 } = await loadHomeDeckSummaries({ premium: false });
    const vm = buildHomeVM({
      deckSummaries,
      selectedSlug: 'csharp',
      hasSignedInUser: true,
      wallet: { availablePulls: 1, reservePulls: 0 },
      updates,
      allUpcoming30,
    });

    expect(deckSummaries[0].ownedCount).toBe(0);
    expect(vm.statusKind).toBe('empty_deck');
    expect(vm.cta.nav).toBe('draw');
    expect(vm.routePreview).toEqual([]);
  });

  it('reports the collection size as ownedCount on the summary', async () => {
    store.clear();
    invalidateDrawStateCache();
    await saveDeckProgress(DECK, [untouched('stranger'), untouched('drawn'), untouched('grand')]);
    await saveDrawState('csharp', { owned: ['drawn', 'grand'], pity: null });

    const { deckSummaries } = await loadHomeDeckSummaries({ premium: false });
    expect(deckSummaries[0].ownedCount).toBe(2);
    expect(deckSummaries[0].newToday).toBe(2);
  });

  it('offers nothing fresh to an account that holds nothing', async () => {
    // The new-user state the PRD is built around: the deck is installed, the
    // collection is empty, and Home must say "draw first", not "here are 100
    // cards to learn". Home's CTA reads newToday === 0 to get there.
    store.clear();
    invalidateDrawStateCache();
    await saveDeckProgress(DECK, [untouched('stranger'), untouched('drawn'), untouched('grand')]);
    await saveDrawState('csharp', { owned: [], pity: null });

    const { deckSummaries } = await loadHomeDeckSummaries({ premium: false });

    expect(deckSummaries[0].newToday).toBe(0);
    expect(deckSummaries[0].dueToday).toBe(0);
    expect(deckSummaries[0].percent).toBe(0);
  });
});
