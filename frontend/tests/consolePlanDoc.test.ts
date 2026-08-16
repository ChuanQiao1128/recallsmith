// The plan document names the tests that hold this refactor down. This checks
// the names point at files that exist.
//
// A plan is the one artifact in a refactor that nothing else contradicts. Code
// gets compiled, tests get run, but a document claiming "covered by
// tests/deckListPageCache.test.tsx" stays exactly as convincing after that file
// is renamed, moved, or never written. The failure mode is specific and it has
// already happened once in this repo: the previous round's notes described a
// safety net by listing filenames, and the only way to check the list was to
// try each path by hand.
//
// So the document's claims about its own safety net are made falsifiable. This
// deliberately does not check that the tests pass or that they assert anything
// useful — it checks the weakest thing that can still fail, which is whether
// the file is there at all.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLAN = fileURLToPath(new URL('../../docs/console-refactor-plan.md', import.meta.url));
const FRONTEND = fileURLToPath(new URL('..', import.meta.url));

/** Every `tests/....test.ts(x)` path the document mentions, deduplicated. */
function citedTestPaths(markdown: string): string[] {
  const matches = markdown.match(/tests\/[\w./-]+\.test\.tsx?/g) ?? [];
  return [...new Set(matches)].sort();
}

describe('the console refactor plan', () => {
  it('is on disk where the steps after this one will look for it', () => {
    expect(existsSync(PLAN)).toBe(true);
  });

  it('only cites test files that exist', () => {
    const cited = citedTestPaths(readFileSync(PLAN, 'utf8'));

    // A document that cites nothing would pass the loop below vacuously, and a
    // vacuous pass is how this check would turn into decoration.
    expect(cited.length).toBeGreaterThanOrEqual(5);

    const missing = cited.filter(path => !existsSync(new URL(path, `file://${FRONTEND}`)));
    expect(missing).toEqual([]);
  });
});
