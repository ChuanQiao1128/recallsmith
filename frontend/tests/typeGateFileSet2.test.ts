// Does the type gate actually check the files in tests/, or does it only look
// like it does?
//
// tests/tsconfigTestProject.test.ts guards the CONFIG TEXT: the reference is
// present, `types` still has both halves, `include` is still ["tests"]. Every
// one of those can be true while the gate compiles nothing, because none of
// them reads the file set the config resolves to. This file reads that set.
//
// ---------------------------------------------------------------------------
// WHY THERE IS A "2" IN THIS FILENAME
// ---------------------------------------------------------------------------
// It is the tooth, not a typo, and it must survive any rename.
//
// tsconfig.test.json used to exclude iCloud conflict copies by enumerating
// "**/*?2.ts", "**/*?2.test.ts", ... up to 9. The intent was for "?" to absorb
// the space in "cardForm 2.ts". But "?" matches ANY single character, so those
// patterns also swallow ordinary files whose basename ends in a digit 2-9.
// Measured in a throwaway fixture against that exact exclude list — planted
// files, real compiler, --listFilesOnly:
//
//   dropped:   apiV2.test.ts, helper2.ts, typeGateFileSet2.test.ts
//              (plus the six intended "x 2.y" conflict-copy shapes)
//   survived:  a1.ts, b10.ts, normal.test.ts, adminUsersMigrate.test.tsx,
//              deckImportPageSource.test.tsx
//
// So the hole is narrower than "ends in a digit" — 0 and 1 are safe, and a
// digit not adjacent to the extension is safe — but it is real.
//
// Vitest does not read tsconfig at all (checked: vitest.config.ts sets
// include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] and nothing there
// consults a tsconfig). So a file caught by that hole is RUN normally and
// TYPE-CHECKED BY NOTHING — the silent failure this file exists to catch.
//
// Naming this file typeGateFileSet2.test.ts puts it on the wrong side of that
// hole: "**/*?2.test.ts" matches it with "*" = "typeGateFileSe" and "?" = "t".
// That is what makes the assertions below go red against the old exclude list
// and green against the new one, with no fixture to plant and no cleanup to
// forget. The trap stays armed forever: restore the old globs and this file
// disappears from the program while still running, and says so.
//
// State this plainly, because it is the difference between a test and a
// decoration: there is no file in the tree today whose name ends in a digit
// 2-9, so a naively-named version of this file would stay GREEN under the
// original broken exclude list. The digit is the only reason it has teeth.
//
// ---------------------------------------------------------------------------
// WHY TWO MEASUREMENTS OF THE SAME THING
// ---------------------------------------------------------------------------
// They are not the same thing.
//
//   (A) `tsc -p tsconfig.test.json --listFilesOnly` reports the whole PROGRAM:
//       root files plus everything reachable by import.
//   (B) ts.parseJsonConfigFileContent reports the ROOT files the config
//       resolves to, before any import is followed.
//
// A file that is excluded but imported by an included test is still checked:
// (B) sees the problem, (A) cannot. A file that is excluded and imported by
// nobody — which is what a stray *.test.ts is, since nothing imports a test —
// is invisible to both unless it is compared against the disk. That comparison
// is the assertion; the two spellings just bracket it from both sides.
//
// ---------------------------------------------------------------------------
// NO iCLOUD EXEMPTION PREDICATE, ON PURPOSE
// ---------------------------------------------------------------------------
// The obvious next move is to teach the disk walk to skip names containing a
// space, so a conflict copy landing in tests/ does not fail this. It is not
// done, because there is no such file in tests/ today and this repo does not
// keep branches that never execute.
//
// The behaviour that falls out is the correct one anyway: an iCloud copy in
// tests/ lights up BOTH this assertion and the existing sentinel in
// tsconfigTestProject.test.ts ("sees no iCloud conflict copies"). The sentinel
// names the cause in its own message, so the pair reads as "a shadow file
// appeared" rather than as a mystery.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const FRONTEND = fileURLToPath(new URL('../', import.meta.url));
const TSC_BIN = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));

// One constant, read by all three measurements, and that is what gives the
// floor in the first assertion something to do. Point this at a directory with
// no .ts files in it and all three sets go empty together — at which point the
// two set comparisons below pass vacuously ([] equals []) and the floor is the
// only thing left that notices. Measured, not assumed: see the mutation log.
const TESTS_DIR = `${FRONTEND}tests`;
const TESTS_PREFIX = `${TESTS_DIR}/`;

