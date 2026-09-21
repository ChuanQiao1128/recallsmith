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

describe('deckRepository · topic', () => {
  it('surfaces topic from a flat deck file as CardExport.Topic', async () => {
    seed({
      slug: 'algo',
      title: 'Algo',
      locale: 'en-US',
      deckType: 1,
      version: 'v1',
      cards: [
        { stableUid: 'a1', question: 'Q1', difficulty: 2, orderInDeck: 1, topic: 'IAM' },
        { stableUid: 'a2', question: 'Q2', orderInDeck: 2 },
      ],
    });
    const { resolveDeckBySlug } = await loadRepo();

    const deck = await resolveDeckBySlug('algo');

    expect(deck?.Cards[0].Topic).toBe('IAM');
    expect(deck?.Cards[1].Topic).toBe(null);
  });

  it('surfaces topic from a v1 deck file as CardExport.Topic', async () => {
    seed({
      buildId: 'v1',
      deck: { slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1 },
      cards: [{ stableUid: 'a1', question: 'Q1', topic: ' S3 ' }],
    });
    const { resolveDeckBySlug } = await loadRepo();

    const deck = await resolveDeckBySlug('algo');

    // The mapper does not trim; normalizeTopic does, later.
    expect(deck?.Cards[0].Topic).toBe(' S3 ');
  });

  it('maps a missing topic to null and keeps the card key order', async () => {
    seed({
      slug: 'algo',
      title: 'Algo',
      locale: 'en-US',
      deckType: 1,
      version: 'v1',
      cards: [{ stableUid: 'a1', question: 'Q1' }],
    });
    const flatRepo = await loadRepo();
    const flatDeck = await flatRepo.resolveDeckBySlug('algo');

    expect(Object.keys(flatDeck!.Cards[0])).toEqual([
      'StableUid',
      'Question',
      'Explanation',
      'CodeSnippet',
      'CodeLanguage',
      'RealWorldUsage',
      'Difficulty',
      'OrderInDeck',
      'Topic',
      'Mcq',
      'Revision',
      'Version',
      'UpdatedAt',
    ]);
    expect(flatDeck!.Cards[0]).toEqual({
      StableUid: 'a1',
      Question: 'Q1',
      Explanation: null,
      CodeSnippet: null,
      CodeLanguage: null,
      RealWorldUsage: null,
      Difficulty: 2,
      OrderInDeck: 1,
      Topic: null,
      Mcq: null,
      Revision: 1,
      Version: 1,
      UpdatedAt: null,
    });

    seed({
      buildId: 'v1',
      deck: { slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1 },
      cards: [{ stableUid: 'a1', question: 'Q1' }],
    });
    const v1Repo = await loadRepo();
    const v1Deck = await v1Repo.resolveDeckBySlug('algo');

    expect(Object.keys(v1Deck!.Cards[0])).toEqual([
      'StableUid',
      'Question',
      'Explanation',
      'CodeSnippet',
      'CodeLanguage',
      'RealWorldUsage',
      'Difficulty',
      'OrderInDeck',
      'Topic',
      'Mcq',
      'Revision',
      'Version',
      'UpdatedAt',
    ]);
  });

  it('maps a non-string topic to null', async () => {
    seed({
      slug: 'algo',
      title: 'Algo',
      locale: 'en-US',
      deckType: 1,
      version: 'v1',
      cards: [
        { stableUid: 'a1', question: 'Q1', orderInDeck: 1, topic: 7 },
        { stableUid: 'a2', question: 'Q2', orderInDeck: 2, topic: null },
        { stableUid: 'a3', question: 'Q3', orderInDeck: 3, topic: ['x'] },
      ],
    });
    const { resolveDeckBySlug } = await loadRepo();

    const deck = await resolveDeckBySlug('algo');

    expect(deck?.Cards[0].Topic).toBe(null);
    expect(deck?.Cards[1].Topic).toBe(null);
    expect(deck?.Cards[2].Topic).toBe(null);
  });
});
