// R19M M03 (M00 §4.3-§4.4): apiClient sends x-dc-trace-id only from an installed provider.
// Fake fetch only; no real URL is ever fetched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HEADER = '1-01234567-89abcdef0123456789abcdef';
const OTHER = '1-fedcba98-76543210fedcba9876543210';

// apiClient reads the host env at module load, so each case resets the module
// registry and imports a fresh apiClient (as apiClientErrors.test.ts does).
async function loadApiClient() {
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', '');
  vi.stubEnv('EXPO_PUBLIC_API_BASE', '');
  vi.stubEnv('EXPO_PUBLIC_API_BASE_FALLBACK', '');
  vi.resetModules();
  const api = await import('../../src/api/apiClient');
  const hosts = await import('../../src/config/hosts');
  return { ...api, hosts };
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function headersOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call]?.[1] as { headers: Record<string, string> }).headers;
}

function traceKeys(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter((k) => k.toLowerCase() === 'x-dc-trace-id');
}

async function rejection(p: Promise<unknown>): Promise<any> {
  return p.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('apiClient x-dc-trace-id', () => {
  it('sends the provider value when a valid provider is installed', async () => {
    const { apiJson, setTraceHeaderProvider } = await loadApiClient();
    const fetchMock = vi.fn(async () => res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setTraceHeaderProvider(() => HEADER);

    await apiJson('/api/v1/me', {});
    const headers = headersOf(fetchMock);
    expect(headers['x-dc-trace-id']).toBe(HEADER);
    expect(headers['content-type']).toBe('application/json');
  });

  it('sends no header and the unchanged header set when no provider is installed', async () => {
    const { apiJson } = await loadApiClient();
    const fetchMock = vi.fn(async () => res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiJson('/api/v1/me', { accessToken: 'tok', headers: { 'x-extra': '1' } });
    expect(headersOf(fetchMock)).toEqual({
      'content-type': 'application/json',
      'x-extra': '1',
      Authorization: 'Bearer tok',
    });
  });

  it.each([
    ['a null result', () => null],
    [
      'a throwing provider',
      () => {
        throw new Error('sdk');
      },
    ],
    ['upper-case hex', () => '1-ABCDEF12-89abcdef0123456789abcdef'],
    ['a too-short value', () => '1-01234567-89abcdef'],
    ['a Root= form', () => `Root=${HEADER};Parent=0123456789abcdef`],
    ['an empty string', () => ''],
    ['a raw 32-hex trace id', () => '0123456789abcdef0123456789abcdef'],
    ['a non-string', () => 42 as unknown as string],
  ])('sends no header for %s', async (_label, provider) => {
    const { apiJson, setTraceHeaderProvider } = await loadApiClient();
    const fetchMock = vi.fn(async () => res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setTraceHeaderProvider(provider as () => string | null);

    await expect(apiJson('/api/v1/me', {})).resolves.toEqual({ ok: true });
    expect(traceKeys(headersOf(fetchMock))).toEqual([]);
  });

  it.each(['x-dc-trace-id', 'X-DC-Trace-Id'])('a caller-supplied %s wins and no second header is added', async (key) => {
    const { apiJson, setTraceHeaderProvider } = await loadApiClient();
    const fetchMock = vi.fn(async () => res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = vi.fn(() => HEADER);
    setTraceHeaderProvider(provider);

    await apiJson('/api/v1/me', { headers: { [key]: OTHER } });
    const headers = headersOf(fetchMock);
    expect(traceKeys(headers)).toEqual([key]);
    expect(headers[key]).toBe(OTHER);
    expect(provider).not.toHaveBeenCalled();
  });

  it('sends the header on the fallback host after a network failure on the primary', async () => {
    const { apiJson, setTraceHeaderProvider, hosts } = await loadApiClient();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setTraceHeaderProvider(() => HEADER);

    await expect(apiJson('/api/v1/me', {})).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${hosts.DEFAULT_API_BASE}/api/v1/me`);
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${hosts.FALLBACK_API_BASE}/api/v1/me`);
    expect(headersOf(fetchMock, 0)['x-dc-trace-id']).toBe(HEADER);
    expect(headersOf(fetchMock, 1)['x-dc-trace-id']).toBe(HEADER);
  });

  it('sends the same header on the 401 replay', async () => {
    const { apiJson, setTraceHeaderProvider, setAccessTokenRefresher } = await loadApiClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = vi.fn(() => HEADER);
    setTraceHeaderProvider(provider);
    setAccessTokenRefresher(async () => 'fresh-token');

    await expect(apiJson('/api/v1/me', { accessToken: 'old-token' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchMock, 0)['x-dc-trace-id']).toBe(HEADER);
    expect(headersOf(fetchMock, 1)['x-dc-trace-id']).toBe(HEADER);
    expect(headersOf(fetchMock, 1).Authorization).toBe('Bearer fresh-token');
    expect(provider).toHaveBeenCalledTimes(1);
    setAccessTokenRefresher(null);
  });

  it('sends no header again after setTraceHeaderProvider(null)', async () => {
    const { apiJson, setTraceHeaderProvider } = await loadApiClient();
    const fetchMock = vi.fn(async () => res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    setTraceHeaderProvider(() => HEADER);
    await apiJson('/api/v1/me', {});
    setTraceHeaderProvider(null);
    await apiJson('/api/v1/me', {});

    expect(headersOf(fetchMock, 0)['x-dc-trace-id']).toBe(HEADER);
    expect(traceKeys(headersOf(fetchMock, 1))).toEqual([]);
  });

  it('a non-OK response carries requestId (envelope traceId) and dcTraceId (header sent)', async () => {
    const { apiJson, setTraceHeaderProvider } = await loadApiClient();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(409, { ok: false, error: { code: 'CONFLICT', message: 'stale' }, traceId: 'gw-req-1' })),
    );
    setTraceHeaderProvider(() => HEADER);

    const err = await rejection(apiJson('/api/v1/sync', { method: 'POST', body: {} }));
    expect(err.message).toBe('stale');
    expect(err.status).toBe(409);
    expect(err.apiErrorCode).toBe('CONFLICT');
    const { classifyError } = await import('../../src/api/errorKind');
    expect(err.kind).toBe(classifyError({ status: 409 }));
    expect(err.requestId).toBe('gw-req-1');
    expect(err.dcTraceId).toBe(HEADER);
  });

  it('dcTraceId is the caller-supplied header when the caller set one', async () => {
    const { apiJson } = await loadApiClient();
    vi.stubGlobal('fetch', vi.fn(async () => res(500, { error: { code: 'X' } })));

    const err = await rejection(apiJson('/api/v1/x', { headers: { 'X-DC-Trace-Id': OTHER } }));
    expect(err.dcTraceId).toBe(OTHER);
    expect(err.requestId).toBeNull();
  });

  it('requestId and dcTraceId are null when neither exists; existing fields still set', async () => {
    const { apiJson } = await loadApiClient();
    vi.stubGlobal('fetch', vi.fn(async () => res(500, { error: { code: 'X' }, traceId: 42 })));

    const err = await rejection(apiJson('/api/v1/x', {}));
    expect(err.status).toBe(500);
    expect(err.apiErrorCode).toBe('X');
    expect(err.kind).toBe('server');
    expect(err.requestId).toBeNull();
    expect(err.dcTraceId).toBeNull();
  });
});
