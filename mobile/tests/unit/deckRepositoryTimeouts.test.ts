import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * Two remote calls used to sit on this file's *local read* paths with no
 * deadline and, in one case, with no reason to be there at all:
 *
 *   - resolveDeckBySlug awaited /api/v1/entitlements before opening a file
 *     already on the phone, for every deck including free ones.
 *   - fetchRemoteManifest issued a bare fetch(), which on a network that
 *     accepts connections and never answers simply never settles.
 *
 * These tests are about what the user experiences at the end of those two
 * calls: whether the app can read its own content, and whether it can lose
 * content it already paid for.
 */

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';
});

const store = new Map<string, string>();
const files = new Map<string, string>();
const deletedFiles: string[] = [];

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

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    const found = files.get(uri);
    if (found == null) throw new Error('ENOENT');
    return found;
  }),
  writeAsStringAsync: vi.fn(async (uri: string, text: string) => {
    files.set(uri, text);
  }),
  deleteAsync: vi.fn(async (uri: string) => {
    deletedFiles.push(uri);
    files.delete(uri);
  }),
  moveAsync: vi.fn(async () => {}),
  getInfoAsync: vi.fn(async (uri: string) => ({ exists: files.has(uri), isDirectory: false, uri })),
  makeDirectoryAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
  downloadAsync: vi.fn(async () => ({ status: 404 })),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_alg: string, text: string) =>
    createHash('sha256').update(text, 'utf8').digest('hex'),
  ),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({
    userSub: 'user1',
    tokens: { accessToken: 'access-token-1' },
  })),
}));

let localPremiumFixture = false;
vi.mock('../../src/premium/premiumStore', () => ({
  getIsPremiumUser: vi.fn(async () => localPremiumFixture),
}));

// The repository keeps a 60s in-process cache of the entitlements answer, so
// a test that lets a previous test's answer leak in is testing the cache.
// Fresh module per test.
async function loadRepo() {
  vi.resetModules();
  return await import('../../src/content/deckRepository');
}

const MANIFEST_URL = 'https://cdn.test/content/manifest.json';
const ENTITLEMENTS_URL = 'https://api.test/api/v1/entitlements';
const CACHE_KEY = 'devcards:content:manifest:v2';
const DECK_FILE = 'file:///docs/devcards-decks-v2/user1/algo.json';

function manifestJson(tier: 'free' | 'premium') {
  return {
    schemaVersion: 2,
    generatedAtMs: 1,
    prefix: 'content',
    decks: [
      {
        slug: 'algo',
        title: 'Algo',
        locale: 'en-US',
        deckType: 1,
        tier,
        availability: 'live',
        downloadMode: 'public',
        totalCards: 1,
        version: 'v1',
        buildId: 'v1',
        path: 'decks/algo/builds/v1/deck.json',
        sha256: null,
        patches: null,
      },
    ],
  };
}

function seedInstalledDeck(tier: 'free' | 'premium') {
  store.set(CACHE_KEY, JSON.stringify(manifestJson(tier)));
  store.set(
    'devcards:content:deckmeta:v2:user1:algo',
    JSON.stringify({ slug: 'algo', buildId: 'v1', fileUri: DECK_FILE, installedAtMs: 1 }),
  );
  files.set(
    DECK_FILE,
    JSON.stringify({
      slug: 'algo',
      title: 'Algo',
      locale: 'en-US',
      deckType: 1,
      version: 'v1',
      cards: [{ stableUid: 'a1', question: 'Q1', difficulty: 2 }],
    }),
  );
}

type Call = { url: string; init: any };
const calls: Call[] = [];
let respond: (call: Call) => any = () => ({ ok: false, status: 404 });

beforeEach(() => {
  store.clear();
  files.clear();
  deletedFiles.length = 0;
  calls.length = 0;
  localPremiumFixture = false;
  respond = () => ({ ok: false, status: 404, json: async () => null, headers: { get: () => null } });

  globalThis.fetch = vi.fn(async (url: unknown, init?: any) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call) as unknown as Response;
  }) as unknown as typeof fetch;
});

function urlsHit(): string[] {
  return calls.map((call) => call.url);
}

