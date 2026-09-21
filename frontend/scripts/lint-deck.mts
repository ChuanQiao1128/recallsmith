// frontend/scripts/lint-deck.mts
//
// Lints a deck markdown file with the SAME parse + validate the console runs
// (src/lib/deckImport.ts parseDeckMarkdown, which calls validateCards and
// validateMcq), so a file that passes here previews all green in the console.
//
// Run (Node 22.18+ / 24 strips the types itself; nothing to install):
//
//   node frontend/scripts/lint-deck.mts <deck.md> [more.md ...]
//
// Output: one line per issue as `<line>: <CODE> <message>`, then one line per
// non-blocking suggestion as `<line>: WARN <CODE> <message>`, then a summary
// line `N cards, M mcq, K issues, W warnings`. Exit 1 when any file has an
// issue, 0 when every file is clean — warnings never fail the run unless
// `--strict` is passed, which fails on any warning too.
//
// How src/lib is loaded: the console sources import each other without file
// extensions (`./cardRules`), which Node's ESM loader refuses, and this repo
// ships neither tsx nor vite-node. esbuild (a vite dependency, already in
// frontend/node_modules) bundles the two library modules in memory and the
// bundle is imported from a data: URL. No temp files, no build step, and the
// library code is the working-tree code, so the lint can never drift from the
// parser it claims to mirror.
//
// One check is added on top of the console's: MCQ_OPTION_TOO_LONG. The server
// (src_C/Vpc/Authoring/McqValidation.cs, step 9) rejects an option text over
// 600 characters, but the console's validateMcq never looks at length, so an
// over-long option would only surface as a failed write during the import
// run. Raising it here keeps the author from finding out at write time.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import type { ImportIssue, ParsedDeck } from '../src/lib/deckImport.ts';
import type { ImportWarning } from '../src/lib/mcqWarnings.ts';

/** Mirrors McqValidation.cs step 9 (`options[i].Text.Length > 600`). */
const MCQ_OPTION_MAX_LENGTH = 600;

interface DeckLib {
  parseDeckMarkdown(text: string): ParsedDeck;
}

async function loadDeckLib(): Promise<DeckLib> {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, '../src/lib/deckImport.ts');
  const result = await build({
    stdin: {
      contents: `export { parseDeckMarkdown } from ${JSON.stringify(entry)};`,
      resolveDir: here,
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

/** Server-only rule the console does not check; same line as the card header. */
function optionLengthIssues(deck: ParsedDeck): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const card of deck.cards) {
    if (!card.mcq) continue;
    for (const option of card.mcq.options) {
      const length = option.text.trim().length;
      if (length > MCQ_OPTION_MAX_LENGTH) {
        issues.push({
          // Not a console ImportIssueCode: this is the server's code, surfaced early.
          code: 'MCQ_OPTION_TOO_LONG' as ImportIssue['code'],
          line: card.sourceLine,
          message: `Option "${option.key}" of card "${card.stableUid}" is ${length} characters; the server allows at most ${MCQ_OPTION_MAX_LENGTH}.`,
          stableUid: card.stableUid,
        });
      }
    }
  }
  return issues;
}

interface LintResult {
  cards: number;
  mcq: number;
  issues: ImportIssue[];
  warnings: ImportWarning[];
}

function lintText(lib: DeckLib, text: string): LintResult {
  const deck = lib.parseDeckMarkdown(text);
  const issues = [...deck.errors, ...optionLengthIssues(deck)].sort((a, b) => a.line - b.line);
  return {
    cards: deck.cards.length,
    mcq: deck.cards.filter((card) => card.mcq !== undefined).length,
    issues,
    warnings: deck.warnings,
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const paths = argv.filter((arg) => !arg.startsWith('--'));
  const strict = argv.includes('--strict');
  if (paths.length === 0) {
    process.stderr.write('usage: node frontend/scripts/lint-deck.mts <deck.md> [more.md ...]\n');
    return 2;
  }

  const lib = await loadDeckLib();
  let failed = false;

  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(resolve(path), 'utf8');
    } catch (err: unknown) {
      process.stderr.write(`${path}: cannot read: ${err instanceof Error ? err.message : String(err)}\n`);
      failed = true;
      continue;
    }

    const result = lintText(lib, text);
    if (paths.length > 1) process.stdout.write(`== ${path}\n`);
    for (const issue of result.issues) {
      process.stdout.write(`${issue.line}: ${issue.code} ${issue.message}\n`);
    }
    for (const warning of result.warnings) {
      process.stdout.write(`${warning.line}: WARN ${warning.code} ${warning.message}\n`);
    }
    process.stdout.write(`${result.cards} cards, ${result.mcq} mcq, ${result.issues.length} issues, ${result.warnings.length} warnings\n`);
    if (result.issues.length > 0 || (strict && result.warnings.length > 0)) failed = true;
  }

  return failed ? 1 : 0;
}

// Only run when executed directly, so the file can also be imported by a test.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`lint-deck: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
