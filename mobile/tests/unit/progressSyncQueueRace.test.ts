import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Interleaving-injection tests for the progressSync event queue.
 *
 * The queue lives behind a single AsyncStorage key and every mutation is a
 * read-modify-write. Single-threaded JS does not make that safe: between the
 * read and the write there are awaits, and another caller can have replaced the
 * whole array in the meantime. The two callers that overlap in production are
 * the push-ack path (remove acked ids, runs inside forceProgressSync) and the
 * rating path (enqueue, runs when the user grades a card), so the exact bug is:
 * remove holds a stale snapshot and writes it back, deleting the event that was
 * enqueued after it read. Local progress is already saved, so the UI looks
 * perfect and the loss only surfaces on another device.
 *
 * These tests force that interleaving instead of hoping for it: writes to the
 * queue key are parked, then released last-parked-first, which is the adversarial
 * order where the staler snapshot lands last. With the queue serializer in place
 * only one critical section can be in flight at a time, so the release order
 * stops mattering.
 */

const USER = 'race-user';
const QUEUE_KEY = `devcards:u:${USER}:sync:progressQueue:v1`;

/** In-memory AsyncStorage with a parking lot for writes to the queue key. */
const store = new Map<string, string>();

type ParkedWrite = { value: string; release: () => void };
const parkedWrites: ParkedWrite[] = [];
let holdQueueWrites = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      if (holdQueueWrites && key === QUEUE_KEY) {
        await new Promise<void>((resolve) => {
          parkedWrites.push({ value, release: resolve });
        });
      }
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
  randomUUID: vi.fn(() => `ev-${++uuidN}`),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: 'test' } },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

/** Scripted API: bootstrap is canned, push acks everything, pull is always empty. */
const pushedBatches: string[][] = [];

vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async (path: string, opts: any) => {
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });
    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, userSub: USER, serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      const ids = (opts?.body?.events ?? []).map((e: any) => String(e.eventId));
      pushedBatches.push(ids);
      return ok({
        serverTimeMs: 1,
        receivedCount: ids.length,
        acceptedCount: ids.length,
        acceptedEventIds: ids,
        duplicateEventIds: [],
      });
    }
    if (path.startsWith('/api/v1/sync/progress')) {
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

function readStoredQueue(): any[] {
  const raw = store.get(QUEUE_KEY);
  if (!raw) return [];
  const arr = JSON.parse(raw);
  return Array.isArray(arr) ? arr : [];
}

function rate(uid: string) {
  return recordReviewEvent({
    deckSlug: 'algo',
    stableUid: uid,
    rating: 'good',
    reviewedAtMs: 1_000,
  });
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function waitForParked(n: number, budgetMs = 1000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (parkedWrites.length < n && Date.now() < deadline) await tick(2);
}

/**
 * Release every parked write last-parked-first until the given operations
 * settle. LIFO is the adversarial order: the write that read the queue EARLIEST
 * lands LAST, so a stale snapshot gets the final word. Serialized code never has
 * more than one write parked, so the order is a no-op there.
 */
async function drainParkedWrites(...ops: Promise<unknown>[]): Promise<void> {
  let settled = false;
  const all = Promise.allSettled(ops).then(() => {
    settled = true;
  });
  for (let i = 0; i < 400 && !settled; i++) {
    while (parkedWrites.length > 0) parkedWrites.pop()!.release();
    await tick(2);
  }
  holdQueueWrites = false;
  while (parkedWrites.length > 0) parkedWrites.pop()!.release();
  await all;
}

beforeAll(async () => {
  await setActiveUserSub(USER);
  await setSyncAccessToken('test-token');
  await forceProgressSync('manual');
});

beforeEach(async () => {
  holdQueueWrites = false;
  parkedWrites.length = 0;
  await resetProgressSyncState();
  pushedBatches.length = 0;
  store.delete(QUEUE_KEY);
});

describe('progressSync queue read-modify-write races', () => {
  it('an enqueue that lands mid-ack is not deleted by the ack write', async () => {
    // Seed one event so the sync round has something to push and ack.
    const seededId = await rate('u-seed');
    expect(readStoredQueue().map((e) => e.eventId)).toEqual([seededId]);

    holdQueueWrites = true;

    // Sync pushes the seeded event, gets an ack, and parks its remove-write.
    const syncOp = forceProgressSync('manual');
    await waitForParked(1);
    expect(parkedWrites).toHaveLength(1);

    // The user grades another card while the ack write is still parked. Under
    // the old code this enqueue reads the pre-ack queue, and its write is then
    // clobbered by the ack write that read even earlier.
    const ratingOp = rate('u-new');

    // Give the enqueue room to reach its own write. Unserialized it parks a
    // second write here (both snapshots now stale relative to each other);
    // serialized it is still blocked on the lock and this just times out.
    await waitForParked(2, 500);

    await drainParkedWrites(syncOp, ratingOp);

    const newId = await ratingOp;
    expect(newId).toBeTruthy();

    const finalIds = readStoredQueue().map((e) => String(e.eventId));
    // The un-acked event survives: it is a fact the server has never seen.
    expect(finalIds).toContain(newId);
    // The acked one is gone: keeping it would re-push work the server has.
    expect(finalIds).not.toContain(seededId);
    expect(pushedBatches[0]).toEqual([seededId]);
  });

  it('two ratings graded back to back both reach the queue', async () => {
    holdQueueWrites = true;

    // Two enqueues in flight at once: both read the queue, both write it back.
    // Without serialization the later write wins and one review is erased.
    const first = rate('u-a');
    const second = rate('u-b');

    await drainParkedWrites(first, second);

    const firstId = await first;
    const secondId = await second;
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);

    const finalIds = readStoredQueue().map((e) => String(e.eventId));
    expect(finalIds).toHaveLength(2);
    expect(finalIds).toContain(firstId);
    expect(finalIds).toContain(secondId);
  });
});
