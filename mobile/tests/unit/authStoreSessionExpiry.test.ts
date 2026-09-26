import { beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore } = vi.hoisted(() => ({ asyncStore: new Map<string, string>() }));

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(async () => ({ userId: 'sub-1' })),
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
import { useAuthStore, AUTH_WAS_SIGNED_IN_KEY } from '../../src/auth/authStore';

function resetStore() {
  useAuthStore.setState({
    status: 'unknown',
    userId: null,
    email: null,
    userSub: null,
    accessToken: null,
    idToken: null,
    loading: false,
    lastError: null,
    sessionExpired: false,
    initRetryPending: false,
  });
}

describe('authStore session expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asyncStore.clear();
    resetStore();
  });

  it('flags an expired session for a previously signed-in user', async () => {
    // The device held a real session before, but Amplify now returns no tokens
    // (refresh token expired).
    asyncStore.set(AUTH_WAS_SIGNED_IN_KEY, '1');
    (fetchAuthSession as any).mockResolvedValue({ tokens: {} });

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().sessionExpired).toBe(true);
  });

  it('does not flag a user who never signed in', async () => {
    (fetchAuthSession as any).mockResolvedValue({ tokens: {} });

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().sessionExpired).toBe(false);
  });

  it('keeps the sync token and user scope when init fails offline', async () => {
    const err: any = new Error('Network request failed');
    err.name = 'NetworkError';
    (fetchAuthSession as any).mockRejectedValue(err);

    await useAuthStore.getState().init();

    // The transient path must NOT wipe the sync token / user scope.
    expect(setSyncAccessToken).not.toHaveBeenCalledWith(null);
    expect(useAuthStore.getState().initRetryPending).toBe(true);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('clears the expired flag on explicit sign out', async () => {
    asyncStore.set(AUTH_WAS_SIGNED_IN_KEY, '1');
    useAuthStore.setState({ status: 'signed_in', sessionExpired: true, accessToken: 'tok' });

    await useAuthStore.getState().signOutNow();

    expect(useAuthStore.getState().sessionExpired).toBe(false);
    expect(asyncStore.has(AUTH_WAS_SIGNED_IN_KEY)).toBe(false);
  });
});
