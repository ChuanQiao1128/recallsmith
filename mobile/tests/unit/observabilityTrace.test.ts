// R19M M03 (M00 §4.3-§4.4): observability installs the x-dc-trace-id provider only
// while Sentry is active, derives it from the SDK trace id, and tags API errors.
// Uses M02's global SDK stand-in (tests/setup/sentry.ts); fetch is always a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DSN = 'https://publickey@example.invalid/1';
const PRODUCTION_UPDATES = { channel: 'production', updateId: null, runtimeVersion: '1.9.0', isEmbeddedLaunch: true };
const SPAN_TRACE_ID = '0123456789abcdef0123456789abcdef';
const SCOPE_TRACE_ID = 'fedcba9876543210fedcba9876543210';
const SPAN_HEADER = '1-01234567-89abcdef0123456789abcdef';
const SCOPE_HEADER = '1-fedcba98-76543210fedcba9876543210';

async function load() {
  vi.resetModules();
  const obs = await import('../../src/telemetry/observability');
  const api = await import('../../src/api/apiClient');
  const flags = await import('../../src/config/featureFlags');
  return { obs, api, flags };
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

function mockActiveSpan(traceId: unknown) {
  globalThis.__sentryMock.getActiveSpan.mockImplementation(() => ({ spanContext: () => ({ traceId }) }));
}

function mockScope(traceId: unknown) {
  globalThis.__sentryMock.getCurrentScope.mockImplementation(() => ({
    setTag: vi.fn(),
    setContext: vi.fn(),
    getPropagationContext: () => ({ traceId }),
  }));
}

function okResponse() {
  return { ok: true, status: 200, statusText: 'OK', text: async () => '{"ok":true}' };
}

/** Sends one request through a fresh fake fetch and returns its x-dc-trace-id (or undefined). */
async function sentHeader(api: typeof import('../../src/api/apiClient')): Promise<string | undefined> {
  const fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal('fetch', fetchMock);
  await api.apiJson('/api/v1/me', {});
  const headers = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers;
  return headers['x-dc-trace-id'];
}

beforeEach(() => {
  vi.stubEnv('EXPO_PUBLIC_API_BASE', 'https://api.test');
  mockActiveSpan(SPAN_TRACE_ID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('trace-header provider lifecycle', () => {
  it('is installed when startObservability ends active: requests carry the header', async () => {
    const { obs, api } = await load();
    expect(await sentHeader(api)).toBeUndefined();
    const status = await obs.startObservability(activeDeps());
    expect(status).toEqual({ active: true, reason: 'active' });
    expect(await sentHeader(api)).toBe(SPAN_HEADER);
  });

  it.each([
    ['dev', () => activeDeps({ env: { dsn: DSN, isDev: true } })],
    ['channel', () => activeDeps({ updates: { ...PRODUCTION_UPDATES, channel: 'preview' } })],
    ['channel', () => activeDeps({ updates: null })],
    ['no-dsn', () => activeDeps({ env: { dsn: undefined, isDev: false } })],
    ['kill-switch', () => activeDeps({ loadCachedConfig: vi.fn(async () => ({ features: { sentry: { enabled: false } } })) })],
  ])('is not installed when inactive (%s)', async (reason, deps) => {
    const { obs, api } = await load();
    const status = await obs.startObservability(deps());
    expect(status).toEqual({ active: false, reason });
    expect(await sentHeader(api)).toBeUndefined();
  });

  it("is not installed when init throws ('init-failed')", async () => {
    const { obs, api } = await load();
    globalThis.__sentryMock.init.mockImplementation(() => {
      throw new Error('native module missing');
    });
    const status = await obs.startObservability(activeDeps());
    expect(status).toEqual({ active: false, reason: 'init-failed' });
    expect(await sentHeader(api)).toBeUndefined();
  });

  it('is removed after the kill-switch flip', async () => {
    const { obs, api, flags } = await load();
    await obs.startObservability(activeDeps());
    expect(await sentHeader(api)).toBe(SPAN_HEADER);

    flags.applyRemoteFeatures({ features: { sentry: { enabled: false } } } as any);
    expect(obs.getObservabilityStatus()).toEqual({ active: false, reason: 'kill-switch' });
    expect(await sentHeader(api)).toBeUndefined();
  });
});

describe('getDcTraceHeader', () => {
  it('converts the active span trace id', async () => {
    const { obs } = await load();
    mockScope(SCOPE_TRACE_ID);
    expect(obs.getDcTraceHeader()).toBe(SPAN_HEADER);
  });

  it('falls back to the scope propagation context when no span is active', async () => {
    const { obs } = await load();
    globalThis.__sentryMock.getActiveSpan.mockImplementation(() => undefined);
    mockScope(SCOPE_TRACE_ID);
    expect(obs.getDcTraceHeader()).toBe(SCOPE_HEADER);
    expect(globalThis.__sentryMock.getCurrentScope).toHaveBeenCalled();
  });

  it('returns null when both are absent or invalid', async () => {
    const { obs } = await load();
    globalThis.__sentryMock.getActiveSpan.mockImplementation(() => undefined);
    mockScope(undefined);
    expect(obs.getDcTraceHeader()).toBeNull();

    mockScope('0123456789ABCDEF0123456789ABCDEF');
    expect(obs.getDcTraceHeader()).toBeNull();

    mockActiveSpan('00000000000000000000000000000000');
    expect(obs.getDcTraceHeader()).toBeNull();
  });

  it('returns null when the SDK throws', async () => {
    const { obs } = await load();
    globalThis.__sentryMock.getActiveSpan.mockImplementation(() => {
      throw new Error('sdk');
    });
    expect(obs.getDcTraceHeader()).toBeNull();
  });
});

describe('beforeSend API tags', () => {
  async function beforeSend() {
    const { obs } = await load();
    await obs.startObservability(activeDeps());
    expect(globalThis.__sentryMock.init).toHaveBeenCalledTimes(1);
    return globalThis.__sentryMock.init.mock.calls[0][0].beforeSend as (event: any, hint: any) => any;
  }

  it('puts api.status, api.error_code, api.request_id and api.dc_trace_id on the event', async () => {
    const send = await beforeSend();
    const err = Object.assign(new Error('stale'), {
      status: 409,
      apiErrorCode: 'CONFLICT',
      kind: 'client',
      requestId: 'gw-req-1',
      dcTraceId: SPAN_HEADER,
    });
    const out = send({ message: 'stale', tags: { 'error.kind': 'js_error', 'api.status': 'old' } }, { originalException: err });
    expect(out.tags).toEqual({
      'error.kind': 'js_error',
      'api.status': '409',
      'api.error_code': 'CONFLICT',
      'api.request_id': 'gw-req-1',
      'api.dc_trace_id': SPAN_HEADER,
    });
  });

  it('adds no tags for a non-API error and keeps existing ones', async () => {
    const send = await beforeSend();
    expect(send({ message: 'x' }, { originalException: new Error('x') })).toEqual({ message: 'x' });
    expect(send({ message: 'y', tags: { a: 'b' } }, {})).toEqual({ message: 'y', tags: { a: 'b' } });
  });

  it('still drops offline errors', async () => {
    const send = await beforeSend();
    const offline = Object.assign(new Error('Network request failed'), { kind: 'offline', dcTraceId: SPAN_HEADER });
    expect(send({ message: 'x' }, { originalException: offline })).toBeNull();
  });
});
