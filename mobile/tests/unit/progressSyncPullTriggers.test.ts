import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which sync reasons are allowed to pull.
 *
 * `pushed === 0` already forces a pull when the outbox is empty, so the
 * whitelist only decides one case: a sync that had local work to send. That
 * case is exactly the multi-device one -- study on phone A, open phone B
 * while B still has queued ratings -- and it was unreachable, because the
 * three names on the old list ('home_focus', 'review_focus', 'app_start')
 * had no caller anywhere in the repo while the reason App.tsx actually fires
 * ('app_foreground') was missing from it.
 *
 * These tests pin the two reasons that now have real call sites, and pin the
 * throttle reason that must NOT pull, so the list cannot quietly become
 * "always".
 */

const USER = 'user1';

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
      for (const k of keys) store.delete(k);
    }),
  },
}));

let uuidN = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidN}`),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: 'test' } },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const pushedEventIds: string[] = [];
const pullPaths: string[] = [];

vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async (path: string, opts: any) => {
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });
    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, userSub: USER, serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      // Accept everything offered, so `pushed > 0` and the pull decision is
      // made by the whitelist rather than by the empty-outbox shortcut.
      const ids = (opts?.body?.events ?? []).map((event: any) => event.eventId);
      pushedEventIds.push(...ids);
      return ok({
        serverTimeMs: 1,
        receivedCount: ids.length,
        acceptedCount: ids.length,
        acceptedEventIds: ids,
        duplicateEventIds: [],
      });
    }
    if (path.startsWith('/api/v1/sync/progress')) {
      pullPaths.push(path);
      return ok({ serverTimeMs: 1, sinceMs: null, items: [] });
    }
    throw new Error(`unexpected apiJson path: ${path}`);
  }),
}));

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async () => null),
}));

vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => {}),
  setActiveUserSubForStorage: vi.fn(),
}));

import {
  forceProgressSync,
  recordReviewEvent,
  resetProgressSyncState,
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';

beforeAll(async () => {
  await setActiveUserSub(USER);
  await setSyncAccessToken('test-token');
  await forceProgressSync('manual');
});

beforeEach(async () => {
  await resetProgressSyncState();
  pushedEventIds.length = 0;
  pullPaths.length = 0;
});

/** Leaves one review event in the outbox so the next sync has work to push. */
async function queueLocalWork(uid: string) {
  const eventId = await recordReviewEvent('algo', uid, 'good', Date.now());
  expect(eventId).not.toBeNull();
}

describe('syncProgressOnce pull whitelist', () => {
  it('pulls on app_foreground even when this device has work of its own to send', async () => {
    await queueLocalWork('u1');

    await forceProgressSync('app_foreground');

    // The push happened -- so `pushed === 0` did not carry this pull.
    expect(pushedEventIds.length).toBeGreaterThan(0);
    expect(pullPaths).toHaveLength(1);
  });

  it('pulls right after a draw commits', async () => {
    await queueLocalWork('u2');

    await forceProgressSync('draw_committed');

    expect(pushedEventIds.length).toBeGreaterThan(0);
    expect(pullPaths).toHaveLength(1);
  });

  it('does not pull on a debounced rating flush that had work to push', async () => {
    await queueLocalWork('u3');

    await forceProgressSync('rating');

    // Ratings fire constantly during a session. Pulling on each one buys a
    // request rate nobody asked the server for, and the next foreground will
    // reconcile anyway.
    expect(pushedEventIds.length).toBeGreaterThan(0);
    expect(pullPaths).toHaveLength(0);
  });

  it('still pulls on a reason with nothing to push, whitelisted or not', async () => {
    await forceProgressSync('rating');

    // The empty-outbox shortcut. Named here so a future whitelist edit cannot
    // be read as "these reasons are the only ones that ever pull".
    expect(pushedEventIds).toHaveLength(0);
    expect(pullPaths).toHaveLength(1);
  });
});
