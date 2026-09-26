// A ratchet on the gap between "the hook exists" and "something renders
// through it".
//
// The allowlist below is empty, so "orphans must be empty" is the entire
// ratchet: any hook the barrel publishes that nobody calls fails immediately.
// That empties the assertions that were phrased relative to the allowlist —
// over an empty list they reduce to expect([]).toEqual([]) and can never fail —
// which is why the numbers in this file are hardcoded rather than derived from
// ALLOWLIST. A check that collapses to an unfailable form when a list empties
// is indistinguishable from a broken one.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  findHookShapedExportsOutsideHooksDir,
  scanHookWiring,
} from './support/hookWiringScan';
import type { SourceFile } from './support/hookWiringScan';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Hooks allowed to sit in the barrel with no caller. Empty, and that is the
 * point. Adding an entry is a debt rather than a fix, so an entry has to say
 * why the hook cannot be wired up AND why deleting it is wrong — "someone
 * might want it later" is what kept 19 uncalled hooks alive here.
 */
const ALLOWLIST: Record<string, string> = {};

/**
 * What the barrel is expected to publish, by name.
 *
 * Written out rather than counted so that swapping one hook for another fails.
 * Every page imports these from the concrete files (`../hooks/useDecks`,
 * `../hooks/useCards`), not from the barrel, so this list is the barrel's
 * inventory and not a bundle fact.
 *
 * It was three — the read pair plus useDeleteCard — then nine, then ten, and is
 * now eleven. The newest is useUnsavedChangesGuard: the card and deck editors
 * warn before a stray navigation discards an unsaved edit, and it is called from
 * all three of them. Sorted, because scanHookWiring sorts.
 *
 * Call sites, one each and all in src/ (the "orphans are empty" assertion above
 * is what actually enforces this; the list is here so a swap is visible):
 *   useCards / useDeck / useDeleteCard  src/pages/CardListPage.tsx
 *   useCard / useUpdateCard             src/pages/EditCardPage.tsx
 *   useCreateCard                       src/pages/NewCardPage.tsx
 *   useCreateDeck                       src/pages/NewDeckPage.tsx
 *   useUpdateDeck                       src/pages/DeckEditPage.tsx
 *   useDeleteDeck / usePublishDeck      src/pages/DeckListPage.tsx
 *   useUnsavedChangesGuard              src/pages/EditCardPage.tsx,
 *                                       NewCardPage.tsx, DeckEditPage.tsx
 */
const EXPECTED_BARREL_HOOKS = [
  'useCard',
  'useCards',
  'useCreateCard',
  'useCreateDeck',
  'useDeck',
  'useDeleteCard',
  'useDeleteDeck',
  'usePublishDeck',
  'useUnsavedChangesGuard',
  'useUpdateCard',
  'useUpdateDeck',
];

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

function difference(from: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove);
  return from.filter(name => !drop.has(name));
}

describe('hooks that nothing calls', () => {
  it('are all accounted for, so the debt cannot grow', () => {
    const unexpected = difference(scan.orphans, Object.keys(ALLOWLIST));
    // A new hook with no caller lands here. Wire it up, delete it, or add it to
    // ALLOWLIST with the reason it is allowed to sit unused.
    expect(unexpected).toEqual([]);
  });

  it('are none, stated as an equality so the allowlist cannot quietly refill', () => {
    // The assertion above subtracts ALLOWLIST before comparing, so adding an
    // entry there silences it. This one does not, and it is the one that has to
    // be edited deliberately — with the entry above it — if a hook is ever
    // excused again.
    expect(scan.orphans).toEqual([]);
  });
});

