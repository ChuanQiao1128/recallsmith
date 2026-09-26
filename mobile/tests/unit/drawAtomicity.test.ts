import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
// Crash injection hook: returns true for the key whose write should be
// killed. Set per test, cleared in beforeEach.
let failSetItemFor: ((key: string) => boolean) | null = null;
const setItemCalls: string[] = [];

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      setItemCalls.push(key);
      if (failSetItemFor?.(key)) {
        throw new Error(`storage write killed: ${key}`);
      }
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

const SLUG = 'csharp';
const SCOPE = 'devcards:u:anon:';

const deckCards = Array.from({ length: 12 }, (_, index) => ({
  StableUid: `c${index + 1}`,
  Question: `Question ${index + 1}`,
  Difficulty: (index % 3) + 1,
  OrderInDeck: index + 1,
}));

const deck = {
  Slug: SLUG,
  Title: 'C# Basics',
  Locale: 'en',
  Version: '1',
  DeckType: 1,
  IsFreeStarter: true,
  TotalCards: deckCards.length,
  FreeCardCount: deckCards.length,
  Cards: deckCards,
};

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async (slug: string) => (slug === SLUG ? deck : null)),
}));

vi.mock('../../src/review/storage', () => ({
  // Kept in the mock even though the draw path no longer calls it: the
  // "never reads review progress" test below asserts on its call count,
  // and an absent export would make that test pass for the wrong reason.
  loadDeckProgress: vi.fn(async () => []),
  // Draw state is user-scoped through this helper now. The mock returns
  // the same shape the real helper produces while signed out, so the key
  // constants below stay literal and readable.
  getUserScopedKey: vi.fn(async (baseKey: string) => `${SCOPE}${baseKey}`),
}));

import { commitDraw, flushDrawHistory, replayDraw } from '../../src/features/gacha/draw/drawCommit';
import { loadDrawHistory, loadDrawState } from '../../src/features/gacha/draw/drawStateStore';
// Clearing `store` below wipes the keys behind the store's back, the same way
// the debug reset does in production -- and, like production, the in-memory
// read model has to be told or one test's collection leaks into the next.
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { loadPityState } from '../../src/features/gacha/draw/pity';

// Was ownedStore.loadOwnedSet, a module with no callers in src/ that was
// deleted with issue #11. Inlined rather than replaced with a plain
// loadDrawState call at each site so the assertions below still read as
// "what does the collection look like", which is what they are about --
// and so the pity half stays visibly untouched by the owned-half reads.
async function loadOwnedSet(slug: string): Promise<Set<string>> {
  return new Set((await loadDrawState(slug)).owned);
}

const STATE_KEY = `${SCOPE}devcards:draw-state:${SLUG}`;
const HISTORY_KEY = `${SCOPE}devcards:draw-history:${SLUG}`;
// Unscoped on purpose: these are what pre-partition builds wrote, and
// the migration path is the only thing that still reads them.
const LEGACY_OWNED_KEY = `devcards:draw-owned:${SLUG}`;
const LEGACY_PITY_KEY = `devcards:draw-pity:${SLUG}`;

describe('draw commit atomicity', () => {
  beforeEach(async () => {
    // Drain any fire-and-forget history append the previous test enqueued
    // before wiping the store, so a late write cannot land in the next test's
    // fixture.
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    failSetItemFor = null;
  });

  it('commits owned and pity in a single storage write', async () => {
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1'], pity: { draws: 3, threshold: 10 } }));

    const result = await commitDraw(SLUG, 1);

    expect(result).not.toBeNull();
    // Exactly one state-bearing write per draw (history aside). Two
    // writes is the bug: there is no window between one setItem and
    // itself for a kill to land in.
    expect(setItemCalls.filter((key) => key !== HISTORY_KEY)).toEqual([STATE_KEY]);

    const persisted = JSON.parse(store.get(STATE_KEY)!);
    expect(persisted.owned).toContain('c1');
    expect(persisted.owned).toHaveLength(2);
    expect(persisted.pity.draws).toBe(result!.pityAfter);
  });

  it('stamps every drawn card with its 1-based deck rank', async () => {
    // OrderInDeck is index + 1 here, so rank and OrderInDeck coincide; the
    // assertion is that the field exists and is consistent with the deck
    // order. cardRank.test.ts pins the sparse-key case.
    store.set(STATE_KEY, JSON.stringify({ owned: [], pity: { draws: 0, threshold: 10 } }));

    const result = await commitDraw(SLUG, 10);

    expect(result).not.toBeNull();
    expect(result!.cards.length).toBeGreaterThan(0);
    const orderOf = new Map(deckCards.map((card) => [card.StableUid, card.OrderInDeck]));
    for (const card of result!.cards) {
      expect(card.rank).toBe(orderOf.get(card.stableUid));
      expect(card.rank).toBeGreaterThanOrEqual(1);
      expect(card.rank).toBeLessThanOrEqual(deckCards.length);
    }
  });

  it('leaves owned and pity untouched when the commit write is killed', async () => {
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1'], pity: { draws: 3, threshold: 10 } }));
    failSetItemFor = (key) => key === STATE_KEY;

    await expect(commitDraw(SLUG, 10)).rejects.toThrow(/storage write killed/);
    await flushDrawHistory();

    // The point of the merged key: a killed draw cannot half-apply. Owned
    // and pity are either both the pre-draw values or both the post-draw
    // ones, never one of each.
    const owned = await loadOwnedSet(SLUG);
    const pity = await loadPityState(SLUG);

    expect([...owned]).toEqual(['c1']);
    expect(pity).toEqual({ draws: 3, threshold: 10 });
    expect(await loadDrawHistory(SLUG)).toEqual([]);
  });

  it('does not record history for a draw whose commit never landed', async () => {
    failSetItemFor = (key) => key === STATE_KEY;

    await expect(commitDraw(SLUG, 1)).rejects.toThrow();
    await flushDrawHistory();

    expect(store.has(HISTORY_KEY)).toBe(false);
  });

  it('migrates the pre-merge two-key layout without losing the collection', async () => {
    store.set(LEGACY_OWNED_KEY, JSON.stringify(['c1', 'c2', 'c3']));
    store.set(LEGACY_PITY_KEY, JSON.stringify({ draws: 7, threshold: 12 }));

    expect([...(await loadOwnedSet(SLUG))].sort()).toEqual(['c1', 'c2', 'c3']);
    expect(await loadPityState(SLUG)).toEqual({ draws: 7, threshold: 12 });

    const result = await commitDraw(SLUG, 1);

    expect(result!.ownedAfter).toBe(4);
    const persisted = JSON.parse(store.get(STATE_KEY)!);
    expect(persisted.owned).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
    expect(persisted.pity.threshold).toBe(12);
  });

  it('keeps a partner write from clobbering the other half of the record', async () => {
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1', 'c2'], pity: { draws: 4, threshold: 10 } }));

    const { savePityState } = await import('../../src/features/gacha/draw/pity');
    await savePityState(SLUG, { draws: 9, threshold: 10 });

    expect([...(await loadOwnedSet(SLUG))].sort()).toEqual(['c1', 'c2']);
    expect(await loadPityState(SLUG)).toEqual({ draws: 9, threshold: 10 });
  });
});

