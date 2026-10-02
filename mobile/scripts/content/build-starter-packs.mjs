#!/usr/bin/env node
// Run: node scripts/content/build-starter-packs.mjs   (from mobile/, Node >= 22, no dependency)
//
// Contract R24-00 §2.1: cut a bundled starter pack for each goal deck from the LIVE published build, so a
// fresh install with no network can still open the starter lesson and the first pack. Each pack is the
// flat deck shape deckRepository accepts:
//   { slug, title, locale, deckType: 1, version: "<buildId>-starter", totalCards, cards }
// where `cards` is the contiguous orderInDeck prefix of the published deck.json, at least MIN_CARDS long
// and at least through the 5th non-MCQ card, copied verbatim (same stableUid and revision, so progress,
// owned cards and the lesson record carry over when the full deck replaces the pack). `totalCards` is the
// full deck's count.
//
// Why the prefix rule: pickStarterUids (src/features/gacha/starter/starterGate.ts) takes the first five
// non-MCQ cards in deck order, so any prefix through the 5th non-MCQ card gives the same lesson as the
// full deck. Why "-starter": a version equal to the live buildId would make the installer report
// already_up_to_date and the full deck would never replace the pack.
//
// Also writes src/content/starter/index.ts (static requires, so the JSON is inlined into the JS bundle and
// ships over OTA). Re-run it to refresh the packs after a content publish; it overwrites the files, all
// of them or none (every pack is built and checked in memory before the first write).

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDN_BASE = 'https://cdn.developercards.app';
const MANIFEST_URL = `${CDN_BASE}/content/manifest.json`;
export const STARTER_SLUGS = ['aws-saa-c03', 'claude-ccdv-f', 'csharp-basics'];
export const MIN_CARDS = 30;
export const STARTER_LESSON_SIZE = 5;
const MAX_TOTAL_BYTES = 300 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../src/content/starter');

async function fetchBytes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** True when a card carries an MCQ blob. The app treats an invalid blob as Q/A (normalizeMcq), so
 *  counting every blob as MCQ can only make the prefix longer, never too short. */
function hasMcq(card) {
  return card.mcq !== null && card.mcq !== undefined;
}

/** The published cards sorted by orderInDeck (ties keep array order, as pickStarterUids does), cut to the
 *  shortest prefix that is at least MIN_CARDS long and contains STARTER_LESSON_SIZE non-MCQ cards. */
export function cutStarterPrefix(cards) {
  const sorted = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => a.card.orderInDeck - b.card.orderInDeck || a.index - b.index)
    .map((entry) => entry.card);
  let nonMcq = 0;
  let throughFifth = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (!hasMcq(sorted[i])) nonMcq += 1;
    if (nonMcq === STARTER_LESSON_SIZE) {
      throughFifth = i + 1;
      break;
    }
  }
  if (throughFifth < 0) throw new Error(`deck has fewer than ${STARTER_LESSON_SIZE} non-MCQ cards`);
  const length = Math.max(MIN_CARDS, throughFifth);
  if (sorted.length < length) throw new Error(`deck has ${sorted.length} cards, need ${length}`);
  return sorted.slice(0, length);
}

function validateDeck(slug, entry, deck) {
  if (deck.slug !== slug) throw new Error(`${slug}: deck.json slug is ${JSON.stringify(deck.slug)}`);
  if (deck.version !== entry.buildId) {
    throw new Error(`${slug}: deck.json version ${deck.version} != manifest buildId ${entry.buildId}`);
  }
  if (!Array.isArray(deck.cards)) throw new Error(`${slug}: deck.json has no cards[]`);
  const seen = new Set();
  for (const card of deck.cards) {
    if (typeof card.stableUid !== 'string' || !card.stableUid) throw new Error(`${slug}: a card has no stableUid`);
    if (seen.has(card.stableUid)) throw new Error(`${slug}: duplicate stableUid ${card.stableUid}`);
    seen.add(card.stableUid);
    if (!Number.isInteger(card.orderInDeck)) throw new Error(`${slug}: ${card.stableUid} has no integer orderInDeck`);
  }
}

