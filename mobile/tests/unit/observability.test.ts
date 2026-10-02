import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ObservabilityModule = typeof import('../../src/telemetry/observability');
type FeatureFlagsModule = typeof import('../../src/config/featureFlags');

const DSN = 'https://publickey@example.invalid/1';
const PRODUCTION_UPDATES = { channel: 'production', updateId: null, runtimeVersion: '1.9.0', isEmbeddedLaunch: true };

async function load(): Promise<{ obs: ObservabilityModule; flags: FeatureFlagsModule }> {
  vi.resetModules();
  const obs = await import('../../src/telemetry/observability');
  const flags = await import('../../src/config/featureFlags');
  return { obs, flags };
}

function activeDeps(overrides: Record<string, unknown> = {}) {
  return {
    installInterimHandlers: vi.fn(),
    loadCachedConfig: vi.fn(async () => null),
    updates: PRODUCTION_UPDATES,
    env: { dsn: DSN, isDev: false },
    ...overrides,
  };
}

function initOptions(): any {
  expect(globalThis.__sentryMock.init).toHaveBeenCalledTimes(1);
  return globalThis.__sentryMock.init.mock.calls[0][0];
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startObservability — active path', () => {
  it('initialises once with the contract literals and never installs the interim handlers', async () => {
    const { obs } = await load();
    expect(obs.getObservabilityStatus()).toEqual({ active: false, reason: 'pending' });
    const deps = activeDeps();
    const status = await obs.startObservability(deps);

    expect(status).toEqual({ active: true, reason: 'active' });
    expect(obs.getObservabilityStatus()).toEqual({ active: true, reason: 'active' });
    expect(deps.installInterimHandlers).not.toHaveBeenCalled();
    expect(globalThis.__sentryMock.reactNavigationIntegration).toHaveBeenCalledWith({ enableTimeToInitialDisplay: true });

    const options = initOptions();
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'production',
      sampleRate: 1.0,
      tracesSampleRate: 0.2,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      maxBreadcrumbs: 50,
      enableAutoSessionTracking: true,
      enableUserInteractionTracing: false,
      initialScope: {
        tags: {
          'ota.update_id': 'embedded',
          'ota.channel': 'production',
          'ota.runtime_version': '1.9.0',
          'ota.is_embedded': 'true',
          'app.env': 'production',
        },
      },
    });
    expect(options.integrations).toHaveLength(1);
    expect(options.integrations[0].name).toBe('ReactNavigation');
    for (const key of ['release', 'dist', 'enableNative', 'useNativeInit', 'profilesSampleRate']) {
      expect(options).not.toHaveProperty(key);
    }
    const targets: RegExp[] = options.tracePropagationTargets;
    expect(targets.some((re) => re.test('https://api.developercards.app/api/v1/me'))).toBe(true);
    expect(targets.some((re) => re.test('https://cdn.developercards.app/x'))).toBe(false);
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeSendTransaction).toBe('function');
    expect(options.beforeBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
  });

  it('turns off native network breadcrumbs and tracking and keeps RevenueCat and the sub out of every hook (2.0 privacy)', async () => {
    const { obs } = await load();
    await obs.startObservability(activeDeps());
    const options = initOptions();
    expect(options.enableNetworkBreadcrumbs).toBe(false);
    expect(options.enableNetworkTracking).toBe(false);

    const sub = '3f2a9c1e-7b4d-4e8a-9c3b-2d1e0f9a8b7c';
    const rcUrl = `https://api.revenuecat.com/v1/subscribers/${sub}/offerings`;
    expect(options.beforeBreadcrumb({ category: 'http', type: 'http', data: { url: rcUrl } })).toBeNull();
    expect(options.beforeBreadcrumb({ category: 'fetch', data: { url: `https://api.developercards.app/u/${sub}` } }))
      .toEqual({ category: 'fetch', data: { url: 'https://api.developercards.app/u/<id>' } });

    const transaction = options.beforeSendTransaction({
      transaction: 'Home',
      spans: [{ op: 'http.client', description: `GET ${rcUrl}` }, { op: 'http.client', description: `GET /x/${sub}` }],
    });
    expect(transaction.spans).toEqual([{ op: 'http.client', description: 'GET /x/<id>' }]);

    const event = options.beforeSend(
      { message: `failed for ${sub}`, breadcrumbs: [{ category: 'http', data: { url: rcUrl } }] },
      {},
    );
    expect(event).toEqual({ message: 'failed for <id>', breadcrumbs: [] });
  });

  it('also sets the OTA tags through setTags after init so native crash events carry them (M02-R3)', async () => {
    const { obs } = await load();
    await obs.startObservability(
      activeDeps({
        updates: { channel: 'production', updateId: 'a1b2c3', runtimeVersion: '1.9.0', isEmbeddedLaunch: false },
      }),
    );
    const tags = {
      'ota.update_id': 'a1b2c3',
      'ota.channel': 'production',
      'ota.runtime_version': '1.9.0',
      'ota.is_embedded': 'false',
      'app.env': 'production',
    };
    expect(globalThis.__sentryMock.setTags).toHaveBeenCalledTimes(1);
    expect(globalThis.__sentryMock.setTags).toHaveBeenCalledWith(tags);
    expect(initOptions().initialScope).toEqual({ tags });
    expect(globalThis.__sentryMock.init.mock.invocationCallOrder[0]).toBeLessThan(
      globalThis.__sentryMock.setTags.mock.invocationCallOrder[0],
    );
  });

  it('stays active when setTags throws after a successful init (M02-R3)', async () => {
    const { obs } = await load();
    globalThis.__sentryMock.setTags.mockImplementation(() => {
      throw new Error('native bridge');
    });
    const deps = activeDeps();
    expect(await obs.startObservability(deps)).toEqual({ active: true, reason: 'active' });
    expect(deps.installInterimHandlers).not.toHaveBeenCalled();
  });

  it('beforeSend scrubs, drops offline/timeout, and caps the session at 25 passed events', async () => {
    const { obs } = await load();
    await obs.startObservability(activeDeps());
    const { beforeSend } = initOptions();

    const offline = Object.assign(new Error('Network request failed'), { kind: 'offline' });
    expect(beforeSend({ message: 'x' }, { originalException: offline })).toBeNull();

    const first = beforeSend({ message: 'someone@example.com', user: { id: '1' } }, {});
    expect(first).toEqual({ message: '[email]' });
    for (let i = 2; i <= 25; i += 1) expect(beforeSend({ message: `e${i}` }, {})).not.toBeNull();
    expect(beforeSend({ message: 'e26' }, {})).toBeNull();
  });

  it('is idempotent: later calls return the first promise', async () => {
    const { obs } = await load();
    const first = obs.startObservability(activeDeps());
    const other = activeDeps();
    const second = obs.startObservability(other);
    expect(second).toBe(first);
    await second;
    expect(globalThis.__sentryMock.init).toHaveBeenCalledTimes(1);
    expect(other.installInterimHandlers).not.toHaveBeenCalled();
  });

  it('treats a cached-config read slower than timeoutMs as not killed', async () => {
    const { obs } = await load();
    const deps = activeDeps({
      timeoutMs: 20,
      loadCachedConfig: vi.fn(
        () => new Promise((resolve) => setTimeout(() => resolve({ features: { sentry: { enabled: false } } }), 200)),
      ),
    });
    const status = await obs.startObservability(deps);
    expect(status).toEqual({ active: true, reason: 'active' });
    expect(globalThis.__sentryMock.init).toHaveBeenCalledTimes(1);
    expect(deps.installInterimHandlers).not.toHaveBeenCalled();
  });

  it('treats a rejecting cached-config read as not killed', async () => {
    const { obs } = await load();
    const status = await obs.startObservability(
      activeDeps({ loadCachedConfig: vi.fn(async () => Promise.reject(new Error('storage down'))) }),
    );
    expect(status.reason).toBe('active');
  });

  it('closes the client once on a later remote flag flip', async () => {
    const { obs, flags } = await load();
    const deps = activeDeps();
    await obs.startObservability(deps);

    flags.applyRemoteFeatures({ features: { sentry: { enabled: false } } } as any);
    expect(globalThis.__sentryMock.close).toHaveBeenCalledTimes(1);
    expect(obs.getObservabilityStatus()).toEqual({ active: false, reason: 'kill-switch' });

    flags.applyRemoteFeatures({ features: { sentry: { enabled: true } } } as any);
    flags.applyRemoteFeatures({ features: { sentry: { enabled: false } } } as any);
    expect(globalThis.__sentryMock.close).toHaveBeenCalledTimes(1);
    expect(deps.installInterimHandlers).not.toHaveBeenCalled();
    expect(obs.captureException(new Error('x'))).toBe(false);
  });

  it('captureException and sendTestEvent route to the SDK when active', async () => {
    const { obs } = await load();
    await obs.startObservability(activeDeps());
    const err = new Error('boom');

    expect(obs.captureException(err, { screen: 'Home', kind: 'boundary' })).toBe(true);
    expect(globalThis.__sentryMock.captureException).toHaveBeenLastCalledWith(err, {
      tags: { 'error.kind': 'boundary', 'error.screen': 'Home' },
    });
    expect(obs.captureException(err)).toBe(true);
    expect(globalThis.__sentryMock.captureException).toHaveBeenLastCalledWith(err, {
      tags: { 'error.kind': 'js_error', 'error.screen': 'unknown' },
    });

    expect(obs.sendTestEvent()).toEqual({ sent: true, eventId: '0123456789abcdef0123456789abcdef', reason: 'active' });
    const [testError, hint] = globalThis.__sentryMock.captureException.mock.calls.at(-1)!;
    expect((testError as Error).message).toBe('DeveloperCards Sentry test event');
    expect(hint).toEqual({ tags: { 'dc.test_event': 'true' } });
  });

  it('captureException never throws when the SDK does', async () => {
    const { obs } = await load();
    await obs.startObservability(activeDeps());
    globalThis.__sentryMock.captureException.mockImplementation(() => {
      throw new Error('sdk');
    });
    expect(obs.captureException(new Error('x'))).toBe(false);
  });

  it('registers the navigation container, including one handed over while pending', async () => {
    const { obs } = await load();
    const ref = { current: 'nav' };
    obs.registerNavigationContainer(ref);
    await obs.startObservability(activeDeps());
    const integration = globalThis.__sentryMock.reactNavigationIntegration.mock.results[0].value;
    expect(integration.registerNavigationContainer).toHaveBeenCalledTimes(1);
    expect(integration.registerNavigationContainer).toHaveBeenCalledWith(ref);
    obs.registerNavigationContainer(ref);
    expect(integration.registerNavigationContainer).toHaveBeenCalledTimes(2);
  });

  it('wrapRootComponent delegates to the SDK wrap', async () => {
    const { obs } = await load();
    const Component = () => null;
    expect(obs.wrapRootComponent(Component)).toBe(Component);
    expect(globalThis.__sentryMock.wrap).toHaveBeenCalledWith(Component);
  });
});

