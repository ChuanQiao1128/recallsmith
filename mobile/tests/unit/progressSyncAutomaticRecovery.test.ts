import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const net = vi.hoisted(() => ({
  store: new Map<string, string>(),
  mode: 'online' as 'online' | 'offline' | 'lost-ack' | 'bad-request',
  attempts: [] as string[],
  attemptTimes: [] as number[],
  accepted: new Set<string>(),
  pulls: 0,
  user: 'A',
  pullGate: undefined as Promise<void> | undefined,
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => net.store.get(key) ?? null,
  setItem: async (key: string, value: string) => { net.store.set(key, value); },
  removeItem: async (key: string) => { net.store.delete(key); },
  getAllKeys: async () => [...net.store.keys()],
  multiRemove: async (keys: string[]) => { keys.forEach(key => net.store.delete(key)); },
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `event-${net.store.size}-${Date.now()}` }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: async () => null }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: async () => [], updateDeckProgress: vi.fn(), setActiveUserSubForStorage: vi.fn(),
}));
vi.mock('../../src/sync/drawStateSync', () => ({ syncDrawStateNow: async () => {} }));
vi.mock('../../src/sync/clientCapabilities', () => ({ getClientCapabilities: async () => ({ clientFeatures: [], updateId: null }) }));
vi.mock('../../src/sync/progressChanges', () => ({ notifyProgressChanged: vi.fn() }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: async (path: string, opts: any) => {
  const ok = (data: any) => ({ success: true, data, error: null });
  if (path.includes('/user/bootstrap')) return ok({ userSub: net.user });
  if (path.includes('/sync/push')) {
    const ids = opts.body.events.map((event: any) => event.eventId) as string[];
    net.attempts.push(...ids);
    net.attemptTimes.push(Date.now());
    if (net.mode === 'offline') throw Object.assign(new Error('Network request failed'), { kind: 'offline' });
    if (net.mode === 'bad-request') throw Object.assign(new Error('Invalid event'), { status: 400 });
    const duplicateEventIds = ids.filter(id => net.accepted.has(id));
    const acceptedEventIds = ids.filter(id => !net.accepted.has(id));
    ids.forEach(id => net.accepted.add(id));
    if (net.mode === 'lost-ack') {
      net.mode = 'online';
      throw Object.assign(new Error('Request timed out'), { kind: 'timeout' });
    }
    return ok({ acceptedEventIds, duplicateEventIds });
  }
  if (path.includes('/sync/progress')) {
    net.pulls++;
    const gate = net.pullGate; net.pullGate = undefined;
    if (gate) await gate;
    return ok({ items: [] });
  }
  throw new Error('Unexpected endpoint');
} }));

let sync: typeof import('../../src/sync/progressSync');
let guard: typeof import('../../src/sync/syncGuard');
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  net.store.clear(); net.mode = 'online'; net.attempts = []; net.accepted.clear(); net.pulls = 0;
  net.user = 'A';
  net.attemptTimes = [];
  net.pullGate = undefined;
  sync = await import('../../src/sync/progressSync');
  guard = await import('../../src/sync/syncGuard');
  await sync.setActiveUserSub('A');
  await sync.setSyncAccessToken('test-token');
  await vi.advanceTimersByTimeAsync(1);
});
afterEach(async () => {
  await sync.setSyncAccessToken(null);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});
async function rateAndFlush() {
  const id = await sync.recordReviewEvent('test-deck', 'card-1', 'good', Date.now());
  sync.scheduleProgressSync({ delayMs: 0, reason: 'rating' });
  await vi.advanceTimersByTimeAsync(1);
  return id;
}

