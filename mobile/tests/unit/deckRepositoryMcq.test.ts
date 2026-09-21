import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { normalizeMcq, mcqRequiredCount, isMcqCard } from '../../src/features/gacha/mcq/normalizeMcq';
import { DEFAULT_FEATURE_FLAGS } from '../../src/config/featureFlags';

/**
 * D01 — the two signed pass-through mapper lines surface the server's cards.mcq
 * as CardExport.Mcq through the only public entry points (resolveDeckBySlug and
 * the install paths). The harness is the C07 deckRepositoryTopic.test.ts harness
 * with the install-capable fs mock of deckContentV3.test.ts so the file can carry
 * a full-file read, a chunked install and a delta patch.
 */

vi.hoisted(() => {
  process.env.EXPO_PUBLIC_CONTENT_BASE_URL = 'https://cdn.test';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';
});

const store = new Map<string, string>();
const files = new Map<string, string>();
const dirs = new Set<string>();

function asDirUri(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}

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

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const CACHE_KEY = 'devcards:content:manifest:v2';
const META_KEY = 'devcards:content:deckmeta:v2:user1:algo';
const SLUG = 'algo';
const DECK_DIR = 'file:///docs/devcards-decks-v2/user1/';
const DECK_FILE = `${DECK_DIR}algo.json`;
const CONTENT = 'https://cdn.test/content';
const resolveRelativeUrl = (rel: string) => `${CONTENT}/${rel.replace(/^\/+/, '')}`;

const fetchRegistry = new Map<string, string>();
const fetchCalls: string[] = [];

/** Plan §4.3 card 1 (:177-217) as the server emits it — PG jsonb key order (C00 §2.9.1). */
const PLAN_CARD_1_MCQ = {
  v: 1,
  options: [
    { key: 'a', why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.', text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.', correct: false },
    { key: 'b', why: null, text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.', correct: true },
    { key: 'c', why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.', text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.', correct: false },
    { key: 'd', why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.', text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.', correct: false },
  ],
  shuffle: true,
  qualifier: 'LEAST operational overhead',
};
const STEM = 'An order API runs on Amazon EC2 instances behind an Application Load Balancer.';
const EXPLANATION = 'Put an SQS standard queue between the API and fulfilment and scale the fulfilment fleet on queue depth.';

function manifestJson(entryOverrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    generatedAtMs: 1,
    prefix: 'content',
    decks: [
      {
        slug: SLUG,
        title: 'Algo',
        locale: 'en-US',
        deckType: 1,
        tier: 'free',
        availability: 'live',
        downloadMode: 'public',
        totalCards: 2,
        version: 'v1',
        buildId: 'v1',
        path: 'decks/algo/builds/v1/deck.json',
        sha256: null,
        patches: null,
        ...entryOverrides,
      },
    ],
  };
}

/** Seed a free-tier installed deck whose file text is `fileJson` (flat or v1 shape). */
function seed(fileJson: unknown, entryOverrides: Record<string, unknown> = {}) {
  store.set(CACHE_KEY, JSON.stringify(manifestJson(entryOverrides)));
  store.set(
    META_KEY,
    JSON.stringify({ slug: 'algo', buildId: 'v1', fileUri: DECK_FILE, installedAtMs: 1 }),
  );
  files.set(DECK_FILE, JSON.stringify(fileJson));
}

// ── Chunked-install fixtures (chunkedInstall.test.ts:79-164) with SLUG='algo', VERSION='v2'. ──
const VERSION = 'v2';
const PACKAGE_REL = `decks/${SLUG}/builds/${VERSION}/package.json`;
const PACKAGE_URL = resolveRelativeUrl(PACKAGE_REL);

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

type ChunkSpec = { seq: number; cards: Array<Record<string, unknown>> };

function chunkRelPath(seq: number): string {
  return `decks/${SLUG}/builds/${VERSION}/chunks/${seq}.json`;
}

function chunkBody(spec: ChunkSpec): string {
  return JSON.stringify({
    schemaVersion: 1,
    slug: SLUG,
    version: VERSION,
    seq: spec.seq,
    cards: spec.cards,
  });
}

function makePackage(specs: ChunkSpec[], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    slug: SLUG,
    version: VERSION,
    deck: {
      slug: SLUG,
      title: 'Algo',
      locale: 'en-US',
      deckType: 1,
      version: VERSION,
      totalCards: specs.reduce((n, s) => n + s.cards.length, 0),
    },
    totalCards: specs.reduce((n, s) => n + s.cards.length, 0),
    chunks: specs.map((s) => ({
      seq: s.seq,
      path: chunkRelPath(s.seq),
      bytes: chunkBody(s).length,
      sha256: sha(chunkBody(s)),
      cardCount: s.cards.length,
    })),
    ...overrides,
  };
}

