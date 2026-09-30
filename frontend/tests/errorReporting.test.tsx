// @vitest-environment jsdom
//
// The three ways an uncaught failure can reach src/lib/reportError.ts, and where
// each one ends up now that the funnel's sink is Sentry (src/lib/sentry.ts).
//
// ---------------------------------------------------------------------------
// WHY "SENDS NOTHING" IS STILL THE FIRST-CLASS CASE HERE
// ---------------------------------------------------------------------------
// Every build without a resolved DSN (local, CI, a deploy whose resolver found
// nothing) must send nothing from any entry point. That is asserted by counting
// calls on the SDK mock and on every transport a browser has, not by reading a
// flag.
//
// ---------------------------------------------------------------------------
// WHO OWNS WHICH ENTRY POINT
// ---------------------------------------------------------------------------
// With Sentry active, its own global handlers own window errors and unhandled
// rejections, so installErrorReporting() attaches nothing (two owners would
// send every failure twice) and init must not be handed a defaultIntegrations
// key that could remove those handlers. The React path is a call inside
// ChunkErrorBoundary's componentDidCatch, which no global handler sees, so it
// reaches captureException through the funnel. The entry points fail
// independently and for unrelated reasons, so each is exercised separately.
//
// The SDK is mocked (vi.hoisted, so it survives vi.resetModules()), and the
// modules are re-imported after each reset because they keep per-page state.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = vi.hoisted(() => ({
  init: vi.fn<(options: Record<string, unknown>) => void>(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
  captureException: vi.fn<(error: unknown, hint?: unknown) => string>(() => 'event-id'),
}));

vi.mock('@sentry/react', () => sdk);

// Resolved with node:path rather than the `new URL(..., import.meta.url)` idiom
// the node-environment test files use: Vite rewrites that idiom as an asset
// reference, and under jsdom the rewritten form resolves against the document's
// http://localhost base, which fileURLToPath then rejects for not being a file:
// URL. The same workaround, with the measurement, is in
// tests/adminConsoleRequests.test.tsx.
const HERE = dirname(fileURLToPath(import.meta.url));

const DSN = 'https://publickey@example.invalid/1';

let removeListeners: (() => void) | null = null;
let sendBeacon: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

async function load() {
  vi.resetModules();
  const sentry = await import('../src/lib/sentry');
  const report = await import('../src/lib/reportError');
  const boundary = await import('../src/components/ChunkErrorBoundary');
  return { sentry, report, ChunkErrorBoundary: boundary.ChunkErrorBoundary };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Sentry on, SDK loaded and initialised. */
async function loadActive(): Promise<Loaded> {
  vi.stubEnv('VITE_SENTRY_DSN', DSN);
  const mods = await load();
  expect(mods.sentry.initConsoleSentry()).toBe(true);
  expect(await mods.sentry.whenConsoleSentryReady()).toBe(true);
  return mods;
}

/** Sentry off: no DSN in this build. */
async function loadInactive(): Promise<Loaded> {
  vi.stubEnv('VITE_SENTRY_DSN', '');
  const mods = await load();
  expect(mods.sentry.initConsoleSentry()).toBe(false);
  return mods;
}

beforeEach(() => {
  sdk.init.mockReset();
  sdk.browserTracingIntegration.mockClear();
  sdk.captureException.mockReset();
  vi.stubEnv('VITE_BUILD_ID', 'abc1234');
  vi.stubEnv('VITE_SENTRY_ENVIRONMENT', '');
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  // jsdom has no sendBeacon; a stub stands in so "never called" means something.
  sendBeacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  window.history.pushState({}, '', '/decks/cards?deckId=7');
});

afterEach(() => {
  removeListeners?.();
  removeListeners = null;
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'sendBeacon');
});

/** A component that throws on its first render, for the boundary path. */
function Exploding(): never {
  throw new Error('render exploded');
}

/**
 * The boundary logs to console.error and React logs the caught error itself, so
 * both are silenced per test rather than globally — a silenced console that
 * outlives the test hides real failures in the ones after it.
 */
function renderInsideBoundary(Boundary: Loaded['ChunkErrorBoundary']): void {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <Boundary resetKey="/decks">
      <Exploding />
    </Boundary>,
  );
  consoleError.mockRestore();
}

