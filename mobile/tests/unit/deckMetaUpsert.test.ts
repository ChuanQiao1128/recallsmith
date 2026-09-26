// MCORE-22 — loadDeckProgress used to rewrite the deck-meta record on every
// read, an AsyncStorage write on a pure-read path that Home hits for three
// decks on each of its launch refreshes. shouldUpsertDeckMeta gates that write
// so it only fires when the content version changed or the record is a day old.
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
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null])),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DECK_META_REFRESH_MS,
  loadDeckProgress,
  shouldUpsertDeckMeta,
} from '../../src/review/storage';
import type { DeckExport } from '../../src/types/deckExport';

const deck: DeckExport = {
  Slug: 'meta-deck',
  Title: 'Meta Deck',
  Locale: 'en',
  Version: '3',
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

describe('shouldUpsertDeckMeta', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');

  it('shouldUpsertDeckMeta skips a fresh meta for the same content version', () => {
    const existing = {
      contentVersion: deck.Version,
      lastSeenAtISO: new Date(now.getTime() - 60_000).toISOString(),
    };
    expect(shouldUpsertDeckMeta(existing, deck, now)).toBe(false);
  });

  it('shouldUpsertDeckMeta rewrites when the content version changes', () => {
    const existing = {
      contentVersion: '2',
      lastSeenAtISO: new Date(now.getTime() - 60_000).toISOString(),
    };
    expect(shouldUpsertDeckMeta(existing, deck, now)).toBe(true);
  });

  it('shouldUpsertDeckMeta rewrites once the meta is older than DECK_META_REFRESH_MS', () => {
    const stale = {
      contentVersion: deck.Version,
      lastSeenAtISO: new Date(now.getTime() - DECK_META_REFRESH_MS - 1).toISOString(),
    };
    expect(shouldUpsertDeckMeta(stale, deck, now)).toBe(true);

    // A null record (never written) and an unparseable timestamp both rewrite.
    expect(shouldUpsertDeckMeta(null, deck, now)).toBe(true);
    expect(
      shouldUpsertDeckMeta({ contentVersion: deck.Version, lastSeenAtISO: 'not-a-date' }, deck, now),
    ).toBe(true);
  });
});

describe('loadDeckProgress deck-meta write', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('loadDeckProgress does not rewrite deck meta on a repeat read', async () => {
    const setItem = AsyncStorage.setItem as unknown as ReturnType<typeof vi.fn>;
    const metaWrites = () =>
      setItem.mock.calls.filter(([key]) => String(key).includes('deck-meta:')).length;

    await loadDeckProgress(deck);
    expect(metaWrites()).toBe(1);

    await loadDeckProgress(deck);
    // Second read: the record already matches the version and is fresh, so no
    // second deck-meta write.
    expect(metaWrites()).toBe(1);
  });
});
