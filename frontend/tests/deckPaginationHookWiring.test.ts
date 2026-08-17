// A guard on the one thing the compiler cannot see about the useDeckPagination
// extraction: whether the page and the hook still agree on WHICH fields exist.
//
// PROVENANCE — read this before citing the file as characterization evidence.
// Unlike tests/deckPaginationLoadMore, ...Race, ...RowActions and
// ...ErrorSurface, this file was NOT written against an unmodified
// DeckListPage.tsx and could not have been. Before the extraction it fails on
// "cannot find module ./useDeckPagination", which is a fact about the file
// system rather than about the code, and treating that red as a red-to-green
// characterization would be exactly the false provenance claim that the header
// of tests/deckListPageLegacyPath.test.tsx exists to warn about. Its teeth come
// only from the post-extraction mutations recorded in the step report (W-a is
// killed by collapsing the destructuring to a single binding, W-b by removing a
// field from either side or from both, W-c by re-declaring one on the page).
//
// WHAT tsc ALREADY OWNS, so that none of these four are read as covering it:
// the hook's return type is declared, so a field the page destructures but the
// hook does not return is a type error, and a page that kept its own
// `const [pagedError, setPagedError] = useState(...)` alongside the
// destructured one is a duplicate-identifier error. What tsc cannot see is a
// field that is dropped from BOTH sides at once — which is precisely the shape
// of "a piece of state got left behind in the page" — and that is what the
// hardcoded EXPECTED list below is for.
//
// Runs in the default node environment: it parses two files, it mounts nothing.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PAGE_PATH = fileURLToPath(new URL('../src/pages/DeckListPage.tsx', import.meta.url));
const HOOK_PATH = fileURLToPath(new URL('../src/pages/useDeckPagination.ts', import.meta.url));

/**
 * The ten values the paginated channel hands back to the page.
 *
 * Hardcoded, and load-bearing precisely because it is a THIRD party. With only
 * the page and the hook compared against each other, deleting a field from both
 * at once satisfies the equality — and "the page quietly kept its own copy of
 * pagedError" begins by deleting it from the hook. Two legs cannot tell a move
 * from a loss; three can.
 *
 * setListMode and pagedRequestSeq are absent on purpose: they have no reader
 * outside the hook, and returning them would invite a second writer.
 */
const EXPECTED = [
  'listMode',
  'listModeRef',
  'paged',
  'setPaged',
  'pagedInitialized',
  'pagedLoading',
  'pagedLoadingMore',
  'pagedError',
  'loadPagedFirst',
  'loadPagedMore',
];

/** The eight bindings that moved into the hook and must not reappear on the page. */
const MOVED_STATE = [
  'listMode',
  'listModeRef',
  'paged',
  'pagedInitialized',
  'pagedLoading',
  'pagedLoadingMore',
  'pagedError',
  'pagedRequestSeq',
];

function parse(path: string, kind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

const parsePage = () => parse(PAGE_PATH, ts.ScriptKind.TSX);
const parseHook = () => parse(HOOK_PATH, ts.ScriptKind.TS);

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

/** Every `useDeckPagination(...)` call in the page, by callee identifier. */
function hookCalls(source: ts.SourceFile): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  walk(source, node => {
    if (!ts.isCallExpression(node)) return;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'useDeckPagination') {
      found.push(node);
    }
  });
  return found;
}

/** The variable declaration the single call initialises. */
function callDeclaration(source: ts.SourceFile): ts.VariableDeclaration {
  const calls = hookCalls(source);
  expect(calls, 'DeckListPage.tsx must call useDeckPagination exactly once').toHaveLength(1);

  const parent = calls[0].parent;
  expect(
    ts.isVariableDeclaration(parent),
    'the useDeckPagination call is not the initialiser of a variable declaration',
  ).toBe(true);
  return parent as ts.VariableDeclaration;
}

/**
 * The KEYS the page destructures — the property names, not the local bindings.
 *
 * `const { paged: pagedState } = ...` contributes `paged`, so renaming a local
 * is free while dropping a field is not. Comparing local names instead would
 * make a harmless rename fail and would still miss nothing extra.
 */
function destructuredKeys(source: ts.SourceFile): string[] {
  const name = callDeclaration(source).name;
  expect(
    ts.isObjectBindingPattern(name),
    'the hook result must be destructured; `const p = useDeckPagination(...)` hides which fields are used',
  ).toBe(true);

  const pattern = name as ts.ObjectBindingPattern;
  return pattern.elements.map(element => {
    // A rest element would absorb an unknown set of fields and make the
    // "which fields are used" question unanswerable from here, so fail loudly
    // rather than silently reporting a short list.
    expect(element.dotDotDotToken, 'a rest element in the destructuring hides fields').toBeUndefined();
    const key = element.propertyName ?? element.name;
    expect(ts.isIdentifier(key), 'a computed key in the destructuring is not readable from here').toBe(
      true,
    );
    return (key as ts.Identifier).text;
  });
}