describe('automatic progress sync recovery', () => {
  it('an empty follow-up does not invalidate a successful readback', async () => {
    const first = await sync.getProgressSyncStatus();
    expect(first.lastPullAtMs).toBeGreaterThan(0);
    sync.scheduleProgressSync({ delayMs: 0, reason: 'app_foreground' });
    await vi.advanceTimersByTimeAsync(1);
    const second = await sync.getProgressSyncStatus();
    expect(second.lastPushAtMs ?? 0).toBeLessThanOrEqual(second.lastPullAtMs!);
    expect(second.error).toBe(false);
  });

  it('automatically confirms an acknowledged rating after the pull throttle', async () => {
    await rateAndFlush();
    const pendingReadback = await sync.getProgressSyncStatus();
    expect(pendingReadback.pending).toBe(0);
    expect(pendingReadback.lastPushAtMs).toBeGreaterThan(pendingReadback.lastPullAtMs!);
    await vi.advanceTimersByTimeAsync(2_001);
    const confirmed = await sync.getProgressSyncStatus();
    expect(confirmed.lastPullAtMs).toBeGreaterThanOrEqual(confirmed.lastPushAtMs!);
    expect(net.accepted.size).toBe(1);
    expect(net.attempts).toHaveLength(1);
  });

  it('retries the same durable event when connectivity returns without a user action', async () => {
    net.mode = 'offline';
    const id = await rateAndFlush();
    expect((await sync.getProgressSyncStatus()).pending).toBe(1);
    expect((await sync.getProgressSyncStatus()).automaticRetry).toBe(true);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(net.attempts.length).toBeGreaterThan(1);
    net.mode = 'online';
    await vi.advanceTimersByTimeAsync(10_001);
    const status = await sync.getProgressSyncStatus();
    expect(status.pending).toBe(0);
    expect(status.error).toBe(false);
    expect(status.lastPullAtMs).toBeGreaterThanOrEqual(status.lastPushAtMs!);
    expect(new Set(net.attempts)).toEqual(new Set([id]));
    expect(net.accepted.size).toBe(1);
  });

  it('a normal ten-second rating flush confirms itself without another trigger', async () => {
    await sync.recordReviewEvent('test-deck', 'card-1', 'good', Date.now());
    sync.scheduleProgressSync({ reason: 'rating' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(net.attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    const status = await sync.getProgressSyncStatus();
    expect(status.pending).toBe(0);
    expect(status.lastPullAtMs).toBeGreaterThanOrEqual(status.lastPushAtMs!);
  });

  it('keeps offline retries bounded at one attempt per minute after backoff', async () => {
    net.mode = 'offline';
    await rateAndFlush();
    await vi.advanceTimersByTimeAsync(3_000 + 10_000 + 30_000 + 60_000 + 60_000 + 10);
    expect(net.attempts).toHaveLength(6);
    [3_000, 10_000, 30_000, 60_000, 60_000].forEach((minimum, i) => {
      expect(net.attemptTimes[i + 1] - net.attemptTimes[i]).toBeGreaterThanOrEqual(minimum);
    });
    expect(net.accepted.size).toBe(0);
    expect((await sync.getProgressSyncStatus()).pending).toBe(1);
  });

  it('never retries the previous account after switching users', async () => {
    net.mode = 'offline';
    const oldId = await rateAndFlush();
    net.user = 'B'; net.mode = 'online';
    await sync.setActiveUserSub('B');
    await sync.setSyncAccessToken('token-B');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(net.attempts).toEqual([oldId]);
    expect((await sync.getProgressSyncStatus()).pending).toBe(0);
    expect(JSON.parse(net.store.get('devcards:u:A:sync:progressQueue:v1')!)).toHaveLength(1);
  });

  it('a late pull from the previous account cannot throttle the new account first readback', async () => {
    await vi.advanceTimersByTimeAsync(2_001);
    let release!: () => void;
    net.pullGate = new Promise<void>(resolve => { release = resolve; });
    sync.scheduleProgressSync({ delayMs: 0, reason: 'manual' });
    await vi.advanceTimersByTimeAsync(1);
    net.user = 'B';
    await sync.setActiveUserSub('B');
    await sync.setSyncAccessToken('token-B');
    await vi.advanceTimersByTimeAsync(1);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await sync.getProgressSyncStatus()).lastPullAtMs).toBeGreaterThan(0);
  });

  it('recovers a lost acknowledgement as a duplicate, without a second accepted review', async () => {
    net.mode = 'lost-ack';
    const id = await rateAndFlush();
    expect((await sync.getProgressSyncStatus()).pending).toBe(1);
    await vi.advanceTimersByTimeAsync(3_001);
    expect(net.attempts).toEqual([id, id]);
    expect(net.accepted.size).toBe(1);
    expect((await sync.getProgressSyncStatus()).pending).toBe(0);
  });

  it('does not repeatedly send a permanent 400 rejection', async () => {
    net.mode = 'bad-request';
    await rateAndFlush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(net.attempts).toHaveLength(1);
    expect((await sync.getProgressSyncStatus()).pending).toBe(1);
  });

  it('pauses retries in the background and resumes recovery on return', async () => {
    net.mode = 'offline';
    await rateAndFlush();
    sync.setProgressSyncAppActive(false);
    net.mode = 'online';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.attempts).toHaveLength(1);
    sync.setProgressSyncAppActive(true);
    await vi.advanceTimersByTimeAsync(1);
    expect((await sync.getProgressSyncStatus()).pending).toBe(0);
    expect(net.accepted.size).toBe(1);
  });

  it.each(['sign-out', 'deletion'] as const)('a scheduled retry stops at %s', async boundary => {
    net.mode = 'offline';
    await rateAndFlush();
    if (boundary === 'sign-out') await sync.setSyncAccessToken(null);
    else guard.blockSync();
    net.mode = 'online';
    await vi.advanceTimersByTimeAsync(120_000);
    expect(net.attempts).toHaveLength(1);
    expect(net.accepted.size).toBe(0);
  });
});
