import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * Manifest conditional-GET tests for deckRepository.fetchRemoteManifest,
 * driven through listManifestDecks({ preferRemote: true }):
 * - 200 stores the manifest cache AND the response ETag (sibling key)
 * - the next fetch sends If-None-Match; a 304 serves the cache as fresh
 * - a corrupted cache falls back to the network without If-None-Match
 * - a 200 without an ETag clears the stored ETag
 * - a network error keeps today's cache-fallback behavior
 */

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
});

/** In-memory AsyncStorage. */
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
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

/** Minimal fs mock: manifest paths never touch the file system. */
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async () => {
    throw new Error('ENOENT');
  }),
  writeAsStringAsync: vi.fn(async () => {}),
  deleteAsync: vi.fn(async () => {}),
  moveAsync: vi.fn(async () => {}),
  getInfoAsync: vi.fn(async (uri: string) => ({ exists: false, isDirectory: false, uri })),
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
  fetchAuthSession: vi.fn(async () => ({ userSub: 'user1' })),
}));

vi.mock('../../src/premium/premiumStore', () => ({
  getIsPremiumUser: vi.fn(async () => false),
}));

import { listManifestDecks } from '../../src/content/deckRepository';

const MANIFEST_URL = 'https://cdn.test/content/manifest.json';
const CACHE_KEY = 'devcards:content:manifest:v2';
const ETAG_KEY = 'devcards:content:manifestEtag:v1';

function manifestJson(generatedAtMs: number): string {
  return JSON.stringify({
    schemaVersion: 2,
    generatedAtMs,
    prefix: 'content',
    decks: [
      {
        slug: 'algo',
        title: 'Algo',
        locale: 'en-US',
        deckType: 1,
        tier: 'free',
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
  });
}

type FetchScript = { status: number; body?: string; etag?: string | null };

const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];
let script: FetchScript[] = [];

beforeEach(() => {
  store.clear();
  fetchCalls.length = 0;
  script = [];

  globalThis.fetch = vi.fn(async (url: unknown, init?: any) => {
    fetchCalls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
    const s = script.shift() ?? { status: 404 };
    return {
      ok: s.status >= 200 && s.status < 300,
      status: s.status,
      text: async () => s.body ?? '',
      json: async () => JSON.parse(s.body ?? 'null'),
      headers: {
        get: (k: string) => (String(k).toLowerCase() === 'etag' ? (s.etag ?? null) : null),
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

describe('fetchRemoteManifest conditional GET', () => {
  it('200 stores the manifest cache and the response ETag; first fetch is unconditional', async () => {
    script = [{ status: 200, body: manifestJson(1), etag: '"abc123"' }];

    const decks = await listManifestDecks({ preferRemote: true });

    expect(decks).toHaveLength(1);
    expect(decks[0].slug).toBe('algo');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(MANIFEST_URL);
    expect(fetchCalls[0].headers['if-none-match']).toBeUndefined();
    expect(fetchCalls[0].headers['cache-control']).toBe('no-cache');
    expect(store.get(ETAG_KEY)).toBe('"abc123"');
    // The cache key keeps the bare RawManifest shape (other code seeds/reads it directly).
    const cached = JSON.parse(store.get(CACHE_KEY)!);
    expect(Array.isArray(cached.decks)).toBe(true);
    expect(cached.decks[0].slug).toBe('algo');
  });

  it('subsequent fetch sends If-None-Match and a 304 serves the cache as fresh', async () => {
    script = [
      { status: 200, body: manifestJson(1), etag: '"abc123"' },
      { status: 304 },
    ];

    await listManifestDecks({ preferRemote: true });
    const decks = await listManifestDecks({ preferRemote: true });

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].headers['if-none-match']).toBe('"abc123"');
    // 304 -> cached manifest served (not an empty/error result).
    expect(decks).toHaveLength(1);
    expect(decks[0].slug).toBe('algo');
    // ETag retained for future revalidations.
    expect(store.get(ETAG_KEY)).toBe('"abc123"');
  });

  it('corrupted cache falls back to the network without If-None-Match', async () => {
    store.set(CACHE_KEY, 'not-json{{{');
    store.set(ETAG_KEY, '"stale"');
    script = [{ status: 200, body: manifestJson(2), etag: '"fresh1"' }];

    const decks = await listManifestDecks({ preferRemote: true });

    expect(fetchCalls).toHaveLength(1);
    // Unusable cache -> a 304 could not be served -> no conditional header sent.
    expect(fetchCalls[0].headers['if-none-match']).toBeUndefined();
    expect(decks).toHaveLength(1);
    expect(store.get(ETAG_KEY)).toBe('"fresh1"');
    expect(JSON.parse(store.get(CACHE_KEY)!).generatedAtMs).toBe(2);
  });

  it('a 200 without an ETag clears the stored ETag', async () => {
    script = [
      { status: 200, body: manifestJson(1), etag: '"abc123"' },
      { status: 200, body: manifestJson(2), etag: null },
    ];

    await listManifestDecks({ preferRemote: true });
    await listManifestDecks({ preferRemote: true });

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].headers['if-none-match']).toBe('"abc123"');
    expect(store.get(ETAG_KEY)).toBeUndefined();
    expect(JSON.parse(store.get(CACHE_KEY)!).generatedAtMs).toBe(2);
  });

  it('a network error keeps the existing cache-fallback behavior', async () => {
    script = [{ status: 200, body: manifestJson(1), etag: '"abc123"' }];
    await listManifestDecks({ preferRemote: true });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    const decks = await listManifestDecks({ preferRemote: true });

    // Served from the cache fallback, exactly like today.
    expect(decks).toHaveLength(1);
    expect(decks[0].slug).toBe('algo');
    // Cache and ETag remain intact for the next attempt.
    expect(store.get(ETAG_KEY)).toBe('"abc123"');
  });
});
