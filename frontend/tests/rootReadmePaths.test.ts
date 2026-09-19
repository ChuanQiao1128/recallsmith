// The root README points at real files by path. This checks the paths resolve.
//
// Same reasoning as consolePlanDoc.test.ts, applied to the file a stranger reads
// first: a README that names `src_C/Worker/WorkerFunction.cs` stays exactly as
// convincing after that file is renamed or moved, and nothing else in the
// toolchain reads prose. The paths are the half of a README that can be checked
// mechanically, so they are.
//
// It deliberately does not check the surrounding claims — only that each cited
// path is on disk, which is the weakest thing that can still fail.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const README = fileURLToPath(new URL('../../README.md', import.meta.url));

const TOP_LEVEL = ['frontend', 'mobile', 'src_C', 'pg-layer', 'snowflake', 'docs', '.github'];

/** Every backticked repo-relative path the README mentions, deduplicated. */
function citedPaths(markdown: string): string[] {
  const pattern = new RegExp('`((?:' + TOP_LEVEL.join('|') + ')/[A-Za-z0-9._/-]+)`', 'g');
  const matches = [...markdown.matchAll(pattern)].map(m => m[1]);
  return [...new Set(matches)].sort();
}

describe('the root README', () => {
  it('is on disk', () => {
    expect(existsSync(README)).toBe(true);
  });

  it('only cites repository paths that exist', () => {
    const cited = citedPaths(readFileSync(README, 'utf8'));

    // Hardcoded, and NOT derived from `cited` — a floor computed from the thing
    // it is checking passes vacuously the moment the regex stops matching, which
    // is the exact bug hookWiring.test.ts records for its own barrel assertion.
    expect(cited.length).toBeGreaterThanOrEqual(12);

    const missing = cited.filter(path => !existsSync(new URL(path, `file://${REPO_ROOT}`)));
    expect(missing).toEqual([]);
  });

  it('ships a LICENSE with no unfilled template fields', () => {
    const license = fileURLToPath(new URL('../../LICENSE', import.meta.url));
    expect(existsSync(license)).toBe(true);
    expect(readFileSync(license, 'utf8')).not.toMatch(/YOUR NAME|\[year\]|\[fullname\]|<name>/);
  });
});

// The file-count column that used to sit in the same table is gone, and so is the
// assertion that guarded it. It never caught a defect. It failed four times on
// count drift alone -- three of those in CI, the last one leaving main red for
// twenty days -- because `git ls-files` reads the index, so any commit that adds
// a file without restaging the README breaks a check that was only ever
// restating what git already knows.
//
// The paths above are kept for the opposite reason: a README naming a file that
// no longer exists is wrong in a way nothing else in the toolchain would catch.
// That check has a job. Counting files was arithmetic with a maintenance bill.