describe('startObservability — inactive reasons', () => {
  it.each([
    ['dev', activeDeps({ env: { dsn: DSN, isDev: true } })],
    ['channel', activeDeps({ updates: { ...PRODUCTION_UPDATES, channel: 'preview' } })],
    ['channel', activeDeps({ updates: null })],
    ['no-dsn', activeDeps({ env: { dsn: undefined, isDev: false } })],
    ['no-dsn', activeDeps({ env: { dsn: '  ', isDev: false } })],
    ['no-dsn', activeDeps({ env: { dsn: `"${DSN}"`, isDev: false } })],
    ['no-dsn', activeDeps({ env: { dsn: 'https://example.invalid/1', isDev: false } })],
    ['no-dsn', activeDeps({ env: { dsn: 'https://publickey@example.invalid/', isDev: false } })],
  ])('%s: no init, interim installed exactly once', async (reason, deps) => {
    const { obs } = await load();
    (deps.installInterimHandlers as ReturnType<typeof vi.fn>).mockClear();
    const status = await obs.startObservability(deps);
    expect(status).toEqual({ active: false, reason });
    expect(obs.getObservabilityStatus()).toEqual({ active: false, reason });
    expect(globalThis.__sentryMock.init).not.toHaveBeenCalled();
    expect(deps.installInterimHandlers).toHaveBeenCalledTimes(1);
    expect(deps.loadCachedConfig).not.toHaveBeenCalled();
  });

  it("'kill-switch': cached features.sentry.enabled:false keeps Sentry off", async () => {
    const { obs } = await load();
    const deps = activeDeps({ loadCachedConfig: vi.fn(async () => ({ features: { sentry: { enabled: false } } })) });
    const status = await obs.startObservability(deps);
    expect(status).toEqual({ active: false, reason: 'kill-switch' });
    expect(globalThis.__sentryMock.init).not.toHaveBeenCalled();
    expect(deps.installInterimHandlers).toHaveBeenCalledTimes(1);
  });

  it("'init-failed': a throwing init falls back to the interim handlers", async () => {
    const { obs } = await load();
    globalThis.__sentryMock.init.mockImplementation(() => {
      throw new Error('native module missing');
    });
    const deps = activeDeps();
    const status = await obs.startObservability(deps);
    expect(status).toEqual({ active: false, reason: 'init-failed' });
    expect(globalThis.__sentryMock.init).toHaveBeenCalledTimes(1);
    expect(deps.installInterimHandlers).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no client', () => undefined],
    ['a client without a parsed DSN', () => ({ getDsn: () => undefined })],
    ['a throwing getClient', () => {
      throw new Error('sdk');
    }],
  ])("'init-failed': %s after init falls back to the interim handlers (M02-R1)", async (_label, getClient) => {
    const { obs } = await load();
    globalThis.__sentryMock.getClient.mockImplementation(getClient);
    const deps = activeDeps();
    const status = await obs.startObservability(deps);
    expect(status).toEqual({ active: false, reason: 'init-failed' });
    expect(obs.getObservabilityStatus()).toEqual({ active: false, reason: 'init-failed' });
    expect(globalThis.__sentryMock.init).toHaveBeenCalledTimes(1);
    expect(deps.installInterimHandlers).toHaveBeenCalledTimes(1);
    expect(globalThis.__sentryMock.setTags).not.toHaveBeenCalled();
    expect(globalThis.__sentryMock.close).toHaveBeenCalledTimes(1);
    expect(obs.captureException(new Error('x'))).toBe(false);
    expect(obs.sendTestEvent()).toEqual({ sent: false, eventId: null, reason: 'init-failed' });
  });

  it('inactive: captureException returns false and sendTestEvent reports the reason', async () => {
    const { obs } = await load();
    await obs.startObservability(activeDeps({ env: { dsn: '', isDev: false } }));
    expect(obs.captureException(new Error('x'), { kind: 'boundary', screen: 'Home' })).toBe(false);
    expect(obs.sendTestEvent()).toEqual({ sent: false, eventId: null, reason: 'no-dsn' });
    expect(globalThis.__sentryMock.captureException).not.toHaveBeenCalled();
    const ref = {};
    obs.registerNavigationContainer(ref);
    expect(globalThis.__sentryMock.reactNavigationIntegration).not.toHaveBeenCalled();
  });

  it('before start: status is pending and nothing is sent', async () => {
    const { obs } = await load();
    expect(obs.getObservabilityStatus()).toEqual({ active: false, reason: 'pending' });
    expect(obs.sendTestEvent()).toEqual({ sent: false, eventId: null, reason: 'pending' });
    expect(obs.captureException(new Error('x'))).toBe(false);
  });

  it('the default env (no DSN in the test environment) resolves to an inactive reason', async () => {
    const { obs } = await load();
    const installInterimHandlers = vi.fn();
    const status = await obs.startObservability({ installInterimHandlers, updates: PRODUCTION_UPDATES });
    // __DEV__ is true under vitest (tests/setup/globals.ts), so the first gate wins.
    expect(status).toEqual({ active: false, reason: 'dev' });
    expect(installInterimHandlers).toHaveBeenCalledTimes(1);
  });
});

describe('source', () => {
  it('reads the bundled DSN through the literal Metro inlines', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/telemetry/observability.ts'), 'utf8');
    expect(source).toContain('const BUNDLED_SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;');
    expect(source.split('process.env.EXPO_PUBLIC_SENTRY_DSN').length - 1).toBe(1);
  });
});
