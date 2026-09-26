import { beforeEach, describe, expect, it, vi } from 'vitest';

// Storage / deck / review mocks mirror tests/unit/drawAtomicity.test.ts so the
// two suites reason about the same in-memory AsyncStorage and the same scope.
const store = new Map<string, string>();
const setItemCalls: string[] = [];

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      setItemCalls.push(key);
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

const SLUG = 'csharp';
const SCOPE = 'devcards:u:anon:';

// 60 cards so the ring-buffer trim (limit 50) has entries to drop, and every
// single pull can reveal a distinct card.
const deckCards = Array.from({ length: 60 }, (_, index) => ({
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

const otherDeck = {
  ...deck,
  Slug: 'aws',
  Title: 'AWS Basics',
};

const resolveDeckBySlugMock = vi.fn(async (slug: string) => (slug === SLUG ? deck : null));

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn((slug: string) => resolveDeckBySlugMock(slug)),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  getUserScopedKey: vi.fn(async (baseKey: string) => `${SCOPE}${baseKey}`),
}));

import { commitDraw, flushDrawHistory, replayDraw } from '../../src/features/gacha/draw/drawCommit';
import { loadDrawHistory } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

const HISTORY_KEY = `${SCOPE}devcards:draw-history:${SLUG}`;

function rawStoredHistory(): any[] {
  return JSON.parse(store.get(HISTORY_KEY) ?? '[]');
}

describe('commitDraw reuses the loaded deck', () => {
  beforeEach(async () => {
    // Drain any fire-and-forget history append the previous test enqueued
    // before wiping the store.
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    resolveDeckBySlugMock.mockClear();
  });

  it('does not re-resolve the deck when the caller passes it', async () => {
    const result = await commitDraw(SLUG, 1, { deck });

    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(1);
    // The whole point: the passed deck is used, so no file read/parse happens.
    expect(resolveDeckBySlugMock).not.toHaveBeenCalled();
  });

  it('falls back to resolving the deck when the passed deck is for another slug', async () => {
    const result = await commitDraw(SLUG, 1, { deck: otherDeck as any });

    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(1);
    // A deck for the wrong slug is ignored; the dynamic-import path resolves
    // the right one.
    expect(resolveDeckBySlugMock).toHaveBeenCalledWith(SLUG);
  });
});

describe('draw history is delta-encoded on disk', () => {
  beforeEach(async () => {
    await flushDrawHistory();
    store.clear();
    invalidateDrawStateCache();
    setItemCalls.length = 0;
    resolveDeckBySlugMock.mockClear();
  });

  it('stores ownedBefore as a delta after the first retained entry', async () => {
    await commitDraw(SLUG, 1, { deck });
    await commitDraw(SLUG, 1, { deck });
    await commitDraw(SLUG, 1, { deck });
    await flushDrawHistory();

    const stored = rawStoredHistory();
    expect(stored).toHaveLength(3);
    // Entry 0 anchors the chain with a full owned list.
    expect(Array.isArray(stored[0].ownedBefore)).toBe(true);
    // Entries 1-2 carry only the delta and drop the full list.
    for (const entry of stored.slice(1)) {
      expect(entry).toHaveProperty('ownedBeforeAdded');
      expect(entry).not.toHaveProperty('ownedBefore');
    }
  });

  it('rebuilds full ownedBefore sets on load so replay still matches', async () => {
    await commitDraw(SLUG, 1, { deck });
    await commitDraw(SLUG, 10, { deck });
    await commitDraw(SLUG, 1, { deck });
    await flushDrawHistory();

    const history = await loadDrawHistory(SLUG);
    expect(history.length).toBe(3);
    for (const record of history) {
      expect(replayDraw(record, deckCards).matches).toBe(true);
    }
  });

  it('rebases the oldest retained entry to a full ownedBefore when the ring buffer trims', async () => {
    // More than the 50-entry limit so the front of the buffer is dropped.
    for (let i = 0; i < 55; i += 1) {
      await commitDraw(SLUG, 1, { deck });
    }
    await flushDrawHistory();

    const stored = rawStoredHistory();
    expect(stored).toHaveLength(50);
    // The new oldest entry has to carry a full owned list, or the delta chain
    // has no anchor to rebuild from.
    expect(Array.isArray(stored[0].ownedBefore)).toBe(true);
    expect(stored[0]).not.toHaveProperty('ownedBeforeAdded');

    const history = await loadDrawHistory(SLUG);
    expect(history).toHaveLength(50);
    for (const record of history) {
      expect(replayDraw(record, deckCards).matches).toBe(true);
    }
  });

  it('still reads legacy entries that carry a full ownedBefore', async () => {
    // Generate real, replayable records, then rewrite them in the pre-G38
    // shape where every entry holds a full ownedBefore and none holds a delta.
    await commitDraw(SLUG, 10, { deck });
    await commitDraw(SLUG, 1, { deck });
    await flushDrawHistory();
    const materialized = await loadDrawHistory(SLUG);
    expect(materialized.every((entry) => Array.isArray(entry.ownedBefore))).toBe(true);

    store.set(HISTORY_KEY, JSON.stringify(materialized));

    const loaded = await loadDrawHistory(SLUG);
    expect(loaded).toEqual(materialized);
    for (const record of loaded) {
      expect(replayDraw(record, deckCards).matches).toBe(true);
    }
  });

  it('writes history in commit order off the commit path', async () => {
    // Two commits, no flush between them: the appends ride the shared queue.
    const first = await commitDraw(SLUG, 1, { deck });
    const second = await commitDraw(SLUG, 1, { deck });
    await flushDrawHistory();

    const history = await loadDrawHistory(SLUG);
    expect(history).toHaveLength(2);
    // Commit order: the first draw saw an empty collection; the second saw the
    // first draw's card already owned.
    expect(history[0].ownedBefore).toEqual([]);
    expect(history[1].ownedBefore).toEqual([first!.cards[0].stableUid]);
    expect(history[1].drawnUids).toEqual([second!.cards[0].stableUid]);
  });
});
