import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signed-out reviews, and what happens to them at sign-in.
 *
 * The old behaviour was a silent drop: recordReviewEvent returned null without a
 * token, so a review done on a plane was a fact the system never had. These
 * tests pin the replacement: the event is written to a reserved PENDING_SUB
 * queue partition, and the next account to sign in adopts it.
 *
 * The third test is the interesting one. Adoption copies into the user queue
 * before clearing pending, so a crash between the two leaves duplicates rather
 * than losses. That trade is only sound if the duplicates are absorbed, so the
 * test kills the process (by losing the clear-write) and then checks the two
 * absorbers in order: adoption skips eventIds already queued, and the server
 * keys rows by eventId, so a re-adopted event that was already pushed comes back
 * as a duplicate and stores nothing new.
 */

const USER = 'adopt-user';
const OTHER_USER = 'adopt-user-2';
const TOKEN = 'test-token';

const PENDING_QUEUE_KEY = 'devcards:u:__pending__:sync:progressQueue:v1';
const userQueueKey = (sub: string) => `devcards:u:${sub}:sync:progressQueue:v1`;

const store = new Map<string, string>();

/**
 * Simulates dying right after the copy: the clear-write never reaches disk.
 *
 * Injected as a REJECTED setItem rather than a silently ignored one. Both leave
 * the pending events on disk, which is the condition the test is about, but a
 * silent success is not a failure mode AsyncStorage has, and progressSync now
 * keeps a parsed copy of the queue in memory: told the write succeeded, it
 * would go on believing the partition was cleared, and the simulated crash
 * would only be visible on disk. A rejection is what a real storage failure
 * looks like, and it makes the module drop its cached copy, so both storage and
 * memory agree the clear never happened.
 */
