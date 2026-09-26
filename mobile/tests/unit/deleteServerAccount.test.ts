import { describe, expect, it, vi } from 'vitest';

import {
  AccountDeletionError,
  DELETE_ME_PATH,
  deleteServerAccountData,
} from '../../src/auth/deleteServerAccount';

const API_BASE = 'https://api.example.test';

function fetchReturning(status: number) {
  return vi.fn(async () => ({ status }) as unknown as Response);
}

describe('deleteServerAccountData', () => {
  it('sends DELETE /api/v1/user/me with the bearer access token', async () => {
    const fetchImpl = fetchReturning(200);

    const outcome = await deleteServerAccountData('access-abc', {
      apiBase: API_BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(outcome).toBe('deleted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}${DELETE_ME_PATH}`);
    expect(url).toContain('/api/v1/user/me');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-abc');
  });

  it('treats 404, 405 and 501 as endpoint not deployed and lets deletion continue', async () => {
    for (const status of [404, 405, 501]) {
      const fetchImpl = fetchReturning(status);
      const outcome = await deleteServerAccountData('access-abc', {
        apiBase: API_BASE,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(outcome).toBe('endpoint_unavailable');
    }
  });

  it('throws AccountDeletionError on a 5xx response', async () => {
    const fetchImpl = fetchReturning(500);

    await expect(
      deleteServerAccountData('access-abc', {
        apiBase: API_BASE,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: 'AccountDeletionError',
      kind: 'server',
      status: 500,
    });
  });

  it('throws an auth AccountDeletionError on 401 or 403', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = fetchReturning(status);
      let caught: unknown;
      try {
        await deleteServerAccountData('access-abc', {
          apiBase: API_BASE,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AccountDeletionError);
      expect((caught as AccountDeletionError).kind).toBe('auth');
      expect((caught as AccountDeletionError).status).toBe(status);
    }
  });

  it('throws AccountDeletionError when the network request fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });

    let caught: unknown;
    try {
      await deleteServerAccountData('access-abc', {
        apiBase: API_BASE,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AccountDeletionError);
    expect((caught as AccountDeletionError).kind).toBe('network');
  });

  it('returns endpoint_unavailable when no API base is configured', async () => {
    const fetchImpl = fetchReturning(200);
    const outcome = await deleteServerAccountData('access-abc', {
      apiBase: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome).toBe('endpoint_unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws an auth error when the access token is blank', async () => {
    const fetchImpl = fetchReturning(200);
    await expect(
      deleteServerAccountData('  ', {
        apiBase: API_BASE,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(AccountDeletionError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