function registerPackageAndChunks(specs: ChunkSpec[]) {
  fetchRegistry.set(PACKAGE_URL, JSON.stringify(makePackage(specs)));
  for (const s of specs) {
    fetchRegistry.set(resolveRelativeUrl(chunkRelPath(s.seq)), chunkBody(s));
  }
}

function installArgs() {
  return {
    slug: SLUG,
    packageUrl: PACKAGE_URL,
    remoteVersion: VERSION,
    deckDir: DECK_DIR,
    finalPath: DECK_FILE,
    resolveRelativeUrl,
  };
}

beforeEach(() => {
  store.clear();
  files.clear();
  dirs.clear();
  fetchRegistry.clear();
  fetchCalls.length = 0;
  localPremiumFixture = false;

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

describe('deckRepository · mcq', () => {
  it('passes a server mcq blob through both mappers untouched', async () => {
    const flatCards = [
      { stableUid: 'm1', question: STEM, explanation: EXPLANATION, difficulty: 2, orderInDeck: 1540, topic: 'Queues', mcq: PLAN_CARD_1_MCQ },
      { stableUid: 'q1', question: 'Q1', orderInDeck: 1550 },
    ];
    seed({ slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1, version: 'v1', cards: flatCards });
    const flatRepo = await loadRepo();
    const flatDeck = await flatRepo.resolveDeckBySlug('algo');

    const assertSix = (deck: Awaited<ReturnType<typeof flatRepo.resolveDeckBySlug>>) => {
      expect(deck!.Cards[0].Mcq).toEqual(PLAN_CARD_1_MCQ);
      expect(JSON.stringify(deck!.Cards[0].Mcq)).toBe(JSON.stringify(PLAN_CARD_1_MCQ));
      expect(deck!.Cards[0].Topic).toBe('Queues');
      const normalised = normalizeMcq(deck!.Cards[0].Mcq);
      expect(normalised).not.toBeNull();
      expect(mcqRequiredCount(normalised!)).toBe(1);
      expect(isMcqCard(deck!.Cards[0], DEFAULT_FEATURE_FLAGS)).toBe(true);
      expect(deck!.Cards[1].Mcq).toBe(null);
      expect(isMcqCard(deck!.Cards[1], DEFAULT_FEATURE_FLAGS)).toBe(false);
    };
    assertSix(flatDeck);

    seed({
      buildId: 'v1',
      deck: { slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1 },
      cards: flatCards,
    });
    const v1Repo = await loadRepo();
    const v1Deck = await v1Repo.resolveDeckBySlug('algo');
    assertSix(v1Deck);
  });

  it('maps absent and non-object mcq to null and keeps the card key order', async () => {
    seed({
      slug: 'algo',
      title: 'Algo',
      locale: 'en-US',
      deckType: 1,
      version: 'v1',
      cards: [
        { stableUid: 'q1', question: 'Q1' },
        { stableUid: 'q2', question: 'Q2', orderInDeck: 2, mcq: null },
        { stableUid: 'q3', question: 'Q3', orderInDeck: 3, mcq: 7 },
        { stableUid: 'q4', question: 'Q4', orderInDeck: 4, mcq: 'x' },
        { stableUid: 'q5', question: 'Q5', orderInDeck: 5, mcq: true },
      ],
    });
    const flatRepo = await loadRepo();
    const flatDeck = await flatRepo.resolveDeckBySlug('algo');

    for (let i = 0; i < 5; i += 1) expect(flatDeck!.Cards[i].Mcq).toBe(null);
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
      StableUid: 'q1',
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
      cards: [{ stableUid: 'q1', question: 'Q1' }],
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

  it('lets a garbage blob survive install and normalise to null', async () => {
    const blobs: unknown[] = [
      [],
      { v: 2 },
      { v: 1, options: 'a' },
      { v: 1, options: [{ key: 'a', why: null, text: 'x', correct: true }] },
    ];
    seed({
      slug: 'algo',
      title: 'Algo',
      locale: 'en-US',
      deckType: 1,
      version: 'v1',
      cards: blobs.map((mcq, i) => ({ stableUid: `g${i}`, question: `Q${i}`, orderInDeck: i + 1, mcq })),
    });
    const { resolveDeckBySlug } = await loadRepo();
    const deck = await resolveDeckBySlug('algo');

    for (let i = 0; i < blobs.length; i += 1) {
      expect(deck!.Cards[i].Mcq).toEqual(blobs[i]);
      expect(normalizeMcq(deck!.Cards[i].Mcq)).toBeNull();
      expect(isMcqCard(deck!.Cards[i], DEFAULT_FEATURE_FLAGS)).toBe(false);
    }
  });

  it('keeps mcq through a chunked install', async () => {
    const specs: ChunkSpec[] = [
      { seq: 1, cards: [{ ...card('m1', 1540), mcq: PLAN_CARD_1_MCQ }, card('q1', 1550)] },
    ];
    registerPackageAndChunks(specs);

    vi.resetModules();
    const { installDeckFromChunkedPackage } = await import('../../src/content/chunkedInstall');
    const res = await installDeckFromChunkedPackage(installArgs());
    expect(res).toEqual({ ok: true, cardCount: 2 });

    const written = JSON.parse(files.get(DECK_FILE)!);
    expect(written.cards[0].mcq).toEqual(PLAN_CARD_1_MCQ);
    expect(JSON.stringify(written.cards[0].mcq)).toBe(JSON.stringify(PLAN_CARD_1_MCQ));
    expect('mcq' in written.cards[1]).toBe(false);

    store.set(CACHE_KEY, JSON.stringify(manifestJson({ version: 'v2', buildId: 'v2', path: 'decks/algo/builds/v2/deck.json' })));
    store.set(
      META_KEY,
      JSON.stringify({ slug: 'algo', buildId: 'v2', fileUri: DECK_FILE, installedAtMs: 1 }),
    );
    const { resolveDeckBySlug } = await loadRepo();
    const deck = await resolveDeckBySlug('algo');
    expect(deck!.Cards[0].Mcq).toEqual(PLAN_CARD_1_MCQ);
    expect(deck!.Cards[1].Mcq).toBe(null);
  });

  it('keeps mcq through a delta patch', async () => {
    files.set(
      DECK_FILE,
      JSON.stringify({
        slug: 'algo',
        title: 'Algo',
        locale: 'en-US',
        deckType: 1,
        version: 'v1',
        totalCards: 2,
        cards: [
          { stableUid: 'q1', question: 'Q1', orderInDeck: 1 },
          { stableUid: 'm2', question: 'Q2', orderInDeck: 2, mcq: PLAN_CARD_1_MCQ },
        ],
      }),
    );
    store.set(
      META_KEY,
      JSON.stringify({ slug: 'algo', buildId: 'v1', fileUri: DECK_FILE, installedAtMs: 1, cardCount: 2 }),
    );

    const patchRel = 'decks/algo/patches/v1-v2.json';
    const deltaText = JSON.stringify({
      schemaVersion: 2,
      slug: 'algo',
      fromVersion: 'v1',
      toVersion: 'v2',
      deck: { slug: 'algo', title: 'Algo', locale: 'en-US', deckType: 1, version: 'v2', totalCards: 3 },
      added: [{ stableUid: 'm3', question: STEM, orderInDeck: 3, mcq: PLAN_CARD_1_MCQ }],
      updated: [{ stableUid: 'm2', question: 'Q2 now plain', orderInDeck: 2 }],
      deleted: [],
    });
    store.set(
      CACHE_KEY,
      JSON.stringify(
        manifestJson({
          version: 'v2',
          buildId: 'v2',
          path: 'decks/algo/builds/v2/deck.json',
          patches: [{ fromVersion: 'v1', toVersion: 'v2', path: patchRel, sha256: sha(deltaText) }],
        }),
      ),
    );
    fetchRegistry.set(`${CONTENT}/${patchRel}`, deltaText);

    const repo = await loadRepo();
    const ok = await repo.installDeckFromUrl('algo', `${CONTENT}/decks/algo/builds/v2/deck.json`, 'v2', null);
    expect(ok).toBe(true);
    expect(fetchCalls).not.toContain(`${CONTENT}/decks/algo/builds/v2/deck.json`);

    const written = JSON.parse(files.get(DECK_FILE)!);
    expect(written.version).toBe('v2');
    expect(written.cards.map((c: { stableUid: string }) => c.stableUid)).toEqual(['q1', 'm2', 'm3']);
    expect('mcq' in written.cards[1]).toBe(false);
    expect(written.cards[2].mcq).toEqual(PLAN_CARD_1_MCQ);
    expect(JSON.stringify(written.cards[2].mcq)).toBe(JSON.stringify(PLAN_CARD_1_MCQ));

    const deck = await repo.resolveDeckBySlug('algo');
    expect(deck!.Cards[2].Mcq).toEqual(PLAN_CARD_1_MCQ);
    expect(deck!.Cards[1].Mcq).toBe(null);
    expect(deck!.Cards[0].Mcq).toBe(null);
  });
});
