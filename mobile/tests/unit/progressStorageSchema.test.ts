// normalizeProgressEntry is the AsyncStorage schema for CardProgress.
//
// The failure it protects against leaves no trace: a field added to the type
// and written by saveDeckProgress is silently dropped on the next read, so the
// feature "works" until the app is restarted and then quietly does nothing.
// hardStreak is the concrete case -- a streak that resets on every load can
// never reach the demotion threshold of 3 -- which is why this test asserts the
// round trip rather than the writer.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

import { loadDeckProgress, saveDeckProgress } from '../../src/review/storage';
import type { CardProgress } from '../../src/review/model';
import type { DeckExport } from '../../src/types/deckExport';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const deck: DeckExport = {
  Slug: 'schema-deck',
  Title: 'Schema Deck',
  Locale: 'en',
  Version: '1',
  DeckType: 1,
  IsFreeStarter: true,
  TotalCards: 1,
  FreeCardCount: 1,
  Cards: [
    {
      StableUid: 'uid-a',
      Revision: 1,
      Question: 'q',
      Difficulty: 1,
      OrderInDeck: 1,
    },
  ],
};

describe('CardProgress storage schema', () => {
  beforeEach(() => {
    store.clear();
  });

  it('round-trips the scheduler counters and the revision demotion mark', async () => {
    const saved: CardProgress = {
      stableUid: 'uid-a',
      stage: 3,
      lastReviewedAt: NOW - DAY_MS,
      nextReviewAt: NOW + 30 * DAY_MS,
      lastSeenRevision: 1,
      lapses: 2,
      hardStreak: 2,
      revisionDemotedAt: NOW - 60_000,
    };

    await saveDeckProgress(deck, [saved]);
    const [loaded] = await loadDeckProgress(deck);

    expect(loaded.stage).toBe(3);
    expect(loaded.lapses).toBe(2);
    expect(loaded.hardStreak).toBe(2);
    expect(loaded.revisionDemotedAt).toBe(NOW - 60_000);
  });

  it('drops fields that are not in the whitelist, and keeps absent counters absent', async () => {
    // The negative half of the contract: this is what happens to any field
    // someone adds to CardProgress without adding it here.
    const saved: any = {
      stableUid: 'uid-a',
      stage: 1,
      lastReviewedAt: NOW - DAY_MS,
      nextReviewAt: NOW + DAY_MS,
      lastSeenRevision: 1,
      notInTheSchema: 'gone on the next load',
      lapses: -1,
    };

    await saveDeckProgress(deck, [saved]);
    const [loaded] = await loadDeckProgress(deck);

    expect((loaded as any).notInTheSchema).toBeUndefined();
    // negative is not a count, so it is treated as absent rather than stored
    expect(loaded.lapses).toBeUndefined();
    expect(loaded.hardStreak).toBeUndefined();
    expect(loaded.revisionDemotedAt).toBeUndefined();
  });
});
