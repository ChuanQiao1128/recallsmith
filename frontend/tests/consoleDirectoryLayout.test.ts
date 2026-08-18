// The one directory convention that has already drifted once, made checkable.
//
// docs/console-refactor-plan.md 12.1 writes down four rules about where things
// live. Only the first one is asserted here, and the choice is not arbitrary:
// it is the rule that was broken, silently, for months.
//
//   src/pages/ holds route entries and nothing else.
//
// Before step 12 that directory also held deckListPagination.ts,
// deckListManifest.ts, deckListRows.ts and useDeckPagination.ts — a pure
// module, a parser, a projection and a hook. None of them is a page. They
// arrived one at a time, each because it was "about DeckListPage", and nothing
// in the toolchain has an opinion about that: they compiled, they were
// imported, they were tested. A directory name is prose, and prose does not
// fail.
//
// ---------------------------------------------------------------------------
// WHY THE ASSERTION IS AN EQUALITY AND NOT AN EXISTENCE CHECK
// ---------------------------------------------------------------------------
// "Every page file is routed" alone would pass a repository where pages/ is
// full of helpers, as long as the real pages are also routed. "Every routed
// module is on disk" alone is already the compiler's job. The two-way equality
// between {files in src/pages/} and {modules App.tsx loads from './pages/'} is
// the shape that fails in BOTH directions:
//
//   - a helper lands in src/pages/          -> extra on the disk side
//   - a page stops being routed             -> extra on the App.tsx side
//
// The second direction is not hypothetical either. A page nothing routes is
// the "present but not wired" defect this repository keeps finding, and it is
// invisible to tsc and to every page test, because a page test imports the page
// directly.
//
// ---------------------------------------------------------------------------
// SCOPE, STATED SO IT IS NOT MISTAKEN FOR MORE
// ---------------------------------------------------------------------------
// Only the top level of src/pages/ is walked, and only rule 1 of the four is
// asserted. The other three ("features/ aggregates a domain", "components/ui/
// is cross-domain", "lib/ is pure") are judgements about what a file is FOR,
// and a test that pretended to decide that would be scoring its own guess.
// This one gets to be mechanical because "is it a route entry" has an answer
// written down in App.tsx.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const APP = `${SRC}App.tsx`;
const PAGES_DIR = `${SRC}pages`;

/**
 * Every `./pages/<Name>` module App.tsx pulls in, by name, from either spelling.
 *
 * Both spellings are real and both must be counted: the two public routes are
 * static `import` declarations, the ten protected ones are `import()` calls
 * inside React.lazy, and DeckListPage is a third shape again — an `import()`
 * inside a named arrow so the module can prefetch it. A collector that knew
 * about only one of those would report a subset and the equality below would
 * fail for a reason that has nothing to do with the convention.
 *
 * Parsed rather than grepped so that a path appearing inside a comment or a
 * string cannot register as a route.
 */
function routedPageNames(source: string): string[] {
  const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const found = new Set<string>();

  const record = (specifier: ts.Expression | undefined): void => {
    if (specifier === undefined || !ts.isStringLiteral(specifier)) return;
    const match = /^\.\/pages\/([A-Za-z0-9]+)$/.exec(specifier.text);
    if (match !== null) found.add(match[1]);
  };

  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) record(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      record(node.arguments[0]);
    }
    node.forEachChild(walk);
  };

  walk(file);
  return [...found].sort();
}

/** Every module sitting directly in src/pages/, by basename. */
function pageFileNames(): string[] {
  return readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name.replace(/\.tsx?$/, ''))
    .sort();
}

describe('src/pages/ holds route entries and nothing else', () => {
  it('contains exactly the modules App.tsx routes to', () => {
    expect(
      pageFileNames(),
      'src/pages/ and App.tsx disagree. A file here that App.tsx never loads is ' +
        'not a page — see docs/console-refactor-plan.md 12.1 for where it goes. ' +
        'A page App.tsx no longer loads is dead weight nothing else reports.',
    ).toEqual(routedPageNames(readFileSync(APP, 'utf8')));
  });

  it('is judging a real, non-trivial set of files', () => {
    // Hardcoded floors, NOT derived from either side. A floor computed from the
    // thing under test passes vacuously the moment the collector stops
    // matching — which is exactly the defect docsPaths.test.ts and
    // rootReadmePaths.test.ts both record against their own earlier versions.
    expect(pageFileNames().length).toBeGreaterThanOrEqual(12);
    expect(routedPageNames(readFileSync(APP, 'utf8'))).toContain('DeckListPage');
  });

  it('would notice if the collector stopped collecting', () => {
    // The equality above is satisfied by two empty sets. These samples fire the
    // real collector at source it must and must not match, so a walk that
    // silently returned nothing cannot pass by agreeing with an empty disk.
    const bothSpellings = `
      import { LoginPage } from './pages/LoginPage';
      const X = lazy(() => import('./pages/NewDeckPage').then(m => m.NewDeckPage));
    `;
    expect(routedPageNames(bothSpellings)).toEqual(['LoginPage', 'NewDeckPage']);

    // A path that only looks like one. Neither of these is a route, and a
    // regex over the file would have counted both.
    const decoys = `
      // See ./pages/GhostPage for the old shape.
      const s = './pages/StringPage';
      import { ConsoleShell } from './components/console/ConsoleShell';
    `;
    expect(routedPageNames(decoys)).toEqual([]);
  });
});
