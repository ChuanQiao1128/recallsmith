import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(), confirmSignUp: vi.fn(), resendSignUpCode: vi.fn(), signIn: vi.fn(), autoSignIn: vi.fn(),
  signOut: vi.fn(async () => {}), fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(async () => ({ userId: 'A' })), deleteUser: vi.fn(async () => {}),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}),
  removeItem: vi.fn(async () => {}), getAllKeys: vi.fn(async () => []),
  multiRemove: vi.fn(async () => {}),
} }));
vi.mock('../../src/sync/progressSync', () => ({
  setSyncAccessToken: vi.fn(async () => {}), setActiveUserSub: vi.fn(async () => {}),
  forceProgressSync: vi.fn(async () => {}), scheduleProgressSync: vi.fn(),
}));
vi.mock('../../src/sync/drawStateSync', () => ({ adoptAnonGachaState: vi.fn(async () => {}) }));
vi.mock('../../src/premium/revenuecat', () => ({ rcLogout: vi.fn(async () => {}) }));
vi.mock('../../src/auth/deleteServerAccount', () => ({ deleteServerAccountData: vi.fn(async () => 'deleted') }));
vi.mock('../../src/sync/stopSyncForDeletion', () => ({
  stopSyncForDeletion: vi.fn(async () => {}), resumeSyncAfterFailedDeletion: vi.fn(),
}));
vi.mock('../../src/content/deckRepository', () => ({ adoptAnonymousPublicDecks: vi.fn(async () => {}) }));
vi.mock('../../src/content/deckCache', () => ({ invalidateDeckCache: vi.fn() }));

import { autoSignIn, confirmSignUp, deleteUser, fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiJson, resetApiBaseForTests, setAccessTokenRefresher } from '../../src/api/apiClient';
import { useAuthStore } from '../../src/auth/authStore';
import { getFreshAccessToken, installAccessTokenRefresher } from '../../src/auth/freshToken';
import { forceProgressSync, setActiveUserSub, setSyncAccessToken } from '../../src/sync/progressSync';
import { deleteServerAccountData } from '../../src/auth/deleteServerAccount';
import { resumeSyncAfterFailedDeletion, stopSyncForDeletion } from '../../src/sync/stopSyncForDeletion';
import { adoptAnonGachaState } from '../../src/sync/drawStateSync';
import { adoptAnonymousPublicDecks } from '../../src/content/deckRepository';
import { invalidateDeckCache } from '../../src/content/deckCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function token(sub: string, version = 'old'): string {
  return `header.${Buffer.from(JSON.stringify({ sub, version })).toString('base64url')}.signature`;
}

function session(sub: string, version = 'fresh') {
  return { tokens: { accessToken: token(sub, version), idToken: token(sub, `id-${version}`) } };
}

function signedIn(sub: string, version = 'old') {
  useAuthStore.setState({
    status: 'signed_in', userId: sub, userSub: sub, email: `${sub}@example.test`,
    accessToken: token(sub, version), idToken: token(sub, `id-${version}`),
    loading: false, lastError: null, sessionExpired: false, initRetryPending: false,
  });
}

function response(status: number): Response {
  return { ok: status === 200, status, statusText: String(status),
    text: async () => JSON.stringify(status === 200 ? { ok: true } : { error: 'unauthorized' }),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAuthSession).mockReset();
  vi.mocked(signOut).mockResolvedValue(undefined);
  vi.mocked(deleteUser).mockResolvedValue(undefined);
  vi.mocked(getCurrentUser).mockResolvedValue({ userId: 'A' } as any);
  vi.mocked(deleteServerAccountData).mockResolvedValue('deleted');
  vi.mocked(stopSyncForDeletion).mockResolvedValue(undefined);
  vi.mocked(AsyncStorage.getAllKeys).mockResolvedValue([]);
  resetApiBaseForTests();
  useAuthStore.setState({ status: 'anonymous', userId: null, userSub: null, accessToken: null });
  signedIn('A');
  installAccessTokenRefresher();
});

afterEach(() => {
  setAccessTokenRefresher(null);
  vi.unstubAllGlobals();
});

