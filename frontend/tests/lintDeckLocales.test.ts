// frontend/scripts/lint-deck.mts, run for real as a child process: the zh-CN
// summary suffix, the `--locales zh-CN` publish-gate check and its usage
// errors, and the promise that an English-only file prints exactly the line it
// printed before translations existed.
//
// Same Node 20 fallback as tests/evalsParseDeck.test.ts: when the runtime cannot
// strip types itself, the child gets a module hook that strips them with
// esbuild and changes nothing else.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const LINT_DECK = join(FRONTEND, 'scripts', 'lint-deck.mts');
const FORMAT_MD = readFileSync(join(FRONTEND, '..', 'content', 'decks', 'FORMAT.md'), 'utf8');

const ENGLISH = [
  '# deck: lint-sample',
  '',
  '## lint-en-001 | d1',
  'Q:',
  'Which field says a reply was cut off?',
  'A:',
  'stop_reason, with the value max_tokens.',
  '',
  '## lint-en-002 | d2',
  'Q:',
  'Which S3 class restores within hours for the least money?',
  'A:',
  'S3 Glacier Flexible Retrieval.',
  '',
].join('\n');

function translatedExample(): string {
  const section = FORMAT_MD.slice(FORMAT_MD.indexOf('### 3.4'));
  const body = section.split('```markdown\n')[1]?.split('\n```')[0];
  if (!body) throw new Error('FORMAT.md §3.4 has no markdown example');
  return `# deck: lint-sample\n\n${body}\n`;
}

let work = '';
let nodeArgs: string[] = [];

function lint(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...nodeArgs, LINT_DECK, ...args], {
    cwd: work,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function lastLine(stdout: string): string {
  const lines = stdout.trimEnd().split('\n');
  return lines[lines.length - 1] ?? '';
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'lint-deck-locales-'));
  writeFileSync(join(work, 'english.md'), ENGLISH);
  writeFileSync(join(work, 'translated.md'), translatedExample());
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

describe('lint-deck and translations', () => {
  it('prints the old summary line for an English-only file', () => {
    const result = lint(['english.md']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('2 cards, 0 mcq, 0 issues, 0 warnings\n');
  });

  it('counts translated cards on the FORMAT.md §3.4 example', () => {
    const result = lint(['translated.md']);
    expect(result.status).toBe(0);
    expect(lastLine(result.stdout)).toBe('1 cards, 1 mcq, 0 issues, 2 warnings, 1 zh-CN');
    expect(result.stdout).toContain('WARN ZH_WARN_CORRECT_LONGEST');
  });

  it('--locales zh-CN reports TRANSLATION_MISSING for every untranslated card and fails', () => {
    const result = lint(['--locales', 'zh-CN', 'english.md']);
    expect(result.status).toBe(1);
    expect(result.stdout.split('\n').filter((line) => line.includes('TRANSLATION_MISSING'))).toHaveLength(2);
    expect(lastLine(result.stdout)).toBe('2 cards, 0 mcq, 2 issues, 0 warnings, 0 zh-CN');
  });

  it('--locales=zh-CN passes a fully translated file', () => {
    const result = lint(['--locales=zh-CN', 'translated.md']);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('TRANSLATION_MISSING');
  });

  it('refuses an unsupported or missing locale as a usage error', () => {
    const traditional = lint(['--locales', 'zh-TW', 'english.md']);
    expect(traditional.status).toBe(2);
    expect(traditional.stderr).toContain('unsupported locale "zh-TW"');

    const bare = lint(['english.md', '--locales']);
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain('--locales needs a value');
  });
});
