import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// apiClient reads EXPO_PUBLIC_API_BASE at module load, so each test stubs the
// env, resets the module registry, and dynamically imports a fresh apiClient.
async function loadApiClient() {
  vi.stubEnv('EXPO_PUBLIC_API_BASE', 'https://api.test');
  vi.resetModules();
  return import('../../src/api/apiClient');
}

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('apiClient error classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses a string message and never an object for HTTP errors', async () => {
    const { apiJson } = await loadApiClient();
    vi.stubGlobal('fetch', vi.fn(async () => res(500, { error: { code: 'X' } })));

    const err = await apiJson('/thing', {}).then(
      () => {
        throw new Error('expected rejection');
      },
      (e: any) => e,
    );
    expect(err.status).toBe(500);
    expect(err.kind).toBe('server');
    expect(err.apiErrorCode).toBe('X');
    expect(typeof err.message).toBe('string');
    expect(err.message).not.toBe('[object Object]');
  });

  it('tags a network failure as offline', async () => {
    const { apiJson } = await loadApiClient();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    );

    await expect(apiJson('/thing', {})).rejects.toMatchObject({ kind: 'offline' });
  });

  it('tags an aborted request as timeout', async () => {
    const { apiJson } = await loadApiClient();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }),
    );

    await expect(apiJson('/thing', {})).rejects.toMatchObject({ kind: 'timeout' });
  });
});