describe('API request session boundaries', () => {
  it('does not refresh or replay an A body after switching to B before the 401 arrives', async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(fetchAuthSession).mockResolvedValue(session('B') as any);
    const request = apiJson('/sync/push', { method: 'POST', accessToken: token('A'), body: { owner: 'A' } });
    signedIn('B');
    first.resolve(response(401));

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(fetchAuthSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay after switching accounts while the refresh is pending', async () => {
    const refresh = deferred<any>();
    vi.mocked(fetchAuthSession).mockReturnValue(refresh.promise);
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetchMock);
    const request = apiJson('/sync/push', { method: 'POST', accessToken: token('A'), body: { owner: 'A' } });
    await vi.waitFor(() => expect(fetchAuthSession).toHaveBeenCalledTimes(1));
    signedIn('B');
    refresh.resolve(session('B'));

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a different-sub refreshed token even without a store transition', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetchMock);
    setAccessTokenRefresher(async () => token('B'));

    await expect(apiJson('/sync/push', { accessToken: token('A'), body: { owner: 'A' } }))
      .rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay an old request after sign-out and sign-in as the same sub', async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(fetchAuthSession).mockResolvedValue(session('A', 'new-login') as any);
    const request = apiJson('/sync/push', { accessToken: token('A'), body: { owner: 'A' } });
    await useAuthStore.getState().signOutNow();
    signedIn('A', 'new-login');
    first.resolve(response(401));

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(fetchAuthSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a same-sub refresh and replay', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(session('A') as any);
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetchMock);
    const body = { owner: 'A' };

    await expect(apiJson('/sync/push', { method: 'POST', accessToken: token('A'), body })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: `Bearer ${token('A', 'fresh')}` }, body: JSON.stringify(body),
    });
  });

  it.each(['malformed', 'header.e30.signature'])('does not refresh an original token without a readable sub: %s', async (original) => {
    const fetchMock = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal('fetch', fetchMock);
    const refresher = vi.fn(async () => token('A', 'fresh'));
    setAccessTokenRefresher(refresher);

    await expect(apiJson('/sync/push', { accessToken: original })).rejects.toMatchObject({ status: 401 });
    expect(refresher).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['malformed', 'header.e30.signature'])('does not replay with a refreshed token without a readable sub: %s', async (fresh) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValue(response(200));
    vi.stubGlobal('fetch', fetchMock);
    setAccessTokenRefresher(async () => fresh);

    await expect(apiJson('/sync/push', { accessToken: token('A') })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discards a successful response that finishes after the account changes', async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(first.promise);
    vi.stubGlobal('fetch', fetchMock);
    const request = apiJson('/me', { accessToken: token('A') });
    signedIn('B');
    first.resolve(response(200));

    await expect(request).rejects.toMatchObject({ status: 401, kind: 'auth' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send a fallback request after the account changes', async () => {
    const transport = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(transport.promise);
    vi.stubGlobal('fetch', fetchMock);
    const request = apiJson('/sync/push', { accessToken: token('A'), body: { owner: 'A' } });
    signedIn('B');
    transport.reject(new TypeError('Network request failed'));

    await expect(request).rejects.toMatchObject({ status: 401, kind: 'auth' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fresh token session boundaries', () => {
  it('discards a delayed A token without changing B or publishing A to sync', async () => {
    const refresh = deferred<any>();
    vi.mocked(fetchAuthSession).mockReturnValue(refresh.promise);
    const pending = getFreshAccessToken();
    signedIn('B');
    refresh.resolve(session('A'));

    expect(await pending).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ userSub: 'B', accessToken: token('B') });
    expect(setSyncAccessToken).not.toHaveBeenCalled();
  });

  it('does not expire B after an A refresh returns delayed missing tokens', async () => {
    const refresh = deferred<any>();
    vi.mocked(fetchAuthSession).mockReturnValue(refresh.promise);
    const pending = getFreshAccessToken();
    signedIn('B');
    refresh.resolve({ tokens: {} });

    expect(await pending).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_in', userSub: 'B', sessionExpired: false });
    expect(setSyncAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a token whose sub differs from the captured account', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue(session('B') as any);

    expect(await getFreshAccessToken()).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ userSub: 'A', accessToken: token('A') });
    expect(setSyncAccessToken).not.toHaveBeenCalled();
  });

  it.each(['malformed', 'header.e30.signature'])('does not publish a refreshed token without a readable sub: %s', async (fresh) => {
    vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: { accessToken: fresh } } as any);

    expect(await getFreshAccessToken()).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ userSub: 'A', accessToken: token('A') });
    expect(setSyncAccessToken).not.toHaveBeenCalled();
  });

  it('does not expire a new session while the old expiry waits for sync cleanup', async () => {
    const cleanup = deferred<void>();
    vi.mocked(setSyncAccessToken).mockImplementationOnce(() => cleanup.promise);
    vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: {} } as any);
    const pending = getFreshAccessToken();
    await vi.waitFor(() => expect(setSyncAccessToken).toHaveBeenCalledWith(null));
    signedIn('B');
    cleanup.resolve();

    expect(await pending).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_in', userSub: 'B', sessionExpired: false });
  });

  it('starts B refresh separately and keeps coalescing B after the discarded A request settles', async () => {
    const a = deferred<any>();
    const b = deferred<any>();
    vi.mocked(fetchAuthSession).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const pendingA = getFreshAccessToken();
    signedIn('B');
    const pendingB = getFreshAccessToken();
    a.resolve(session('A'));
    expect(await pendingA).toBeNull();
    const sameB = getFreshAccessToken();
    expect(sameB).toBe(pendingB);
    b.resolve(session('B'));

    expect(await pendingB).toBe(token('B', 'fresh'));
    expect(fetchAuthSession).toHaveBeenCalledTimes(2);
    expect(setSyncAccessToken).toHaveBeenCalledExactlyOnceWith(token('B', 'fresh'));
  });

  it('invalidates pending refresh immediately when sign-out begins', async () => {
    const refresh = deferred<any>();
    const signOutResult = deferred<void>();
    vi.mocked(fetchAuthSession).mockReturnValue(refresh.promise);
    vi.mocked(signOut).mockReturnValue(signOutResult.promise);
    const pending = getFreshAccessToken();
    const signingOut = useAuthStore.getState().signOutNow();
    refresh.resolve(session('A'));
    const result = await pending;
    const syncCallsBeforeSignOutCompletes = vi.mocked(setSyncAccessToken).mock.calls.slice();
    signOutResult.resolve();
    await signingOut;

    expect(result).toBeNull();
    expect(syncCallsBeforeSignOutCompletes).toHaveLength(0);
  });

  it('discards the previous login refresh after the same user signs back in', async () => {
    const refresh = deferred<any>();
    vi.mocked(fetchAuthSession).mockReturnValue(refresh.promise);
    const pending = getFreshAccessToken();
    await useAuthStore.getState().signOutNow();
    signedIn('A', 'new-login');
    vi.mocked(setSyncAccessToken).mockClear();
    refresh.resolve(session('A', 'old-login-refreshed'));

    expect(await pending).toBeNull();
    expect(useAuthStore.getState().accessToken).toBe(token('A', 'new-login'));
    expect(setSyncAccessToken).not.toHaveBeenCalled();
  });
});

