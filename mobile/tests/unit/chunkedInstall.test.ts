import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/** In-memory fs shared by the expo-file-system/legacy mock. */
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
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_alg: string, text: string) =>
    createHash('sha256').update(text, 'utf8').digest('hex'),
  ),
}));

import { installDeckFromChunkedPackage } from '../../src/content/chunkedInstall';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** URL -> body registry backing the global fetch stub. */
const fetchRegistry = new Map<string, string>();
const fetchCalls: string[] = [];

const BASE = 'https://cdn.test/content';
const resolveRelativeUrl = (rel: string) => `${BASE}/${rel.replace(/^\/+/, '')}`;

const DECK_DIR = 'file:///docs/devcards-decks-v2/user1/';
const FINAL_PATH = `${DECK_DIR}csharp.json`;
const SLUG = 'csharp';
const VERSION = '20260428T075215Z-5ba0392a';
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

type ChunkSpec = { seq: number; cards: ReturnType<typeof card>[] };

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

function makePackage(
  specs: ChunkSpec[],
  overrides: Record<string, unknown> = {},
  chunkOverrides: Array<Record<string, unknown> | undefined> = [],
) {
  return {
    schemaVersion: 1,
    slug: SLUG,
    version: VERSION,
    deck: {
      slug: SLUG,
      title: 'C# Interview',
      locale: 'en-US',
      deckType: 1,
      version: VERSION,
      totalCards: specs.reduce((n, s) => n + s.cards.length, 0),
    },
    totalCards: specs.reduce((n, s) => n + s.cards.length, 0),
    chunks: specs.map((s, i) => ({
      seq: s.seq,
      path: chunkRelPath(s.seq),
      bytes: chunkBody(s).length,
      sha256: sha(chunkBody(s)),
      cardCount: s.cards.length,
      ...(chunkOverrides[i] || {}),
    })),
    ...overrides,
  };
}

function registerPackageAndChunks(specs: ChunkSpec[], pkg?: unknown) {
  fetchRegistry.set(PACKAGE_URL, JSON.stringify(pkg ?? makePackage(specs)));
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
    finalPath: FINAL_PATH,
    resolveRelativeUrl,
  };
}

