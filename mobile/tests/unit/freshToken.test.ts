import { beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore } = vi.hoisted(() => ({ asyncStore: new Map<string, string>() }));

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(async () => ({ userId: 'sub-init' })),
  deleteUser: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (asyncStore.has(k) ? asyncStore.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      asyncStore.delete(k);
    }),
    getAllKeys: vi.fn(async () => Array.from(asyncStore.keys())),
    multiRemove: vi.fn(async (ks: string[]) => {
      ks.forEach((k) => asyncStore.delete(k));
    }),
  },
}));

vi.mock('../../src/sync/progressSync', () => ({
  setSyncAccessToken: vi.fn(async () => {}),
  setActiveUserSub: vi.fn(async () => {}),
  forceProgressSync: vi.fn(async () => {}),
  scheduleProgressSync: vi.fn(async () => {}),
}));

vi.mock('../../src/sync/drawStateSync', () => ({
  adoptAnonGachaState: vi.fn(async () => {}),
}));

import { fetchAuthSession } from 'aws-amplify/auth';
import { setSyncAccessToken } from '../../src/sync/progressSync';
import { useAuthStore } from '../../src/auth/authStore';
import {
  getFreshAccessToken,
  refreshAuthOnForeground,
} from '../../src/auth/freshToken';

function resetStore(overrides: Record<string, unknown> = {}) {
  useAuthStore.setState({
    status: 'anonymous',
    userId: null,
    email: null,
    userSub: null,
    accessToken: null,
    idToken: null,
    loading: false,
    lastError: null,
    sessionExpired: false,
    initRetryPending: false,
    ...overrides,
  });
}

describe('getFreshAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncStore.clear();
    resetStore();
  });

  it('returns the refreshed access token and hands it to the sync layer', async () => {
    resetStore({ status: 'signed_in', accessToken: 'old-token', idToken: 'old-id' });
    (fetchAuthSession as any).mockResolvedValue({
      tokens: { accessToken: 'fresh-token', idToken: 'fresh-id' },
    });

    const token = await getFreshAccessToken();

    expect(token).toBe('fresh-token');
    expect(setSyncAccessToken).toHaveBeenCalledWith('fresh-token');
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
    expect(useAuthStore.getState().idToken).toBe('fresh-id');
    expect(useAuthStore.getState().status).toBe('signed_in');
  });

  it('coalesces concurrent refreshes into one fetchAuthSession call', async () => {
    resetStore({ status: 'signed_in', accessToken: 'old-token' });
    let resolveSession!: (v: unknown) => void;
    (fetchAuthSession as any).mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    const p1 = getFreshAccessToken();
    const p2 = getFreshAccessToken();
    resolveSession({ tokens: { accessToken: 'fresh-token', idToken: 'fresh-id' } });
    const [a, b] = await Promise.all([p1, p2]);

    expect(a).toBe('fresh-token');
    expect(b).toBe('fresh-token');
    expect(fetchAuthSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh fails with a network error', async () => {
    resetStore({ status: 'signed_in', accessToken: 'old-token', idToken: 'old-id' });
    const err: any = new Error('Network request failed');
    err.name = 'NetworkError';
    (fetchAuthSession as any).mockRejectedValue(err);

    const token = await getFreshAccessToken();

    expect(token).toBeNull();
    expect(setSyncAccessToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(useAuthStore.getState().accessToken).toBe('old-token');
    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });

  it('marks the session expired when Amplify returns no tokens', async () => {
    resetStore({ status: 'signed_in', accessToken: 'old-token', userSub: 'sub-1' });
    asyncStore.set('recallsmith:auth:wasSignedIn', '1');
    (fetchAuthSession as any).mockResolvedValue({ tokens: {} });

    const token = await getFreshAccessToken();

    expect(token).toBeNull();
    expect(setSyncAccessToken).toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().sessionExpired).toBe(true);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('refreshAuthOnForeground retries init after an offline cold start', async () => {
    resetStore({ status: 'anonymous', initRetryPending: true });
    (fetchAuthSession as any).mockResolvedValue({
      tokens: { accessToken: 'reconnected-token', idToken: 'reconnected-id' },
    });

    await refreshAuthOnForeground();

    expect(fetchAuthSession).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(useAuthStore.getState().accessToken).toBe('reconnected-token');
    expect(useAuthStore.getState().initRetryPending).toBe(false);
  });
});
