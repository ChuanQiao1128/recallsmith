// evals/scripts/parse-deck.mts and export-cards.mts, run for real as child processes.
//
// `dc-evals review`, `backfill-sources` validation and `embed-cards --deck` read every Markdown
// deck through parse-deck.mts (deck-lib.mts: this console's parseDeckMarkdown plus exportCard),
// and the Python tests replace that parser with stand-ins. This file is the check that the real
// script still prints the exported keys, reads stdin as `-`, exits 1 on a headerless deck, and
// that export-cards.mts --check still matches the committed evals/data exports (F01, e-tests-3).
//
// Node 22.18+ strips the types itself. CI's frontend job runs Node 20, which cannot, so there the
// child is started with a module hook that strips the types with esbuild (already a frontend
// dependency) and changes nothing else: the scripts keep their own file URLs, so deck-lib.mts
// finds the repository exactly as it does when the owner runs it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(FRONTEND, '..');
const PARSE_DECK = join(REPO, 'evals', 'scripts', 'parse-deck.mts');
const EXPORT_CARDS = join(REPO, 'evals', 'scripts', 'export-cards.mts');

const EXPORT_KEYS = [
  'sourceUid',
  'deckSlug',
  'stableUid',
  'difficulty',
  'topic',
  'question',
  'explanation',
  'codeSnippet',
  'codeLanguage',
  'realWorldUsage',
  'mcq',
  'source',
];

const DECK = [
  '# deck: evals-fixture',
  '',
  '## evals-fixture-001 | d2',
  'Q:',
  'What does a fixture card check?',
  'A:',
  'That the real parser runs.',
  '',
  '## evals-fixture-002 | d3',
  'Q:',
  'Which runtime prints it?',
  'A:',
  'Node, through parse-deck.mts.',
  'CODE: bash',
  'node evals/scripts/parse-deck.mts deck.md',
  '',
].join('\n');

const HEADERLESS = DECK.split('\n').slice(2).join('\n');

let work = '';
let nodeArgs: string[] = [];

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[], input?: string): Run {
  const result = spawnSync(process.execPath, [...nodeArgs, script, ...args], {
    cwd: work,
    input,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function cardsOf(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'evals-parse-deck-'));
  writeFileSync(join(work, 'deck.md'), DECK);
  writeFileSync(join(work, 'headerless.md'), HEADERLESS);
  const features = process.features as { typescript?: unknown };
  if (!features.typescript) {
    const esbuild = createRequire(join(FRONTEND, 'package.json')).resolve('esbuild');
    const hooks = join(work, 'strip-types-hooks.mjs');
    writeFileSync(
      hooks,
      [
        "import { readFileSync } from 'node:fs';",
        "import { createRequire } from 'node:module';",
        "import { fileURLToPath } from 'node:url';",
        `const { transformSync } = createRequire(import.meta.url)(${JSON.stringify(esbuild)});`,
        'export async function load(url, context, next) {',
        "  if (url.startsWith('file:') && /\\.m?ts$/.test(url)) {",
        "    const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), { loader: 'ts', format: 'esm', target: 'node20' });",
        "    return { format: 'module', source: code, shortCircuit: true };",
        '  }',
        '  return next(url, context);',
        '}',
        '',
      ].join('\n'),
    );
    const register = join(work, 'strip-types-register.mjs');
    writeFileSync(
      register,
      `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`,
    );
    nodeArgs = ['--import', pathToFileURL(register).href];
  }
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('evals/scripts/parse-deck.mts', () => {
  it('prints one exported card per line with the export-cards keys, in deck order', () => {
    const result = run(PARSE_DECK, ['deck.md']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const cards = cardsOf(result.stdout);
    expect(cards.map((card) => Object.keys(card))).toEqual([EXPORT_KEYS, EXPORT_KEYS]);
    expect(cards[0]).toMatchObject({
      sourceUid: 'evals-fixture-001',
      deckSlug: 'evals-fixture',
      stableUid: 'evals-fixture-001',
      difficulty: 2,
      question: 'What does a fixture card check?',
      explanation: 'That the real parser runs.',
      codeSnippet: null,
      mcq: null,
      source: null,
    });
    expect(cards[1]).toMatchObject({
      stableUid: 'evals-fixture-002',
      difficulty: 3,
      codeLanguage: 'bash',
      codeSnippet: 'node evals/scripts/parse-deck.mts deck.md',
    });
  });

  it('reads the deck from stdin when the path is -', () => {
    const fromFile = run(PARSE_DECK, ['deck.md']);
    const fromStdin = run(PARSE_DECK, ['-'], DECK);
    expect(fromStdin.status).toBe(0);
    expect(fromStdin.stdout).toBe(fromFile.stdout);
  });

  it('exits 1 with MISSING_DECK_HEADER on a deck without a "# deck:" header', () => {
    const result = run(PARSE_DECK, ['headerless.md']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('headerless.md:1: MISSING_DECK_HEADER');
    const fromStdin = run(PARSE_DECK, ['-'], HEADERLESS);
    expect(fromStdin.status).toBe(1);
    expect(fromStdin.stderr).toContain('-:1: MISSING_DECK_HEADER');
  });

  it('exits 2 on a usage error', () => {
    expect(run(PARSE_DECK, []).status).toBe(2);
    expect(run(PARSE_DECK, ['missing.md']).status).toBe(2);
  });
});

describe('evals/scripts/export-cards.mts --check', () => {
  it('matches the committed evals/data exports', () => {
    const result = run(EXPORT_CARDS, ['--check']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
