// @vitest-environment jsdom
//
// The three ways an uncaught failure can reach src/lib/reportError.ts, and the
// one condition under which it must reach the network from none of them.
//
// ---------------------------------------------------------------------------
// WHY "SENDS NOTHING" IS THE FIRST-CLASS CASE HERE
// ---------------------------------------------------------------------------
// There is no server collecting these reports today. A module in that state
// usually ships as either a TODO or a POST to a URL somebody will fill in
// later, and both are worse than silence: the first is never wired, the second
// starts failing requests on every page in production the day the placeholder
// host stops resolving. So "no endpoint configured -> zero calls to sendBeacon"
// is asserted as hard as the sending cases, and it is asserted by counting the
// calls rather than by inspecting a flag.
//
// ---------------------------------------------------------------------------
// WHY THE THREE ENTRY POINTS ARE EXERCISED SEPARATELY
// ---------------------------------------------------------------------------
// They fail independently and for unrelated reasons. window.onerror and
// unhandledrejection are two different listeners that a refactor can drop one
// of; the React path is a call inside componentDidCatch, which a boundary can
// keep working perfectly without. A single "reportError posts a beacon" test
// would pass with two of the three funnels disconnected — and disconnected is
// the state all three were in before this step.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installErrorReporting, reportError } from '../src/lib/reportError';
import { ChunkErrorBoundary } from '../src/components/ChunkErrorBoundary';

// Resolved with node:path rather than the `new URL(..., import.meta.url)` idiom
// the node-environment test files use: Vite rewrites that idiom as an asset
// reference, and under jsdom the rewritten form resolves against the document's
// http://localhost base, which fileURLToPath then rejects for not being a file:
// URL. The same workaround, with the measurement, is in
// tests/adminConsoleRequests.test.tsx.
const HERE = dirname(fileURLToPath(import.meta.url));

const ENDPOINT = 'https://collector.invalid/report';

/** Every sendBeacon(url, body) this test observed, body parsed back to an object. */
interface Beacon {
  url: string;
  body: Record<string, unknown>;
}

let beacons: Beacon[] = [];
let sendBeacon: ReturnType<typeof vi.fn>;
let removeListeners: (() => void) | null = null;

/**
 * jsdom does not implement navigator.sendBeacon at all, so this is a stub
 * standing in for a missing API rather than a spy replacing a real one. That is
 * stated because it decides an assertion below: `typeof navigator.sendBeacon`
 * is 'undefined' in this environment unless something puts it there, which is
 * exactly the guard reportError checks before building a payload.
 */
function installBeaconStub(): void {
  sendBeacon = vi.fn((url: string, body?: BodyInit | null) => {
    beacons.push({ url, body: JSON.parse(String(body)) as Record<string, unknown> });
    return true;
  });
  Object.defineProperty(navigator, 'sendBeacon', {
    value: sendBeacon,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  beacons = [];
  installBeaconStub();
  vi.stubEnv('VITE_ERROR_REPORT_URL', ENDPOINT);
  vi.stubEnv('VITE_BUILD_ID', 'abc1234');
  window.history.pushState({}, '', '/decks/cards?deckId=7');
});

afterEach(() => {
  removeListeners?.();
  removeListeners = null;
  cleanup();
  vi.unstubAllEnvs();
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
function renderInsideBoundary(): void {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ChunkErrorBoundary resetKey="/decks">
      <Exploding />
    </ChunkErrorBoundary>,
  );
  consoleError.mockRestore();
}

describe('an uncaught error reaches the reporter', () => {
  it('from a script that threw outside React', () => {
    removeListeners = installErrorReporting();

    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('top-level boom'), message: 'top-level boom' }),
    );

    expect(beacons).toHaveLength(1);
    expect(beacons[0].url).toBe(ENDPOINT);
    expect(beacons[0].body.source).toBe('window.onerror');
    expect(beacons[0].body.message).toBe('top-level boom');
  });

  it('from a promise nobody awaited', () => {
    removeListeners = installErrorReporting();

    // A plain Event carrying `reason`, because jsdom does not implement
    // PromiseRejectionEvent. The handler reads the property, not the class.
    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new Error('nobody caught this');
    window.dispatchEvent(event);

    expect(beacons).toHaveLength(1);
    expect(beacons[0].body.source).toBe('unhandledrejection');
    expect(beacons[0].body.message).toBe('nobody caught this');
  });

  it('from a component that threw while rendering', () => {
    // No listeners installed on purpose: this path must not depend on them.
    renderInsideBoundary();

    expect(beacons).toHaveLength(1);
    expect(beacons[0].body.source).toBe('react');
    expect(beacons[0].body.message).toBe('render exploded');
    // The component stack is the only thing that says WHERE, and a render error
    // has no useful file/line of its own.
    expect(String(beacons[0].body.detail)).toContain('Exploding');
  });
});

