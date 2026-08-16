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