describe('the scan itself is still looking at something', () => {
  it('rejects a namespace import, which would hide every call site', () => {
    // `import * as hooks` would make the named-binding scan report zero usage
    // for a file that uses everything.
    expect(scan.namespaceImports).toEqual([]);
  });

  it('found a plausible number of source files', () => {
    // 62 files under src/ today; the floor is deliberately far below that. It
    // is what turns "scanned nothing and agreed with the allowlist" from a pass
    // into a failure.
    expect(scan.scannedFileCount).toBeGreaterThanOrEqual(20);
  });

  it('found the barrel it is judging, and it publishes exactly the wired eleven', () => {
    // Hardcoded on purpose, and re-deriving either line from ALLOWLIST breaks
    // it: `toBeGreaterThanOrEqual(ALLOWLIST.size)` is a real floor of 22 while
    // the allowlist is full and silently becomes `>= 0` — unfailable, passing
    // even if src/hooks/index.ts were deleted — the moment it is emptied.
    // Naming the hooks removes the coupling entirely.
    expect(scan.exportedHooks).toEqual(EXPECTED_BARREL_HOOKS);
    expect(scan.exportedHooks.length).toBeGreaterThanOrEqual(3);
  });

  it('is judging every hook in the folder, not only the ones the barrel lists', () => {
    // Everything above judges src/hooks/index.ts. A hook file that index.ts
    // never re-exports is not an orphan, not an allowlist entry and not a
    // failure — it is invisible, which would make "the debt cannot grow" a
    // claim about the barrel rather than about the codebase. Adding a hook
    // nobody calls and leaving it out of the barrel was, until this line,
    // enough to pass.
    //
    // SCOPE: `hooksNotInBarrel` reads only files under src/hooks/. A hook
    // declared in src/utils, src/auth or a page is outside it entirely — see
    // the case below, which is the other half of the claim.
    expect(scan.hooksNotInBarrel).toEqual([]);
  });

  it('knows exactly which hooks live outside src/hooks, and they are accounted for', () => {
    // The assertion above is scoped to src/hooks/; this one covers the rest of
    // src/. Deliberately NOT folded into hooksNotInBarrel: that field is
    // asserted to be empty, and useAuth — which is correctly wired — would
    // land in it and turn a working hook red.
    //
    // useAuth is real and called from three places, hand-verified:
    //   src/auth/RequireAuth.tsx:7, src/pages/LoginPage.tsx:13,
    //   src/pages/AuthCallbackPage.tsx:9
    // It is listed here because it is UNGUARDED, not because it is debt. This
    // scan deliberately does not judge call sites for out-of-barrel hooks —
    // that would need relative specifiers resolved to files — so a second
    // entry appearing here is a prompt for a person, not a verdict: barrel it
    // so the real ratchet covers it, or add it with its call sites verified
    // the same way.
    //
    // useConfirm is the second entry, and the prompt was answered rather than
    // silenced. Call sites, hand-verified the same way:
    //   src/pages/CardListPage.tsx:71, src/pages/DeckListPage.tsx:168,
    //   src/pages/AdminUsersPage.tsx:118
    // Not added to src/hooks/index.ts: that barrel publishes the data-fetching
    // hooks, and this one reads a React context that only exists because a
    // provider is mounted above it. Its wiring question is not "does anything
    // call it" — three pages do — but "is the provider an ancestor", which no
    // barrel can answer. tests/appConfirmWiring.test.ts and
    // tests/confirmWiring.test.tsx are what answer it.
    //
    // useDeckPagination is the third entry, and the prompt was likewise
    // answered rather than silenced. It has exactly ONE call site, hand-verified
    // the same way:
    //   src/pages/DeckListPage.tsx:214 — the `} = useDeckPagination({
    //   superAdmin, debouncedQ, mountedRef, loadAll });` that closes the
    //   destructuring begun at :203
    // That statement is not left to a hand count either:
    // tests/deckPaginationHookWiring.test.ts W-a asserts there is exactly one
    // call to it in that file, W-d asserts the callee is the imported binding
    // rather than a same-named local, and W-b/W-c assert that every field the
    // hook returns is destructured there and that the page kept no duplicate
    // copy of its own. Not added to src/hooks/index.ts: that barrel publishes
    // the reusable data-fetching hooks, and this one is private to a single
    // page — it takes four values that page owns, one of them a ref, and hands
    // back a setter that page needs. Publishing it would advertise a reuse that
    // would be wrong to attempt.
    //
    // useAppQueryClient is the fourth entry, and the prompt was answered rather
    // than silenced. It is declared in src/api/queryClient.ts beside the client
    // it hands out, and its call sites are the six mutation hooks in
    // src/hooks/useCards.ts and src/hooks/useDecks.ts — hand-verified the same
    // way, one call at the top of each of useCreateCard, useUpdateCard,
    // useDeleteCard, useCreateDeck, useUpdateDeck, useDeleteDeck and
    // usePublishDeck. Deliberately NOT added to src/hooks/index.ts, and the
    // reason is mechanical rather than stylistic: this scan treats a call made
    // from inside src/hooks/ as plumbing rather than as a consumer, so a hook
    // that only the other hooks call would be published by the barrel, counted
    // as called by nobody, and land in `orphans` — turning a correctly-wired
    // hook into a permanent failure. It also does not belong there on merits:
    // that barrel publishes the data-fetching hooks pages render through, and
    // this one answers "which client", which no page asks.
    const outside = findHookShapedExportsOutsideHooksDir(sources).map(entry => entry.name);
    expect(outside).toEqual([
      'useAppQueryClient',
      'useAuth',
      'useConfirm',
      'useDeckPagination',
    ]);
  });
});