describe('auth action session boundaries', () => {
  it('does not clear B when an old sign-out finishes later', async () => {
    const signOutResult = deferred<void>();
    vi.mocked(signOut).mockReturnValue(signOutResult.promise);
    const signingOut = useAuthStore.getState().signOutNow();
    signedIn('B');
    signOutResult.resolve();
    await signingOut;

    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_in', userSub: 'B', accessToken: token('B') });
    expect(setSyncAccessToken).not.toHaveBeenCalled();
  });

  it('does not begin a new refresh while sign-out is pending', async () => {
    const signOutResult = deferred<void>();
    vi.mocked(signOut).mockReturnValue(signOutResult.promise);
    const signingOut = useAuthStore.getState().signOutNow();
    const refreshed = await getFreshAccessToken();
    signOutResult.resolve();
    await signingOut;

    expect(refreshed).toBeNull();
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });

  it('does not fall back to B token for an account deletion started by A', async () => {
    const refresh = deferred<any>();
    vi.mocked(fetchAuthSession).mockReturnValue(refresh.promise);
    const deleting = useAuthStore.getState().deleteAccountNow();
    await vi.waitFor(() => expect(fetchAuthSession).toHaveBeenCalledTimes(1));
    signedIn('B');
    refresh.resolve(session('A'));

    await expect(deleting).rejects.toThrow('Session changed');
    expect(deleteServerAccountData).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_in', userSub: 'B', accessToken: token('B') });
  });

  it('keeps the existing same-session deletion token fallback after a transient refresh failure', async () => {
    vi.mocked(fetchAuthSession).mockRejectedValue(new Error('Network request failed'));

    await useAuthStore.getState().deleteAccountNow();

    expect(deleteServerAccountData).toHaveBeenCalledExactlyOnceWith(token('A'));
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });
});

