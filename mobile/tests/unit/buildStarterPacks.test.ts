// O01 generator (scripts/content/build-starter-packs.mjs): a refresh writes either every file (the
// three packs and index.ts) or none of them. A size or validation failure part way through must not
// leave new packs next to an old index.ts, whose STARTER_BUILD would then disagree with their versions.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type BuilderModule = {
  STARTER_SLUGS: string[];
  buildStarterPacks: (options: {
    fetchBytes: (url: string) => Promise<Buffer>;
    outDir: string;
    log?: (line: string) => void;
  }) => Promise<void>;
};

const SCRIPT = resolve(__dirname, '../../scripts/content/build-starter-packs.mjs');
const CDN = 'https://cdn.developercards.app';
const SLUGS = ['aws-saa-c03', 'claude-ccdv-f', 'csharp-basics'];
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
    // 3 decks x 30 cards x ~4 KB each is about 360 KB.
    const decks = Object.fromEntries(SLUGS.map((slug) => [slug, makeDeck(slug, 4000)]));
    await expect(buildStarterPacks({ fetchBytes: makeFetch(decks), outDir, log: () => {} })).rejects.toThrow(/limit/);
    expect(snapshot(outDir)).toEqual(before);
  });

  it('leaves every old file untouched when a later deck fails validation', async () => {
    const { buildStarterPacks } = await loadBuilder();
    const before = snapshot(outDir);
    const decks: Record<string, unknown> = Object.fromEntries(SLUGS.map((slug) => [slug, makeDeck(slug, 10)]));
    decks['csharp-basics'] = { ...makeDeck('csharp-basics', 10), slug: 'something-else' };
    await expect(buildStarterPacks({ fetchBytes: makeFetch(decks), outDir, log: () => {} })).rejects.toThrow(/csharp-basics/);
    expect(snapshot(outDir)).toEqual(before);
  });

  it('writes the three packs and an index.ts that names their build when everything passes', async () => {
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
