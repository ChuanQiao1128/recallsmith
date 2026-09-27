// evals/scripts/export-cards.mts
//
// Exports the two project decks as QaCard-shaped JSONL for the eval dataset, through the
// console's own parser (frontend/src/lib/deckImport.ts parseDeckMarkdown), so the eval sees
// exactly the cards the console would import.
//
// Run from any cwd (Node 22.18+ / 24 strips the types itself):
//
//   node evals/scripts/export-cards.mts           write evals/data/cards-<slug>.jsonl
//   node evals/scripts/export-cards.mts --check   exit 1 when a committed file differs
//
// The parser is loaded like frontend/scripts/lint-deck.mts: esbuild bundles the library in
// memory and the bundle is imported from a data: URL. esbuild lives in frontend/node_modules,
// and Node resolves bare imports relative to the importing file, so it is resolved through a
// require anchored at frontend/package.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const frontendRequire = createRequire(resolve(repo, 'frontend/package.json'));
const { build } = frontendRequire('esbuild') as typeof import('esbuild');

const DECKS = ['aws-saa-c03', 'claude-ccdv-f'] as const;

interface ParsedDeckLike {
  deckSlug: string | null;
  cards: Array<Record<string, unknown>>;
  errors: Array<{ line: number; code: string; message: string }>;
}

interface DeckLib {
  parseDeckMarkdown(text: string): ParsedDeckLike;
}

async function loadDeckLib(): Promise<DeckLib> {
  const libDir = resolve(repo, 'frontend/src/lib');
  const entry = resolve(libDir, 'deckImport.ts');
  const result = await build({
    stdin: {
      contents: `export { parseDeckMarkdown } from ${JSON.stringify(entry)};`,
      resolveDir: libDir,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return (await import(url)) as DeckLib;
}

/** One exported card, keys in the contract order (a QaCard without cardId/contentSha256). */
function exportCard(deckSlug: string, card: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceUid: card.stableUid,
    deckSlug,
    stableUid: card.stableUid,
    difficulty: card.difficulty,
    topic: card.topic ?? null,
    question: card.question,
    explanation: card.explanation,
    codeSnippet: card.codeSnippet ?? null,
    codeLanguage: card.codeLanguage ?? null,
    realWorldUsage: card.realWorldUsage ?? null,
    mcq: card.mcq ?? null,
    source: card.source ?? null,
  };
}

async function main(): Promise<number> {
  const check = process.argv.slice(2).includes('--check');
  const lib = await loadDeckLib();
  let failed = false;
  for (const slug of DECKS) {
    const deckPath = resolve(repo, 'content/decks', `${slug}.md`);
    const parsed = lib.parseDeckMarkdown(readFileSync(deckPath, 'utf8'));
    if (parsed.errors.length > 0) {
      for (const issue of parsed.errors) {
        process.stderr.write(`${deckPath}:${issue.line}: ${issue.code} ${issue.message}\n`);
      }
      process.stderr.write(`refusing to export ${slug}: ${parsed.errors.length} parse error(s)\n`);
      return 1;
    }
    if (parsed.deckSlug !== slug) {
      process.stderr.write(`${deckPath}: deck header is ${String(parsed.deckSlug)}, expected ${slug}\n`);
      return 1;
    }
    const text = parsed.cards.map((card) => `${JSON.stringify(exportCard(slug, card))}\n`).join('');
    const outPath = resolve(repo, 'evals/data', `cards-${slug}.jsonl`);
    if (check) {
      let committed = '';
      try {
        committed = readFileSync(outPath, 'utf8');
      } catch {
        committed = '';
      }
      if (committed !== text) {
        process.stderr.write(`${outPath} is out of date; run node evals/scripts/export-cards.mts\n`);
        failed = true;
      }
    } else {
      writeFileSync(outPath, text, 'utf8');
      process.stdout.write(`${outPath}: ${parsed.cards.length} cards\n`);
    }
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();
