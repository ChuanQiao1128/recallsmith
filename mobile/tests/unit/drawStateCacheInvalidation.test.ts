import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The draw-state read model against the key deletions that do not go through
 * saveDrawState.
 *
 * The premise behind caching this data is "saveDrawState is the only writer",
 * and for writes that holds. Deletions are the exception, and there are three:
 * the debug progress reset (covered in drawStateCache.test.ts), the deck
 * retire purge, and this one -- the sync debug reset, whose
 * `devcards:u:{sub}:` prefix sweep is wider than its name and takes the
 * account's collection with it. Each one is a place where a cache entry can
 * outlive its keys, and where the next draw would read the deleted collection
 * out of memory and write it back.
 *
 * This file lives apart from drawStateCache.test.ts because that suite runs
 * the real review/storage to exercise account partitioning, while progressSync
 * can only be brought up with review/storage mocked.
 */

const USER = 'user1';
const SLUG = 'csharp';

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

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'uuid-1') }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async () => {
    throw new Error('unexpected network call');
  }),
}));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));
vi.mock('../../src/sync/drawStateSync', () => ({ syncDrawStateNow: vi.fn(async () => {}) }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => {}),
  setActiveUserSubForStorage: vi.fn(),
  // The one piece of review/storage this suite needs for real behaviour: the
  // key layout the sync reset sweeps by prefix. Same shape the real helper
  // produces for a signed-in account.
  getUserScopedKey: vi.fn(async (baseKey: string) => `devcards:u:${USER}:${baseKey}`),
}));

import { loadDrawState, saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import {
  resetProgressSyncState,
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';

const STATE_KEY = `devcards:u:${USER}:devcards:draw-state:${SLUG}`;

describe('draw state cache vs the sync debug reset', () => {
  beforeEach(async () => {
    store.clear();
    invalidateDrawStateCache();
    await setActiveUserSub(USER);
    await setSyncAccessToken('test-token');
  });

  it('forgets a collection the sync reset deleted', async () => {
    await saveDrawState(SLUG, { owned: ['c1', 'c2'], pity: { draws: 3, threshold: 10 } });
    expect((await loadDrawState(SLUG)).owned).toEqual(['c1', 'c2']);

    await resetProgressSyncState();

    // Worth stating plainly, because the function's name does not: this debug
    // reset takes the gacha collection too. Whether it should is a product
    // question and not this issue's; while it does, the read model must not
    // be the one thing that survives it.
    expect(store.has(STATE_KEY)).toBe(false);
    expect((await loadDrawState(SLUG)).owned).toEqual([]);
  });
});
