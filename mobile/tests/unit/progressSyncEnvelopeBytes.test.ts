// The owner's contract for the frozen progressSync.ts is "two optional envelope
// fields, nothing else changes on the wire". A test that only checked the new
// keys would pass if a stray null or a reordered key slipped in; comparing
// JSON.stringify(body) against an independently built literal is the only
// assertion that pins the old bytes. This file is the golden-bytes test: it
// mocks clientCapabilities (never expo-updates — the golden test is about the
// envelope, not the read) and drives a real push to capture the batch body.
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const USER = 'envelope-user';
const NOW_MS = 50_000;

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

// Records every push body so the golden assertion can inspect the exact bytes;
// acks every id so the queue drains and the next test starts empty.
const pushedBodies: unknown[] = [];

vi.mock('../../src/api/apiClient', () => ({
  apiJson: vi.fn(async (path: string, opts: any) => {
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });
    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, userSub: USER, serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      pushedBodies.push(opts?.body);
      const ids = (opts?.body?.events ?? []).map((e: any) => String(e.eventId));
      return ok({
        serverTimeMs: 1,
        receivedCount: ids.length,
        acceptedCount: ids.length,
        acceptedEventIds: ids,
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

// This file, and only this file, mocks clientCapabilities; every other
// progressSync suite runs the real module (its dynamic import fails under node
// and yields {}). The capability outcome is swapped per case via capsState.
const capsState = vi.hoisted(() => ({ value: {} as { clientFeatures?: string[]; updateId?: string } }));
vi.mock('../../src/sync/clientCapabilities', () => ({
  getClientCapabilities: vi.fn(async () => capsState.value),
}));

import {
  forceProgressSync,
  recordReviewEvent,
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';

let dateSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  store.set('devcards:deviceId:v1', 'device-golden');
  await setActiveUserSub(USER);
  await setSyncAccessToken('test-token');
});

beforeEach(() => {
  pushedBodies.length = 0;
  capsState.value = {};
  dateSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
});

afterEach(() => {
  dateSpy.mockRestore();
});

// Record after sign-in so the event lands in the user partition and the queue
// cache sees it, then drive one push and hand back the captured body.
async function pushOne(stableUid: string): Promise<{ id: string | null; body: any }> {
  const id = await recordReviewEvent({
    deckSlug: 'algo',
    stableUid,
    rating: 'good',
    reviewedAtMs: 1_000,
  });
  await forceProgressSync('manual');
  expect(pushedBodies).toHaveLength(1);
  return { id, body: pushedBodies[0] };
}

// The per-event bytes are the same in every case — build them once from the
// fixture, mirroring progressSync.ts:1494-1528.
function expectedEvents(id: string | null) {
  return [
    {
      eventId: id,
      schemaVersion: 1,
      eventType: 'card_reviewed',
      type: 'review',
      deckSlug: 'algo',
      deckVersion: null,
      stableUid: 'uid-golden',
      rating: 3,
      sessionId: null,
      cardRevision: null,
      statedDifficulty: null,
      reviewStage: null,
      reviewCountForCard: null,
      dwellTimeMs: null,
      offlineQueueDelayMs: NOW_MS - 1_000,
      reviewedAtMs: 1_000,
      eventTimeMs: 1_000,
      nextReviewAtMs: null,
      schedulerVersion: 'ladder-v1',
      progressAfter: null,
      lastSeenRevision: null,
    },
  ];
}

describe('progressSync envelope bytes', () => {
  it('sends the pre-C14 envelope bytes when the client has no capabilities', async () => {
    capsState.value = {};
    const { id, body } = await pushOne('uid-golden');

    const expected = {
      deviceId: 'device-golden',
      clientPlatform: 'ios',
      clientVersion: 'test',
      events: expectedEvents(id),
    };
    expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
    expect(Object.keys(JSON.parse(JSON.stringify(body)))).toEqual(['deviceId', 'clientPlatform', 'clientVersion', 'events']);
    expect(JSON.stringify(body)).not.toContain('clientFeatures');
    expect(JSON.stringify(body)).not.toContain('updateId');
  });

  it('places clientFeatures and updateId after clientVersion and before events', async () => {
    capsState.value = { clientFeatures: ['mcq'], updateId: 'abc' };
    const { id, body } = await pushOne('uid-golden');

    expect(Object.keys(JSON.parse(JSON.stringify(body)))).toEqual(['deviceId', 'clientPlatform', 'clientVersion', 'clientFeatures', 'updateId', 'events']);
    expect(body.clientFeatures).toEqual(['mcq']);
    expect(body.updateId).toBe('abc');
    expect(JSON.stringify(body.events)).toBe(JSON.stringify(expectedEvents(id)));
  });

  it('keeps an absent capability off the wire', async () => {
    capsState.value = { updateId: 'abc' };
    const { body } = await pushOne('uid-golden');

    expect(Object.keys(JSON.parse(JSON.stringify(body)))).toEqual(['deviceId', 'clientPlatform', 'clientVersion', 'updateId', 'events']);
    expect(JSON.stringify(body)).not.toContain('clientFeatures');
    expect(JSON.stringify(body)).not.toContain('"updateId":null');
  });
});