/** The property names of the hook's single top-level return object literal. */
function returnedKeys(source: ts.SourceFile): string[] {
  let fn: ts.FunctionDeclaration | undefined;
  walk(source, node => {
    if (!ts.isFunctionDeclaration(node)) return;
    if (node.name?.text === 'useDeckPagination') fn = node;
  });
  expect(fn, 'no `function useDeckPagination` declaration found').not.toBeUndefined();

  const body = (fn as ts.FunctionDeclaration).body;
  expect(body, 'useDeckPagination has no body').not.toBeUndefined();

  const returns = (body as ts.Block).statements.filter(ts.isReturnStatement);
  expect(returns, 'useDeckPagination must have exactly one top-level return').toHaveLength(1);

  const expression = returns[0].expression;
  expect(
    expression !== undefined && ts.isObjectLiteralExpression(expression),
    'useDeckPagination must return an object literal',
  ).toBe(true);

  return (expression as ts.ObjectLiteralExpression).properties.map(property => {
    // A spread would make the returned set unreadable from here — and would
    // also slip past the excess-property check the declared return type relies
    // on — so it is rejected outright rather than approximated.
    expect(ts.isSpreadAssignment(property), 'the returned literal spreads something').toBe(false);
    const key = property.name;
    expect(key !== undefined && ts.isIdentifier(key), 'a returned property has no plain name').toBe(
      true,
    );
    return (key as ts.Identifier).text;
  });
}

/** Every name in the page initialised by useState(...) or useRef(...). */
function pageOwnedStateNames(source: ts.SourceFile): string[] {
  const names: string[] = [];
  walk(source, node => {
    if (!ts.isVariableDeclaration(node)) return;
    const init = node.initializer;
    if (init === undefined || !ts.isCallExpression(init)) return;
    if (!ts.isIdentifier(init.expression)) return;
    if (init.expression.text !== 'useState' && init.expression.text !== 'useRef') return;

    if (ts.isIdentifier(node.name)) {
      names.push(node.name.text);
      return;
    }
    // `const [x, setX] = useState(...)` — take the value binding and the setter.
    if (ts.isArrayBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          names.push(element.name.text);
        }
      }
    }
  });
  return names;
}

describe('the page and useDeckPagination agree on exactly one set of fields', () => {
  it('W-a: the page calls it once, and destructures the result', () => {
    const source = parsePage();

    // Throws if there is no call, more than one, a call that is not a
    // declaration initialiser, a plain identifier binding, a rest element, or a
    // computed key.
    const keys = destructuredKeys(source);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size, 'a key is destructured twice').toBe(keys.length);
  });

  it('W-b: destructured keys, returned keys and the declared ten all agree', () => {
    const destructured = destructuredKeys(parsePage()).sort();
    const returned = returnedKeys(parseHook()).sort();
    const expected = [...EXPECTED].sort();

    // Three-way. The first equality catches a field that exists on one side
    // only; the second catches a field deleted from both sides at once, which
    // is what "some state stayed behind in the page" looks like from here.
    expect(destructured).toEqual(returned);
    expect(returned).toEqual(expected);
  });

  it('W-c: the page declares no state of its own under any of the moved names', () => {
    const owned = new Set(pageOwnedStateNames(parsePage()));
    const leftBehind = MOVED_STATE.filter(name => owned.has(name));

    // Overlaps W-b deliberately. Keeping a duplicate AND destructuring the
    // hook's copy is a tsc redeclaration error; keeping it WITHOUT
    // destructuring is caught by W-b. This case adds nothing to the coverage
    // and everything to the failure message: it names the identifier and the
    // file the stale declaration is in, instead of printing two sorted arrays
    // and leaving the reader to diff them.
    expect(leftBehind).toEqual([]);
  });

  it('W-d: the identifier it calls is the one imported from ./useDeckPagination', () => {
    const source = parsePage();
    const imported: string[] = [];

    walk(source, node => {
      if (!ts.isImportDeclaration(node)) return;
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier) || specifier.text !== './useDeckPagination') return;

      const bindings = node.importClause?.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) return;
      for (const element of bindings.elements) imported.push(element.name.text);
    });

    // Without this, a page that declared its own local `function
    // useDeckPagination()` would satisfy W-a and W-b against itself while the
    // real hook sat unused — the "written but never called" shape this
    // repository keeps producing, wearing the name of its own guard.
    expect(imported).toContain('useDeckPagination');
  });
});