describe('what a report carries', () => {
  it('names the build, so an old error can be told from a current one', () => {
    reportError(new Error('x'), 'react');
    expect(beacons[0].body.build).toBe('abc1234');
  });

  it('falls back to the mode rather than inventing a build id', () => {
    vi.stubEnv('VITE_BUILD_ID', '');
    reportError(new Error('x'), 'react');
    expect(beacons[0].body.build).toBe(import.meta.env.MODE);
    expect(beacons[0].body.build).not.toBe('');
  });

  it('names the route by path only, never the query string', () => {
    // The load-bearing case is /auth/callback, whose query string carries the
    // Cognito authorization code — a live credential, on the one route where a
    // failure is most likely to be reported. Sending `location.href` here would
    // hand that code to whatever host the endpoint names.
    window.history.pushState({}, '', '/auth/callback?code=SECRET-AUTH-CODE&state=xyz');

    reportError(new Error('callback blew up'), 'window.onerror');

    expect(beacons[0].body.route).toBe('/auth/callback');
    expect(JSON.stringify(beacons[0].body)).not.toContain('SECRET-AUTH-CODE');
  });

  it('bounds a stack that a deep tree made enormous', () => {
    const error = new Error('deep');
    error.stack = 'x'.repeat(20_000);

    reportError(error, 'react');

    // sendBeacon refuses an oversized payload and the refusal is silent, so an
    // unbounded stack would turn "reported" into "dropped" with no signal.
    expect(String(beacons[0].body.stack).length).toBeLessThan(4_100);
  });

  it('survives a value that is not an Error at all', () => {
    // `throw 'a string'` and a rejected promise carrying an object are both
    // reachable, and neither has .message or .stack.
    reportError('just a string', 'unhandledrejection');

    expect(beacons).toHaveLength(1);
    expect(beacons[0].body.message).toBe('just a string');
    expect(beacons[0].body.stack).toBe('');
  });
});

describe('with no endpoint configured, which is this repository today', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ERROR_REPORT_URL', '');
  });

  it('sends nothing from any of the three entry points', () => {
    removeListeners = installErrorReporting();

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('a'), message: 'a' }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('b');
    window.dispatchEvent(rejection);
    renderInsideBoundary();

    // Counting the calls, not reading a flag: a module that built a payload and
    // then threw it away would satisfy a flag and still cost the page the work.
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(beacons).toEqual([]);
  });

  it('says so to its caller rather than pretending it sent', () => {
    expect(reportError(new Error('a'), 'react')).toBe(false);
  });

  it('and the same three entry points do send when it is set', () => {
    // The control for the assertion above: three silent calls prove nothing
    // unless the same three are noisy under the only condition that differs.
    vi.stubEnv('VITE_ERROR_REPORT_URL', ENDPOINT);
    removeListeners = installErrorReporting();

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('a'), message: 'a' }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('b');
    window.dispatchEvent(rejection);
    renderInsideBoundary();

    expect(beacons.map(b => b.body.source)).toEqual([
      'window.onerror',
      'unhandledrejection',
      'react',
    ]);
  });
});