function listenerTypes(add: { mock: { calls: unknown[][] } }): unknown[] {
  return add.mock.calls.map(call => call[0]);
}

function expectNothingSent(xhrSend: { mock: { calls: unknown[] } }): void {
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.captureException).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(sendBeacon).not.toHaveBeenCalled();
  expect(xhrSend.mock.calls).toHaveLength(0);
}

function rejectionEvent(reason: unknown): Event {
  // A plain Event carrying `reason`, because jsdom does not implement
  // PromiseRejectionEvent. The handler reads the property, not the class.
  const event = new Event('unhandledrejection') as Event & { reason?: unknown };
  event.reason = reason;
  return event;
}

describe('an uncaught error reaches the right owner', () => {
  it('window error: owned by Sentry when active, silent when inactive', async () => {
    const active = await loadActive();
    const add = vi.spyOn(window, 'addEventListener');
    removeListeners = active.report.installErrorReporting();
    expect(listenerTypes(add)).not.toContain('error');
    expect(Object.keys(sdk.init.mock.calls[0][0])).not.toContain('defaultIntegrations');
    add.mockRestore();
    removeListeners();
    removeListeners = null;

    sdk.init.mockReset();
    const inactive = await loadInactive();
    const addAgain = vi.spyOn(window, 'addEventListener');
    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send');
    removeListeners = inactive.report.installErrorReporting();
    expect(listenerTypes(addAgain)).toContain('error');

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('top-level boom'), message: 'top-level boom' }));

    expectNothingSent(xhrSend);
  });

  it('unhandled rejection: owned by Sentry when active, silent when inactive', async () => {
    const active = await loadActive();
    const add = vi.spyOn(window, 'addEventListener');
    removeListeners = active.report.installErrorReporting();
    expect(listenerTypes(add)).not.toContain('unhandledrejection');
    expect(Object.keys(sdk.init.mock.calls[0][0])).not.toContain('defaultIntegrations');
    add.mockRestore();
    removeListeners();
    removeListeners = null;

    sdk.init.mockReset();
    const inactive = await loadInactive();
    const addAgain = vi.spyOn(window, 'addEventListener');
    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send');
    removeListeners = inactive.report.installErrorReporting();
    expect(listenerTypes(addAgain)).toContain('unhandledrejection');

    window.dispatchEvent(rejectionEvent(new Error('nobody caught this')));

    expectNothingSent(xhrSend);
  });

  it('React boundary: reaches captureException with the component stack', async () => {
    // No listeners installed on purpose: this path must not depend on them.
    const { ChunkErrorBoundary } = await loadActive();

    renderInsideBoundary(ChunkErrorBoundary);

    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const [error, hint] = sdk.captureException.mock.calls[0];
    expect((error as Error).message).toBe('render exploded');
    expect(hint).toMatchObject({
      tags: { 'console.source': 'react', 'console.route': '/decks/cards' },
      contexts: { react: { componentStack: expect.any(String) } },
    });
    // The component stack is the only thing that says WHERE, and a render error
    // has no useful file/line of its own.
    expect(JSON.stringify(hint)).toContain('Exploding');
    expect(JSON.stringify(hint)).not.toContain('deckId');
  });
});