describe('session initialization operation boundaries', () => {
  it.each(['success', 'network failure', 'permanent failure'])('keeps B untouched when an old init ends with %s', async (outcome) => {
    const result = deferred<any>();
    vi.mocked(fetchAuthSession).mockReturnValue(result.promise);
    const pending = useAuthStore.getState().init();
    signedIn('B');
    useAuthStore.setState({ loading: true, lastError: 'B operation pending' });
    if (outcome === 'success') result.resolve(session('A'));
    else result.reject(Object.assign(new Error('old init failed'), {
      name: outcome === 'network failure' ? 'NetworkError' : 'NotAuthorizedException',
    }));
    await pending;

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signed_in', userSub: 'B', accessToken: token('B'), loading: true, lastError: 'B operation pending',
    });
    expect(setActiveUserSub).not.toHaveBeenCalled();
    expect(setSyncAccessToken).not.toHaveBeenCalled();
  });

  it.each(['user', 'scope', 'decks', 'gacha', 'flag'])('stops an old init after its pending %s step returns', async (phase) => {
    const step = deferred<any>();
    vi.mocked(fetchAuthSession).mockResolvedValue(session('A') as any);
    const gated = phase === 'user' ? getCurrentUser
      : phase === 'scope' ? setActiveUserSub
      : phase === 'decks' ? adoptAnonymousPublicDecks
      : phase === 'gacha' ? adoptAnonGachaState : AsyncStorage.setItem;
    vi.mocked(gated).mockReturnValueOnce(step.promise);
    const pending = useAuthStore.getState().init();
    await vi.waitFor(() => expect(gated).toHaveBeenCalled());
    signedIn('B');
    useAuthStore.setState({ loading: true });
    const effects = [setActiveUserSub, adoptAnonymousPublicDecks, invalidateDeckCache, adoptAnonGachaState, AsyncStorage.setItem];
    const callCounts = effects.map((effect) => vi.mocked(effect).mock.calls.length);
    step.resolve(phase === 'user' ? { userId: 'A' } : undefined);
    await pending;

    expect(useAuthStore.getState()).toMatchObject({ userSub: 'B', accessToken: token('B'), loading: true });
    expect(effects.map((effect) => vi.mocked(effect).mock.calls.length)).toEqual(callCounts);
    expect(setSyncAccessToken).not.toHaveBeenCalled();
    expect(forceProgressSync).not.toHaveBeenCalled();
  });

  it('stops an old init error cleanup when its sync cleanup returns after B signs in', async () => {
    const cleanup = deferred<void>();
    vi.mocked(fetchAuthSession).mockRejectedValue(Object.assign(new Error('expired'), { name: 'NotAuthorizedException' }));
    vi.mocked(setSyncAccessToken).mockReturnValueOnce(cleanup.promise);
    const pending = useAuthStore.getState().init();
    await vi.waitFor(() => expect(setSyncAccessToken).toHaveBeenCalledWith(null));
    signedIn('B');
    useAuthStore.setState({ loading: true });
    cleanup.resolve();
    await pending;

    expect(useAuthStore.getState()).toMatchObject({ userSub: 'B', accessToken: token('B'), loading: true });
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('does not apply a sign-in result from before the account switched', async () => {
    const result = deferred<any>();
    vi.mocked(signIn).mockReturnValueOnce(result.promise);
    const pending = useAuthStore.getState().signInWithEmail('A@example.test', 'pass');
    signedIn('B');
    useAuthStore.setState({ loading: true });
    result.resolve({ isSignedIn: true });
    await pending;

    expect(useAuthStore.getState()).toMatchObject({ userSub: 'B', accessToken: token('B'), loading: true });
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });

  it('does not apply delayed automatic sign-in after the account switched', async () => {
    const result = deferred<any>();
    vi.mocked(confirmSignUp).mockResolvedValueOnce({ nextStep: { signUpStep: 'COMPLETE_AUTO_SIGN_IN' } } as any);
    vi.mocked(autoSignIn).mockReturnValueOnce(result.promise);
    const pending = useAuthStore.getState().confirmSignUpCode('A@example.test', '123456');
    await vi.waitFor(() => expect(autoSignIn).toHaveBeenCalled());
    signedIn('B');
    useAuthStore.setState({ loading: true });
    result.resolve({ isSignedIn: true });
    await pending;

    expect(useAuthStore.getState()).toMatchObject({ userSub: 'B', accessToken: token('B'), loading: true });
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });
});

