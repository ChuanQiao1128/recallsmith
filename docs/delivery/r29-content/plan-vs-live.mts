// docs/delivery/r29-content/plan-vs-live.mts
//
// R29 gate: plans a deck file against the deck as last PUBLISHED (the public CDN deck.json), with
// the console's own parseDeckMarkdown + planImport, and fails unless the only difference is the
// `source` field. Read-only: two public GETs (manifest.json, deck.json), no credentials.
//
//   node docs/delivery/r29-content/plan-vs-live.mts content/decks/aws-saa-c03.md [--live deck.json]
//
// Exit 0 when creates = 0, conflicts = 0, parse errors = 0, no published card is missing from the
// file, and every update changes `source` alone. The console preview is still the final word: the
// database can hold console edits that were never published.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDN = 'https://d1ditdi9jqpy6n.cloudfront.net'; // mobile/src/content/deckRepository.ts CONTENT_BASE_URL
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function loadLib() {
  const { build } = createRequire(resolve(repo, 'frontend/package.json'))('esbuild');
  const libDir = resolve(repo, 'frontend/src/lib');
  const out = await build({
    stdin: {
      contents: `export { parseDeckMarkdown, planImport } from ${JSON.stringify(resolve(libDir, 'deckImport.ts'))};`,
      resolveDir: libDir,
      loader: 'ts',
    },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}

async function liveDeck(slug: string, file: string | undefined) {
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const manifest = await (await fetch(`${CDN}/content/manifest.json`)).json();
  const entry = manifest.decks.find((d: { slug: string }) => d.slug === slug);
  if (!entry) throw new Error(`deck ${slug} is not in the published manifest`);
  return (await fetch(`${CDN}/${manifest.prefix}/${entry.path}`)).json();
}

async function main(argv: string[]): Promise<number> {
  const deckPath = argv[0];
  const liveIdx = argv.indexOf('--live');
  if (!deckPath) {
    process.stderr.write('usage: node docs/delivery/r29-content/plan-vs-live.mts <deck.md> [--live deck.json]\n');
    return 2;
  }
  const lib = await loadLib();
  const parsed = lib.parseDeckMarkdown(readFileSync(deckPath, 'utf8'));
  const live = await liveDeck(parsed.deckSlug, liveIdx > 0 ? argv[liveIdx + 1] : undefined);
  const existing = live.cards.map((c: Record<string, unknown>, i: number) => ({
    ...c, id: i + 1, deckId: 0, version: 1, isDeleted: false,
    topic: c.topic ?? null, mcq: c.mcq ?? null, source: c.source ?? null,
  }));
  const plan = lib.planImport(parsed, existing);
  const fileUids = new Set(parsed.cards.map((c: { stableUid: string }) => c.stableUid));
  const missing = existing.filter((c: { stableUid: string }) => !fileUids.has(c.stableUid)).map((c: { stableUid: string }) => c.stableUid);
  const notSourceOnly = plan.updates.filter((u: { changedFields: string[] }) => u.changedFields.some((f) => f !== 'source'));
  const summary = {
    deck: parsed.deckSlug,
    liveBuild: live.version,
    parseErrors: parsed.errors.length,
    cards: parsed.cards.length,
    liveCards: existing.length,
    sourcesLive: existing.filter((c: { source: unknown }) => c.source).length,
    sourcesFile: parsed.cards.filter((c: { source?: unknown }) => c.source).length,
    creates: plan.creates.length,
    updates: plan.updates.length,
    unchanged: plan.unchanged.length,
    conflicts: plan.conflicts.length,
    publishedCardsMissingFromFile: missing,
    updatesNotSourceOnly: notSourceOnly.map((u: { card: { stableUid: string }; changedFields: string[] }) => [u.card.stableUid, u.changedFields]),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
  const ok = summary.parseErrors === 0 && summary.creates === 0 && summary.conflicts === 0 && missing.length === 0 && notSourceOnly.length === 0;
  return ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
