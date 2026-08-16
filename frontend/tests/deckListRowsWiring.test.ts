// A guard on the one thing the compiler cannot see about the buildViewRows
// extraction: whether the values PASSED to it are the same expressions the
// useMemo deps array is memoised ON.
//
// Three of the four locks on that input object already belong to tsc, and were
// measured rather than assumed:
//
//   Lock A  excess-property checking on an inline object literal rejects a
//           field that BuildViewRowsInput does not declare;
//   Lock B  every field is required, so a missing one is a type error;
//   Lock C  noUnusedLocals (tsconfig.app.json) reports TS6133 on a destructured
//           binding the function body never reads, so a field that is passed
//           and ignored cannot survive either.
//
// What none of them can see is a field whose VALUE drifts from the dep that
// tracks it. Both drifting shapes compile cleanly and both quietly change
// memoisation:
//
//   * `pagedItems: paged` instead of `paged.items` — the value read and the
//     value compared are then different objects;
//   * hoisting the literal above the factory — `const input = {...}; useMemo(
//     () => buildViewRows(input), [...])` — which builds a fresh object every
//     render. The memo still works today, but the next reader adds `input` to
//     the deps array to silence exhaustive-deps and the cache dies outright.
//
// W1 excludes the second by construction and W4 excludes the first, which is
// the whole reason this file exists rather than trusting tsc alone.
//
// NOTE ON THE COMPILER LOCKS: they are real, but nothing in this file holds
// them down — they live in `npx tsc --noEmit` and in the standalone tests
// type-check. Do not read W1-W4 as covering them.
//
// Runs in the default node environment: it parses a file, it does not mount
// anything.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PAGE_PATH = fileURLToPath(new URL('../src/pages/DeckListPage.tsx', import.meta.url));

/** The seven values the row model reads, in the order the deps array lists them. */
const EXPECTED_INPUTS = [
  'listMode',
  'paged.items',
  'decks',
  'manifestState.bySlug',
  'q',
  'statusFilter',
  'typeFilter',
];

function parsePage(): ts.SourceFile {
  return ts.createSourceFile(
    PAGE_PATH,
    readFileSync(PAGE_PATH, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

/** The `const viewRows = useMemo(...)` call, found by the name it binds. */
function findViewRowsMemo(source: ts.SourceFile): ts.CallExpression {
  let found: ts.CallExpression | undefined;

  walk(source, node => {
    if (!ts.isVariableDeclaration(node)) return;
    if (!ts.isIdentifier(node.name) || node.name.text !== 'viewRows') return;

    const init = node.initializer;
    if (init === undefined || !ts.isCallExpression(init)) return;
    if (!ts.isIdentifier(init.expression) || init.expression.text !== 'useMemo') return;
    found = init;
  });

  expect(found, 'no `const viewRows = useMemo(...)` found in DeckListPage.tsx').not.toBeUndefined();
  return found as ts.CallExpression;
}

/**
 * The expression the factory evaluates to.
 *
 * A block whose ONLY statement is a return is unwrapped, because that is the
 * shape the page uses and it is equivalent to a concise body. A block with two
 * or more statements is not unwrapped — that is precisely the hoisted-const
 * shape W1 exists to reject.
 */
function factoryResultExpression(memo: ts.CallExpression): ts.Expression | null {
  const factory = memo.arguments[0];
  if (factory === undefined || !ts.isArrowFunction(factory)) return null;

  const body = factory.body;
  if (!ts.isBlock(body)) return body;
  if (body.statements.length !== 1) return null;

  const only = body.statements[0];
  if (!ts.isReturnStatement(only) || only.expression === undefined) return null;
  return only.expression;
}

function depsArray(memo: ts.CallExpression): ts.ArrayLiteralExpression {
  const deps = memo.arguments[1];
  expect(deps !== undefined && ts.isArrayLiteralExpression(deps)).toBe(true);
  return deps as ts.ArrayLiteralExpression;
}

/** The single object literal argument handed to buildViewRows. */
function inputLiteral(memo: ts.CallExpression): ts.ObjectLiteralExpression {
  const result = factoryResultExpression(memo);
  expect(result, 'the useMemo factory does not evaluate directly to one expression').not.toBeNull();

  const call = result as ts.Expression;
  expect(ts.isCallExpression(call)).toBe(true);

  const callExpr = call as ts.CallExpression;
  expect(ts.isIdentifier(callExpr.expression) && callExpr.expression.text === 'buildViewRows').toBe(
    true,
  );
  expect(callExpr.arguments).toHaveLength(1);
  expect(ts.isObjectLiteralExpression(callExpr.arguments[0])).toBe(true);
  return callExpr.arguments[0] as ts.ObjectLiteralExpression;
}

/**
 * What each field actually passes. A shorthand `listMode,` passes the value of
 * `listMode`, so it contributes its own name — which is exactly what the deps
 * array spells.
 */
function passedExpressions(
  literal: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
): string[] {
  return literal.properties.map(property => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
    expect(ts.isPropertyAssignment(property)).toBe(true);
    return (property as ts.PropertyAssignment).initializer.getText(source).trim();
  });
}

describe('buildViewRows is wired to exactly what the memo tracks', () => {
  it('W1: the factory evaluates directly to buildViewRows(<object literal>)', () => {
    const source = parsePage();
    const memo = findViewRowsMemo(source);

    // Throws if the factory hoists the literal into a local, returns something
    // other than a call, or hands buildViewRows anything but one literal.
    const literal = inputLiteral(memo);
    expect(literal.properties.length).toBeGreaterThan(0);
  });

  it('W2: the input literal spreads nothing', () => {
    const source = parsePage();
    const literal = inputLiteral(findViewRowsMemo(source));

    // A spread would make the field set unreadable from here, and would also
    // slip past the excess-property check that Lock A relies on.
    const spreads = literal.properties.filter(ts.isSpreadAssignment);
    expect(spreads).toHaveLength(0);
  });

  it('W3: field count, deps count and the declared input count all agree', () => {
    const source = parsePage();
    const memo = findViewRowsMemo(source);

    expect(inputLiteral(memo).properties).toHaveLength(EXPECTED_INPUTS.length);
    expect(depsArray(memo).elements).toHaveLength(EXPECTED_INPUTS.length);
  });

  it('W4: every field passes the same expression its dep tracks', () => {
    const source = parsePage();
    const memo = findViewRowsMemo(source);

    const passed = passedExpressions(inputLiteral(memo), source).sort();
    const tracked = depsArray(memo)
      .elements.map(element => element.getText(source).trim())
      .sort();

    // Compared as multisets: field order is free, membership is not. Passing
    // `paged` while tracking `paged.items` reads a value the memo does not
    // compare, and that is invisible to the type checker.
    expect(passed).toEqual(tracked);
    expect(tracked).toEqual([...EXPECTED_INPUTS].sort());
  });
});
