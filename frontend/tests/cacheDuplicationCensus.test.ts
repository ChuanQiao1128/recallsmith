// A census of one number: 5 * 60 * 1000.
//
// Two files in src/ hold that literal, and each is a separate, hand-rolled
// answer to the same question — how long may this console show data it already
// has:
//
//   src/api/queryClient.ts   staleTime on the shared QueryClient.
//   src/pages/DeckListPage.tsx  TTL on a localStorage cache the page reads and
//                               writes itself, on its legacy non-paginated path.
//
// They are not merged here, and merging them is not a tidying job: the
// DeckListPage copy guards a code path that no test currently executes, and
// swapping its cache layer blind is how a five-minute-stale deck list ends up
// in front of someone deciding what to publish.
//
// So this file does the other thing a duplication can be held to — it caps it.
// A third copy fails. Removing one of the two also fails, until whoever removed
// it says so here. The list is the outstanding balance, and it can only be
// changed deliberately.
//
// PAID DOWN, 2026-08 — saying so here because the header above required it.
// There was a third holder, src/hooks/useDashboard.ts: a 212-line hook with its
// own localStorage cache and its own five-minute TTL, and the only caller of
// the api layer's fetchDashboard. Nothing in the app ever called the hook. It
// was deleted along with the other 18 uncalled hooks in src/hooks/, and
// fetchDashboard with it, so the third copy of this number is gone rather than
// merged. The balance went from three to two by deletion, which is the cheapest
// way a duplication is ever retired.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** The literal as written. Formatting variants are a different search. */
const TTL_LITERAL = '5 * 60 * 1000';

const EXPECTED_HOLDERS = [
  'api/queryClient.ts',
  'pages/DeckListPage.tsx',
];

function collect(dir: string, into: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return into;
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collect(path, into);
    } else if (/\.tsx?$/.test(entry)) {
      into.push(path);
    }
  }

  return into;
}

const scannedFiles = collect(SRC_ROOT);

const holders = scannedFiles
  .filter(path => readFileSync(path, 'utf8').includes(TTL_LITERAL))
  .map(path => relative(SRC_ROOT, path).split(sep).join('/'))
  .sort();

describe('the five-minute cache window', () => {
  it('is still written out in exactly two places', () => {
    // Equality, not containment, in both directions on purpose: a third copy
    // is new debt, and a vanished copy means someone paid some down and owes
    // this list an update.
    expect(holders).toEqual(EXPECTED_HOLDERS);
  });

  it('was searched for across a real set of files', () => {
    // Without this, a scan that reads nothing finds nothing, and "no fourth
    // copy" would be indistinguishable from "no files".
    expect(scannedFiles.length).toBeGreaterThanOrEqual(20);
  });
});
