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
// The parser loader and exportCard live in deck-lib.mts (shared with parse-deck.mts).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { exportCard, loadDeckLib, repo } from './deck-lib.mts';

const DECKS = ['aws-saa-c03', 'claude-ccdv-f'] as const;

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