/**
 * Every .ts/.tsx file under `dir`, recursively, relative to `dir`.
 *
 * Copied rather than shared with tsconfigTestProject.test.ts. Two guards that
 * import one walker agree with each other by construction: break the walker and
 * both go quiet together, which is precisely the failure neither is allowed to
 * have. Twelve duplicated lines is the cheaper half of that trade.
 */
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
  return found.sort();
}

/** (A) tests/ files in the program the real compiler binary builds. */
function programFilesUnderTests(): string[] {
  // `tsc -p <file> --listFilesOnly`, not `tsc -b --listFiles`. `-b` walks all
  // three referenced projects, prints over a thousand lines, and — without
  // --force, on an up-to-date tree — prints nothing at all. This form is one
  // project, ~470 lines, ~0.5s, and it stops before emitting, so it neither
  // writes node_modules/.tmp/tsconfig.test.tsbuildinfo nor disturbs the real
  // `tsc -b` gate.
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [TSC_BIN, '-p', 'tsconfig.test.json', '--listFilesOnly'], {
      cwd: FRONTEND,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      'tsc -p tsconfig.test.json --listFilesOnly did not exit 0 — the type gate ' +
        'cannot even be measured:\n' +
        `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`,
    );
  }

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith(TESTS_PREFIX))
    .map(line => line.slice(TESTS_PREFIX.length))
    .sort();
}

/** (B) tests/ files the config resolves to as ROOT files, imports not followed. */
function configuredRootsUnderTests(): string[] {
  const configPath = `${FRONTEND}tsconfig.test.json`;
  // TypeScript's own JSONC parser: the file legitimately has comments, and a
  // hand-rolled stripper that disagreed with tsc about what a comment is would
  // let this pass against a config tsc rejects.
  const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'));
  expect(parsed.error, 'tsconfig.test.json is not parseable as JSONC').toBeUndefined();

  const resolved = ts.parseJsonConfigFileContent(parsed.config, ts.sys, FRONTEND);
  const errors = resolved.errors
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  expect(errors, 'tsconfig.test.json does not resolve cleanly').toEqual([]);

  return resolved.fileNames
    .filter(name => name.startsWith(TESTS_PREFIX))
    .map(name => name.slice(TESTS_PREFIX.length))
    .sort();
}

describe('the type gate over tests/', () => {
  const onDisk = sourceFilesUnder(TESTS_DIR);

  it('is not measuring an empty directory', () => {
    // (C) Hardcoded, and deliberately NOT derived from either measured set. A
    // floor computed from the thing under test passes vacuously the instant the
    // walker or the config parse returns nothing — the exact defect
    // hookWiring.test.ts records against its own barrel assertion. 55 is a
    // floor, not a count: it must not need editing every time a test is added.
    expect(onDisk.length).toBeGreaterThanOrEqual(55);
  });

  it('compiles every test file that is on disk, and nothing that is not', () => {
    // The whole point. A file can sit in tests/, be collected and executed by
    // vitest, and be absent from this list — that is a file whose types nobody
    // checks, and no other signal in the repo reports it.
    expect(
      programFilesUnderTests(),
      'files under tests/ disagree with the type-check program. A file on disk ' +
        'but missing from the program is RUN by vitest and TYPE-CHECKED BY ' +
        'NOTHING — check the "exclude" globs in tsconfig.test.json.',
    ).toEqual(onDisk);
  });

  it('takes every test file on disk as a root, not only the ones something imports', () => {
    // Same comparison one layer earlier. A stray test file is imported by
    // nobody, so if it is not a ROOT it is nowhere — being reachable is not a
    // property tests have.
    expect(configuredRootsUnderTests()).toEqual(onDisk);
  });

  it('is reached by the command CI actually runs', () => {
    // The seam between what is measured above and what enforces it. The two
    // assertions above run `tsc -p tsconfig.test.json`; CI runs `npm run build`.
    // Those agree only because build is `tsc -b` (which walks references, one of
    // which is this project) and because tsconfig.test.json has no references of
    // its own, so `-p` and `-b` resolve the same include/exclude to the same
    // set. Swap build to `tsc --noEmit` and it checks zero files — this repo has
    // already shipped that once — while everything above stays green.
    const pkg = JSON.parse(readFileSync(`${FRONTEND}package.json`, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.build).toBe('tsc -b && vite build');
  });
});
