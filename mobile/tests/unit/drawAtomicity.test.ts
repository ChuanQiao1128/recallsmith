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
  loadDeckProgress: vi.fn(async () => []),
}));

import { commitDraw, replayDraw } from '../../src/features/gacha/draw/drawCommit';
import { loadDrawHistory } from '../../src/features/gacha/draw/drawStateStore';
import { loadOwnedSet } from '../../src/features/gacha/draw/ownedStore';
import { loadPityState } from '../../src/features/gacha/draw/pity';

const STATE_KEY = `devcards:draw-state:${SLUG}`;
const HISTORY_KEY = `devcards:draw-history:${SLUG}`;
const LEGACY_OWNED_KEY = `devcards:draw-owned:${SLUG}`;
const LEGACY_PITY_KEY = `devcards:draw-pity:${SLUG}`;

describe('draw commit atomicity', () => {
  beforeEach(() => {
    store.clear();
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

  it('leaves owned and pity untouched when the commit write is killed', async () => {
    store.set(STATE_KEY, JSON.stringify({ owned: ['c1'], pity: { draws: 3, threshold: 10 } }));
    failSetItemFor = (key) => key === STATE_KEY;

    await expect(commitDraw(SLUG, 10)).rejects.toThrow(/storage write killed/);

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

describe('draw replay', () => {
  beforeEach(() => {
    store.clear();
    setItemCalls.length = 0;
    failSetItemFor = null;
  });

  it('reproduces a recorded draw from its persisted seed and inputs', async () => {
    const result = await commitDraw(SLUG, 10);
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
    const history = await loadDrawHistory(SLUG);

    expect(history).toHaveLength(50);
    // Oldest entries fall off the front, the fresh draw is at the back.
    expect(history[0].drawId).toBe(`${SLUG}:11`);
    expect(history[history.length - 1].drawId).not.toBe(`${SLUG}:59`);
    expect(history[history.length - 1].ts).toBeGreaterThan(1_000_000);
  });
});
