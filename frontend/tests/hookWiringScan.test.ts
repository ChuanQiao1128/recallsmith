// Positive and negative controls for the scanner that hookWiring.test.ts
// trusts.
//
// The scanner's failure mode is not "wrong answer", it is "confident answer
// from no evidence": handed nothing, it reports that every hook is an orphan,
// which is precisely what a full allowlist expects to hear. So it is driven
// here with synthetic sources in both directions — a hook that is used must not
// be called an orphan, and a hook that is not used must be.

import { describe, expect, it } from 'vitest';
import { scanHookWiring } from './support/hookWiringScan';
import type { SourceFile } from './support/hookWiringScan';

const INDEX_PATH = 'src/hooks/index.ts';

const INDEX_SOURCE = `
export { useDecks, useDeck } from './useDecks';
export { useCards } from './useCards';
export { useLocalStorage } from './useLocalStorage';
export { queryClient, QueryKeys } from '../api/queryClient';
`;

/** The hooks barrel, plus whatever consumer files a case wants to add. */
function withIndex(...consumers: SourceFile[]): SourceFile[] {
  return [{ path: INDEX_PATH, source: INDEX_SOURCE }, ...consumers];
}

describe('what counts as an exported hook', () => {
  it('reads the barrel, and only the symbols that name a hook', () => {
    const scan = scanHookWiring(withIndex());
    expect(scan.exportedHooks).toEqual(['useCards', 'useDeck', 'useDecks', 'useLocalStorage']);
    // queryClient and QueryKeys ride along in the same file and are not hooks.
    expect(scan.exportedHooks).not.toContain('queryClient');
    expect(scan.exportedHooks).not.toContain('QueryKeys');
  });

  it('finds nothing to judge when the barrel is missing from the input', () => {
    // A glob that misses src/hooks/index.ts must not look like "no orphans".
    const scan = scanHookWiring([
      { path: 'src/pages/Anything.tsx', source: 'export const x = 1;' },
    ]);
    expect(scan.exportedHooks).toHaveLength(0);
    expect(scan.orphans).toHaveLength(0);
  });
});

describe('what counts as a call site', () => {
  it('does not call a hook an orphan when a page imports and uses it', () => {
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/CardListPage.tsx',
        source: `
          import { useCards } from '../hooks/useCards';
          export function Page() { return useCards(7); }
        `,
      }),
    );
    expect(scan.calledHooks).toContain('useCards');
    expect(scan.orphans).not.toContain('useCards');
    expect(scan.orphans).toEqual(['useDeck', 'useDecks', 'useLocalStorage']);
  });

  it('counts an import through the barrel, not only the concrete file', () => {
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/DeckListPage.tsx',
        source: `
          import { useDecks } from '../hooks';
          export function Page() { return useDecks(); }
        `,
      }),
    );
    expect(scan.calledHooks).toContain('useDecks');
    expect(scan.orphans).not.toContain('useDecks');
  });

  it('calls every hook an orphan when no consumer file exists at all', () => {
    const scan = scanHookWiring(withIndex());
    expect(scan.orphans).toEqual(['useCards', 'useDeck', 'useDecks', 'useLocalStorage']);
    expect(scan.calledHooks).toHaveLength(0);
  });

  it('ignores hooks importing each other inside src/hooks', () => {
    // useDecks calling useCards would otherwise mark useCards as wired while
    // no page has ever rendered it.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/hooks/useDecks.ts',
        source: `
          import { useCards } from './useCards';
          export function useDecks() { return useCards(1); }
        `,
      }),
    );
    expect(scan.orphans).toContain('useCards');
  });

  it('does not accept an import that the file body never mentions', () => {
    // Wired on paper only: the binding exists, nothing renders through it.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Unused.tsx',
        source: `
          import { useCards } from '../hooks';
          export function Page() { return null; }
        `,
      }),
    );
    expect(scan.orphans).toContain('useCards');
    expect(scan.calledHooks).toHaveLength(0);
  });

  it('reports a namespace import instead of reading through it', () => {
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Sneaky.tsx',
        source: `
          import * as hooks from '../hooks';
          export function Page() { return hooks.useCards(7); }
        `,
      }),
    );
    expect(scan.namespaceImports).toHaveLength(1);
    expect(scan.namespaceImports[0].local).toBe('hooks');
    expect(scan.namespaceImports[0].path).toBe('src/pages/Sneaky.tsx');
    // And it is still counted as an orphan, so the two signals cannot cancel
    // out into a quiet pass.
    expect(scan.orphans).toContain('useCards');
  });
});

