import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (k: string) => store.get(k) ?? null),
  setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
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
    requested = true;
    const snapshot = rows;
    if (gate) await gate;
    return ok({ items: snapshot, serverTimeMs: 100 });
  }
  throw new Error('Unexpected endpoint in local regression');
}) }));
import { applyCachedRemoteProgress, forceProgressSync, setActiveUserSub, setSyncAccessToken } from '../../src/sync/progressSync';
import { notifyProgressChanged, subscribeProgressChanges } from '../../src/sync/progressChanges';
import { loadDeckProgress, saveDeckProgress, setActiveUserSubForStorage } from '../../src/review/storage';

const T = 1_790_000_000_000;
beforeEach(async () => {
  vi.useFakeTimers(); store.clear(); gate = null; requested = false; installed = false;
  rows = [{ deckSlug: 'deck', stableUid: 'one', status: 1, reviewCount: 1, lastRating: 1,
    lastReviewedAtMs: T, nextReviewAtMs: T + 600_000, srsStage: 0, updatedAtMs: T + 1 }];
  await setActiveUserSub('A'); await setSyncAccessToken('SYNTHETIC');
});
afterEach(async () => { await setSyncAccessToken(null); vi.clearAllTimers(); vi.useRealTimers(); });

describe('progress commit to view notification', () => {
  it('replays a pull cached before installation and only notifies after the durable write', async () => {
    const changes: string[] = [];
    const off = subscribeProgressChanges(({ userSub }) => {
      const saved = JSON.parse(store.get(`devcards:u:${userSub}:deck-progress:deck`)!);
      expect(saved[0].lastReviewedAt).toBe(T);
      changes.push(userSub);
    });
    try {
      const sync = forceProgressSync('manual');
      await vi.advanceTimersByTimeAsync(500);
      await sync;
      expect(changes).toEqual([]);
      installed = true;
      expect(await applyCachedRemoteProgress('deck')).toBe(1);
      expect(changes).toEqual(['A']);
      expect(await applyCachedRemoteProgress('deck')).toBe(0);
      expect(changes).toEqual(['A']);
    } finally { off(); }
  });
  it('discards a pull that arrives after an A to B switch', async () => {
    installed = true;
    let release!: () => void; gate = new Promise(resolve => { release = resolve; });
    const changes = vi.fn(); const off = subscribeProgressChanges(changes);
    try {
      const pending = forceProgressSync('manual');
      await vi.advanceTimersByTimeAsync(1);
      expect(requested).toBe(true);
      await setActiveUserSub('B');
      release(); await vi.advanceTimersByTimeAsync(500); await pending;
      expect(store.has('devcards:u:B:deck-progress:deck')).toBe(false);
      expect(changes).not.toHaveBeenCalled();
    } finally { off(); }
  });
  it('pins a sync write to its original partition even when the active scope has changed', async () => {
    setActiveUserSubForStorage('B');
    await saveDeckProgress(deck, [{ stableUid: 'one', stage: 0, nextReviewAt: T, lastReviewedAt: T }], 'A');
    expect(store.has('devcards:u:A:deck-progress:deck')).toBe(true);
    expect(store.has('devcards:u:B:deck-progress:deck')).toBe(false);
  });
  it('keeps legacy migration in the original partition after the active account changes', async () => {
    setActiveUserSubForStorage('B');
    store.set('devcards:u:A:deck-progress:deck:v1', JSON.stringify([
      { stableUid: 'one', stage: 0, nextReviewAt: T + 600_000, lastReviewedAt: T, lastSeenRevision: 1 }
    ]));
    const restored = await loadDeckProgress(deck, 'A');
    expect(restored[0].lastReviewedAt).toBe(T);
    expect(store.has('devcards:u:A:deck-progress:deck')).toBe(true);
    expect(store.has('devcards:u:B:deck-progress:deck')).toBe(false);
    expect(store.has('devcards:u:B:deck-meta:deck')).toBe(false);
  });
  it('unsubscribes a view and isolates a failing listener', () => {
    const bad = subscribeProgressChanges(() => { throw new Error('view failure'); });
    const seen = vi.fn(); const off = subscribeProgressChanges(seen);
    notifyProgressChanged({ userSub: 'A', deckSlug: 'deck' });
    expect(seen).toHaveBeenCalledTimes(1);
    off(); bad(); notifyProgressChanged({ userSub: 'A', deckSlug: 'deck' });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
