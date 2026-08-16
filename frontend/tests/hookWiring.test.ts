// A ratchet on the gap between "the hook exists" and "something renders
// through it".
//
// HISTORY, kept because it is the reason this file is shaped the way it is.
//
// src/hooks/index.ts used to publish 22 hooks. At the time this file was
// written, pages and components called none of them: every page fetched with
// its own useState + useEffect, while a QueryClientProvider sat mounted in
// main.tsx with nothing underneath it that ever asked it for anything. That is
// not visible from any single file, so it survived eight rounds of review.
//
// This file made it visible and made it a one-way street, via an allowlist of
// hooks permitted to sit unused. CardListPage was then wired to useDeck,
// useCards and useDeleteCard, taking three off the list. In 2026-08 the
// remaining 19 were deleted outright rather than wired up, because a hook with
// no caller is not a feature waiting for a caller — it is code a reader has to
// rule out. The allowlist is now empty and the barrel publishes exactly the
// three hooks a page renders through.
//
// WHAT AN EMPTY ALLOWLIST DOES TO THE TWO ORIGINAL ASSERTIONS — read before
// editing, because one of them is now doing all the work and the other is
// doing none.
//
//   * "the debt cannot grow" (orphans must be empty) is now the entire ratchet.
//     With nothing excused, any hook the barrel publishes that no one calls
//     fails immediately.
//   * "the list cannot go stale" was the interesting half when the list had
//     entries: it forced a hook that got wired up to be struck off. Over an
//     empty list it reduces to expect([]).toEqual([]) and can never fail. It is
//     deleted rather than kept as a passing test, because a test that cannot
//     fail is indistinguishable from one that is broken.
//
// The same collapse hit the self-check further down, and that one was dangerous
// rather than merely useless: "found the barrel it is judging" floored
// exportedHooks.length against the ALLOWLIST size, so emptying the allowlist
// turned it into `>= 0` — true even if src/hooks/index.ts were deleted
// entirely, which is the exact failure it exists to catch. It is now floored
// against a hardcoded 3 and pinned by name. Do not re-derive that number from
// another value in this file; deriving it is what broke it.

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
 * Hooks allowed to sit in the barrel with no caller.
 *
 * Empty, and that is the point — it is the balance, and the balance is zero.
 * Adding an entry is allowed but it is a debt, not a fix: write why the hook
 * cannot be wired up and why deleting it is wrong, because "someone might want
 * it later" was the reasoning behind all 19 that were eventually deleted.
 */
const ALLOWLIST: Record<string, string> = {};

/**
 * What the barrel is expected to publish, by name.
 *
 * Written out rather than counted so that swapping one hook for another fails.
 * These three are the ones CardListPage renders through — it imports them from
 * the concrete files (`../hooks/useDecks`, `../hooks/useCards`), not from the
 * barrel, so this list is the barrel's inventory and not a bundle fact.
 */
const EXPECTED_BARREL_HOOKS = ['useCards', 'useDeck', 'useDeleteCard'];

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
    // 75 when this floor was written, 73 after the hook deletion. The floor is
    // what turns "scanned nothing and agreed with the allowlist" from a pass
    // into a failure.
    expect(scan.scannedFileCount).toBeGreaterThanOrEqual(20);
  });

  it('found the barrel it is judging, and it publishes exactly the wired three', () => {
    // Hardcoded on purpose. This assertion previously read
    //   expect(scan.exportedHooks.length).toBeGreaterThanOrEqual(ALLOWLIST.size)
    // which was a real floor of 22 while the allowlist was full and became `>= 0`
    // — unfailable — the moment it was emptied. Deleting src/hooks/index.ts
    // would have passed. Naming the hooks removes the coupling entirely.
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
    // useAuth is real and called from four places, hand-verified:
    //   src/auth/RequireAuth.tsx:7, src/auth/RequireGroup.tsx:12,
    //   src/pages/LoginPage.tsx:13, src/pages/AuthCallbackPage.tsx:9
    // It is listed here because it is UNGUARDED, not because it is debt. This
    // scan deliberately does not judge call sites for out-of-barrel hooks —
    // that would need relative specifiers resolved to files — so a second
    // entry appearing here is a prompt for a person, not a verdict: barrel it
    // so the real ratchet covers it, or add it with its call sites verified
    // the same way.
    const outside = findHookShapedExportsOutsideHooksDir(sources).map(entry => entry.name);
    expect(outside).toEqual(['useAuth']);
  });
});
