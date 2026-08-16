// A ratchet on the gap between "the hook exists" and "something renders
// through it".
//
// src/hooks/index.ts publishes 22 hooks. At the time this file was written,
// pages and components called none of them: every page fetched with its own
// useState + useEffect, while a QueryClientProvider sat mounted in main.tsx
// with nothing underneath it that ever asked it for anything. That is not
// visible from any single file, so it survived eight rounds of review.
//
// The list below makes it visible, and makes it a one-way street:
//
//   * a hook that no one calls and that is not on the list fails the build, so
//     the debt cannot grow;
//   * a hook that gets wired up must be deleted from the list, so the list
//     cannot quietly go stale and start certifying a fiction.
//
// Both directions are asserted. Only the second one is unusual, and it is the
// one that matters: a stale allowlist is how a guard turns into decoration.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { scanHookWiring } from './support/hookWiringScan';
import type { SourceFile } from './support/hookWiringScan';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Why every entry carries a reason: "unused" is not a verdict, it is a
 * question. These three answers point at three different follow-ups, and
 * writing them here puts them where the next person is already looking.
 */
const REASON = {
  /** Kept on purpose as a worked example. Deleting it is a product call. */
  interviewDemo: 'interview-demo',
  /** Nothing needs it and something else already does the job. */
  deleteCandidate: 'delete-candidate',
  /** Real, but aimed at an endpoint no page currently uses. */
  wrongEndpoint: 'not-applicable-to-current-endpoint',
} as const;

// 22 when this file was written. CardListPage now renders through useDeck,
// useCards and useDeleteCard, so those three came off the list — which is the
// only way the list is allowed to shrink.
const ALLOWLIST: Record<string, string> = {
  // DeckListPage's super-admin path calls fetchAdminDecksPage, a cursor-paged
  // endpoint. useDecks wraps the legacy full-list fetchDecks. They are not two
  // spellings of the same request, so wiring the page to useDecks would change
  // which endpoint it hits; it needs a useInfiniteQuery of its own first.
  useDecks: REASON.wrongEndpoint,
  useCreateDeck: REASON.wrongEndpoint,
  useUpdateDeck: REASON.wrongEndpoint,
  useDeleteDeck: REASON.wrongEndpoint,

  useCreateCard: REASON.wrongEndpoint,
  useUpdateCard: REASON.wrongEndpoint,

  // Same story: the manifest pages call the admin manifest endpoints directly.
  useManifest: REASON.wrongEndpoint,
  useRebuildManifest: REASON.wrongEndpoint,

  // Not react-query at all — a 211-line hook with its own localStorage cache
  // and the third copy of the five-minute TTL (see cacheDuplicationCensus).
  // It is also the only caller of fetchDashboard.
  useDashboard: REASON.deleteCandidate,
  // A generic async hook that overlaps with both api/dedupe.ts and react-query.
  useAsync: REASON.deleteCandidate,

  useLocalStorage: REASON.interviewDemo,
  useDebounce: REASON.interviewDemo,
  useDebouncedCallback: REASON.interviewDemo,
  usePrevious: REASON.interviewDemo,
  usePreviousDistinct: REASON.interviewDemo,
  useHistory: REASON.interviewDemo,
  useIntersectionObserver: REASON.interviewDemo,
  useInfiniteScroll: REASON.interviewDemo,
  useCountUp: REASON.interviewDemo,
};

/**
 * A missing directory returns nothing rather than throwing, so a wrong root
 * fails on the file-count floor below — an assertion that says what went
 * wrong — instead of on an ENOENT stack trace that says where.
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

const scan = scanHookWiring(readSources(SRC_ROOT));

function difference(from: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove);
  return from.filter(name => !drop.has(name));
}

describe('hooks that nothing calls', () => {
  it('are all accounted for, so the debt cannot grow', () => {
    const unexpected = difference(scan.orphans, Object.keys(ALLOWLIST));
    // A new hook with no caller lands here. Wire it up, or add it with the
    // reason it is allowed to sit unused.
    expect(unexpected).toEqual([]);
  });

  it('are all still uncalled, so the list cannot go stale', () => {
    const wired = difference(Object.keys(ALLOWLIST), scan.orphans);
    // A hook on this list that something now calls has to be removed from it.
    // Without this direction the list would keep certifying that wired-up
    // hooks are dead, and the count would stop meaning anything.
    expect(wired).toEqual([]);
  });
});

describe('the scan itself is still looking at something', () => {
  it('rejects a namespace import, which would hide every call site', () => {
    // `import * as hooks` would make the named-binding scan report zero usage
    // for a file that uses everything.
    expect(scan.namespaceImports).toEqual([]);
  });

  it('found a plausible number of source files', () => {
    // 75 at the time of writing. The floor is what turns "scanned nothing and
    // agreed with the allowlist" from a pass into a failure.
    expect(scan.scannedFileCount).toBeGreaterThanOrEqual(20);
  });

  it('found the barrel it is judging', () => {
    expect(scan.exportedHooks.length).toBeGreaterThanOrEqual(Object.keys(ALLOWLIST).length);
  });
});
