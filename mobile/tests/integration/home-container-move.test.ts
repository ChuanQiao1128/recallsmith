// iOS gives the app a new data-container path whenever a new binary is installed over the old one
// (an App Store or TestFlight update, a simulator reinstall). The files move with it, but each deck
// install meta stores an absolute file:// URI under the old container. On 2026-10-18 the first launch
// after such an install read every deck as missing: resolveDeckBySlug found nothing at the stored
// URI, deleted the meta, and Home showed "Finish setup" and "Nothing to review yet" for packs the
// learner already owned cards in, until another tab re-downloaded the decks.
//
// The deck repository, the deck cache and Home's summary loader are real. The file system is in
// memory, and its documentDirectory is switched between two containers to stand in for the update.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
});

const OLD_DOCS = 'file:///Containers/Data/Application/OLD-UUID/Documents/';
const NEW_DOCS = 'file:///Containers/Data/Application/NEW-UUID/Documents/';
const fsState = vi.hoisted(() => ({ documentDirectory: '' }));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, store.get(key) ?? null])),
    multiSet: vi.fn(async (pairs: Array<[string, string]>) => {
      for (const [key, value] of pairs) store.set(key, value);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => store.delete(key));
    }),
  },
}));

const files = new Map<string, string>();
const dirs = new Set<string>();
const asDirUri = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);
vi.mock('expo-file-system/legacy', () => ({
  get documentDirectory() {
    return fsState.documentDirectory;
  },
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: vi.fn(async (uri: string) => {
    if (!files.has(uri)) throw new Error(`ENOENT: ${uri}`);
    return files.get(uri)!;
  }),
  writeAsStringAsync: vi.fn(async (uri: string, content: string) => {
    files.set(uri, content);
  }),
  deleteAsync: vi.fn(async (uri: string) => {
    files.delete(uri);
    const dirUri = asDirUri(uri);
    dirs.delete(dirUri);
    for (const k of [...files.keys()]) if (k.startsWith(dirUri)) files.delete(k);
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
  readDirectoryAsync: vi.fn(async () => []),
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
  digestStringAsync: vi.fn(async () => ''),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(async () => ({})),
}));

vi.mock('../../src/review/progressScope', () => ({
  getProgressScopeKey: () => 'anon',
}));

vi.mock('../../src/premium/premiumStore', () => ({
  getIsPremiumUser: vi.fn(async () => false),
  usePremiumUser: () => false,
  setIsPremiumUser: vi.fn(async () => {}),
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcGetCustomerInfoSafe: vi.fn(async () => null),
  isPremiumActive: vi.fn(() => false),
}));

vi.mock('../../src/notifications/reminders', () => ({
  syncDailyReminders: vi.fn(async () => {}),
}));

vi.mock('../../src/sync/progressSync', () => ({
  recordReviewEvent: vi.fn(async () => 'evt-1'),
  scheduleProgressSync: vi.fn(async () => {}),
  applyCachedRemoteProgress: vi.fn(async () => {}),
}));

import { getCachedDeck, installDeckAndInvalidate, invalidateDeckCache } from '../../src/content/deckCache';
import {
  loadHomeDeckSummaries,
  resetAutoUpdateAttemptsForTests,
  resetLastKnownDeckUpdatesForTests,
} from '../../src/features/gacha/home/deckActionResolver';

const SLUG = 'aws-saa-fundamentals';
const BUILD = '20261014T103833Z-e35ca605';
const BASE = 'https://cdn.test';
const MANIFEST_URL = `${BASE}/content/manifest.json`;
const DECK_PATH = `decks/${SLUG}/builds/${BUILD}/deck.json`;
const DECK_URL = `${BASE}/content/${DECK_PATH}`;
const META_KEY = `devcards:content:deckmeta:v2:anon:${SLUG}`;
const DECK_DIR = 'devcards-decks-v2/anon/';

const CARDS = Array.from({ length: 6 }, (_, i) => ({
  stableUid: `awsf-${i + 1}`,
  orderInDeck: i + 1,
  difficulty: 2,
  question: `Question ${i + 1}`,
  explanation: `Answer ${i + 1}`,
  codeLanguage: '',
  codeSnippet: '',
  realWorldUsage: '',
  revision: 1,
}));
const DECK = {
  slug: SLUG,
  title: 'AWS Architect Basics',
  locale: 'en-US',
  deckType: 1,
  version: BUILD,
  totalCards: CARDS.length,
  cards: CARDS,
};
const MANIFEST = {
  schemaVersion: 2,
  generatedAtMs: 1,
  prefix: 'content',
  decks: [
    {
      slug: SLUG,
      title: DECK.title,
      locale: 'en-US',
      deckType: 1,
      tier: 'free',
      availability: 'live',
      downloadMode: 'public',
      version: BUILD,
      buildId: BUILD,
      totalCards: CARDS.length,
      path: DECK_PATH,
      sha256: null,
    },
  ],
};

let online = true;
const fetchCalls: string[] = [];
const fetchMock = vi.fn(async (input: any) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input);
  fetchCalls.push(url);
  if (!online) throw new TypeError('Network request failed');
  const body = url === MANIFEST_URL ? MANIFEST : url === DECK_URL ? DECK : null;
  if (!body) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
});

