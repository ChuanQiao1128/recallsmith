// A census of one module's dangling exports: src/api/authoring.ts.
//
// WHY THIS FILE EXISTS
//
// It was written the day 19 uncalled hooks were deleted from src/hooks/. Three
// of those hooks were the only consumer of something in the api layer:
//
//   useDashboard.ts      -> fetchDashboard  and the DashboardData interface
//   useManifest.ts       -> rebuildManifest
//
// Deleting the hooks left all three sitting in authoring.ts with no importer
// anywhere in the repo, and *nothing* went red. That is not an oversight in one
// tool, it is a gap every tool here shares by construction:
//
//   * tsconfig.app.json turns on noUnusedLocals, and the name says the scope —
//     an export is consumed from outside the file, so an unused one is not a
//     local and never will be.
//   * ESLint has no cross-file rule; each file is linted alone.
//   * Rollup tree-shakes dead exports out of the bundle, which means the build
//     stays the same size and the waste is invisible in dist/ too.
//   * The other 30 test files assert behaviour, and a symbol nobody imports has
//     no behaviour to assert.
//
// So cascade dead code is the specific shape that survives a deletion with a
// green suite. This file makes it fail instead.
//
// HOW TO READ A FAILURE
//
// The list below is an outstanding balance, asserted with toEqual in both
// directions. Two ways to break it, and they need opposite fixes:
//
//   * a name APPEARS that is not on the list -> something's last importer just
//     went away. Delete the export, or wire it up. Do not add it here to get
//     green; adding it here is the one edit that turns this file into
//     decoration.
//   * a name VANISHES from the list -> someone paid debt down. Remove it here,
//     in the same change.
//
// WHY THE LIST IS EMPTY
//
// It used to carry four entries — fetchPermissions, updatePermission,
// bulkUpdatePermissions and checkPublishJobStatus — real endpoints with no page
// behind them, recorded rather than fixed while the cascade cleanup stayed
// scoped. F22 (CFE-21) deleted all four from src/api/authoring.ts, so the
// outstanding balance is now zero. A name reappearing here means a deletion
// elsewhere just orphaned an export again; wire it up or delete it, do not
// re-add it here.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { namesImportedFrom, topLevelExportedNames } from './support/hookWiringScan';
import type { SourceFile } from './support/hookWiringScan';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));
const TESTS_ROOT = fileURLToPath(new URL('.', import.meta.url));
const AUTHORING = join(SRC_ROOT, 'api', 'authoring.ts');

/**
 * Exports of src/api/authoring.ts that nothing imports, sorted.
 *
 * Empty since F22 (CFE-21) deleted the four dead endpoints —
 * fetchPermissions, updatePermission, bulkUpdatePermissions and
 * checkPublishJobStatus — that used to sit here with no page behind them.
 */
const EXPECTED_DANGLING: string[] = [];

/**
 * SCOPE: this module only, not all of src/.
 *
 * Widening it to every file under src/ was tried and produced 90+ false
 * positives in one run: a page reached only through a lazy `import()` has no
 * static importer, and a constant used only by tests looks unimported from src.
 * A census that cries wolf ninety times gets an allowlist bolted on, and the
 * allowlist is what everyone reads afterwards. One module, exactly right, beats
 * the whole tree approximately right.
 */
function readSources(dir: string, into: SourceFile[] = []): SourceFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return into;
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      readSources(path, into);
    } else if (/\.tsx?$/.test(entry)) {
      into.push({ path, source: readFileSync(path, 'utf8') });
    }
  }

  return into;
}

// tests/ is in the importer set alongside src/. Leaving it out would report
// every export that only a test consumes as dead, and the next person would
// delete something with coverage.
const consumers = [...readSources(SRC_ROOT), ...readSources(TESTS_ROOT)];

const exported = topLevelExportedNames({
  path: AUTHORING,
  source: readFileSync(AUTHORING, 'utf8'),
});

const imported = namesImportedFrom(consumers, 'authoring', 'src/api/authoring.ts');
const dangling = exported.filter(name => !imported.has(name)).sort();

describe('exports of src/api/authoring.ts that nothing imports', () => {
  it('are none: the four old dead exports were deleted', () => {
    // A new name here means a deletion elsewhere just orphaned an export.
    expect(dangling).toEqual(EXPECTED_DANGLING);
  });

  it('was computed from a real export surface, not an empty parse', () => {
    // Without this, a parser that returns nothing finds nothing dangling and
    // this file goes green forever while asserting that the empty set equals
    // four names — which it does not, so the floor is belt and braces. The
    // real failure it catches is authoring.ts being renamed or moved: the read
    // would throw, but a future refactor that makes reads lenient would turn
    // this into a silent pass.
    expect(exported.length).toBeGreaterThanOrEqual(20);
  });

  it('was computed against a real set of importers', () => {
    // Same failure from the other side: zero importers scanned would report
    // every export as dangling, which is loud — but a *partial* scan is quiet
    // and wrong. A namespace import would also defeat the name-level check, so
    // it is rejected rather than treated as "imports nothing".
    expect(consumers.length).toBeGreaterThanOrEqual(20);
    expect(imported.has('*')).toBe(false);
  });
});
