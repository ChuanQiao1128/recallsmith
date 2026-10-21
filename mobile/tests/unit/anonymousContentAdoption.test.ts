import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * C07 — the two signed mapper lines in deckRepository.ts surface the server's
 * cards.topic as CardExport.Topic. This suite drives the mappers through the
 * only public entry point (resolveDeckBySlug) using the harness of
 * deckRepositoryTimeouts.test.ts: a free-tier manifest keeps the read off the
 * network, so an installed file is a pure file read.
 */

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';
});

const store = new Map<string, string>();
const files = new Map<string, string>();

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
    files.delete(uri);
  }),
  moveAsync: vi.fn(async () => {}),
  copyAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error('ENOENT');
    files.set(to, files.get(from)!);
  }),
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

async function loadRepo() {
  vi.resetModules();
  return await import('../../src/content/deckRepository');
}

const CACHE_KEY = 'devcards:content:manifest:v2';
const DECK_FILE = 'file:///docs/devcards-decks-v2/user1/algo.json';

function manifestJson() {
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
  };
}

/** Seed a free-tier installed deck whose file text is `fileJson` (flat or v1 shape). */
function seed(fileJson: unknown) {
  store.set(CACHE_KEY, JSON.stringify(manifestJson()));
  store.set(
    'devcards:content:deckmeta:v2:user1:algo',
    JSON.stringify({ slug: 'algo', buildId: 'v1', fileUri: DECK_FILE, installedAtMs: 1 }),
  );
  files.set(DECK_FILE, JSON.stringify(fileJson));
}

beforeEach(() => {
  store.clear();
  files.clear();
  localPremiumFixture = false;
  globalThis.fetch = vi.fn(async () => ({
    ok: false,
    status: 404,
    json: async () => null,
    headers: { get: () => null },
  })) as unknown as typeof fetch;
});


describe('guest public content adoption', () => {
  function seedGuest() {
    const data = { slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1,
      version: 'v1', cards: [{ stableUid: 'one', question: 'Q', orderInDeck: 1, revision: 1 }] };
    seed(data);
    const meta = store.get('devcards:content:deckmeta:v2:user1:algo')!;
    store.delete('devcards:content:deckmeta:v2:user1:algo');
    files.delete(DECK_FILE);
    const guestFile = 'file:///docs/devcards-decks-v2/anon/algo.json';
    files.set(guestFile, JSON.stringify(data));
    store.set('devcards:content:deckmeta:v2:anon:algo', JSON.stringify({ ...JSON.parse(meta), fileUri: guestFile }));
    store.set('devcards:u:anon:deck-progress:algo', 'PRIVATE_GUEST_PROGRESS');
    store.set('devcards:u:other:deck-progress:algo', 'PRIVATE_OTHER_PROGRESS');
  }
  it('makes the already downloaded public deck available on sign-in without a restart or download', async () => {
    seedGuest();
    const repo = await loadRepo();
    await repo.adoptAnonymousPublicDecks('user1');
    expect((await repo.resolveDeckBySlug('algo'))?.Cards[0].StableUid).toBe('one');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(store.get('devcards:u:anon:deck-progress:algo')).toBe('PRIVATE_GUEST_PROGRESS');
    expect(store.get('devcards:u:other:deck-progress:algo')).toBe('PRIVATE_OTHER_PROGRESS');
    expect(store.has('devcards:u:user1:deck-progress:algo')).toBe(false);
  });
  it('does not overwrite an account build', async () => {
    seedGuest();
    const accountMeta = JSON.stringify({ slug: 'algo', buildId: 'account-v2', fileUri: DECK_FILE });
    store.set('devcards:content:deckmeta:v2:user1:algo', accountMeta);
    await (await loadRepo()).adoptAnonymousPublicDecks('user1');
    expect(store.get('devcards:content:deckmeta:v2:user1:algo')).toBe(accountMeta);
  });
  it.each([{ tier: 'premium' }, { availability: 'retired' }, { downloadMode: 'auth' }])(
    'does not carry gated or retired content: %o', async patch => {
      seedGuest();
      const manifest = manifestJson(); Object.assign(manifest.decks[0], patch);
      store.set(CACHE_KEY, JSON.stringify(manifest));
      await (await loadRepo()).adoptAnonymousPublicDecks('user1');
      expect(store.has('devcards:content:deckmeta:v2:user1:algo')).toBe(false);
    });
  it('refuses a stale sign-in command for an account that is no longer active', async () => {
    seedGuest();
    await (await loadRepo()).adoptAnonymousPublicDecks('other');
    expect(store.has('devcards:content:deckmeta:v2:other:algo')).toBe(false);
  });
});