describe('account deletion operation boundaries', () => {
  it.each(['stop', 'server', 'cognito', 'signout', 'purgeRead', 'purgeWrite', 'flag'])('stops deletion after its pending %s step returns in B session', async (phase) => {
    const step = deferred<any>();
    vi.mocked(fetchAuthSession).mockResolvedValue(session('A') as any);
    if (phase === 'purgeWrite') vi.mocked(AsyncStorage.getAllKeys).mockResolvedValueOnce(['devcards:u:A:progress']);
    const gated = phase === 'stop' ? stopSyncForDeletion
      : phase === 'server' ? deleteServerAccountData
      : phase === 'cognito' ? deleteUser
      : phase === 'signout' ? signOut
      : phase === 'purgeRead' ? AsyncStorage.getAllKeys
      : phase === 'purgeWrite' ? AsyncStorage.multiRemove : AsyncStorage.removeItem;
    vi.mocked(gated).mockReturnValueOnce(step.promise);
    const pending = useAuthStore.getState().deleteAccountNow();
    await vi.waitFor(() => expect(gated).toHaveBeenCalled());
    signedIn('B');
    useAuthStore.setState({ loading: true, lastError: 'B operation pending' });
    const effects = [deleteServerAccountData, deleteUser, signOut, setSyncAccessToken, AsyncStorage.multiRemove, AsyncStorage.removeItem, resumeSyncAfterFailedDeletion];
    const callCounts = effects.map((effect) => vi.mocked(effect).mock.calls.length);
    step.resolve(phase === 'server' ? 'deleted' : phase === 'purgeRead' ? ['devcards:u:A:progress'] : undefined);

    await expect(pending).rejects.toThrow('Session changed');
    expect(useAuthStore.getState()).toMatchObject({ userSub: 'B', accessToken: token('B'), loading: true, lastError: 'B operation pending' });
    expect(effects.map((effect) => vi.mocked(effect).mock.calls.length)).toEqual(callCounts);
  });

  it.each(['stop', 'server', 'cognito'])('does not apply stale %s deletion errors to B', async (phase) => {
    const step = deferred<any>();
    vi.mocked(fetchAuthSession).mockResolvedValue(session('A') as any);
    const gated = phase === 'stop' ? stopSyncForDeletion : phase === 'server' ? deleteServerAccountData : deleteUser;
    vi.mocked(gated).mockReturnValueOnce(step.promise);
    const pending = useAuthStore.getState().deleteAccountNow();
    await vi.waitFor(() => expect(gated).toHaveBeenCalled());
    signedIn('B');
    useAuthStore.setState({ lastError: 'B operation pending' });
    step.reject(new Error('old deletion error'));

    await expect(pending).rejects.toThrow('Session changed');
    expect(useAuthStore.getState()).toMatchObject({ userSub: 'B', accessToken: token('B'), lastError: 'B operation pending' });
    expect(resumeSyncAfterFailedDeletion).not.toHaveBeenCalled();
  });
});