describe('gacha does not depend on review', () => {
  beforeEach(async () => {
    // Drain any fire-and-forget history append the previous test enqueued
    // before wiping the store, so a late write cannot land in the next test's
    // fixture.
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    failSetItemFor = null;
  });

  it('never reads review progress while committing a draw', async () => {
    const { loadDeckProgress } = await import('../../src/review/storage');
    vi.mocked(loadDeckProgress).mockClear();

    const result = await commitDraw(SLUG, 10);

    // The draw still happened -- this is not passing because nothing ran.
    expect(result!.cards).toHaveLength(10);
    // The edge only ever pointed this way by accident: selectDrawCards
    // stopped reading `progress` when the review-history weighting was
    // deleted, but drawCommit went on loading it. Asserting the call
    // count rather than deleting the mock keeps the failure legible --
    // re-adding the load turns this red with "expected 0 calls", not
    // with a TypeError three frames deep.
    expect(vi.mocked(loadDeckProgress)).not.toHaveBeenCalled();
  });
});

describe('draw replay', () => {
  beforeEach(async () => {
    // Drain any fire-and-forget history append the previous test enqueued
    // before wiping the store, so a late write cannot land in the next test's
    // fixture.
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    failSetItemFor = null;
  });

  it('reproduces a recorded draw from its persisted seed and inputs', async () => {
    const result = await commitDraw(SLUG, 10);
    await flushDrawHistory();
    const history = await loadDrawHistory(SLUG);

    expect(history).toHaveLength(1);
    const record = history[0];
    expect(record.slug).toBe(SLUG);
    expect(record.drawCount).toBe(10);
    expect(record.drawnUids).toEqual(result!.cards.map((card) => card.stableUid));

    const replay = replayDraw(record, deckCards);

    expect(replay.matches).toBe(true);
    expect(replay.drawnUids).toEqual(record.drawnUids);
  });

  it('detects a record whose seed no longer explains the outcome', async () => {
    await commitDraw(SLUG, 10);
    await flushDrawHistory();
    const [record] = await loadDrawHistory(SLUG);

    const replay = replayDraw({ ...record, seed: record.seed + 1 }, deckCards);

    expect(replay.matches).toBe(false);
  });

  it('keeps at most the last 50 draws in the ring buffer', async () => {
    const entries = Array.from({ length: 60 }, (_, index) => ({
      drawId: `${SLUG}:${index}`,
      slug: SLUG,
      seed: index,
      drawCount: 1,
      ownedBefore: [],
      pityBefore: { draws: 0, threshold: 10 },
      drawnUids: [`c${index}`],
      ts: index,
    }));
    store.set(HISTORY_KEY, JSON.stringify(entries));

    await commitDraw(SLUG, 1);
    await flushDrawHistory();
    const history = await loadDrawHistory(SLUG);

    expect(history).toHaveLength(50);
    // Oldest entries fall off the front, the fresh draw is at the back.
    expect(history[0].drawId).toBe(`${SLUG}:11`);
    expect(history[history.length - 1].drawId).not.toBe(`${SLUG}:59`);
    expect(history[history.length - 1].ts).toBeGreaterThan(1_000_000);
  });
});
