import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let failCache = false;
let failPull = false;
let failQueue = false;
let failRead: string | null = null;
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (k: string) => { if (k === failRead) throw new Error('SIMULATED_READ_FAILURE'); return store.get(k) ?? null; }),
  setItem: vi.fn(async (k: string, v: string) => {
    if (failQueue && k.endsWith('sync:progressQueue:v1')) throw new Error('SIMULATED_STORAGE_FULL');
    if (failCache && k.endsWith('sync:remoteCache:v1:deck')) throw new Error('SIMULATED_STORAGE_FULL');
    store.set(k, v);
  }),
  removeItem: vi.fn(async (k: string) => { store.delete(k); }),
  getAllKeys: vi.fn(async () => [...store.keys()]),
  multiRemove: vi.fn(async (keys: string[]) => keys.forEach(k => store.delete(k))),
} }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'synthetic') }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/sync/clientCapabilities', () => ({ getClientCapabilities: vi.fn(async () => ({})) }));
vi.mock('../../src/sync/drawStateSync', () => ({ syncDrawStateNow: vi.fn(async () => {}) }));
const deck: any = { Slug: 'deck', Version: 'v1', Cards: [{ StableUid: 'one', Revision: 1 }], TotalCards: 1 };
let installed = false;
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: vi.fn(async () => installed ? deck : null) }));
let gate: Promise<void> | null = null;
let requested = false;
let rows: any[] = [];
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn(async (path: string) => {
  const ok = (data: any) => ({ success: true, data });
  if (path.includes('bootstrap')) return ok({ userSub: store.get('devcards:auth:activeUserSub:v1') });
  if (path.includes('/sync/progress')) {
    if (failPull) throw new Error('SIMULATED_HTTP_503');
    requested = true;
    const snapshot = path.includes('cursor=cursor-review') ? [] : rows;
    if (gate) await gate;
    return ok({ items: snapshot, serverTimeMs: T + 2, nextCursor: 'cursor-review', hasMore: false });
  }
  throw new Error('Unexpected endpoint in local regression');
}) }));
import { invalidateProgressQueueCache } from '../../src/sync/progressQueueCache';
import { recordReviewEvent, getProgressSyncDebugState, applyCachedRemoteProgress, forceProgressSync, setActiveUserSub, setSyncAccessToken } from '../../src/sync/progressSync';
import { notifyProgressChanged, subscribeProgressChanges } from '../../src/sync/progressChanges';
import { loadDeckProgress, saveDeckProgress, updateDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';

const T = 1_790_000_000_000;
beforeEach(async () => {
  vi.useFakeTimers(); store.clear(); failRead = null; failCache = false; failPull = false; failQueue = false; gate = null; requested = false; installed = false;
  rows = [{ deckSlug: 'deck', stableUid: 'one', status: 1, reviewCount: 1, lastRating: 1,
    lastReviewedAtMs: T, nextReviewAtMs: T + 600_000, srsStage: 0, updatedAtMs: T + 1 }];
  await setActiveUserSub(null); await setActiveUserSub('A'); await setSyncAccessToken('SYNTHETIC');
});
afterEach(async () => { await setSyncAccessToken(null); vi.clearAllTimers(); vi.useRealTimers(); });

async function sync() { const p = forceProgressSync('manual'); await vi.advanceTimersByTimeAsync(500); await p; }
describe('durable sync failure recovery', () => {
  it('does not overwrite existing facts after a cold queue read fails', async () => {
    const key = 'devcards:u:A:sync:progressQueue:v1';
    store.set(key, JSON.stringify([{ eventId: 'older-fact' }]));
    invalidateProgressQueueCache('A'); failRead = key;
    await expect(recordReviewEvent({ deckSlug: 'deck', stableUid: 'one', rating: 'hard' })).rejects.toThrow('SIMULATED_READ_FAILURE');
    expect(JSON.parse(store.get(key)!)).toEqual([{ eventId: 'older-fact' }]);
  });
  it('does not replace cached older rows after a remote cache read fails', async () => {
    const key = 'devcards:u:A:sync:remoteCache:v1:deck';
    const previous = JSON.stringify({ older: { stableUid: 'older', updatedAtMs: T - 1 } });
    store.set(key, previous); failRead = key;
    await sync();
    expect(store.get(key)).toBe(previous);
    expect(store.has('devcards:u:A:sync:cursor:v2')).toBe(false);
    failRead = null; await vi.advanceTimersByTimeAsync(2500); await sync();
    expect(Object.keys(JSON.parse(store.get(key)!))).toEqual(['older', 'one']);
  });
  it('serializes a rating and a remote merge from fresh snapshots in the captured partition', async () => {
    const two: any = { ...deck, Cards: [...deck.Cards, { StableUid: 'two', Revision: 1 }] };
    await loadDeckProgress(two, 'A');
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const first = updateDeckProgress(two, async fresh => {
      await held;
      return fresh.map(p => p.stableUid === 'one' ? { ...p, lastReviewedAt: T, nextReviewAt: T + 600000 } : p);
    }, 'A');
    const second = updateDeckProgress(two, fresh => fresh.map(p => p.stableUid === 'two'
      ? { ...p, lastReviewedAt: T + 1, nextReviewAt: T + 700000, fsrsStability: 4 } : p), 'A');
    setActiveUserSubForStorage('B');
    release(); await first; await second;
    const saved = await loadDeckProgress(two, 'A');
    expect(saved.find(p => p.stableUid === 'one')?.lastReviewedAt).toBe(T);
    expect(saved.find(p => p.stableUid === 'two')?.fsrsStability).toBe(4);
    expect(store.has('devcards:u:B:deck-progress:deck')).toBe(false);
  });
  it('rejects a review whose queue write failed, then persists one event on retry', async () => {
    failQueue = true;
    const input = { eventId: 'same-intent', deckSlug: 'deck', stableUid: 'one', rating: 'hard', reviewedAtMs: T };
    await expect(recordReviewEvent(input)).rejects.toThrow('SIMULATED_STORAGE_FULL');
    expect(store.has('devcards:u:A:sync:progressQueue:v1')).toBe(false);
    expect((await getProgressSyncDebugState()).queueSize).toBe(0);
    failQueue = false;
    await recordReviewEvent(input); await recordReviewEvent(input);
    expect((await getProgressSyncDebugState()).queueSize).toBe(1);
  });
  it('retains the cursor on failed cache write and replays the missing deck', async () => {
    store.set('devcards:u:A:sync:remoteCache:v1:other', '{}');
    failCache = true; await sync();
    expect(store.has('devcards:u:A:sync:remoteCache:v1:deck')).toBe(false);
    expect(store.has('devcards:u:A:sync:cursor:v2')).toBe(false);
    failCache = false; installed = true; await vi.advanceTimersByTimeAsync(2500); await sync();
    expect(await applyCachedRemoteProgress('deck')).toBe(0);
    expect(JSON.parse(store.get('devcards:u:A:deck-progress:deck')!)[0].lastReviewedAt).toBe(T);
  });
  it('retains an error after a failed pull without claiming a completed sync', async () => {
    failPull = true; await sync();
    expect(store.has('devcards:u:A:sync:last:v1')).toBe(false);
    expect(store.has('devcards:u:A:sync:lastError:v1')).toBe(true);
  });
});
