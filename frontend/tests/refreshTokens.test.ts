import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshTokens } from '../src/auth/cognito';

vi.mock('../src/auth/authConfig', () => ({
  AUTH_CONFIG: { domain: 'https://auth.e2e.invalid', clientId: 'test-client' },
  assertAuthConfig: () => {},
}));

const renewed = { access_token: 'renewed', id_token: 'id-renewed', expires_in: 3600, token_type: 'Bearer' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the Cognito refresh dependency boundary', () => {
  it.each([
    [400, 'invalid_grant', 'permanent'],
    [400, 'temporarily_unavailable', 'temporary'],
    [400, 'invalid_client', 'temporary'],
    [429, 'invalid_grant', 'temporary'],
    [500, 'server_error', 'temporary'],
    [503, 'temporarily_unavailable', 'temporary'],
  ])('classifies HTTP %i / %s as %s without parsing a message', async (status, error, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status })));
    await expect(refreshTokens('refresh-test')).rejects.toMatchObject({
      name: 'TokenRefreshError', kind, status, oauthError: error,
    });
  });

  it('treats an unreadable outage body as temporary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>unavailable</html>', { status: 503 })));
    await expect(refreshTokens('refresh-test')).rejects.toMatchObject({ kind: 'temporary', status: 503 });
  });

  it('normalizes a network failure to a retryable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(refreshTokens('refresh-test')).rejects.toMatchObject({ name: 'TokenRefreshError', kind: 'temporary' });
  });

  it('aborts a stalled refresh within ten seconds and permits a later attempt', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal as AbortSignal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = expect(refreshTokens('refresh-test')).rejects.toMatchObject({ kind: 'temporary' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signal?.aborted).toBe(true);
    await pending;
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(renewed)));
    await expect(refreshTokens('refresh-test')).resolves.toEqual(renewed);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects malformed success without claiming the refresh token was revoked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'incomplete' }))));
    await expect(refreshTokens('refresh-test')).rejects.toMatchObject({ kind: 'temporary' });
  });

  it('sends only the refresh grant and cleans up its deadline on success', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(renewed)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(refreshTokens('refresh-test')).resolves.toEqual(renewed);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://auth.e2e.invalid/oauth2/token');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body)).toEqual({ grant_type: 'refresh_token', client_id: 'test-client', refresh_token: 'refresh-test' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
