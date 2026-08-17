// Where the confirmation provider sits, and that the pages are underneath it.
//
// Same reasoning as tests/appBoundaryWiring.test.ts, applied to a provider
// instead of a prop. ConfirmDialog can be mounted, focused, escaped and
// answered in tests/confirmDialogA11y.test.tsx while being reachable from
// nowhere in the application — which is precisely the state it was in before
// this step: not merely "unwired", but absent from the production bundle
// entirely (no chunk contained its markup). "The component works" and "the app
// has it" are separate claims and this file asserts the second.
//
// Read off the AST rather than the rendered tree because the *position* is the
// claim. tests/confirmWiring.test.tsx mounts the real <App/> and clicks a real
// row, which proves reachability; it cannot distinguish "inside Suspense" from
// "outside Suspense", and that distinction decides whether an open dialog
// survives a route chunk arriving late.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';

const APP_PATH = fileURLToPath(new URL('../src/App.tsx', import.meta.url));
const PAGES_DIR = fileURLToPath(new URL('../src/pages', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

/** The one file in src/ that is allowed to reach for the browser dialog. */
const FALLBACK_MODULE = 'components/ui/ConfirmDialogContext.ts';

/**
 * A call, not a mention.
 *
 * The bare name appears in prose in three of the files this scans — the call
 * sites explain in a comment why the wording changed when the browser dialog
 * went away — and a scanner that counted those would have to be satisfied by
 * deleting comments, which is the wrong incentive to build into a gate.
 */
const CONFIRM_CALL = /window\.confirm\s*\(/;

function parseApp(): ts.SourceFile {
  return ts.createSourceFile(
    'App.tsx',
    readFileSync(APP_PATH, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

/** Every opening tag named `name`, self-closing ones included. */
function openingTags(source: ts.SourceFile, name: string): ts.JsxOpeningLikeElement[] {
  const found: ts.JsxOpeningLikeElement[] = [];
  const walk = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === name
    ) {
      found.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return found;
}

/**
 * The whole element for `name` — opening tag through closing tag — so that
 * "inside" can be asked as a range question.
 *
 * Ranges rather than a parent walk because the parent chain from a JSX child up
 * to an ancestor element passes through JsxElement, SyntaxList and JsxFragment
 * nodes in a shape that varies with formatting; positions do not.
 */
function elementRange(source: ts.SourceFile, name: string): { pos: number; end: number } {
  const [tag] = openingTags(source, name);
  expect(tag, `no <${name}> in App.tsx`).not.toBeUndefined();
  const element = ts.isJsxSelfClosingElement(tag) ? tag : tag.parent;
  return { pos: element.pos, end: element.end };
}

function isInside(inner: { pos: number; end: number }, outer: { pos: number; end: number }): boolean {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

function tsxFilesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter(name => name.endsWith('.tsx') || name.endsWith('.ts'))
    .map(name => join(dir, name));
}

function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('App mounts the confirmation provider', () => {
  it('mounts exactly one, so there is one dialog and one pending answer', () => {
    // Two providers would each hold their own pending resolve, and a page would
    // reach whichever is nearer — so cancelling in the outer dialog would leave
    // the inner caller waiting forever. The supersede logic that prevents that
    // is per-provider.
    expect(openingTags(parseApp(), 'ConfirmDialogProvider')).toHaveLength(1);
  });

  it('puts every route underneath it, not beside it', () => {
    // The half that makes this more than "the tag is present". A provider
    // rendered as a sibling of <Routes> compiles, renders, and leaves every
    // page falling back to window.confirm — visibly working, and wired to
    // nothing.
    const source = parseApp();
    const provider = elementRange(source, 'ConfirmDialogProvider');
    const routes = elementRange(source, 'Routes');

    expect(isInside(routes, provider)).toBe(true);
  });

  it('sits inside the chunk boundary and outside Suspense', () => {
    // Both halves were argued in App.tsx and both are silent if wrong.
    //
    // Inside ChunkErrorBoundary: a failed chunk should replace the whole
    // screen. A dialog floating over the crash screen asks about an action
    // whose page is gone.
    //
    // Outside Suspense: a dialog has to outlive a route suspending underneath
    // it. Inside, React swaps the subtree for RouteFallback, the dialog
    // unmounts mid-question, and the awaiting handler is left with a promise
    // that no supersede path will ever answer.
    const source = parseApp();
    const provider = elementRange(source, 'ConfirmDialogProvider');
    const boundary = elementRange(source, 'ChunkErrorBoundary');
    const suspense = elementRange(source, 'Suspense');

    expect(isInside(provider, boundary)).toBe(true);
    expect(isInside(suspense, provider)).toBe(true);
  });
});

describe('the pages no longer reach for the browser dialog', () => {
  it('has no window.confirm left under src/pages', () => {
    const files = tsxFilesIn(PAGES_DIR);

    // Anti-vacuity, in both the count and the names: a glob that resolved to
    // nothing would satisfy "none of them calls window.confirm" perfectly, and
    // a glob that silently stopped matching .tsx would too. The four files
    // named here are the four that used to call it.
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const page of ['CardListPage.tsx', 'AdminUsersPage.tsx', 'DeckListPage.tsx']) {
      expect(files.some(f => f.endsWith(page)), `did not scan ${page}`).toBe(true);
    }

    const offenders = files
      .filter(file => CONFIRM_CALL.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(PAGES_DIR.length + 1));
    expect(offenders).toEqual([]);
  });

  it('leaves exactly one caller of window.confirm in src/, the documented fallback', () => {
    // Asserted as an exact set rather than a count. The fallback is what keeps
    // a bare-mounted page working without a provider, and it is deliberate; a
    // second entry appearing here means some component grew its own dialog
    // again, which is the thing this step removed.
    const callers = allSourceFiles(SRC_DIR)
      .filter(file => CONFIRM_CALL.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(SRC_DIR.length + 1).split('\\').join('/'))
      .sort();

    expect(callers).toEqual([FALLBACK_MODULE]);
  });
});