let dropPendingClearWrite = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      if (dropPendingClearWrite && key === PENDING_QUEUE_KEY && value === '[]') {
        throw new Error('simulated storage failure: pending clear-write lost');
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

/**
 * Fake server with the real idempotency rule: event_id is the primary key, so a
 * second delivery of the same id inserts nothing and answers "duplicate".
 */
const serverRows = new Map<string, { userSub: string; stableUid: string }>();
const deliveries = new Map<string, number>();
let activeServerUser = USER;

function deliver(events: any[]) {
  const acceptedEventIds: string[] = [];
  const duplicateEventIds: string[] = [];

  for (const e of events) {
    const id = String(e.eventId);
    deliveries.set(id, (deliveries.get(id) ?? 0) + 1);

    if (serverRows.has(id)) {
      duplicateEventIds.push(id);
      continue;
    }
    serverRows.set(id, { userSub: activeServerUser, stableUid: String(e.stableUid) });
    acceptedEventIds.push(id);
  }

  return { acceptedEventIds, duplicateEventIds };
}

vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async (path: string, opts: any) => {
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });

    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, userSub: activeServerUser, serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      const events = opts?.body?.events ?? [];
      const { acceptedEventIds, duplicateEventIds } = deliver(events);
      return ok({
        serverTimeMs: 1,
        receivedCount: events.length,
        acceptedCount: acceptedEventIds.length,
        acceptedEventIds,
        duplicateEventIds,
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
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';

function idsIn(key: string): string[] {
  const raw = store.get(key);
  if (!raw) return [];
  const arr = JSON.parse(raw);
  return Array.isArray(arr) ? arr.map((e: any) => String(e?.eventId)) : [];
}

const pendingIds = () => idsIn(PENDING_QUEUE_KEY);
const queueIds = (sub: string = USER) => idsIn(userQueueKey(sub));

function rate(uid: string) {
  return recordReviewEvent({
    deckSlug: 'algo',
    stableUid: uid,
    rating: 'good',
    reviewedAtMs: 1_000,
    progressAfter: { stableUid: uid, stage: 2, nextReviewAt: 2_000 },
  });
}

async function signIn(sub: string = USER) {
  activeServerUser = sub;
  await setSyncAccessToken(TOKEN);
  await setActiveUserSub(sub);
}

beforeEach(async () => {
  // Sign out through the real entry point so the module's in-memory token and
  // sub are cleared the same way the app clears them.
  await setSyncAccessToken(null);
  await forceProgressSync('manual');

  dropPendingClearWrite = false;
  store.clear();
  serverRows.clear();
  deliveries.clear();
  activeServerUser = USER;
});

describe('signed-out reviews reach the pending partition', () => {
  it('a rating with no token is queued instead of dropped', async () => {
    const first = await rate('u-a');
    const second = await rate('u-b');

    // The old contract was `return null`; the event now exists and is durable.
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(pendingIds()).toEqual([first, second]);

    // Nothing was written under a user partition: there is no user yet, and
    // guessing one is what adoption is for.
    expect(queueIds()).toEqual([]);
  });
});

describe('adoption at sign-in', () => {
  it('moves pending events into the account queue and pushes them', async () => {
    const first = await rate('u-a');
    const second = await rate('u-b');

    await signIn();
    await forceProgressSync('manual');

    // Copy happened, clear happened, and the server has both facts.
    expect(pendingIds()).toEqual([]);
    expect(queueIds()).toEqual([]);
    expect([...serverRows.keys()].sort()).toEqual([first, second].sort());
    expect(serverRows.get(String(first))?.userSub).toBe(USER);
  });

  it('adopting twice is a no-op the second time', async () => {
    const first = await rate('u-a');

    await signIn();
    expect(queueIds()).toEqual([first]);
    expect(pendingIds()).toEqual([]);

    // Re-entering the same sub (app restart, token refresh) runs adoption again.
    await setActiveUserSub(USER);
    await setActiveUserSub(USER);

    expect(queueIds()).toEqual([first]);

    await forceProgressSync('manual');
    expect(deliveries.get(String(first))).toBe(1);
    expect(serverRows.size).toBe(1);
  });

  it('a review taken after sign-in never enters the pending partition', async () => {
    await signIn();
    const id = await rate('u-live');

    expect(queueIds()).toEqual([id]);
    expect(pendingIds()).toEqual([]);
  });

  it('only the account that signs in adopts: a later account gets nothing', async () => {
    const first = await rate('u-a');

    await signIn(USER);
    expect(queueIds(USER)).toEqual([first]);

    await setActiveUserSub(OTHER_USER);
    expect(queueIds(OTHER_USER)).toEqual([]);
  });
});

describe('crash between copy and clear', () => {
  it('leaves duplicates, and neither queue nor server ends up with any', async () => {
    const first = await rate('u-a');
    const second = await rate('u-b');

    // Crash injection: the copy lands, the clear does not.
    dropPendingClearWrite = true;
    await signIn();

    expect(queueIds()).toEqual([first, second]);
    expect(pendingIds()).toEqual([first, second]);

    // Absorber 1, in-queue dedupe: re-running adoption while the copies are
    // still queued adds nothing.
    await setActiveUserSub(USER);
    expect(queueIds()).toEqual([first, second]);

    await forceProgressSync('manual');
    expect(queueIds()).toEqual([]);
    expect(serverRows.size).toBe(2);

    // Absorber 2, server-side event_id: the copies are gone from the queue by
    // now, so the surviving pending events really do get re-adopted and
    // re-pushed. They must still store nothing new.
    dropPendingClearWrite = false;
    await setActiveUserSub(USER);
    expect(queueIds()).toEqual([first, second]);
    expect(pendingIds()).toEqual([]);

    await forceProgressSync('manual');

    expect(deliveries.get(String(first))).toBe(2);
    expect(deliveries.get(String(second))).toBe(2);
    // Two reviews happened, so two rows exist. The crash cost a redundant push,
    // not a duplicated review and not a lost one.
    expect(serverRows.size).toBe(2);
    expect([...serverRows.keys()].sort()).toEqual([first, second].sort());
    expect(queueIds()).toEqual([]);
  });
});
