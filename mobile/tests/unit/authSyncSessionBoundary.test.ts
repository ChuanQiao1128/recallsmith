import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  store: new Map<string, string>(),
  hold: null as null | { method: string; key: string; entered: () => void; gate: Promise<void> },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => {
    const value = state.store.get(key) ?? null;
    if (state.hold?.method === 'get' && state.hold.key === key) {
      const hold = state.hold; state.hold = null; hold.entered(); await hold.gate;
    }
    return value;
  },
  setItem: async (key: string, value: string) => {
    if (state.hold?.method === 'set' && state.hold.key === key) {
      const hold = state.hold; state.hold = null; hold.entered(); await hold.gate;
    }
    state.store.set(key, value);
  },
  removeItem: async (key: string) => {
    if (state.hold?.method === 'remove' && state.hold.key === key) {
      const hold = state.hold; state.hold = null; hold.entered(); await hold.gate;
    }
    state.store.delete(key);
  },
  getAllKeys: async () => [...state.store.keys()],
  multiRemove: async (keys: string[]) => { keys.forEach((key) => state.store.delete(key)); },
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'event-1' }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../../src/content/deckRepository', () => ({ resolveDeckBySlug: async () => null }));
vi.mock('../../src/review/storage', () => ({
  loadDeckProgress: async () => [], updateDeckProgress: vi.fn(), setActiveUserSubForStorage: vi.fn(),
}));
vi.mock('../../src/sync/drawStateSync', () => ({ syncDrawStateNow: async () => {} }));
vi.mock('../../src/sync/clientCapabilities', () => ({ getClientCapabilities: async () => ({ clientFeatures: [] }) }));
vi.mock('../../src/api/apiClient', () => ({ apiJson: vi.fn() }));

const TOKEN_KEY = 'devcards:auth:accessToken:v1';
const SUB_KEY = 'devcards:auth:activeUserSub:v1';
let sync: typeof import('../../src/sync/progressSync');
let boundary: typeof import('../../src/auth/sessionBoundary');
let storage: typeof import('../../src/review/storage');
let api: typeof import('../../src/api/apiClient');

function token(sub: string) {
  return `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`;
}

function park(method: string, key: string) {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const started = new Promise<void>((done) => { entered = done; });
  state.hold = { method, key, entered, gate };
  return { release, started };
}

async function allowConcurrentWork() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  state.store.clear(); state.hold = null;
  sync = await import('../../src/sync/progressSync');
  boundary = await import('../../src/auth/sessionBoundary');
  storage = await import('../../src/review/storage');
  api = await import('../../src/api/apiClient');
  vi.mocked(api.apiJson).mockReset();
  vi.mocked(api.apiJson).mockResolvedValue({ data: { items: [] } });
  vi.mocked(storage.setActiveUserSubForStorage).mockClear();
});

afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers();
});

