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

import { findApiCallSites, scanHookWiring } from './support/hookWiringScan';
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
  /**
   * Real, but aimed at an endpoint nothing in the app calls — not through the
   * hook and not around it. Wiring it up would need a caller invented first.
   */
  wrongEndpoint: 'not-applicable-to-current-endpoint',
  /**
   * A page already imports the exact api function this hook wraps and calls it
   * inline. The endpoint is live; the hook is the part being skipped. This is
   * the shape the ratchet exists to count, so it gets its own name instead of
   * hiding inside "not applicable".
   */
  pageCallsApiDirectly: 'page-calls-wrapped-api-directly',
} as const;

/**
 * `apiFn` is the function the hook's queryFn or mutationFn awaits, read off
 * src/hooks/useDecks.ts, useCards.ts and useManifest.ts. It is what makes the
 * two reasons above decidable instead of rhetorical: `wrongEndpoint` claims
 * that name has no caller outside src/api and src/hooks, `pageCallsApiDirectly`
 * claims it has at least one, and the assertions further down check both
 * directions against the parsed source.
 *
 * The hooks with no `apiFn` wrap nothing — they are local-state utilities, and
 * neither claim applies to them.
 *
 * 22 when this file was written. CardListPage now renders through useDeck,
 * useCards and useDeleteCard, so those three came off the list — which is the
 * only way the list is allowed to shrink.
 */
interface AllowlistEntry {
  reason: string;
  apiFn?: string;
}

const ALLOWLIST: Record<string, AllowlistEntry> = {
  // Only DeckListPage's super-admin path calls the cursor-paged
  // fetchAdminDecksPage. Its non-super-admin path, and its 403/404 fallback,
  // call fetchDecks() at DeckListPage.tsx:438 — the same request useDecks
  // wraps — and ContentIntelligencePage.tsx:122 calls it too. So the obstacle
  // is not that the endpoint is unused: it is that the page wants the
  // localStorage cache and the manifest join that sit around the call.
  useDecks: { reason: REASON.pageCallsApiDirectly, apiFn: 'fetchDecks' },
  useCreateDeck: { reason: REASON.pageCallsApiDirectly, apiFn: 'createDeck' },
  useUpdateDeck: { reason: REASON.pageCallsApiDirectly, apiFn: 'updateDeck' },
  useDeleteDeck: { reason: REASON.pageCallsApiDirectly, apiFn: 'deleteDeck' },

  useCreateCard: { reason: REASON.pageCallsApiDirectly, apiFn: 'createCard' },
  useUpdateCard: { reason: REASON.pageCallsApiDirectly, apiFn: 'updateCard' },

  // DeckListPage.tsx:439 calls fetchAdminManifest() beside its deck fetch.
  useManifest: { reason: REASON.pageCallsApiDirectly, apiFn: 'fetchAdminManifest' },
  // The one entry the original label was right about: rebuildManifest has no
  // caller anywhere outside src/api and src/hooks. Nothing in the app rebuilds
  // the manifest, through this hook or around it.
  useRebuildManifest: { reason: REASON.wrongEndpoint, apiFn: 'rebuildManifest' },

  // Not react-query at all — a 211-line hook with its own localStorage cache
  // and the third copy of the five-minute TTL (see cacheDuplicationCensus).
  // It is also the only caller of fetchDashboard.
  useDashboard: { reason: REASON.deleteCandidate, apiFn: 'fetchDashboard' },
  // A generic async hook that overlaps with both api/dedupe.ts and react-query.
  useAsync: { reason: REASON.deleteCandidate },

  useLocalStorage: { reason: REASON.interviewDemo },
  useDebounce: { reason: REASON.interviewDemo },
  useDebouncedCallback: { reason: REASON.interviewDemo },
  usePrevious: { reason: REASON.interviewDemo },
  usePreviousDistinct: { reason: REASON.interviewDemo },
  useHistory: { reason: REASON.interviewDemo },
  useIntersectionObserver: { reason: REASON.interviewDemo },
  useInfiniteScroll: { reason: REASON.interviewDemo },
  useCountUp: { reason: REASON.interviewDemo },
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

const sources = readSources(SRC_ROOT);
const scan = scanHookWiring(sources);
const apiCallSites = findApiCallSites(sources);

/** Files outside src/api and src/hooks that invoke `apiFn`, sorted. */
function directCallersOf(apiFn: string): string[] {
  return [...new Set(apiCallSites.filter(site => site.apiFn === apiFn).map(site => site.path))]
    .sort();
}

function entriesWithReason(reason: string): [string, AllowlistEntry][] {
  return Object.entries(ALLOWLIST).filter(([, entry]) => entry.reason === reason);
}

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

// A reason nobody can check is a comment wearing an assertion's clothes. These
// two run in opposite directions so neither can be satisfied by shrugging: one
// fails if a "nothing calls this endpoint" note is filed over a live call site,
// the other fails if a "the page calls it directly" note names a function with
// no caller at all.
describe('the reason attached to each unwired hook', () => {
  it('says "no page uses this endpoint" only where nothing calls it', () => {
    const contradicted = entriesWithReason(REASON.wrongEndpoint)
      .map(([hook, entry]) => ({
        hook,
        apiFn: entry.apiFn,
        callers: entry.apiFn === undefined ? [] : directCallersOf(entry.apiFn),
      }))
      .filter(row => row.apiFn === undefined || row.callers.length > 0);

    // A hit here means the page is reaching past the hook to the same request,
    // which is the debt this file counts — not a reason to be excused from it.
    expect(contradicted).toEqual([]);
  });

  it('says "the page calls the api directly" only where a call site exists', () => {
    const unsupported = entriesWithReason(REASON.pageCallsApiDirectly)
      .map(([hook, entry]) => ({
        hook,
        apiFn: entry.apiFn,
        callers: entry.apiFn === undefined ? [] : directCallersOf(entry.apiFn),
      }))
      .filter(row => row.callers.length === 0);

    // Without this direction the new reason would be a free pass: relabel
    // anything, nothing checks.
    expect(unsupported).toEqual([]);
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

  it('is judging every hook in the folder, not only the ones the barrel lists', () => {
    // Everything above judges src/hooks/index.ts. A hook file that index.ts
    // never re-exports is not an orphan, not an allowlist entry and not a
    // failure — it is invisible, which would make "the debt cannot grow" a
    // claim about the barrel rather than about the codebase. Adding a hook
    // nobody calls and leaving it out of the barrel was, until this line,
    // enough to pass.
    expect(scan.hooksNotInBarrel).toEqual([]);
  });
});
