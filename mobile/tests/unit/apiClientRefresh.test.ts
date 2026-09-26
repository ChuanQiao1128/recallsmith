import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// apiClient reads EXPO_PUBLIC_API_BASE at module import, so it must be set
// before the import below runs.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_BASE = 'https://api.example.test';
});

import { apiJson, setAccessTokenRefresher } from '../../src/api/apiClient';

type FakeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
};

function res(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function authHeaderOf(call: any[]): string | undefined {
  return call?.[1]?.headers?.Authorization;
}

describe('apiClient 401 refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccessTokenRefresher(null);
  });

  afterEach(() => {
    setAccessTokenRefresher(null);
    vi.unstubAllGlobals();
  });

  it('retries a 401 once with the refreshed token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setAccessTokenRefresher(async () => 'fresh-token');

    const result = await apiJson<{ ok: boolean }>('/me', { accessToken: 'old-token' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe('Bearer old-token');
    expect(authHeaderOf(fetchMock.mock.calls[1])).toBe('Bearer fresh-token');
  });

  it('does not retry when no refresher is installed or the token did not change', async () => {
    // No refresher installed.
    const fetchMock = vi.fn().mockResolvedValue(res(401, { error: 'unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiJson('/me', { accessToken: 'old-token' })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Refresher installed but returns the same token — nothing changed.
    fetchMock.mockClear();
    setAccessTokenRefresher(async () => 'old-token');

    await expect(apiJson('/me', { accessToken: 'old-token' })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a request that was sent without a token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(401, { error: 'unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);
    const refresher = vi.fn(async () => 'fresh-token');
    setAccessTokenRefresher(refresher);

    await expect(apiJson('/public', {})).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresher).not.toHaveBeenCalled();
  });
});
