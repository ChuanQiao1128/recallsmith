// Wave E / E09: the one-shot execute-api fallback in apiClient.apiJson. Retry only on a
// thrown TypeError on the primary host, never on an HTTP status or an abort; the working
// host is remembered for the rest of the process. See mobile/src/api/apiClient.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiJson, resetApiBaseForTests } from '../../src/api/apiClient';
import { DEFAULT_API_BASE, FALLBACK_API_BASE } from '../../src/config/hosts';

const calls: { url: string; init: any }[] = [];

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function scriptFetch(...steps: Array<() => Promise<Response> | Response>) {
  let i = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: any) => {
    calls.push({ url: String(url), init });
    return steps[Math.min(i++, steps.length - 1)]();
  }) as unknown as typeof fetch;
}

const ok = () => res(200, { ok: true });
const netErr = () => Promise.reject(new TypeError('Network request failed'));
const abortErr = () => Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
const http500 = () => res(500, { error: { message: 'boom', code: 'BOOM' } });

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_API_BASE;
  delete process.env.EXPO_PUBLIC_API_BASE_FALLBACK;
  resetApiBaseForTests();
  calls.length = 0;
});

describe('apiClient fallback', () => {
  it('calls the primary host once on success', async () => {
    scriptFetch(ok);
    const out = await apiJson<{ ok: boolean }>('/api/v1/x', {});
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_API_BASE}/api/v1/x`);
  });

  it('retries once on the fallback host after a network error on the primary', async () => {
    scriptFetch(netErr, ok);
    const out = await apiJson<{ ok: boolean }>('/api/v1/x', {});
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`${DEFAULT_API_BASE}/api/v1/x`);
    expect(calls[1].url).toBe(`${FALLBACK_API_BASE}/api/v1/x`);
  });

  it('does not retry on an HTTP error status', async () => {
    scriptFetch(http500);
    let err: any;
    try {
      await apiJson('/api/v1/x', {});
    } catch (e) {
      err = e;
    }
    expect(calls).toHaveLength(1);
    expect(err.status).toBe(500);
    expect(err.apiErrorCode).toBe('BOOM');
  });

  it('does not retry on a timeout abort', async () => {
    scriptFetch(abortErr);
    let err: any;
    try {
      await apiJson('/api/v1/x', {});
    } catch (e) {
      err = e;
    }
    expect(calls).toHaveLength(1);
    // MSHELL-10 wraps transport failures: a timeout is kind 'timeout' with the AbortError as cause.
    expect(err.kind).toBe('timeout');
    expect(err.cause?.name).toBe('AbortError');
  });

  it('remembers the working host for later calls in the process', async () => {
    scriptFetch(netErr, ok, ok);
    await apiJson('/api/v1/x', {});
    expect(calls).toHaveLength(2);
    await apiJson('/api/v1/y', {});
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toBe(`${FALLBACK_API_BASE}/api/v1/y`);
  });

  it('never retries when the fallback is disabled by a custom base', async () => {
    process.env.EXPO_PUBLIC_API_BASE = 'https://custom.test';
    scriptFetch(netErr);
    let err: any;
    try {
      await apiJson('/api/v1/x', {});
    } catch (e) {
      err = e;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://custom.test/api/v1/x');
    // MSHELL-10 wraps transport failures: kind 'offline' with the fetch TypeError as cause.
    expect(err.kind).toBe('offline');
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it('propagates the network error when the fallback also fails', async () => {
    scriptFetch(netErr, netErr, ok);
    let err: any;
    try {
      await apiJson('/api/v1/x', {});
    } catch (e) {
      err = e;
    }
    expect(calls).toHaveLength(2);
    // MSHELL-10 wraps transport failures: kind 'offline' with the fetch TypeError as cause.
    expect(err.kind).toBe('offline');
    expect(err.cause).toBeInstanceOf(TypeError);
    await apiJson('/api/v1/x', {});
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toBe(`${DEFAULT_API_BASE}/api/v1/x`);
  });

  it('keeps Authorization and JSON body on the retried request', async () => {
    scriptFetch(netErr, ok);
    await apiJson('/api/v1/x', { method: 'POST', accessToken: 't0k', body: { a: 1 } });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.init.method).toBe('POST');
      expect(c.init.headers.Authorization).toBe('Bearer t0k');
      expect(c.init.body).toBe(JSON.stringify({ a: 1 }));
    }
  });
});