describe('sync identity session boundaries', () => {
  it('keeps B token and scope when an old token cleanup finishes after the switch', async () => {
    await sync.setActiveUserSub('A');
    await sync.setSyncAccessToken('A-token');
    const cleanup = park('remove', TOKEN_KEY);
    const old = sync.setSyncAccessToken(null);
    await cleanup.started;
    boundary.invalidateAuthSession();
    const next = (async () => {
      await sync.setActiveUserSub('B');
      await sync.setSyncAccessToken('B-token');
    })();
    await allowConcurrentWork();
    cleanup.release();
    await Promise.all([old, next]);

    expect(state.store.get(TOKEN_KEY)).toBe('B-token');
    expect(state.store.get(SUB_KEY)).toBe('B');
    expect(storage.setActiveUserSubForStorage).toHaveBeenLastCalledWith('B');
  });

  it('keeps B scope when an older scope read finishes after the switch', async () => {
    const read = park('get', SUB_KEY);
    const old = sync.setActiveUserSub('A');
    await read.started;
    boundary.invalidateAuthSession();
    const next = sync.setActiveUserSub('B');
    await allowConcurrentWork();
    read.release();
    await Promise.all([old, next]);

    expect(state.store.get(SUB_KEY)).toBe('B');
    expect(storage.setActiveUserSubForStorage).toHaveBeenLastCalledWith('B');
  });

  it('keeps B scope when an old scope removal finishes after the switch', async () => {
    await sync.setActiveUserSub('A');
    const cleanup = park('remove', SUB_KEY);
    const old = sync.setActiveUserSub(null);
    await cleanup.started;
    boundary.invalidateAuthSession();
    const next = sync.setActiveUserSub('B');
    await allowConcurrentWork();
    cleanup.release();
    await Promise.all([old, next]);

    expect(state.store.get(SUB_KEY)).toBe('B');
    expect(storage.setActiveUserSubForStorage).toHaveBeenLastCalledWith('B');
  });

  it('keeps B token when an old token write finishes after the switch', async () => {
    const write = park('set', TOKEN_KEY);
    const old = sync.setSyncAccessToken('A-token');
    await write.started;
    boundary.invalidateAuthSession();
    const next = sync.setSyncAccessToken('B-token');
    await allowConcurrentWork();
    write.release();
    await Promise.all([old, next]);

    expect(state.store.get(TOKEN_KEY)).toBe('B-token');
  });

  it('does not cache or use an old persisted token read after B signs in', async () => {
    state.store.set(TOKEN_KEY, token('A'));
    state.store.set(SUB_KEY, 'A');
    const read = park('get', TOKEN_KEY);
    const pending = sync.getProgressSyncDebugState();
    await read.started;
    boundary.invalidateAuthSession();
    await sync.setActiveUserSub('B');
    await sync.setSyncAccessToken(token('B'));
    read.release();

    expect((await pending).userSub).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(api.apiJson).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(api.apiJson).mock.calls.every(([, opts]) => opts.accessToken === token('B'))).toBe(true);
    expect((await sync.getProgressSyncDebugState()).userSub).toBe('B');
  });

  it('does not cache an old persisted scope read after B signs in', async () => {
    state.store.set(SUB_KEY, 'A');
    await sync.setSyncAccessToken(token('A'));
    const read = park('get', SUB_KEY);
    const pending = sync.getProgressSyncDebugState();
    await read.started;
    boundary.invalidateAuthSession();
    await sync.setActiveUserSub('B');
    await sync.setSyncAccessToken(token('B'));
    read.release();

    expect((await pending).userSub).toBeNull();
    expect((await sync.getProgressSyncDebugState()).userSub).toBe('B');
  });

  it('never pairs a readable A token with the B sync scope', async () => {
    await sync.setActiveUserSub('B');
    await sync.setSyncAccessToken(token('A'));

    expect((await sync.getProgressSyncDebugState()).userSub).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.apiJson).not.toHaveBeenCalled();
  });

  it('does not continue an older same-sub sync after a new session generation starts', async () => {
    let finish!: (value: any) => void;
    const bootstrap = new Promise<any>((resolve) => { finish = resolve; });
    vi.mocked(api.apiJson).mockReturnValueOnce(bootstrap);
    await sync.setActiveUserSub('A');
    await sync.setSyncAccessToken(token('A'));
    await vi.advanceTimersByTimeAsync(1);
    expect(api.apiJson).toHaveBeenCalledTimes(1);
    boundary.invalidateAuthSession();
    await sync.setActiveUserSub('A');
    await sync.setSyncAccessToken(token('A'));
    finish({ data: { userSub: 'A' } });
    await allowConcurrentWork();

    // A new generation's scheduled sync has not fired yet. The old run must
    // finish without starting its push/pull or a draw-state request.
    expect(api.apiJson).toHaveBeenCalledTimes(1);
    expect(sync.isProgressSyncInFlight()).toBe(false);
  });
});