/** Hangs the named URL forever, rejecting only when its deadline aborts it. */
function hangOn(url: string, onSignal: (signal: AbortSignal) => void) {
  respond = (call) => {
    if (call.url !== url) {
      return { ok: false, status: 404, json: async () => null, headers: { get: () => null } };
    }
    onSignal(call.init.signal);
    return new Promise((_resolve, reject) => {
      call.init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
}

describe('resolveDeckBySlug · entitlements are not on the free path', () => {
  it('opens an installed free deck without asking the server about entitlements', async () => {
    seedInstalledDeck('free');
    const { resolveDeckBySlug } = await loadRepo();

    const deck = await resolveDeckBySlug('algo');

    expect(deck?.Slug).toBe('algo');
    // The whole point: reading a file off this phone is a file read.
    expect(urlsHit()).not.toContain(ENTITLEMENTS_URL);
  });

  it('still asks about entitlements for a premium deck', async () => {
    seedInstalledDeck('premium');
    respond = (call) =>
      call.url === ENTITLEMENTS_URL
        ? { ok: true, status: 200, json: async () => ({ data: { tier: 'premium' } }) }
        : { ok: false, status: 404, json: async () => null, headers: { get: () => null } };
    const { resolveDeckBySlug } = await loadRepo();

    const deck = await resolveDeckBySlug('algo');

    expect(urlsHit()).toContain(ENTITLEMENTS_URL);
    expect(deck?.Slug).toBe('algo');
    expect(deletedFiles).toEqual([]);
  });
});

describe('resolveDeckBySlug · a failed entitlements lookup is not a "no"', () => {
  it('keeps the installed premium deck when the lookup cannot be completed', async () => {
    seedInstalledDeck('premium');
    respond = (call) => {
      if (call.url === ENTITLEMENTS_URL) throw new Error('offline');
      return { ok: false, status: 404, json: async () => null, headers: { get: () => null } };
    };
    const { resolveDeckBySlug } = await loadRepo();

    const deck = await resolveDeckBySlug('algo');

    // Losing the network must not delete content the user already has.
    expect(deck?.Slug).toBe('algo');
    expect(deletedFiles).toEqual([]);
    expect(store.has('devcards:content:deckmeta:v2:user1:algo')).toBe(true);
  });

  it('keeps the installed premium deck when the entitlements request times out', async () => {
    seedInstalledDeck('premium');
    let sawSignal: AbortSignal | null = null;
    hangOn(ENTITLEMENTS_URL, (signal) => {
      sawSignal = signal;
    });
    const { resolveDeckBySlug } = await loadRepo();

    vi.useFakeTimers();
    try {
      // Not awaited yet on purpose. Without a deadline this promise never
      // settles and the assertions below are never reached -- the failure
      // mode of a regression here is this test timing out, which is the
      // honest shape of "the app hangs".
      const pending = resolveDeckBySlug('algo');
      await vi.advanceTimersByTimeAsync(5_000);
      const deck = await pending;

      expect(deck?.Slug).toBe('algo');
      expect(sawSignal).not.toBeNull();
      expect((sawSignal as unknown as AbortSignal).aborted).toBe(true);
      expect(deletedFiles).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still purges when the server actually says this user is not entitled', async () => {
    seedInstalledDeck('premium');
    respond = (call) =>
      call.url === ENTITLEMENTS_URL
        ? { ok: true, status: 200, json: async () => ({ data: { tier: 'free' } }) }
        : { ok: false, status: 404, json: async () => null, headers: { get: () => null } };
    const { resolveDeckBySlug } = await loadRepo();

    const deck = await resolveDeckBySlug('algo');

    expect(deck).toBeNull();
    expect(deletedFiles).toEqual([DECK_FILE]);
  });
});

describe('fetchRemoteManifest · deadline then cache', () => {
  it('gives up on a manifest request that never answers and serves the cache', async () => {
    store.set(CACHE_KEY, JSON.stringify(manifestJson('free')));
    let sawSignal: AbortSignal | null = null;
    hangOn(MANIFEST_URL, (signal) => {
      sawSignal = signal;
    });
    const { listManifestDecks } = await loadRepo();

    vi.useFakeTimers();
    try {
      const pending = listManifestDecks({ preferRemote: true });
      await vi.advanceTimersByTimeAsync(7_000);
      const decks = await pending;

      expect(decks[0]?.slug).toBe('algo');
      expect(urlsHit()).toContain(MANIFEST_URL);
      expect(sawSignal).not.toBeNull();
      expect((sawSignal as unknown as AbortSignal).aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
