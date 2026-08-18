// Hook order on DeckListPage, pinned statically.
//
// WHY THIS CANNOT BE A RUNTIME TEST. React only complains about hook order when
// it changes BETWEEN TWO RENDERS OF THE SAME COMPONENT. A refactor that moves a
// hook call and then renders consistently in the new order is completely
// invisible at runtime: every render agrees with every other render, no warning
// fires, and every existing test stays green. The bug it hides is the one the
// comment at DeckListPage.tsx:153 already warns about in prose — a hook drifting
// into the middle of a block that is about to be lifted somewhere else — and
// until this file existed nothing checked that warning.
//
// So the evidence has to come from the source text, not from rendering it.
//
// HOW "IN THE COMPONENT BODY" IS DECIDED. The walk starts at DeckListPage's body
// and refuses to descend into any nested function-like node. That makes the rule
// exactly "the nearest enclosing function is the component body", which is the
// same rule React itself applies.
//
// It is deliberately NOT a list of helper names to skip. Such a list has to
// name loadAll, resolveDeckId, handleDeleteDeck, handlePublish, loadPublishJobs
// and handleSignOut today, would silently go stale the first time somebody adds
// a seventh helper, and cannot express the arrow functions passed to useEffect
// and useMemo at all — which is where most of this file's nested code lives.
// Structure answers the question; a name list only approximates it.
//
// C2 is the other half. C1 describes the PAGE's hook sequence, and that is only
// a description of the rendered tree while the tree has no other hooks in it. A
// child component that called useNavigate of its own would have a hook order
// that C1 cannot see.
//
// That was also the concrete reason the older, unused DeckTable component (in a
// sibling decks/ directory, deleted in the same step that added this file) was
// not reused for the split: it called useNavigate() internally, so adopting it
// would have put a hook below the page that C1 could never account for.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const PAGE = path.join(FRONTEND, 'src/pages/DeckListPage.tsx');
const SPLIT_DIR = path.join(FRONTEND, 'src/features/deckList/components');

/**
 * The hook calls DeckListPage makes directly, in source order.
 *
 * Recorded against the unmodified page and updated once since, deliberately:
 * `useDeleteDeck` and `usePublishDeck` were added immediately after
 * `useConfirm` when the two row actions moved onto react-query mutations. That
 * placement is not arbitrary — they sit with the other thing the row actions
 * need, and above the paginated block, which is the block the comment at the
 * useDeckPagination call warns must be liftable as a unit.
 *
 * `useDeckPagination` now sits at index 26; the two useMemos at the end are
 * still `decks` and `viewRows`.
 */
const EXPECTED_HOOK_SEQUENCE = [
  'useNavigate',
  'useMemo',
  'useMemo',
  'useMemo',
  'useState',
  'useState',
  'useConfirm',
  'useDeleteDeck',
  'usePublishDeck',
  'useState',
  'useState',
  'useRef',
  'useState',
  'useState',
  'useRef',
  'useState',
  'useState',
  'useState',
  'useState',
  'useRef',
  'useRef',
  'useState',
  'useState',
  'useState',
  'useRef',
  'useEffect',
  'useDeckPagination',
  'useEffect',
  'useEffect',
  'useEffect',
  'useEffect',
  'useMemo',
  'useMemo',
];

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    // Parents are needed: getStart(sourceFile) walks up for leading trivia.
    true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessor(node)
    || ts.isSetAccessor(node)
  );
}

/** `foo()` -> "foo"; `React.foo()` -> "foo"; anything else -> null. */
function calleeName(node: ts.CallExpression): string | null {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    return expression.name.text;
  }
  return null;
}

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

/** Hook calls made directly by `fn`'s body, in source order. */
function directHookCalls(sourceFile: ts.SourceFile, body: ts.Node): string[] {
  const hits: Array<{ name: string; pos: number }> = [];

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== null && isHookName(name)) {
        hits.push({ name, pos: node.getStart(sourceFile) });
      }
    }
    node.forEachChild(child => {
      // The whole rule, in one line.
      if (isFunctionLike(child)) return;
      walk(child);
    });
  }

  walk(body);
  // Pre-order already yields source order, but sorting makes that a property of
  // the result rather than an assumption about forEachChild.
  hits.sort((a, b) => a.pos - b.pos);
  return hits.map(h => h.name);
}