describe('the file count the disk-reading half is judged on', () => {
  it('reports how many files it was handed', () => {
    expect(scanHookWiring([]).scannedFileCount).toBe(0);
    expect(scanHookWiring(withIndex()).scannedFileCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Mentioned is not called.
//
// The scan above asks whether the file body contains the identifier anywhere.
// That is a text search, and a text search cannot tell a call site from a
// comment, a string, a type position or a property name. Every case below is a
// file where nothing renders through the hook, and the pre-AST scanner said it
// was wired.
//
// Why this matters more here than it would elsewhere: hookWiring.test.ts
// asserts the allowlist and the orphan set are the *same* set, in both
// directions. So a hook that leaves `orphans` for a bogus reason turns the
// staleness assertion red, and the only edit that makes it green again is
// striking that hook off the ratchet. A single comment is enough to do it, and
// the comment is permanent. The freshness half of the guard becomes the lever
// that shrinks the guard — the wired-on-paper disease it was written to catch,
// caught in the catcher.
// ---------------------------------------------------------------------------

describe('a mention that is not a call', () => {
  it('does not count a name that appears only in a line comment', () => {
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Commented.tsx',
        source: `
          import { useDecks } from '../hooks';
          export function Page() {
            // TODO: wire useDecks here
            return null;
          }
        `,
      }),
    );
    expect(scan.calledHooks).not.toContain('useDecks');
    expect(scan.orphans).toContain('useDecks');
  });

  it('does not count a name that appears only in a block comment', () => {
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/BlockCommented.tsx',
        source: `
          import { useDecks } from '../hooks';
          /* useDecks */
          export function Page() { return null; }
        `,
      }),
    );
    expect(scan.calledHooks).not.toContain('useDecks');
    expect(scan.orphans).toContain('useDecks');
  });

  it('does not count a name that appears only inside a string literal', () => {
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Stringy.tsx',
        source: `
          import { useCards } from '../hooks';
          export const label = 'useCards';
        `,
      }),
    );
    expect(scan.calledHooks).not.toContain('useCards');
    expect(scan.orphans).toContain('useCards');
  });

  it('does not count a clause-level type-only import', () => {
    // `import type { x }` erases at compile time; the specifier-level filter
    // upstream only sees `{ type x }`, which is the other spelling.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/TypeOnly.tsx',
        source: `
          import type { useCards } from '../hooks';
          export type T = typeof useCards;
        `,
      }),
    );
    expect(scan.calledHooks).not.toContain('useCards');
    expect(scan.orphans).toContain('useCards');
  });

  it('does not count a binding that is referenced but never invoked', () => {
    // Putting a hook in a registry object renders exactly nothing.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Registry.tsx',
        source: `
          import { useCards } from '../hooks';
          export const registry = { useCards };
        `,
      }),
    );
    expect(scan.calledHooks).not.toContain('useCards');
    expect(scan.orphans).toContain('useCards');
  });

  it('does not count a same-named property on some other object', () => {
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Shadowed.tsx',
        source: `
          import { useDecks } from '../hooks';
          const other = { useDecks: () => 1 };
          export function Page() { return other.useDecks(); }
        `,
      }),
    );
    expect(scan.calledHooks).not.toContain('useDecks');
    expect(scan.orphans).toContain('useDecks');
  });

  it('does not accept a same-named export from a module that is not the hooks folder', () => {
    // A substring test for '/hooks' also matches '../vendor/hooks-compat',
    // which lets an unrelated package vouch for the barrel's symbols.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Impostor.tsx',
        source: `
          import { useCards } from '../vendor/hooks-compat';
          export function Page() { return useCards(7); }
        `,
      }),
    );
    expect(scan.calledHooks).not.toContain('useCards');
    expect(scan.orphans).toContain('useCards');
  });
});

describe('hooks that never reach the barrel', () => {
  it('reports a hook file that index.ts does not re-export', () => {
    // The ratchet judges the barrel. A hook that is never re-exported is not
    // an orphan, not an allowlist entry, and not a failure — it is invisible,
    // so "the debt cannot grow" only holds inside the barrel.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/hooks/useOrphanProbe.ts',
        source: `export function useOrphanProbe() { return 1; }`,
      }),
    );
    expect(scan.hooksNotInBarrel).toContain('useOrphanProbe');
  });
});

describe('a dynamic import of the barrel', () => {
  it('is reported rather than passing unseen', () => {
    // Same blind spot as `import * as hooks`, and previously not reported at
    // all: the statement scan only matches the static `... from '...'` form.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Lazy.tsx',
        source: `
          export async function Page() {
            const m = await import('../hooks');
            return m.useDecks();
          }
        `,
      }),
    );
    expect(scan.namespaceImports).toHaveLength(1);
    expect(scan.namespaceImports[0].specifier).toBe('../hooks');
    expect(scan.namespaceImports[0].path).toBe('src/pages/Lazy.tsx');
  });
});

// ---------------------------------------------------------------------------
// Two deliberate inaccuracies, pinned so a later change cannot quietly widen
// them into the hole they resemble. Both err toward calling a live hook an
// orphan, which turns the ratchet red and brings a human; the opposite error
// shrinks the ratchet in silence.
// ---------------------------------------------------------------------------

describe('the conservative bias, held in place', () => {
  it('still counts a call that sits in a branch nothing can reach', () => {
    // Reachability is not the question being asked. Answering it would need
    // control-flow analysis, and the wrong answer would be a false orphan.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/DeadBranch.tsx',
        source: `
          import { useCards } from '../hooks';
          export function Page() {
            if (false) { useCards(1); }
            return null;
          }
        `,
      }),
    );
    expect(scan.calledHooks).toContain('useCards');
  });

  it('calls a hook an orphan when it is only ever invoked through an alias', () => {
    // Following `const h = useCards` would mean tracking assignments. The scan
    // reports the orphan instead and lets a person look.
    const scan = scanHookWiring(
      withIndex({
        path: 'src/pages/Aliased.tsx',
        source: `
          import { useCards } from '../hooks';
          const h = useCards;
          export function Page() { return h(1); }
        `,
      }),
    );
    expect(scan.orphans).toContain('useCards');
  });
});
