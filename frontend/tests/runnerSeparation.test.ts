// Two test runners now live under tests/. This is what keeps them apart.
//
// ---------------------------------------------------------------------------
// WHAT GOES WRONG IF THEY OVERLAP
// ---------------------------------------------------------------------------
// The failure is not symmetrical, and neither half is quiet in a useful way.
//
//   - vitest collecting a Playwright spec: the spec imports `@playwright/test`,
//     whose `test()` throws when it is called outside the Playwright runner. So
//     the `frontend` CI job goes red with an error about a browser, in a job
//     that has no browser, for a file it was never supposed to open.
//   - Playwright collecting a vitest file: Playwright's DEFAULT testMatch is
//     `**/*.@(spec|test).?(c|m)[jt]s?(x)` — which matches every one of the 78
//     *.test.ts(x) files in this directory. Point testDir at `tests` by
//     accident and the e2e job tries to run the entire unit suite in a browser.
//
// The reason this needs an assertion rather than a convention is that the
// separation currently rests on ONE character: `.spec.` versus `.test.`. That
// is not a boundary anybody can see while adding a file.
//
// ---------------------------------------------------------------------------
// WHY PLAYWRIGHT IS ASKED RATHER THAN READ
// ---------------------------------------------------------------------------
// `playwright test --list` is the real collector: it resolves the config,
// applies testDir/testMatch/testIgnore and reports the files it would run. It
// does NOT start the webServer — measured at ~0.5s, no build — so this stays a
// cheap unit test rather than one that quietly depends on `vite build`.
//
// Reading playwright.config.ts as text instead would assert what the file says,
// and the two things that actually decide collection (Playwright's default
// testMatch, and the resolution of a relative testDir) are not in that text.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import vitestConfig from '../vitest.config';

const FRONTEND = fileURLToPath(new URL('../', import.meta.url));
const TESTS_DIR = `${FRONTEND}tests`;
const E2E_DIR = `${TESTS_DIR}/e2e`;
const PLAYWRIGHT_CLI = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));

