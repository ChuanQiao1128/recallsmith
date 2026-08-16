// A guard on the gap between "the prop works" and "the app passes it".
//
// ChunkErrorBoundary takes a resetKey and clears its error screen when that key
// changes. chunkErrorBoundary.test.tsx proves that behaviour by rendering the
// boundary directly and handing it two different keys. Every one of those cases
// stays green when App.tsx stops passing resetKey at all — measured, not
// assumed: deleting the attribute from App.tsx leaves all 257 tests passing.
//
// So the behaviour has a test and the wiring does not, which is the failure
// this repo keeps rediscovering — most recently in a hook-wiring guard that
// counted a mention inside a comment as a call. A prop that is implemented,
// tested and never passed is the same shape of nothing.
//
// tsc cannot cover it either: resetKey is optional, because the boundary is
// mounted without a router in its own tests. Making it required would trade
// this hole for a worse one.
//
// Read off the AST rather than the rendered tree because App mounts every route
// in the application; asserting one attribute should not require standing up
// auth, a query client and a router first.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const APP_PATH = fileURLToPath(new URL('../src/App.tsx', import.meta.url));

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

function attribute(tag: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return tag.attributes.properties.find(
    (prop): prop is ts.JsxAttribute =>
      ts.isJsxAttribute(prop) && prop.name.getText() === name,
  );
}

describe('App hands the boundary its reset signal', () => {
  it('mounts exactly one ChunkErrorBoundary', () => {
    // A second one nested inside would catch first and never receive a key,
    // which is how this guard could pass while the outer wiring rots.
    expect(openingTags(parseApp(), 'ChunkErrorBoundary')).toHaveLength(1);
  });

  it('passes resetKey, so the error screen cannot outlive the route', () => {
    const source = parseApp();
    const [boundary] = openingTags(source, 'ChunkErrorBoundary');
    const resetKey = attribute(boundary, 'resetKey');

    expect(resetKey).not.toBeUndefined();

    // Not just present: it has to carry a value that changes on navigation.
    // `resetKey` alone parses fine and means `true`, a constant, which would
    // reinstate the bug with the attribute still visibly there.
    const initializer = resetKey?.initializer;
    expect(initializer).not.toBeUndefined();
    expect(ts.isJsxExpression(initializer!)).toBe(true);

    const expression = (initializer as ts.JsxExpression).expression?.getText(source) ?? '';
    // The location object identity is stable across some updates, so the key
    // reads a field off it rather than the object itself.
    expect(expression).toMatch(/location\.(pathname|key|search)/);
  });

  it('reads that value from the router rather than inventing one', () => {
    const source = parseApp();
    const text = source.getFullText();

    // useLocation is what makes the pathname above re-render App on navigation.
    // Swapping it for a captured constant would keep the attribute, keep the
    // shape, and stop the reset from ever firing.
    expect(text).toContain('useLocation');
    expect(openingTags(source, 'ChunkErrorBoundary')).toHaveLength(1);
  });
});
