// evals/scripts/parse-deck.mts
//
// Prints one deck's cards as QaCard-shaped JSON, one object per line, with the same keys as
// export-cards.mts (exportCard), through the console's own parser (frontend/src/lib/deckImport.ts
// parseDeckMarkdown). `dc-evals review` runs it to read the deck the owner is about to publish,
// both the working-tree file and the `git show REF:<path>` text it compares against.
//
//   node evals/scripts/parse-deck.mts <deck.md>     read a file
//   node evals/scripts/parse-deck.mts -             read the deck from stdin
//
// Exit 0 with the cards on stdout. Exit 1 on a parse error (one `file:line: CODE message` line
// per issue on stderr; stdin is named `-`), and exit 2 on a usage error. Needs
// frontend/node_modules (esbuild): `cd frontend && npm ci`.

import { readFileSync } from 'node:fs';

import { exportCard, loadDeckLib } from './deck-lib.mts';

async function main(argv: string[]): Promise<number> {
  if (argv.length !== 1) {
    process.stderr.write('usage: node evals/scripts/parse-deck.mts <deck.md | ->\n');
    return 2;
  }
  const target = argv[0];
  let text: string;
  try {
    text = readFileSync(target === '-' ? 0 : target, 'utf8');
  } catch {
    process.stderr.write(`${target}: cannot read the deck\n`);
    return 2;
  }
  const lib = await loadDeckLib();
  const parsed = lib.parseDeckMarkdown(text);
  if (parsed.errors.length > 0) {
    for (const issue of parsed.errors) {
      process.stderr.write(`${target}:${issue.line}: ${issue.code} ${issue.message}\n`);
    }
    return 1;
  }
  if (parsed.deckSlug === null) {
    process.stderr.write(`${target}:1: MISSING_DECK_HEADER the deck has no "# deck: <slug>" header\n`);
    return 1;
  }
  const slug = parsed.deckSlug;
  process.stdout.write(parsed.cards.map((card) => `${JSON.stringify(exportCard(slug, card))}\n`).join(''));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
