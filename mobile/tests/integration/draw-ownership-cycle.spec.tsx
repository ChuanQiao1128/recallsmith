import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  },
}));

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async () => ({
    Slug: 'csharp',
    Title: 'C# Interview',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: 5,
    FreeCardCount: 5,
    Cards: [
      { StableUid: '1', OrderInDeck: 1, Question: 'Q1', Difficulty: 1 },
      { StableUid: '2', OrderInDeck: 2, Question: 'Q2', Difficulty: 2 },
      { StableUid: '3', OrderInDeck: 3, Question: 'Q3', Difficulty: 3 },
      { StableUid: '4', OrderInDeck: 4, Question: 'Q4', Difficulty: 1 },
      { StableUid: '5', OrderInDeck: 5, Question: 'Q5', Difficulty: 2 },
    ],
  })),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  // Draw state keys are user-scoped through this helper; the mock keeps
  // the signed-out shape the real helper produces.
  getUserScopedKey: vi.fn(async (baseKey: string) => `devcards:u:anon:${baseKey}`),
}));

import { commitDraw } from '../../src/features/gacha/draw/drawCommit';
// store.clear() below wipes the keys behind the store's back, the same way the
// debug reset does in production -- and, like production, the in-memory read
// model has to be told or one test's collection leaks into the next.
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

describe('draw ownership cycle', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();
  });

  it('grows ownership until the pool is exhausted', async () => {
    const first = await commitDraw('csharp', 1);
    const second = await commitDraw('csharp', 1);
    const third = await commitDraw('csharp', 1);
    const fourth = await commitDraw('csharp', 1);
    const fifth = await commitDraw('csharp', 1);
    const exhausted = await commitDraw('csharp', 1);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    expect(fourth).not.toBeNull();
    expect(fifth).not.toBeNull();
    expect(exhausted).not.toBeNull();

    expect(first!.ownedAfter).toBe(1);
    expect(second!.ownedAfter).toBe(2);
    expect(third!.ownedAfter).toBe(3);
    expect(fourth!.ownedAfter).toBe(4);
    expect(fifth!.ownedAfter).toBe(5);

    expect(first!.cards).toHaveLength(1);
    expect(second!.cards).toHaveLength(1);
    expect(first!.cards[0].stableUid).not.toBe(second!.cards[0].stableUid);

    expect(exhausted!.cards).toHaveLength(0);
    expect(exhausted!.poolExhausted).toBe(true);
    expect(exhausted!.ownedAfter).toBe(5);
    expect(exhausted!.totalCards).toBe(5);
  });
});
