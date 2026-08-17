// The type gate that covers tests/ is itself only a config file, and a config
// file has no failing mode that anyone notices: delete the reference below and
// every test still passes, every lint still passes, and the build still exits
// 0 - it just silently stops type-checking 46 files again. That is the exact
// failure this repo already shipped once (see the "Known limitations" section
// the README used to carry), so the gate gets a test.
//
// The three checks are the three ways the gate can be switched off without
// anything else going red: unhooking the project, letting an iCloud conflict
// copy back into the include glob, and hollowing out `types` so the project
// compiles nothing meaningful.
//
// Parsing is done with TypeScript's own JSONC parser rather than JSON.parse or
// a hand-rolled comment stripper. These files legitimately contain comments,
// and a stripper that disagrees with tsc about what a comment is would let this
// test pass against a file tsc rejects.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const FRONTEND = fileURLToPath(new URL('../', import.meta.url));

function readJsonc(relativePath: string): unknown {
  const absolute = fileURLToPath(new URL(relativePath, import.meta.url));
  const parsed = ts.parseConfigFileTextToJson(absolute, readFileSync(absolute, 'utf8'));
  // A syntax error here means tsc cannot read the file either, so say so loudly
  // instead of returning undefined and failing later with a confusing message.
  expect(parsed.error, `${relativePath} is not parseable as JSONC`).toBeUndefined();
  return parsed.config;
}

/** Every .ts/.tsx file under `dir`, recursively, as paths relative to `dir`. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = `${current}/${entry.name}`;
      const label = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(next, label);
      else if (/\.tsx?$/.test(entry.name)) found.push(label);
    }
  };
  walk(dir, '');
  return found;
}

describe('the tests/ type-check project', () => {
  it('is referenced by tsconfig.json, so `tsc -b` walks it', () => {
    const root = readJsonc('../tsconfig.json') as { references?: { path?: string }[] };
    const paths = (root.references ?? []).map(reference => reference.path);

    expect(paths).toContain('./tsconfig.test.json');
  });

  it('sees no iCloud conflict copies in src/ or tests/', () => {
    // "include": ["tests"] is a directory glob, so a file iCloud renames to
    // "errorFeed 2.test.ts" gets compiled the moment it lands. tsconfig.test.json
    // excludes that shape; this asserts none is on disk in the first place, which
    // catches the case where the exclude list is edited into uselessness.
    //
    // The digit is matched before a "." or end-of-name, NOT anchored to the
    // extension. The tighter-looking / \d\.tsx?$/ silently misses
    // "errorFeed 2.test.ts" - the digit there is followed by ".test.ts", not by
    // the extension - which is one of the shapes tsconfig.test.json excludes, so
    // that spelling would leave the sentinel blind to a case the config handles.
    const suspects = [
      ...sourceFilesUnder(`${FRONTEND}src`).map(name => `src/${name}`),
      ...sourceFilesUnder(`${FRONTEND}tests`).map(name => `tests/${name}`),
    ].filter(name => / \d+(\.|$)/.test(name));

    expect(suspects).toEqual([]);
  });

  it('keeps both halves of `types` and checks the whole tests/ directory', () => {
    const config = readJsonc('../tsconfig.test.json') as {
      compilerOptions?: { types?: string[] };
      include?: string[];
    };

    // node: 11 test files import node builtins. vite/client: tests reach src,
    // which reads import.meta.env. Dropping either one was measured to produce
    // errors, so neither is decoration.
    expect(config.compilerOptions?.types).toContain('node');
    expect(config.compilerOptions?.types).toContain('vite/client');

    // Exactly ["tests"], not a narrowed file list: a partial include is how a
    // half-finished migration silently stops covering the rest of the directory.
    expect(config.include).toEqual(['tests']);
  });
});

// The one check the three above cannot make: what tsc actually resolved.
//
// Every assertion so far reads the config file. That is one level too high, and
// the gap is not theoretical, it shipped. The first version of this project
// excluded iCloud conflict copies with `**/*?2.ts`, meaning to let `?` absorb
// the space in `name 2.ts`. But `?` matches any character, so `apiV2.test.ts`,
// an ordinary filename, was excluded too: invisible to tsc, still collected and
// run by vitest. Measured, not imagined. Reading `exclude` back out of the file
// would have agreed with itself and said nothing.
//
// So this one asks tsc. `--listFiles` prints the resolved program, and comparing
// it against the directory listing is the only form of the claim that cannot be
// satisfied by a config that merely looks right.
describe('what tsc actually resolved under tests/', () => {
  // Shells out to a real tsc build, which is seconds rather than milliseconds
  // and is slower still on a cold CI runner with no incremental cache. The
  // default 5s budget was enough locally and timed out on the first CI run.
  it('is exactly the files on disk, no more and no fewer', { timeout: 180_000 }, () => {
    const testsDir = `${FRONTEND}tests`;

    const onDisk = new Set(
      filesUnder(testsDir)
        // Conflict copies are excluded on purpose. The iCloud check above is
        // what keeps that exclusion from quietly widening past them.
        .filter(name => !name.includes(' ')),
    );

    const listed = execFileSync(
      'npx',
      ['tsc', '-p', 'tsconfig.test.json', '--noEmit', '--listFiles'],
      { cwd: FRONTEND, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    const resolved = new Set(
      listed
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith(`${testsDir}/`))
        .map(line => line.slice(testsDir.length + 1)),
    );

    // Anti-vacuity. A broken walk and an empty program would satisfy the
    // set comparison together; this refuses to call that agreement.
    expect(onDisk.size).toBeGreaterThan(50);

    expect({
      missing: [...onDisk].filter(f => !resolved.has(f)).sort(),
      extra: [...resolved].filter(f => !onDisk.has(f)).sort(),
    }).toEqual({ missing: [], extra: [] });
  });
});

/** Every .ts/.tsx path under `dir`, relative to it. Hoisted so both describes share it. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const label = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(`${current}/${entry.name}`, label);
      else if (/\.tsx?$/.test(entry.name)) found.push(label);
    }
  };
  walk(dir, '');
  return found;
}