function readMeta(): { fileUri: string; buildId: string } | null {
  const raw = store.get(META_KEY);
  return raw ? JSON.parse(raw) : null;
}

// The previous binary, online: Home's revalidating load caches the manifest, then the deck installs
// under the old container.
async function installUnderOldContainer() {
  fsState.documentDirectory = OLD_DOCS;
  online = true;
  await loadHomeDeckSummaries({ premium: false, remote: true });
  expect(await installDeckAndInvalidate(SLUG, DECK_URL, BUILD, null)).toBe(true);
  expect(readMeta()?.fileUri).toBe(`${OLD_DOCS}${DECK_DIR}${SLUG}.json`);
  expect(store.has('devcards:content:manifest:v2')).toBe(true);
}

// What iOS does when the new binary goes in: the container's contents move to a new path, and the
// app process starts fresh (no in-memory deck cache), offline here so nothing can be re-downloaded.
function installNewBinary() {
  for (const [uri, text] of [...files.entries()]) {
    if (!uri.startsWith(OLD_DOCS)) continue;
    files.delete(uri);
    files.set(NEW_DOCS + uri.slice(OLD_DOCS.length), text);
  }
  for (const dir of [...dirs]) {
    if (!dir.startsWith(OLD_DOCS)) continue;
    dirs.delete(dir);
    dirs.add(NEW_DOCS + dir.slice(OLD_DOCS.length));
  }
  fsState.documentDirectory = NEW_DOCS;
  invalidateDeckCache();
  resetLastKnownDeckUpdatesForTests();
  online = false;
  fetchCalls.length = 0;
}

describe('first launch after a new binary moves the app container', () => {
  beforeEach(() => {
    store.clear();
    files.clear();
    dirs.clear();
    fetchCalls.length = 0;
    online = true;
    vi.stubGlobal('fetch', fetchMock);
    invalidateDeckCache();
    resetAutoUpdateAttemptsForTests();
    resetLastKnownDeckUpdatesForTests();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps an installed deck studyable on Home's cache-first load, offline, and repoints its meta", async () => {
    await installUnderOldContainer();
    installNewBinary();

    const summary = await loadHomeDeckSummaries({ premium: false, remote: false });
    expect(summary.deckSummaries.map((d) => [d.slug, d.canStudy, d.localCards])).toEqual([
      [SLUG, true, CARDS.length],
    ]);
    // Read from the moved file, not re-downloaded.
    expect(fetchCalls).toEqual([]);
    expect(readMeta()).toMatchObject({ buildId: BUILD, fileUri: `${NEW_DOCS}${DECK_DIR}${SLUG}.json` });

    // The repaired meta holds on the next launch too (a fresh deck cache reads it directly).
    invalidateDeckCache();
    expect((await getCachedDeck(SLUG))?.Cards).toHaveLength(CARDS.length);
  });

  it('still forgets an install whose file is gone from the new container as well', async () => {
    await installUnderOldContainer();
    installNewBinary();
    files.delete(`${NEW_DOCS}${DECK_DIR}${SLUG}.json`);

    const summary = await loadHomeDeckSummaries({ premium: false, remote: false });
    expect(summary.deckSummaries.map((d) => [d.slug, d.canStudy])).toEqual([[SLUG, false]]);
    expect(readMeta()).toBeNull();
  });
});