beforeEach(() => {
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

describe('installDeckFromChunkedPackage', () => {
  it('installs a multi-chunk package with out-of-order seqs, sorted by orderInDeck', async () => {
    // Package lists seq 2 before seq 1; card orders interleave across chunks.
    const specs: ChunkSpec[] = [
      { seq: 2, cards: [card('u3', 3), card('u1', 1)] },
      { seq: 1, cards: [card('u4', 4), card('u2', 2)] },
    ];
    registerPackageAndChunks(specs);

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res).toEqual({ ok: true, cardCount: 4 });
    expect(files.has(FINAL_PATH)).toBe(true);

    const deck = JSON.parse(files.get(FINAL_PATH)!);
    expect(deck.slug).toBe(SLUG);
    expect(deck.title).toBe('C# Interview');
    expect(deck.locale).toBe('en-US');
    expect(deck.deckType).toBe(1);
    expect(deck.version).toBe(VERSION);
    expect(deck.totalCards).toBe(4);
    expect(deck.cards.map((c: { stableUid: string }) => c.stableUid)).toEqual([
      'u1',
      'u2',
      'u3',
      'u4',
    ]);

    // Chunk cache dir cleaned after success.
    const leftovers = [...files.keys()].filter((k) => k.includes('/chunks/'));
    expect(leftovers).toEqual([]);
  });

  it('returns ok:false on chunk sha256 mismatch and never writes the final file', async () => {
    const specs: ChunkSpec[] = [{ seq: 1, cards: [card('u1', 1)] }];
    const pkg = makePackage(specs, {}, [{ sha256: sha('something-else') }]);
    registerPackageAndChunks(specs, pkg);

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('chunk_1');
    expect(files.has(FINAL_PATH)).toBe(false);
    // Re-downloaded once (2 attempts total) before giving up.
    const chunkUrl = resolveRelativeUrl(chunkRelPath(1));
    expect(fetchCalls.filter((u) => u === chunkUrl).length).toBe(2);
  });

  it('resumes: a pre-seeded valid chunk file is reused and its URL never fetched', async () => {
    const specs: ChunkSpec[] = [
      { seq: 1, cards: [card('u1', 1)] },
      { seq: 2, cards: [card('u2', 2)] },
    ];
    registerPackageAndChunks(specs);

    // Pre-seed chunk 1 in the cache dir with the exact valid bytes.
    const chunkDir = `${DECK_DIR}chunks/${SLUG}.${VERSION}/`;
    files.set(`${chunkDir}1.json`, chunkBody(specs[0]));

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res).toEqual({ ok: true, cardCount: 2 });
    const chunk1Url = resolveRelativeUrl(chunkRelPath(1));
    const chunk2Url = resolveRelativeUrl(chunkRelPath(2));
    expect(fetchCalls).not.toContain(chunk1Url);
    expect(fetchCalls).toContain(chunk2Url);
  });

  it('re-downloads a corrupt cached chunk and succeeds', async () => {
    const specs: ChunkSpec[] = [{ seq: 1, cards: [card('u1', 1)] }];
    registerPackageAndChunks(specs);

    const chunkDir = `${DECK_DIR}chunks/${SLUG}.${VERSION}/`;
    files.set(`${chunkDir}1.json`, '{"corrupt":true}');

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res).toEqual({ ok: true, cardCount: 1 });
    expect(fetchCalls).toContain(resolveRelativeUrl(chunkRelPath(1)));
    const deck = JSON.parse(files.get(FINAL_PATH)!);
    expect(deck.cards[0].stableUid).toBe('u1');
  });

  it('returns ok:false when package version does not match remoteVersion', async () => {
    const specs: ChunkSpec[] = [{ seq: 1, cards: [card('u1', 1)] }];
    const pkg = makePackage(specs, { version: 'some-other-build' });
    registerPackageAndChunks(specs, pkg);

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res.ok).toBe(false);
    expect(files.has(FINAL_PATH)).toBe(false);
  });

  it('returns ok:false when assembled card count does not match totalCards', async () => {
    const specs: ChunkSpec[] = [{ seq: 1, cards: [card('u1', 1), card('u2', 2)] }];
    // Declare 3 total but chunks only carry 2 (keep chunk-level cardCount consistent).
    const pkg = makePackage(specs, { totalCards: 3 });
    (pkg.deck as { totalCards: number }).totalCards = 3;
    registerPackageAndChunks(specs, pkg);

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('total_cards_mismatch');
    expect(files.has(FINAL_PATH)).toBe(false);
  });

  it('returns ok:false on duplicate stableUid across chunks', async () => {
    const specs: ChunkSpec[] = [
      { seq: 1, cards: [card('dup', 1)] },
      { seq: 2, cards: [card('dup', 2)] },
    ];
    registerPackageAndChunks(specs);

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('duplicate');
    expect(files.has(FINAL_PATH)).toBe(false);
  });

  it('cleans up stale chunk dirs of other versions for the same slug', async () => {
    const specs: ChunkSpec[] = [{ seq: 1, cards: [card('u1', 1)] }];
    registerPackageAndChunks(specs);

    const staleDir = `${DECK_DIR}chunks/${SLUG}.older-build/`;
    files.set(`${staleDir}1.json`, '{"old":true}');
    const otherSlugDir = `${DECK_DIR}chunks/golang.${VERSION}/`;
    files.set(`${otherSlugDir}1.json`, '{"other":true}');

    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res.ok).toBe(true);
    expect(files.has(`${staleDir}1.json`)).toBe(false);
    // Other slugs' caches are untouched.
    expect(files.has(`${otherSlugDir}1.json`)).toBe(true);
  });

  it('never throws: package fetch HTTP error returns ok:false', async () => {
    // PACKAGE_URL not registered -> 404
    const res = await installDeckFromChunkedPackage(installArgs());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('package_http_404');
  });
});
