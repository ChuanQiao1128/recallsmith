import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * Content Delivery v3 wiring tests for deckRepository.installDeckFromUrl:
 * - whole-file sha256 verification on the full-download path
 * - patch-edge sha256 verification on the raw delta text
 * - chunked package install preferred over full download when packagePath is set
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

/** In-memory fs. */
const files = new Map<string, string>();
const dirs = new Set<string>();

function asDirUri(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    if (!files.has(uri)) throw new Error(`ENOENT: ${uri}`);
    return files.get(uri)!;
  }),
  writeAsStringAsync: vi.fn(async (uri: string, content: string) => {
    files.set(uri, content);
  }),
  deleteAsync: vi.fn(async (uri: string, opts?: { idempotent?: boolean }) => {
    const dirUri = asDirUri(uri);
    let existed = files.delete(uri);
    if (dirs.delete(dirUri)) existed = true;
    for (const k of [...files.keys()]) {
      if (k.startsWith(dirUri)) {
        files.delete(k);
        existed = true;
      }
    }
    for (const d of [...dirs]) {
      if (d.startsWith(dirUri)) dirs.delete(d);
    }
    if (!existed && !opts?.idempotent) throw new Error(`ENOENT: ${uri}`);
  }),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
    files.set(to, files.get(from)!);
    files.delete(from);
  }),
  getInfoAsync: vi.fn(async (uri: string) => {
    if (files.has(uri)) return { exists: true, isDirectory: false, uri };
    const dirUri = asDirUri(uri);
    const isDir = dirs.has(dirUri) || [...files.keys()].some((k) => k.startsWith(dirUri));
    return { exists: isDir, isDirectory: isDir, uri };
  }),
  makeDirectoryAsync: vi.fn(async (uri: string) => {
    dirs.add(asDirUri(uri));
  }),
  readDirectoryAsync: vi.fn(async (uri: string) => {
    const dirUri = asDirUri(uri);
    const names = new Set<string>();
    for (const k of files.keys()) {
      if (k.startsWith(dirUri)) names.add(k.slice(dirUri.length).split('/')[0]);
    }
    for (const d of dirs) {
      if (d !== dirUri && d.startsWith(dirUri)) names.add(d.slice(dirUri.length).split('/')[0]);
    }
    return [...names];
  }),
  downloadAsync: vi.fn(async (url: string, fileUri: string) => {
    const resp = await fetch(url, { method: 'GET' });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`download_failed_http_${resp.status}`);
    files.set(fileUri, text);
    return { status: resp.status, uri: fileUri };
  }),
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
  getIsPremiumUser: vi.fn(async () => true),
}));

import { installDeckFromUrl } from '../../src/content/deckRepository';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const fetchRegistry = new Map<string, string>();
const fetchCalls: string[] = [];

const BASE = 'https://cdn.test';
const SLUG = 'csharp';
const VERSION = '20260428T075215Z-5ba0392a';
const USER_DIR = 'file:///docs/devcards-decks-v2/user1/';
const FINAL_PATH = `${USER_DIR}csharp.json`;
const META_KEY = `devcards:content:deckmeta:v2:user1:${SLUG}`;
const MANIFEST_CACHE_KEY = 'devcards:content:manifest:v2';

const DECK_URL = `${BASE}/content/decks/${SLUG}/builds/${VERSION}/deck.json`;

function card(uid: string, order: number) {
  return {
    stableUid: uid,
    orderInDeck: order,
    difficulty: 2,
    question: `Q ${uid}`,
    explanation: `E ${uid}`,
    codeLanguage: null,
    codeSnippet: null,
    realWorldUsage: null,
    revision: 1,
  };
}

function flatDeckText(version: string, uids: string[]): string {
  return JSON.stringify({
    slug: SLUG,
    title: 'C# Interview',
    locale: 'en-US',
    deckType: 1,
    version,
    totalCards: uids.length,
    cards: uids.map((u, i) => card(u, i + 1)),
  });
}

