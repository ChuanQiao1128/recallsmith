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
import { execFileSync } from 'node:child_process';
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

// The file counts in the same table, checked against git rather than trusted.
//
// The paths above were guarded from the start; the numbers beside them were not,
// and by the time this was noticed one had already drifted — the table said 111
// for frontend/ while the tree held 112, because a file was added after the
// count was taken. A number in a document with nothing keeping it true is the
// shape of defect this repository has spent a long time removing from its code.
// It applies to prose as well.
//
// `git ls-files` is the same command the README says it used, so the assertion
// and the claim cannot drift apart by using different definitions of "file".
describe('the file counts in the README table', () => {
  it('match what git actually tracks', () => {
    const markdown = readFileSync(README, 'utf8');

    // | `frontend/` | React 19, … | Admin console… | 112 |
    const rows = [
      ...markdown.matchAll(/\|\s*`([\w.\-/]+?)\/?`\s*\|[^|]*\|[^|]*\|\s*(\d+)\s*\|/g),
    ].map(m => ({ dir: m[1], claimed: Number(m[2]) }));

    // Anti-vacuity: a regex that stops matching would otherwise pass silently.
    expect(rows.map(r => r.dir).sort()).toEqual([...TOP_LEVEL].sort());

    const actual = rows.map(({ dir }) => {
      const listed = execFileSync('git', ['ls-files', dir], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return { dir, count: listed.split('\n').filter(Boolean).length };
    });

    expect(actual).toEqual(rows.map(r => ({ dir: r.dir, count: r.claimed })));
  });
});
