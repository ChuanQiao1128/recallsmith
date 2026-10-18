// frontend/scripts/lint-deck.mts
//
// Lints a deck markdown file with the SAME parse + validate the console runs
// (src/lib/deckImport.ts parseDeckMarkdown, which calls validateCards and
// validateMcq), so a file that passes here previews all green in the console.
//
// Run (Node 22.18+ / 24 strips the types itself; nothing to install):
//
//   node frontend/scripts/lint-deck.mts [--strict] [--locales zh-CN] <deck.md> [more.md ...]
//
// Output: one line per issue as `<line>: <CODE> <message>`, then one line per
// non-blocking suggestion as `<line>: WARN <CODE> <message>`, then a summary
// line `N cards, M mcq, K issues, W warnings`. Exit 1 when any file has an
// issue, 0 when every file is clean — warnings never fail the run unless
// `--strict` is passed, which fails on any warning too.
//
// `--locales zh-CN` (or `--locales=zh-CN`) lints the file the way the publish
// gate treats a deck whose translation_locales holds zh-CN: every card without
// a zh-CN translation is a TRANSLATION_MISSING issue. When the flag is given,
// or any card carries a translation, the summary line gains `, T zh-CN` (T =
// cards with a zh-CN translation); an English-only file prints exactly what it
// printed before translations existed.
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

/** Mirrors TRANSLATION_LOCALES in src/lib/translationRules.ts (v1: zh-CN only). */
const SUPPORTED_LOCALES = ['zh-CN'];

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

/** The publish gate's TRANSLATION_MISSING, raised early for every declared locale a card lacks. */
function missingTranslationIssues(deck: ParsedDeck, locales: readonly string[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const card of deck.cards) {
    for (const locale of locales) {
      if (card.translations?.[locale as 'zh-CN'] !== undefined) continue;
      issues.push({
        // Not a console ImportIssueCode: this is the server's publish-gate code, surfaced early.
        code: 'TRANSLATION_MISSING' as ImportIssue['code'],
        line: card.sourceLine,
        message: `Card "${card.stableUid}" has no ${locale} translation; a deck that declares ${locale} cannot publish until every card has one.`,
        stableUid: card.stableUid,
      });
    }
  }
  return issues;
}

interface LintResult {
  cards: number;
  mcq: number;
  issues: ImportIssue[];
  warnings: ImportWarning[];
  /** Cards carrying a translation, per supported locale. */
  translated: Map<string, number>;
}

function lintText(lib: DeckLib, text: string, locales: readonly string[] = []): LintResult {
  const deck = lib.parseDeckMarkdown(text);
  const issues = [...deck.errors, ...optionLengthIssues(deck), ...missingTranslationIssues(deck, locales)].sort(
    (a, b) => a.line - b.line,
  );
  const translated = new Map<string, number>();
  for (const locale of SUPPORTED_LOCALES) {
    translated.set(locale, deck.cards.filter((card) => card.translations?.[locale as 'zh-CN'] !== undefined).length);
  }
  return {
    cards: deck.cards.length,
    mcq: deck.cards.filter((card) => card.mcq !== undefined).length,
    issues,
    warnings: deck.warnings,
    translated,
  };
}

interface LintArgs {
  paths: string[];
  strict: boolean;
  locales: string[];
}

/** Splits argv into paths and flags; a string is a usage error. `--locales` takes the next argument or `=value`, comma separated. */
function parseArgs(argv: readonly string[]): LintArgs | string {
  const args: LintArgs = { paths: [], strict: false, locales: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--locales' || arg.startsWith('--locales=')) {
      const value = arg === '--locales' ? argv[++i] : arg.slice('--locales='.length);
      if (value === undefined || value.trim() === '') return '--locales needs a value, e.g. --locales zh-CN';
      for (const locale of value.split(',').map((l) => l.trim()).filter(Boolean)) {
        if (!SUPPORTED_LOCALES.includes(locale)) return `unsupported locale "${locale}"; supported: ${SUPPORTED_LOCALES.join(', ')}`;
        if (!args.locales.includes(locale)) args.locales.push(locale);
      }
    } else if (!arg.startsWith('--')) {
      args.paths.push(arg);
    }
  }
  return args;
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const usage = 'usage: node frontend/scripts/lint-deck.mts [--strict] [--locales zh-CN] <deck.md> [more.md ...]\n';
  if (typeof args === 'string') {
    process.stderr.write(`lint-deck: ${args}\n${usage}`);
    return 2;
  }
  const { paths, strict, locales } = args;
  if (paths.length === 0) {
    process.stderr.write(usage);
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

    const result = lintText(lib, text, locales);
    if (paths.length > 1) process.stdout.write(`== ${path}\n`);
    for (const issue of result.issues) {
      process.stdout.write(`${issue.line}: ${issue.code} ${issue.message}\n`);
    }
    for (const warning of result.warnings) {
      process.stdout.write(`${warning.line}: WARN ${warning.code} ${warning.message}\n`);
    }
    // A locale joins the summary when it was declared or the file uses it, so
    // an English-only file keeps its old summary line byte for byte.
    const localeCounts = SUPPORTED_LOCALES.filter((locale) => locales.includes(locale) || (result.translated.get(locale) ?? 0) > 0)
      .map((locale) => `, ${result.translated.get(locale) ?? 0} ${locale}`)
      .join('');
    process.stdout.write(
      `${result.cards} cards, ${result.mcq} mcq, ${result.issues.length} issues, ${result.warnings.length} warnings${localeCounts}\n`,
    );
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
