// The event queue has always had a 3000-event cap, and hitting it discarded the
// OLDEST reviews with no counter, no log line and no surface anywhere: the only
// events the server would never receive were exactly the ones nobody could find
// out about. Every layer still reported success.
//
// These tests pin the counter that makes the loss observable, on both paths
// that can reach the cap (rating and sign-in adoption) and on both partitions
// (a signed-in account and the reserved __pending__ one), and they assert it is
// readable from getProgressSyncDebugState, because a counter nothing can read
// is the same silence with extra steps.
import { describe, it, expect, vi } from 'vitest';

const USER = 'drop-user';
const PENDING = '__pending__';
const qKey = (sub: string) => `devcards:u:${sub}:sync:progressQueue:v1`;
const dropKey = (sub: string) => `devcards:u:${sub}:sync:droppedEvents:v1`;

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

let uuidN = 0;
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => `new-${++uuidN}`) }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// A server that acks nothing and returns nothing: any sync round the scheduler
// starts in the background leaves the queue exactly as the test set it up.
vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async (path: string) => {
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });
    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, userSub: USER, serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      return ok({
        serverTimeMs: 1,
        receivedCount: 0,
        acceptedCount: 0,
        acceptedEventIds: [],
        duplicateEventIds: [],
      });
    }
    return ok({ serverTimeMs: 1, sinceMs: null, items: [] });
  }),
}));

vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => null) }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: vi.fn(async () => []),
  saveDeckProgress: vi.fn(async () => undefined),
  setActiveUserSubForStorage: vi.fn(),
}));

import {
  getProgressSyncDebugState,
  recordReviewEvent,
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';

const MAX_QUEUE_EVENTS = 3000;

function seedQueue(sub: string, count: number, idPrefix: string) {
  const events = Array.from({ length: count }, (_, i) => ({
    eventId: `${idPrefix}-${i}`,
    schemaVersion: 1,
    eventType: 'card_reviewed',
    deckSlug: 'algo',
    deckVersion: null,
    stableUid: `uid-${i}`,
    rating: 3,
    reviewedAtMs: 1_000 + i,
    lastSeenRevision: null,
  }));
  store.set(qKey(sub), JSON.stringify(events));
}

function readQueueIds(sub: string): string[] {
  const raw = store.get(qKey(sub));
  return raw ? (JSON.parse(raw) as any[]).map((e) => String(e.eventId)) : [];
}

function readDropped(sub: string): number {
  return Number(store.get(dropKey(sub)) ?? '0');
}

describe('progressSync queue drop counter', () => {
  it('counts the review a full signed-out queue throws away', async () => {
    store.clear();
    seedQueue(PENDING, MAX_QUEUE_EVENTS, 'old');

    expect(readDropped(PENDING)).toBe(0);

    // No token yet, so this rating lands in the reserved pending partition and
    // pushes the queue one over the cap.
    const id = await recordReviewEvent({
      deckSlug: 'algo',
      stableUid: 'uid-new',
      rating: 'good',
      reviewedAtMs: 9_000,
    });

    const ids = readQueueIds(PENDING);
    expect(ids).toHaveLength(MAX_QUEUE_EVENTS);
    // The oldest event is the one that went, and the new one survived.
    expect(ids).not.toContain('old-0');
    expect(ids).toContain(String(id));
    expect(readDropped(PENDING)).toBe(1);

    // Signed out, the debug state still reports the stranded partition: those
    // events belong to no account, so nothing else would ever show them.
    const debug = await getProgressSyncDebugState();
    expect(debug.userSub).toBeNull();
    expect(debug.pendingQueueSize).toBe(MAX_QUEUE_EVENTS);
    expect(debug.pendingDroppedCount).toBe(1);
  });

  it('counts what adoption drops, against the account that adopted', async () => {
    store.clear();
    seedQueue(USER, MAX_QUEUE_EVENTS, 'own');
    seedQueue(PENDING, 5, 'pending');

    // Sign-in: the pending events are adopted, and the queue is already full.
    await setActiveUserSub(USER);

    expect(readQueueIds(USER)).toHaveLength(MAX_QUEUE_EVENTS);
    expect(readQueueIds(PENDING)).toHaveLength(0);
    expect(readDropped(USER)).toBe(5);

    await setSyncAccessToken('test-token');
    const debug = await getProgressSyncDebugState();
    expect(debug.userSub).toBe(USER);
    expect(debug.queueSize).toBe(MAX_QUEUE_EVENTS);
    expect(debug.droppedCount).toBe(5);
    // Separate numbers on purpose: a signed-in queue overflowing and a
    // signed-out one overflowing are different failures.
    expect(debug.pendingDroppedCount).toBe(0);
  });
});
