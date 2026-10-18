// O01 generator (scripts/content/build-starter-packs.mjs): a refresh writes either every file (the
// packs and index.ts) or none of them. A size or validation failure part way through must not
// leave new packs next to an old index.ts, whose STARTER_BUILD would then disagree with their versions.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// starterGate imports AsyncStorage at module scope; pickStarterUids itself never touches storage.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { pickStarterUids } from '../../src/features/gacha/starter/starterGate';

type FlatCard = { stableUid: string; orderInDeck: number; mcq: unknown };

type BuilderModule = {
  STARTER_SLUGS: string[];
  MIN_CARDS: number;
  cutStarterPrefix: (cards: FlatCard[]) => FlatCard[];
  buildStarterPacks: (options: {
    fetchBytes: (url: string) => Promise<Buffer>;
    outDir: string;
    log?: (line: string) => void;
  }) => Promise<void>;
};

const SCRIPT = resolve(__dirname, '../../scripts/content/build-starter-packs.mjs');
const CDN = 'https://cdn.developercards.app';
// 2026-10-14 three decks: csharp-basics is hidden and has no pack; aws-saa-fundamentals never had one.
const SLUGS = ['aws-saa-c03', 'claude-ccdv-f'];
const BUILD = '20261001T000000Z-abc123';

async function loadBuilder(): Promise<BuilderModule> {
  return (await import(pathToFileURL(SCRIPT).href)) as BuilderModule;
}

function makeDeck(slug: string, questionBytes: number) {
  return {
    slug,
    title: `Deck ${slug}`,
    locale: 'en-US',
    version: BUILD,
    cards: Array.from({ length: 40 }, (_, i) => ({
      stableUid: `${slug}-${i + 1}`,
      orderInDeck: i + 1,
      difficulty: 1,
      question: `${'q'.repeat(questionBytes)} ${i + 1}`,
      explanation: 'a',
      codeLanguage: '',
      codeSnippet: '',
      realWorldUsage: '',
      revision: 1,
      mcq: null,
    })),
  };
}

function makeFetch(decks: Record<string, unknown>) {
  const manifest = {
    prefix: 'content',
    decks: SLUGS.map((slug) => ({
      slug,
      tier: 'free',
      availability: 'live',
      deckType: 1,
      buildId: BUILD,
      path: `decks/${slug}/deck.json`,
      sha256: null,
    })),
  };
  return async (url: string) => {
    if (url === `${CDN}/content/manifest.json`) return Buffer.from(JSON.stringify(manifest));
    const slug = SLUGS.find((s) => url === `${CDN}/content/decks/${s}/deck.json`);
    if (!slug) throw new Error(`unexpected GET ${url}`);
    return Buffer.from(JSON.stringify(decks[slug]));
  };
}

const OLD_FILES = ['index.ts', ...SLUGS.map((s) => `${s}.starter.json`)];

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) out[name] = readFileSync(join(dir, name), 'utf8');
  return out;
}

describe('build-starter-packs: all files or none', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'starter-packs-'));
    for (const name of OLD_FILES) writeFileSync(join(outDir, name), `old ${name}\n`);
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('leaves every old file untouched when the packs go over 300 KB', async () => {
    const { buildStarterPacks } = await loadBuilder();
    const before = snapshot(outDir);
    // 2 decks x 30 cards x ~6 KB each is about 360 KB.
    const decks = Object.fromEntries(SLUGS.map((slug) => [slug, makeDeck(slug, 6000)]));
    await expect(buildStarterPacks({ fetchBytes: makeFetch(decks), outDir, log: () => {} })).rejects.toThrow(/limit/);
    expect(snapshot(outDir)).toEqual(before);
  });

  it('leaves every old file untouched when a later deck fails validation', async () => {
    const { buildStarterPacks } = await loadBuilder();
    const before = snapshot(outDir);
    const decks: Record<string, unknown> = Object.fromEntries(SLUGS.map((slug) => [slug, makeDeck(slug, 10)]));
    decks['claude-ccdv-f'] = { ...makeDeck('claude-ccdv-f', 10), slug: 'something-else' };
    await expect(buildStarterPacks({ fetchBytes: makeFetch(decks), outDir, log: () => {} })).rejects.toThrow(/claude-ccdv-f/);
    expect(snapshot(outDir)).toEqual(before);
  });

  it('writes the packs and an index.ts that names their build when everything passes', async () => {
    const { buildStarterPacks, STARTER_SLUGS } = await loadBuilder();
    expect(STARTER_SLUGS).toEqual(SLUGS);
    const decks = Object.fromEntries(SLUGS.map((slug) => [slug, makeDeck(slug, 10)]));
    await buildStarterPacks({ fetchBytes: makeFetch(decks), outDir, log: () => {} });
    const after = snapshot(outDir);
    expect(Object.keys(after).sort()).toEqual([...OLD_FILES].sort());
    for (const slug of SLUGS) {
      const pack = JSON.parse(after[`${slug}.starter.json`]);
      expect(pack).toMatchObject({ slug, version: `${BUILD}-starter`, totalCards: 40 });
      expect(pack.cards).toHaveLength(30);
      expect(after['index.ts']).toContain(`'${slug}': '${BUILD}',`);
    }
  });
});