/** Every .ts/.tsx file under `dir`, recursively, as paths relative to FRONTEND. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = `${current}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) found.push(next.slice(FRONTEND.length));
    }
  };
  walk(dir);
  return found.sort();
}

type PlaywrightListing = {
  config: { rootDir: string; projects: { name: string; testMatch: string[]; testIgnore: string[] }[] };
  suites: { file: string }[];
};

/** What Playwright itself says it would collect, resolved to FRONTEND-relative paths. */
function playwrightListing(): { rootDir: string; testMatch: string[]; files: string[] } {
  const stdout = execFileSync(
    process.execPath,
    [PLAYWRIGHT_CLI, 'test', '--list', '--reporter=json'],
    { cwd: FRONTEND, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );

  const listing = JSON.parse(stdout) as PlaywrightListing;
  const rootDir = `${listing.config.rootDir}/`;

  return {
    rootDir: rootDir.slice(FRONTEND.length),
    testMatch: listing.config.projects.flatMap(project => project.testMatch),
    files: listing.suites.map(suite => `${rootDir}${suite.file}`.slice(FRONTEND.length)).sort(),
  };
}

/**
 * The file suffixes vitest's include patterns end in, e.g. ['.test.ts', '.test.tsx'].
 *
 * The shape of each pattern is asserted before anything is derived from it. A
 * hand-rolled glob engine would be a second, worse implementation of the thing
 * under test; refusing to interpret a pattern this does not recognise turns
 * that risk into a loud failure instead of a silently wrong answer.
 */
function vitestIncludeSuffixes(): string[] {
  const include = vitestConfig.test?.include;
  expect(include, 'vitest.config.ts no longer sets test.include').toBeDefined();

  return include!.map(pattern => {
    const match = /^tests\/\*\*\/\*(\.[a-z]+\.tsx?)$/.exec(pattern);
    expect(
      match,
      `vitest include pattern ${JSON.stringify(pattern)} is not the "tests/**/*.<suffix>" shape ` +
        'this test knows how to reason about. Widen the assertion deliberately rather than ' +
        'letting it interpret a pattern it does not understand.',
    ).not.toBeNull();
    return match![1];
  });
}

describe('the vitest and Playwright collectors', () => {
  const onDisk = sourceFilesUnder(TESTS_DIR);
  const e2eOnDisk = sourceFilesUnder(E2E_DIR);

  it('are both actually holding files, so nothing below passes vacuously', () => {
    // Hardcoded floors, not derived from the sets being compared: two empty
    // sets are disjoint, and that is the way every assertion in this file
    // silently stops meaning anything.
    expect(onDisk.length).toBeGreaterThanOrEqual(70);
    expect(e2eOnDisk.length).toBeGreaterThanOrEqual(1);
    expect(playwrightListing().files.length).toBeGreaterThanOrEqual(1);
  });

  it('cannot both claim a file, because vitest only takes *.test.ts(x)', () => {
    const suffixes = vitestIncludeSuffixes();
    expect(suffixes.sort()).toEqual(['.test.ts', '.test.tsx']);

    // Every file vitest would collect, computed from its own config rather than
    // from a guess about what it collects.
    const vitestCollects = onDisk.filter(file =>
      suffixes.some(suffix => file.endsWith(suffix)),
    );
    const playwrightCollects = playwrightListing().files;

    expect(
      vitestCollects.filter(file => playwrightCollects.includes(file)),
      'a file is claimed by both runners',
    ).toEqual([]);

    // And the other direction, which the intersection alone does not give:
    // Playwright must not be looking at a *.test.ts that merely happens not to
    // exist under tests/e2e today.
    expect(playwrightCollects.filter(file => file.includes('.test.'))).toEqual([]);
  });

  it('keeps Playwright inside tests/e2e, holding exactly the specs on disk', () => {
    const { rootDir, testMatch, files } = playwrightListing();

    expect(rootDir).toBe('tests/e2e/');
    // Narrower than Playwright's default `**/*.@(spec|test).?(c|m)[jt]s?(x)`,
    // which would match every unit test in this repository. Losing this line is
    // how the e2e job would start trying to run the vitest suite in a browser.
    expect(testMatch).toEqual(['**/*.spec.ts']);

    expect(files).toEqual(e2eOnDisk.filter(file => file.endsWith('.spec.ts')));
  });

  it('leaves no file in the wrong directory to be picked up by the wrong one', () => {
    // The disk-side half. The two configs can be perfect and a `*.spec.ts`
    // dropped into tests/ next to the unit tests would still be collected by
    // nobody at all — which is worse than being collected twice, because
    // nothing reports it.
    const strayUnitTestInE2e = e2eOnDisk.filter(file => /\.test\.tsx?$/.test(file));
    expect(strayUnitTestInE2e, 'a *.test.ts under tests/e2e is run by neither runner').toEqual([]);

    const straySpecOutsideE2e = onDisk.filter(
      file => file.endsWith('.spec.ts') && !file.startsWith('tests/e2e/'),
    );
    expect(straySpecOutsideE2e, 'a *.spec.ts outside tests/e2e is run by neither runner').toEqual(
      [],
    );
  });
});

describe('the Playwright config itself', () => {
  it('is type-checked by the node project, like the other two config files', () => {
    // playwright.config.ts sits at frontend/ root: outside tsconfig.app.json
    // ("src") and outside tsconfig.test.json ("tests"). Without this entry it is
    // compiled by NOTHING — the same hole the README describes for tests/, and
    // the same one typeGateFileSet2.test.ts exists to keep shut. It matters
    // here specifically because this file is the only place the preview port,
    // the build mode and testMatch are written down.
    const configPath = `${FRONTEND}tsconfig.node.json`;
    const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'));
    expect(parsed.error, 'tsconfig.node.json is not parseable as JSONC').toBeUndefined();

    const include = (parsed.config as { include?: string[] }).include ?? [];
    expect(include).toContain('playwright.config.ts');
  });
});