async function buildPack(manifest, slug, get) {
  const entry = (manifest.decks ?? []).find((d) => d.slug === slug);
  if (!entry) throw new Error(`${slug}: not in the live manifest`);
  // A starter pack must open without an entitlement: only free, live, public decks qualify.
  if (entry.tier !== 'free' || entry.availability !== 'live' || entry.deckType !== 1) {
    throw new Error(`${slug}: live manifest says tier=${entry.tier} availability=${entry.availability} deckType=${entry.deckType}`);
  }
  if (typeof entry.buildId !== 'string' || !/^\d{8}T\d{6}Z-[0-9a-f]+$/.test(entry.buildId)) {
    throw new Error(`${slug}: unexpected buildId ${JSON.stringify(entry.buildId)}`);
  }
  const prefix = typeof manifest.prefix === 'string' && manifest.prefix ? manifest.prefix : 'content';
  const url = `${CDN_BASE}/${prefix}/${entry.path}`;
  const bytes = await get(url);
  if (typeof entry.sha256 === 'string' && entry.sha256) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.sha256) throw new Error(`${slug}: sha256 mismatch for ${url}`);
  }
  const deck = JSON.parse(bytes.toString('utf8'));
  validateDeck(slug, entry, deck);
  const cards = cutStarterPrefix(deck.cards);
  return {
    buildId: entry.buildId,
    pack: {
      slug,
      title: deck.title,
      locale: deck.locale,
      deckType: 1,
      version: `${entry.buildId}-starter`,
      totalCards: deck.cards.length,
      cards,
    },
  };
}

function renderIndex(builds) {
  const requires = STARTER_SLUGS.map(
    (slug) => `  '${slug}': require('./${slug}.starter.json') as StarterPack,`,
  ).join('\n');
  const buildLines = STARTER_SLUGS.map((slug) => `  '${slug}': '${builds[slug]}',`).join('\n');
  return `// GENERATED by scripts/content/build-starter-packs.mjs -- do not edit by hand; re-run the script.
//
// Contract R24-00 §2.1: bundled starter packs (a verbatim orderInDeck prefix of each goal deck's live
// build). Static requires keep the JSON inside the JS bundle, so the packs ship over OTA.

export type StarterSlug = ${STARTER_SLUGS.map((s) => `'${s}'`).join(' | ')};

/** One card, copied verbatim from the published deck.json (flat v3 card shape). */
export type StarterPackCard = {
  stableUid: string;
  orderInDeck: number;
  difficulty: number;
  question: string;
  explanation: string;
  codeLanguage: string;
  codeSnippet: string;
  realWorldUsage: string;
  revision: number;
  topic?: string | null;
  mcq?: unknown;
  source?: unknown;
};

/** The flat deck shape deckRepository installs; \`version\` is "<buildId>-starter". */
export type StarterPack = {
  slug: StarterSlug;
  title: string;
  locale: string;
  deckType: 1;
  version: string;
  /** The full deck's card count (the pack holds a prefix). */
  totalCards: number;
  cards: StarterPackCard[];
};

export const STARTER_PACKS: Record<StarterSlug, StarterPack> = {
${requires}
};

/** The live buildId each pack was cut from. */
export const STARTER_BUILD: Record<StarterSlug, string> = {
${buildLines}
};
`;
}

/**
 * Builds every pack in memory, checks the size limit, then writes the packs and index.ts. A failed
 * fetch, validation or size check throws before any file is written, so the packs on disk always
 * match the index.ts next to them.
 */
export async function buildStarterPacks({ fetchBytes: get = fetchBytes, outDir = OUT_DIR, log = console.log } = {}) {
  const manifest = JSON.parse((await get(MANIFEST_URL)).toString('utf8'));
  const builds = {};
  const outputs = [];
  let totalBytes = 0;
  for (const slug of STARTER_SLUGS) {
    const { buildId, pack } = await buildPack(manifest, slug, get);
    const text = `${JSON.stringify(pack, null, 2)}\n`;
    totalBytes += Buffer.byteLength(text);
    outputs.push({ file: `${slug}.starter.json`, text });
    builds[slug] = buildId;
    const nonMcq = pack.cards.filter((c) => !hasMcq(c)).length;
    log(`${slug}: ${pack.cards.length}/${pack.totalCards} cards (${nonMcq} non-MCQ), ${pack.version}`);
  }
  if (totalBytes >= MAX_TOTAL_BYTES) throw new Error(`starter packs total ${totalBytes} bytes, limit ${MAX_TOTAL_BYTES}`);
  outputs.push({ file: 'index.ts', text: renderIndex(builds) });

  await mkdir(outDir, { recursive: true });
  for (const { file, text } of outputs) await writeFile(resolve(outDir, file), text);
  log(`wrote ${STARTER_SLUGS.length} packs (${totalBytes} bytes) and index.ts to ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildStarterPacks().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