// Card translations round (2026-10-18): exam decks are MCQ only. pickStarterUids then teaches the
// deck's first five cards, so the pack is the plain MIN_CARDS prefix and settles the same lesson.
describe('build-starter-packs: an MCQ-only deck', () => {
  const MCQ_BLOB = {
    v: 1,
    qualifier: null,
    shuffle: true,
    options: [
      { key: 'a', text: 'Right', why: null, correct: true },
      { key: 'b', text: 'Wrong one', why: 'Because b is wrong.', correct: false },
      { key: 'c', text: 'Wrong two', why: 'Because c is wrong.', correct: false },
    ],
  };
  const mcqCard = (order: number): FlatCard => ({ stableUid: `m${order}`, orderInDeck: order, mcq: MCQ_BLOB });
  const asLessonCards = (cards: FlatCard[]) => cards.map((c) => ({ StableUid: c.stableUid, OrderInDeck: c.orderInDeck, Mcq: c.mcq }));

  it('cuts the MIN_CARDS prefix, which picks the same lesson as the full deck', async () => {
    const { cutStarterPrefix, MIN_CARDS } = await loadBuilder();
    // Out of order on purpose: the cut sorts by orderInDeck first.
    const deck = Array.from({ length: 60 }, (_, i) => mcqCard(60 - i));
    const pack = cutStarterPrefix(deck);
    expect(pack).toHaveLength(MIN_CARDS);
    expect(pack.map((c) => c.orderInDeck)).toEqual(Array.from({ length: MIN_CARDS }, (_, i) => i + 1));
    const lesson = pickStarterUids(asLessonCards(deck));
    expect(lesson).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(pickStarterUids(asLessonCards(pack))).toEqual(lesson);
  });

  it('still refuses a deck too small to teach a lesson', async () => {
    const { cutStarterPrefix } = await loadBuilder();
    expect(() => cutStarterPrefix([1, 2, 3, 4].map(mcqCard))).toThrow(/fewer than 5 cards/);
    // Five cards make a lesson, but not a pack (MIN_CARDS).
    expect(() => cutStarterPrefix([1, 2, 3, 4, 5].map(mcqCard))).toThrow(/need 30/);
  });

  it('keeps the Q/A cut for a deck with five Q/A cards', async () => {
    const { cutStarterPrefix } = await loadBuilder();
    const qa = (order: number): FlatCard => ({ stableUid: `q${order}`, orderInDeck: order, mcq: null });
    // Five Q/A cards, the fifth at position 40: the pack runs through it.
    const deck = [...Array.from({ length: 36 }, (_, i) => mcqCard(i + 1)), qa(37), qa(38), qa(39), qa(40), mcqCard(41), qa(42), mcqCard(43)];
    const pack = cutStarterPrefix(deck);
    expect(pack).toHaveLength(42);
    expect(pickStarterUids(asLessonCards(pack))).toEqual(pickStarterUids(asLessonCards(deck)));
    expect(pickStarterUids(asLessonCards(deck))).toEqual(['q37', 'q38', 'q39', 'q40', 'q42']);
  });
});
