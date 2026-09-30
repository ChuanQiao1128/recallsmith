// @vitest-environment jsdom
//
// src/lib/sentry.ts: the gate, the lazy SDK load and the funnel's sink.
//
// The SDK is mocked everywhere, so no test here can reach a real Sentry host.
// The mock functions are created with vi.hoisted so they survive
// vi.resetModules(), and every test re-imports sentry.ts, reportError.ts and
// sentryScrub.ts after the reset because those modules keep per-page state (the
// decision, the pending queue, the attached listeners).
//
// "Stays off with a blank DSN" is the first case on purpose: it is the state of
// every build that has no DSN resolved, and it is asserted by counting calls on
// every transport a browser has, not by reading a flag.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  init: vi.fn<(options: Record<string, unknown>) => void>(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
  captureException: vi.fn<(error: unknown, hint?: unknown) => string>(() => 'event-id'),
}));

vi.mock('@sentry/react', () => sdk);

const DSN = 'https://publickey@example.invalid/1';

async function load() {
  vi.resetModules();
  const sentry = await import('../src/lib/sentry');
  const report = await import('../src/lib/reportError');
  const scrub = await import('../src/lib/sentryScrub');
  return { sentry, report, scrub };
}

function initOptions(): Record<string, unknown> {
  expect(sdk.init).toHaveBeenCalledTimes(1);
  return sdk.init.mock.calls[0][0];
}

let sendBeacon: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sdk.init.mockReset();
  sdk.browserTracingIntegration.mockClear();
  sdk.captureException.mockReset();
  vi.stubEnv('VITE_SENTRY_DSN', '');
  vi.stubEnv('VITE_SENTRY_ENVIRONMENT', '');
  vi.stubEnv('VITE_BUILD_ID', '');
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  // jsdom has no sendBeacon; a stub stands in so "not called" means something.
  sendBeacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true, writable: true });
  window.history.pushState({}, '', '/decks/cards');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'sendBeacon');
});

describe('console Sentry', () => {
  it('stays off with a blank DSN: no init, reportError false, no network', async () => {
    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send');

    for (const blank of [undefined, '   ']) {
      if (blank === undefined) vi.stubEnv('VITE_SENTRY_DSN', undefined);
      else vi.stubEnv('VITE_SENTRY_DSN', blank);
      const { sentry, report } = await load();

      expect(sentry.initConsoleSentry()).toBe(false);
      expect(sentry.isConsoleSentryActive()).toBe(false);
      expect(await sentry.whenConsoleSentryReady()).toBe(false);
      expect(report.reportError(new Error('a'), 'react', 'stack')).toBe(false);
      expect(report.reportError('b', 'unhandledrejection')).toBe(false);
    }

    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSend).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('initialises once with the contract options when VITE_SENTRY_DSN is set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const { sentry, scrub } = await load();

    expect(sentry.initConsoleSentry()).toBe(true);
    expect(sentry.initConsoleSentry()).toBe(true);
    expect(sentry.isConsoleSentryActive()).toBe(true);
    expect(await sentry.whenConsoleSentryReady()).toBe(true);

    const options = initOptions();
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'production',
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
      tracePropagationTargets: [],
      maxBreadcrumbs: 50,
    });
    expect(options.integrations).toContainEqual({ name: 'BrowserTracing' });
    expect(options.beforeSend).toBe(scrub.scrubEvent);
    expect(options.beforeSendTransaction).toBe(scrub.scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrub.scrubBreadcrumb);
    expect(Object.keys(options).filter(key => /replay|profil|feedback|defaultIntegrations/i.test(key))).toEqual([]);
    expect('release' in options).toBe(false);
  });

  it('uses VITE_SENTRY_ENVIRONMENT and console@<VITE_BUILD_ID> when they are set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    vi.stubEnv('VITE_SENTRY_ENVIRONMENT', ' staging ');
    vi.stubEnv('VITE_BUILD_ID', 'abc123def456');
    const { sentry } = await load();

    sentry.initConsoleSentry();
    await sentry.whenConsoleSentryReady();

    expect(initOptions()).toMatchObject({ environment: 'staging', release: 'console@abc123def456' });
  });

  it('reports through captureException with the console.source and console.route tags', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const { sentry, report } = await load();
    sentry.initConsoleSentry();
    await sentry.whenConsoleSentryReady();

    const err = new Error('boom');
    expect(report.reportError(err, 'react', 'stack')).toBe(true);

    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).toHaveBeenCalledWith(err, {
      tags: { 'console.source': 'react', 'console.route': '/decks/cards' },
      contexts: { react: { componentStack: 'stack' } },
    });
  });

  it('never sends the query string as the route', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const { sentry, report } = await load();
    sentry.initConsoleSentry();
    await sentry.whenConsoleSentryReady();
    window.history.pushState({}, '', '/auth/callback?code=abc123#x');

    report.reportError(new Error('callback failed'), 'window.onerror');

    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const seen = JSON.stringify([sdk.init.mock.calls, sdk.captureException.mock.calls]);
    expect(seen).toContain('/auth/callback');
    expect(seen).not.toContain('abc123');
  });

  it('queues reports made before the SDK has loaded and flushes them once', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const { sentry, report } = await load();
    sentry.initConsoleSentry();

    const early = new Error('early');
    expect(report.reportError(early, 'react')).toBe(true);
    window.history.pushState({}, '', '/elsewhere');
    expect(sdk.captureException).not.toHaveBeenCalled();

    await sentry.whenConsoleSentryReady();
    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).toHaveBeenCalledWith(early, {
      tags: { 'console.source': 'react', 'console.route': '/decks/cards' },
      contexts: undefined,
    });

    // The queue is bounded: extra early reports are dropped, not held.
    sdk.captureException.mockClear();
    const again = await load();
    again.sentry.initConsoleSentry();
    const accepted: boolean[] = [];
    for (let i = 0; i < again.sentry.CONSOLE_SENTRY_PENDING_MAX + 5; i += 1) {
      accepted.push(again.report.reportError(new Error(`early ${i}`), 'unhandledrejection'));
    }
    expect(accepted.filter(Boolean)).toHaveLength(again.sentry.CONSOLE_SENTRY_PENDING_MAX);
    await again.sentry.whenConsoleSentryReady();
    expect(sdk.captureException).toHaveBeenCalledTimes(again.sentry.CONSOLE_SENTRY_PENDING_MAX);
  });

  it('turns inactive and drops the queue when the SDK fails to initialise', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    sdk.init.mockImplementationOnce(() => {
      throw new Error('init failed');
    });
    const { sentry, report } = await load();

    expect(sentry.initConsoleSentry()).toBe(true);
    expect(report.reportError(new Error('queued'), 'react')).toBe(true);

    expect(await sentry.whenConsoleSentryReady()).toBe(false);
    expect(sentry.isConsoleSentryActive()).toBe(false);
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(report.reportError(new Error('later'), 'react')).toBe(false);
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('installErrorReporting attaches no window listener while Sentry is active', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const { sentry, report } = await load();
    const add = vi.spyOn(window, 'addEventListener');

    expect(sentry.initConsoleSentry()).toBe(true);
    const uninstall = report.installErrorReporting();

    const types = add.mock.calls.map(call => call[0]);
    expect(types).not.toContain('error');
    expect(types).not.toContain('unhandledrejection');
    expect(report.installErrorReporting()).toBe(uninstall);
    uninstall();
    await sentry.whenConsoleSentryReady();
  });
});