function seedManifest(entryOverrides: Record<string, unknown> = {}) {
  store.set(
    MANIFEST_CACHE_KEY,
    JSON.stringify({
      schemaVersion: 2,
      generatedAtMs: 1,
      prefix: 'content',
      decks: [
        {
          slug: SLUG,
          title: 'C# Interview',
          locale: 'en-US',
          deckType: 1,
          tier: 'free',
          availability: 'live',
          downloadMode: 'public',
          totalCards: 2,
          version: VERSION,
          buildId: VERSION,
          path: `decks/${SLUG}/builds/${VERSION}/deck.json`,
          sha256: null,
          patches: null,
          ...entryOverrides,
        },
      ],
    }),
  );
}

beforeEach(() => {
  store.clear();
  files.clear();
  dirs.clear();
  fetchRegistry.clear();
  fetchCalls.length = 0;

  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    fetchCalls.push(u);
    const body = fetchRegistry.get(u);
    if (body === undefined) {
      return {
        ok: false,
        status: 404,
        text: async () => 'not found',
        json: async () => null,
        headers: { get: () => null },
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => body,
      json: async () => JSON.parse(body),
      headers: { get: () => 'application/json' },
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

describe('installDeckFromUrl (content delivery v3)', () => {
  it('full download succeeds when remoteSha256 matches the downloaded text', async () => {
    const deckText = flatDeckText(VERSION, ['u1', 'u2']);
    seedManifest();
    fetchRegistry.set(DECK_URL, deckText);

    const ok = await installDeckFromUrl(SLUG, DECK_URL, VERSION, sha(deckText));

    expect(ok).toBe(true);
    expect(files.get(FINAL_PATH)).toBe(deckText);
    const meta = JSON.parse(store.get(META_KEY)!);
    expect(meta.buildId).toBe(VERSION);
    expect(meta.cardCount).toBe(2);
  });

  it('full download fails with sha256_mismatch when remoteSha256 does not match', async () => {
    const deckText = flatDeckText(VERSION, ['u1', 'u2']);
    seedManifest();
    fetchRegistry.set(DECK_URL, deckText);

    const ok = await installDeckFromUrl(SLUG, DECK_URL, VERSION, sha('tampered'));

    expect(ok).toBe(false);
    expect(files.has(FINAL_PATH)).toBe(false);
    expect(store.has(META_KEY)).toBe(false);
  });

  it('full download still works when remoteSha256 is null (old manifests)', async () => {
    const deckText = flatDeckText(VERSION, ['u1', 'u2']);
    seedManifest();
    fetchRegistry.set(DECK_URL, deckText);

    const ok = await installDeckFromUrl(SLUG, DECK_URL, VERSION, null);

    expect(ok).toBe(true);
    expect(files.get(FINAL_PATH)).toBe(deckText);
  });

  it('prefers the chunked package when packagePath is set and skips the full download', async () => {
    const packageRel = `decks/${SLUG}/builds/${VERSION}/package.json`;
    const chunkRel = `decks/${SLUG}/builds/${VERSION}/chunks/1.json`;
    const chunkText = JSON.stringify({
      schemaVersion: 1,
      slug: SLUG,
      version: VERSION,
      seq: 1,
      cards: [card('u1', 1), card('u2', 2)],
    });
    const packageText = JSON.stringify({
      schemaVersion: 1,
      slug: SLUG,
      version: VERSION,
      deck: {
        slug: SLUG,
        title: 'C# Interview',
        locale: 'en-US',
        deckType: 1,
        version: VERSION,
        totalCards: 2,
      },
      totalCards: 2,
      chunks: [
        {
          seq: 1,
          path: chunkRel,
          bytes: chunkText.length,
          sha256: sha(chunkText),
          cardCount: 2,
        },
      ],
    });

    seedManifest({ packagePath: packageRel });
    fetchRegistry.set(`${BASE}/content/${packageRel}`, packageText);
    fetchRegistry.set(`${BASE}/content/${chunkRel}`, chunkText);
    // Deliberately do NOT register DECK_URL: chunked must succeed without it.

    const ok = await installDeckFromUrl(SLUG, DECK_URL, VERSION, null);

    expect(ok).toBe(true);
    expect(fetchCalls).not.toContain(DECK_URL);
    const deck = JSON.parse(files.get(FINAL_PATH)!);
    expect(deck.version).toBe(VERSION);
    expect(deck.cards.map((c: { stableUid: string }) => c.stableUid)).toEqual(['u1', 'u2']);
    const meta = JSON.parse(store.get(META_KEY)!);
    expect(meta.buildId).toBe(VERSION);
    expect(meta.cardCount).toBe(2);
  });

  it('falls back to full download when the chunked package is broken', async () => {
    const packageRel = `decks/${SLUG}/builds/${VERSION}/package.json`;
    const deckText = flatDeckText(VERSION, ['u1', 'u2']);

    seedManifest({ packagePath: packageRel });
    // Package URL 404s -> chunked_fallback_to_full -> full download succeeds.
    fetchRegistry.set(DECK_URL, deckText);

    const ok = await installDeckFromUrl(SLUG, DECK_URL, VERSION, sha(deckText));

    expect(ok).toBe(true);
    expect(fetchCalls).toContain(`${BASE}/content/${packageRel}`);
    expect(files.get(FINAL_PATH)).toBe(deckText);
  });

  it('applies a patch when the edge sha256 matches the raw delta text', async () => {
    const OLD_VERSION = 'old-build-1';
    const patchRel = `decks/${SLUG}/patches/${OLD_VERSION}-${VERSION}.json`;
    const deltaText = JSON.stringify({
      schemaVersion: 2,
      slug: SLUG,
      fromVersion: OLD_VERSION,
      toVersion: VERSION,
      deck: {
        slug: SLUG,
        title: 'C# Interview',
        locale: 'en-US',
        deckType: 1,
        version: VERSION,
        totalCards: 3,
      },
      added: [card('u3', 3)],
      updated: [],
      deleted: [],
    });

    seedManifest({
      patches: [
        { fromVersion: OLD_VERSION, toVersion: VERSION, path: patchRel, sha256: sha(deltaText) },
      ],
    });
    fetchRegistry.set(`${BASE}/content/${patchRel}`, deltaText);

    // Existing install at OLD_VERSION.
    files.set(FINAL_PATH, flatDeckText(OLD_VERSION, ['u1', 'u2']));
    store.set(
      META_KEY,
      JSON.stringify({
        slug: SLUG,
        buildId: OLD_VERSION,
        installedAtMs: 1,
        fileUri: FINAL_PATH,
        cardCount: 2,
      }),
    );

    const ok = await installDeckFromUrl(SLUG, DECK_URL, VERSION, null);

    expect(ok).toBe(true);
    // Patched in place, no full download.
    expect(fetchCalls).not.toContain(DECK_URL);
    const deck = JSON.parse(files.get(FINAL_PATH)!);
    expect(deck.version).toBe(VERSION);
    expect(deck.cards.map((c: { stableUid: string }) => c.stableUid)).toEqual(['u1', 'u2', 'u3']);
  });

  it('rejects a patch whose edge sha256 does not match and falls back to full download', async () => {
    const OLD_VERSION = 'old-build-1';
    const patchRel = `decks/${SLUG}/patches/${OLD_VERSION}-${VERSION}.json`;
    const deltaText = JSON.stringify({
      schemaVersion: 2,
      slug: SLUG,
      fromVersion: OLD_VERSION,
      toVersion: VERSION,
      added: [card('u3', 3)],
    });
    const deckText = flatDeckText(VERSION, ['u1', 'u2', 'u3']);

    seedManifest({
      patches: [
        {
          fromVersion: OLD_VERSION,
          toVersion: VERSION,
          path: patchRel,
          sha256: sha('not-the-delta'),
        },
      ],
    });
    fetchRegistry.set(`${BASE}/content/${patchRel}`, deltaText);
    fetchRegistry.set(DECK_URL, deckText);

    files.set(FINAL_PATH, flatDeckText(OLD_VERSION, ['u1', 'u2']));
    store.set(
      META_KEY,
      JSON.stringify({
        slug: SLUG,
        buildId: OLD_VERSION,
        installedAtMs: 1,
        fileUri: FINAL_PATH,
        cardCount: 2,
      }),
    );

    const ok = await installDeckFromUrl(SLUG, DECK_URL, VERSION, sha(deckText));

    expect(ok).toBe(true);
    // Patch was rejected -> full deck fetched instead.
    expect(fetchCalls).toContain(DECK_URL);
    expect(files.get(FINAL_PATH)).toBe(deckText);
  });
});
