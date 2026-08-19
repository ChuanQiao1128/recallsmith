import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * The draw-state read model against the deck-retire purge.
 *
 * This is the invalidation point that matters most in practice: the other two
 * deletions are debug menu items a tester fires deliberately, while this one
 * runs inside a background manifest refresh. A deck retired server-side has
 * its local keys swept -- including its draw state, in every account
 * partition, because the sweep matches `devcards:*` keys containing the slug.
 * Nobody presses anything, so a stale cache entry here would survive
 * unnoticed until a reinstall wrote the dead collection back to disk.
 */

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
});

const SLUG = 'algo';
const USER = 'user1';
const STATE_KEY = `devcards:u:${USER}:devcards:draw-state:${SLUG}`;

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
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    }),
  },
}));

/** Minimal fs mock: the manifest path never touches the file system. */
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async () => {
    throw new Error('ENOENT');
  }),
  writeAsStringAsync: vi.fn(async () => {}),
  deleteAsync: vi.fn(async () => {}),
  moveAsync: vi.fn(async () => {}),
  getInfoAsync: vi.fn(async (uri: string) => ({ exists: false, isDirectory: false, uri })),
  makeDirectoryAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
  downloadAsync: vi.fn(async () => ({ status: 404 })),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_alg: string, text: string) =>
    createHash('sha256').update(text, 'utf8').digest('hex'),
  ),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({ userSub: USER })),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  getIsPremiumUser: vi.fn(async () => false),
}));

// Only the key layout is needed from review/storage; the deck repository does
// not import it at all, and drawStateStore wants nothing else from it.
vi.mock('../../src/review/storage', () => ({
  getUserScopedKey: vi.fn(async (baseKey: string) => `devcards:u:${USER}:${baseKey}`),
}));

import { listManifestDecks } from '../../src/content/deckRepository';
import { loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';

function retiredManifest(): string {
  return JSON.stringify({
    schemaVersion: 2,
    generatedAtMs: 1,
    prefix: 'content',
    decks: [
      {
        slug: SLUG,
        title: 'Algo',
        locale: 'en-US',
        deckType: 1,
        tier: 'free',
        availability: 'retired',
        retiredAtMs: 1_700_000_000_000,
        downloadMode: 'public',
        totalCards: 1,
        version: 'v1',
        buildId: 'v1',
        path: 'decks/algo/builds/v1/deck.json',
        sha256: null,
        patches: null,
      },
    ],
  });
}

describe('draw state cache vs the deck retire purge', () => {
  beforeEach(() => {
    store.clear();
    invalidateDrawStateCache();

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => retiredManifest(),
        json: async () => JSON.parse(retiredManifest()),
        headers: { get: () => null },
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  it('forgets the collection of a deck retired under it', async () => {
    await saveDrawState(SLUG, { owned: ['c1', 'c2'], pity: null });
    // Warm from the write, the way a real session would: the draw screen read
    // this deck before the refresh that retired it.
    expect((await loadDrawState(SLUG)).owned).toEqual(['c1', 'c2']);

    await listManifestDecks({ preferRemote: true });

    expect(store.has(STATE_KEY)).toBe(false);
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
  });
});
