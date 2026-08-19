import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The remote version-gate config sits in front of every cold start, so what
 * this file requests and what it does when the request fails are both
 * launch-latency decisions, not networking trivia.
 */

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
  },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.4.0' }, appOwnership: null },
}));

vi.mock('expo-application', () => ({
  nativeApplicationVersion: '1.4.0',
}));

import {
  compareSemver,
  fetchRemoteConfig,
  loadCachedRemoteConfig,
  loadRemoteConfig,
  resolveIosUpdate,
} from '../../src/config/remoteConfig';

const CONFIG_URL = 'https://cdn.test/recallsmith-config.json';
const CACHE_KEY = 'recallsmith:remote-config:last-good:v1';

type FetchCall = { url: string; init: any };
const fetchCalls: FetchCall[] = [];

function scriptFetch(responder: (call: FetchCall) => any) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: any) => {
    const call = { url: String(url), init };
    fetchCalls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const GATING_CONFIG = { ios: { minSupportedVersion: '2.0.0', appStoreId: '123' } };

describe('fetchRemoteConfig', () => {
  beforeEach(() => {
    store.clear();
    fetchCalls.length = 0;
  });

  it('requests the config URL unchanged, with no per-launch cache buster', async () => {
    scriptFetch(() => okJson(GATING_CONFIG));

    await fetchRemoteConfig(CONFIG_URL);

    expect(fetchCalls).toHaveLength(1);
    // A `?t=<now>` made every launch a guaranteed origin round trip.
    expect(fetchCalls[0].url).toBe(CONFIG_URL);
    expect(fetchCalls[0].url).not.toMatch(/[?&]t=/);
    // Revalidation is still requested; that is the part that was doing work.
    expect(fetchCalls[0].init.headers['cache-control']).toBe('no-cache');
  });

  it('remembers the last config that parsed', async () => {
    scriptFetch(() => okJson(GATING_CONFIG));

    await fetchRemoteConfig(CONFIG_URL);

    expect(JSON.parse(store.get(CACHE_KEY)!)).toEqual(GATING_CONFIG);
    expect(await loadCachedRemoteConfig()).toEqual(GATING_CONFIG);
  });

  it('does not cache a non-2xx response', async () => {
    scriptFetch(() => ({ ok: false, status: 503, json: async () => ({ ios: {} }) }) as unknown as Response);

    expect(await fetchRemoteConfig(CONFIG_URL)).toBeNull();
    expect(store.has(CACHE_KEY)).toBe(false);
  });

  it('aborts a request that outlives its timeout instead of holding the caller', async () => {
    let seenSignal: AbortSignal | null = null;
    scriptFetch(
      (call) =>
        new Promise((_resolve, reject) => {
          seenSignal = call.init.signal;
          call.init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const result = await fetchRemoteConfig(CONFIG_URL, 5);

    expect(result).toBeNull();
    expect(seenSignal).not.toBeNull();
    expect(seenSignal!.aborted).toBe(true);
  });
});

describe('loadRemoteConfig', () => {
  beforeEach(() => {
    store.clear();
    fetchCalls.length = 0;
  });

  it('falls back to the last good config when the network is gone', async () => {
    scriptFetch(() => okJson(GATING_CONFIG));
    await loadRemoteConfig(CONFIG_URL);

    scriptFetch(() => {
      throw new Error('offline');
    });
    const offline = await loadRemoteConfig(CONFIG_URL);

    // Losing wifi is not how a user gets out from under a version floor.
    expect(offline).toEqual(GATING_CONFIG);
    expect(resolveIosUpdate(offline!, '1.4.0').forceUpdate).toBe(true);
  });

  it('returns null on a device that has never read the config', async () => {
    scriptFetch(() => {
      throw new Error('offline');
    });

    expect(await loadRemoteConfig(CONFIG_URL)).toBeNull();
  });

  it('prefers a fresh config over the cached one', async () => {
    scriptFetch(() => okJson(GATING_CONFIG));
    await loadRemoteConfig(CONFIG_URL);

    const relaxed = { ios: { minSupportedVersion: '1.0.0' } };
    scriptFetch(() => okJson(relaxed));

    expect(await loadRemoteConfig(CONFIG_URL)).toEqual(relaxed);
    expect(resolveIosUpdate((await loadCachedRemoteConfig())!, '1.4.0').forceUpdate).toBe(false);
  });
});

describe('resolveIosUpdate', () => {
  it('compares against the running version, so upgrading clears a cached gate', () => {
    expect(resolveIosUpdate(GATING_CONFIG, '1.4.0').forceUpdate).toBe(true);
    expect(resolveIosUpdate(GATING_CONFIG, '2.0.0').forceUpdate).toBe(false);
    expect(compareSemver('1.4.0', '2.0.0')).toBe(-1);
  });
});