function findComponent(sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | null = null;
  sourceFile.forEachChild(node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
  });
  expect(found, `${name} is not a top-level function declaration`).not.toBeNull();
  return found as unknown as ts.FunctionDeclaration;
}

describe('C1: the page calls its hooks in a fixed order', () => {
  it('matches the recorded sequence exactly', () => {
    const sourceFile = parse(PAGE);
    const component = findComponent(sourceFile, 'DeckListPage');
    expect(component.body, 'DeckListPage has no body').not.toBeUndefined();

    const actual = directHookCalls(sourceFile, component.body as ts.Block);
    expect(actual).toEqual(EXPECTED_HOOK_SEQUENCE);
  });

  it('the recorded sequence is not vacuous', () => {
    // A scanner that silently found nothing would agree with an empty literal
    // forever. Three independent floors: the length, the presence of the one
    // non-React hook, and the fact that more than one distinct hook appears.
    expect(EXPECTED_HOOK_SEQUENCE.length).toBe(33);
    expect(EXPECTED_HOOK_SEQUENCE).toContain('useDeckPagination');
    expect(new Set(EXPECTED_HOOK_SEQUENCE).size).toBeGreaterThan(4);
  });

  it('the walk really does stop at nested functions', () => {
    // Control for the scanner itself. handleSignOut and loadPublishJobs contain
    // no hook calls, but the arrow bodies inside useEffect(...) do contain
    // ordinary calls — and every hook name the page mentions anywhere is
    // accounted for by the sequence above. If the walk descended, the two
    // useState calls React makes internally would not appear (they are in
    // another file), but `useConfirm` inside a handler would. This asserts the
    // shape instead: the raw text mentions no hook the walk missed.
    const source = readFileSync(PAGE, 'utf8');
    const mentioned = new Set(
      Array.from(source.matchAll(/\b(use[A-Z]\w*)\s*\(/g)).map(m => m[1]),
    );
    const collected = new Set(EXPECTED_HOOK_SEQUENCE);
    // Every hook NAME that appears anywhere in the file is one the component
    // body calls. If a helper ever starts calling a hook of its own, this goes
    // red and asks a person whether the walk should have seen it.
    expect(Array.from(mentioned).sort()).toEqual(Array.from(collected).sort());
  });
});

describe('C2: the split components contribute no hooks of their own', () => {
  function splitFiles(): string[] {
    if (!existsSync(SPLIT_DIR)) return [];
    return readdirSync(SPLIT_DIR)
      .filter(f => f.endsWith('.tsx'))
      .sort();
  }

  it('finds the components (a floor, so an empty glob cannot pass)', () => {
    // Deliberately RED until Phase D creates the directory. A hook-freedom
    // assertion over zero files is satisfied by every possible codebase, so the
    // floor is not optional and must not be lowered to make this go green.
    expect(splitFiles().length).toBeGreaterThanOrEqual(5);
  });

  it('none of them calls a hook, and none is memoised', () => {
    const offenders: string[] = [];

    for (const file of splitFiles()) {
      const full = path.join(SPLIT_DIR, file);
      const sourceFile = parse(full);
      const source = readFileSync(full, 'utf8');

      // Any hook call anywhere in the file, at any nesting depth: a hook inside
      // a child component in the same file counts just as much.
      const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const name = calleeName(node);
          if (name !== null && isHookName(name)) offenders.push(`${file}: calls ${name}()`);
        }
        node.forEachChild(walk);
      };
      walk(sourceFile);

      // React.memo and useCallback are banned separately from hooks: they are
      // how a behaviour change gets dressed up as an optimisation, and either
      // one would make the parity instruments in deckListSplitParity.test.tsx
      // describe a different tree from the one production renders.
      if (/\bmemo\s*\(/.test(source)) offenders.push(`${file}: uses memo()`);
    }

    expect(offenders).toEqual([]);
  });
});