describe('the reporter cannot become the failure', () => {
  it('swallows a sendBeacon that throws, instead of turning one failure into two', () => {
    // WRITTEN TWICE. The first version dispatched an ErrorEvent and asserted
    // that dispatchEvent did not throw — and it survived deleting the catch,
    // because jsdom (like a browser) reports an exception thrown inside a
    // listener rather than propagating it out of dispatchEvent. The assertion
    // was true no matter what the code did.
    //
    // reportError is therefore called directly, where a throw has somewhere to
    // go, and the boundary case below covers the path that actually matters:
    // componentDidCatch is not a listener, and a throw there escapes the
    // boundary that was handling the first error.
    sendBeacon.mockImplementation(() => {
      throw new Error('beacon exploded');
    });

    expect(() => reportError(new Error('a'), 'react')).not.toThrow();
    expect(reportError(new Error('a'), 'react')).toBe(false);
  });

  it('lets the boundary keep showing its fallback when reporting blows up', () => {
    sendBeacon.mockImplementation(() => {
      throw new Error('beacon exploded');
    });

    renderInsideBoundary();

    // The boundary's own screen, not a blank page: a throw out of
    // componentDidCatch would take the boundary down with the error it caught.
    expect(document.body.textContent).toContain('This page hit an error');
  });

  it('sends nothing, and builds nothing, where sendBeacon does not exist', () => {
    // The JSON.stringify spy is what gives the `typeof navigator.sendBeacon`
    // guard teeth. Without it the guard is unobservable: delete it and the call
    // throws on `undefined(...)`, the try/catch below catches, and reportError
    // returns false either way — an assertion on the return value alone cannot
    // tell a checked branch from a swallowed crash. The difference that IS
    // observable is the work: with the guard, no payload is ever built.
    Reflect.deleteProperty(navigator, 'sendBeacon');
    const stringify = vi.spyOn(JSON, 'stringify');

    const sent = reportError(new Error('a'), 'react');

    expect(sent).toBe(false);
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it('installs once, so two calls do not double every report', () => {
    // main.tsx calls this at module scope, but a module can be evaluated twice
    // (HMR, a test importing it again), and two listeners on the same event send
    // two beacons for one failure.
    removeListeners = installErrorReporting();
    installErrorReporting();

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('a'), message: 'a' }));

    expect(beacons).toHaveLength(1);
  });
});

describe('the three entry points are actually attached to the application', () => {
  it('main.tsx installs the listeners before it mounts React', () => {
    // main.tsx calls createRoot at module scope, so importing it from a test
    // mounts the whole application into #root. The position is the claim and it
    // is read off the source, the same way tests/appConfirmWiring.test.ts reads
    // where the confirmation provider sits.
    //
    // WRITTEN TWICE. The first version used indexOf('installErrorReporting()')
    // over the raw text, and it survived commenting the call out — the string
    // is still there, inside the comment, still ahead of createRoot. Parsed
    // now, because a comment is not a node.
    const { install, mount } = mainPositions();

    expect(install, 'main.tsx never calls installErrorReporting()').toBeGreaterThan(-1);
    expect(mount, 'main.tsx never calls ReactDOM.createRoot').toBeGreaterThan(-1);
    expect(install, 'the listeners are attached after React mounts').toBeLessThan(mount);
  });

  it('and the parse is really reading calls, not text', () => {
    // The control for the case above. A commented-out call must not count, and
    // the detector is fired at both spellings so a parse that degenerated to a
    // substring search cannot pass.
    expect(positionsIn('installErrorReporting();\nReactDOM.createRoot(x);').install).toBe(0);
    expect(positionsIn('// installErrorReporting();\nReactDOM.createRoot(x);').install).toBe(-1);
  });

  it('the boundary is the one that reports the React path', () => {
    // Belt to the behavioural test above: that one proves a beacon is sent when
    // a component throws inside ChunkErrorBoundary, which would keep passing if
    // some ancestor started reporting instead. This pins the call to the file.
    expect(readBoundary()).toMatch(/reportError\(\s*error,\s*'react'/);
  });
});

/**
 * Source offsets of the two module-scope calls whose ORDER is the claim.
 *
 * -1 for either one means "no such call", which is a different failure from
 * "the calls are in the wrong order" and gets its own message above.
 */
function positionsIn(source: string): { install: number; mount: number } {
  const file = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let install = -1;
  let mount = -1;

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
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
  return { install, mount };
}

function mainPositions(): { install: number; mount: number } {
  return positionsIn(readFileSync(resolve(HERE, '../src/main.tsx'), 'utf8'));
}

function readBoundary(): string {
  return readFileSync(resolve(HERE, '../src/components/ChunkErrorBoundary.tsx'), 'utf8');
}