describe('the reporter cannot become the failure', () => {
  it('installs once, so two calls do not double the listeners', async () => {
    // main.tsx calls this at module scope, but a module can be evaluated twice
    // (HMR, a test importing it again), and two listeners on the same event
    // report one failure twice.
    const { report } = await loadInactive();
    const add = vi.spyOn(window, 'addEventListener');

    removeListeners = report.installErrorReporting();
    expect(report.installErrorReporting()).toBe(removeListeners);

    expect(listenerTypes(add).filter(type => type === 'error')).toHaveLength(1);
    expect(listenerTypes(add).filter(type => type === 'unhandledrejection')).toHaveLength(1);

    // The active path is idempotent too: the same no-op every time.
    removeListeners();
    removeListeners = null;
    const active = await loadActive();
    const first = active.report.installErrorReporting();
    expect(active.report.installErrorReporting()).toBe(first);
  });

  it('never throws, even when captureException throws', async () => {
    const { report, ChunkErrorBoundary } = await loadActive();
    sdk.captureException.mockImplementation(() => {
      throw new Error('capture exploded');
    });

    expect(() => report.reportError(new Error('a'), 'react')).not.toThrow();
    expect(report.reportError(new Error('a'), 'react')).toBe(false);

    // The boundary's own screen, not a blank page: a throw out of
    // componentDidCatch would take the boundary down with the error it caught.
    renderInsideBoundary(ChunkErrorBoundary);
    expect(document.body.textContent).toContain('This page hit an error');
  });

  it('with no DSN nothing is sent from any entry point', async () => {
    const { report, ChunkErrorBoundary } = await loadInactive();
    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send');
    removeListeners = report.installErrorReporting();

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('a'), message: 'a' }));
    window.dispatchEvent(rejectionEvent(new Error('b')));
    renderInsideBoundary(ChunkErrorBoundary);

    expect(report.reportError(new Error('c'), 'react')).toBe(false);
    expectNothingSent(xhrSend);
  });
});

describe('the three entry points are actually attached to the application', () => {
  it('main.tsx starts Sentry, then installs the listeners, then mounts React', () => {
    // main.tsx calls createRoot at module scope, so importing it from a test
    // mounts the whole application into #root. The order is the claim and it is
    // read off the source, parsed rather than searched: a commented-out call is
    // still text, but it is not a node.
    const { init, install, mount } = mainPositions();

    expect(init, 'main.tsx never calls initConsoleSentry()').toBeGreaterThan(-1);
    expect(install, 'main.tsx never calls installErrorReporting()').toBeGreaterThan(-1);
    expect(mount, 'main.tsx never calls ReactDOM.createRoot').toBeGreaterThan(-1);
    expect(init, 'Sentry is decided after the listeners are installed').toBeLessThan(install);
    expect(install, 'the listeners are attached after React mounts').toBeLessThan(mount);
  });

  it('and the parse is really reading calls, not text', () => {
    // The control for the case above. A commented-out call must not count, and
    // the parser is run on both spellings so a parse that degenerated to a
    // substring search cannot pass.
    expect(positionsIn('installErrorReporting();\nReactDOM.createRoot(x);').install).toBe(0);
    expect(positionsIn('// installErrorReporting();\nReactDOM.createRoot(x);').install).toBe(-1);
    expect(positionsIn('initConsoleSentry();\ninstallErrorReporting();').init).toBe(0);
    expect(positionsIn('// initConsoleSentry();\ninstallErrorReporting();').init).toBe(-1);
  });

  it('the boundary is the one that reports the React path', () => {
    // Belt to the behavioural test above: that one proves captureException is
    // reached when a component throws inside ChunkErrorBoundary, which would
    // keep passing if some ancestor started reporting instead. This pins the
    // call to the file.
    expect(readBoundary()).toMatch(/reportError\(\s*error,\s*'react'/);
  });
});

/**
 * Source offsets of the module-scope calls whose ORDER is the claim.
 *
 * -1 for any one means "no such call", which is a different failure from "the
 * calls are in the wrong order" and gets its own message above.
 */
function positionsIn(source: string): { init: number; install: number; mount: number } {
  const file = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let init = -1;
  let install = -1;
  let mount = -1;

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (init === -1 && ts.isIdentifier(callee) && callee.text === 'initConsoleSentry') {
        init = node.getStart(file);
      }
      if (install === -1 && ts.isIdentifier(callee) && callee.text === 'installErrorReporting') {
        install = node.getStart(file);
      }
      if (
        mount === -1 &&
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'createRoot'
      ) {
        mount = node.getStart(file);
      }
    }
    node.forEachChild(walk);
  };

  walk(file);
  return { init, install, mount };
}

function mainPositions(): { init: number; install: number; mount: number } {
  return positionsIn(readFileSync(resolve(HERE, '../src/main.tsx'), 'utf8'));
}

function readBoundary(): string {
  return readFileSync(resolve(HERE, '../src/components/ChunkErrorBoundary.tsx'), 'utf8');
}
