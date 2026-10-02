import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R25 G02: account deletion cannot be undone by a late sync.
 *
 * deleteAccountNow refreshes the access token before DELETE /api/v1/user/me.
 * The refresh hands the new token to the sync layer, which used to schedule a
 * 'token_set' sync on the spot; that sync (and any foreground, rating or
 * draw-state sync that happened to fire while the DELETE was on the wire)
 * reached the server AFTER the delete and wrote rows back for a deleted user.
 *
 * Every network call -- the real progressSync/drawStateSync calls via apiJson
 * and the DELETE itself -- goes into one ordered log, so "nothing after the
 * DELETE" is a plain index comparison.
 */

const { store, netLog, fetchAuthSessionMock } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  netLog: [] as string[],
  fetchAuthSessionMock: { token: 'fresh-access' },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null])),
    multiSet: vi.fn(async (pairs: [string, string][]) => {
      for (const [k, v] of pairs) store.set(k, v);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  },
}));

let uuidN = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidN}`),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: 'test' } },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  fetchAuthSession: vi.fn(async () => ({
    tokens: { accessToken: fetchAuthSessionMock.token, idToken: 'fresh-id' },
  })),
  getCurrentUser: vi.fn(async () => ({ userId: 'user1' })),
  deleteUser: vi.fn(async () => {}),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  autoSignIn: vi.fn(),
}));

vi.mock('../../src/premium/revenuecat', () => ({
  rcLogout: vi.fn(async () => {}),
}));

vi.mock('../../src/content/deckRepository', () => ({
  resolveDeckBySlug: vi.fn(async () => null),
}));

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

vi.mock('../../src/api/apiClient', () => ({
  setAccessTokenRefresher: vi.fn(),
  apiJson: vi.fn(async (path: string, opts: any) => {
    netLog.push(`${opts?.method ?? 'GET'} ${path}`);
    // A real round trip takes time; this is what lets a sync that started
    // before the DELETE overlap it.
    await wait(5);
    const ok = (data: any) => ({ success: true, data, error: null, traceId: 't', version: '1' });
    if (path.startsWith('/api/v1/user/bootstrap')) {
      return ok({ created: false, userSub: 'user1', serverTimeMs: 1 });
    }
    if (path.startsWith('/api/v1/sync/push')) {
      const ids = (opts?.body?.events ?? []).map((e: any) => e.eventId);
      return ok({
        serverTimeMs: 1,
        receivedCount: ids.length,
        acceptedCount: ids.length,
        acceptedEventIds: ids,
        duplicateEventIds: [],
      });
    }
    if (path.startsWith('/api/v1/sync/progress')) {
      return ok({ serverTimeMs: 1, sinceMs: null, items: [] });
    }
    // Draw-state sync and anything else: an empty success is enough, the test
    // only cares whether the call was made.
    return ok({});
  }),
}));

// The DELETE itself: logged in the same ordered stream, and slow enough that a
// timer armed just before it (token_set, app_foreground, rating) fires while
// it is still on the wire -- exactly the production race.
const deleteBehaviour = vi.hoisted(() => ({ fail: false }));
vi.mock('../../src/auth/deleteServerAccount', async (importActual) => {
  const actual = await importActual<typeof import('../../src/auth/deleteServerAccount')>();
  return {
    ...actual,
    deleteServerAccountData: vi.fn(async () => {
      netLog.push('DELETE /api/v1/user/me');
      await wait(40);
      if (deleteBehaviour.fail) throw new actual.AccountDeletionError('server', 500);
      return 'deleted' as const;
    }),
  };
});

import {
  forceProgressSync,
  recordReviewEvent,
  resetProgressSyncState,
  scheduleProgressSync,
  setActiveUserSub,
  setSyncAccessToken,
} from '../../src/sync/progressSync';
import { syncDrawStateNow } from '../../src/sync/drawStateSync';
import { useAuthStore } from '../../src/auth/authStore';

function callsAfterDelete(): string[] {
  const i = netLog.indexOf('DELETE /api/v1/user/me');
  expect(i).toBeGreaterThanOrEqual(0);
  return netLog.slice(i + 1);
}

async function signedIn() {
  useAuthStore.setState({
    status: 'signed_in',
    userId: 'user1',
    userSub: 'user1',
    email: 'demo@example.com',
    accessToken: 'old-access',
    idToken: 'old-id',
    lastError: null,
  });
  await setActiveUserSub('user1');
  await setSyncAccessToken('old-access');
  // Let the token_set sync that setSyncAccessToken schedules finish, so each
  // test starts from an idle sync layer with a clean log.
  await forceProgressSync('manual');
  await wait(20);
  netLog.length = 0;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  deleteBehaviour.fail = false;
  fetchAuthSessionMock.token = `fresh-access-${Math.random()}`;
  await resetProgressSyncState();
  await signedIn();
});

afterEach(async () => {
  await wait(60);
  warnSpy.mockRestore();
});

describe('account deletion blocks every sync', () => {
  it('the token refresh at the start of deletion does not sync after the DELETE', async () => {
    await recordReviewEvent('algo', 'c1', 'good', Date.now());
    netLog.length = 0;

    await useAuthStore.getState().deleteAccountNow();
    await wait(60);

    expect(callsAfterDelete()).toEqual([]);
    // Nothing reached the server before the DELETE either: the refresh did not sync.
    expect(netLog).toEqual(['DELETE /api/v1/user/me']);
  });

  it('an app foreground, a rating flush or a draw-state sync during the DELETE stays off the network', async () => {
    await recordReviewEvent('algo', 'c2', 'good', Date.now());
    // A rating debounce armed before the user tapped Delete account.
    scheduleProgressSync({ delayMs: 10, reason: 'rating' });
    netLog.length = 0;

    const deleting = useAuthStore.getState().deleteAccountNow();
    await wait(5);
    scheduleProgressSync({ delayMs: 0, reason: 'app_foreground' });
    scheduleProgressSync({ delayMs: 0, reason: 'app_background' });
    void forceProgressSync('draw_committed');
    await syncDrawStateNow('fresh-access');
    await deleting;
    await wait(60);

    expect(callsAfterDelete()).toEqual([]);
  });

  it('a sync already running when deletion starts finishes before the DELETE', async () => {
    await recordReviewEvent('algo', 'c3', 'good', Date.now());
    netLog.length = 0;

    void forceProgressSync('manual');
    await wait(1);
    await useAuthStore.getState().deleteAccountNow();
    await wait(60);

    expect(callsAfterDelete()).toEqual([]);
  });

  it('after a successful deletion every sync path is a no-op until the next sign-in', async () => {
    await useAuthStore.getState().deleteAccountNow();
    await wait(20);

    scheduleProgressSync({ delayMs: 0, reason: 'app_foreground' });
    await forceProgressSync('manual');
    await syncDrawStateNow('stale-token');
    await wait(20);

    expect(callsAfterDelete()).toEqual([]);
  });

  it('a failed deletion lifts the block so normal sync resumes', async () => {
    deleteBehaviour.fail = true;
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();
    await wait(60);
    netLog.length = 0;

    await recordReviewEvent('algo', 'c4', 'good', Date.now());
    await forceProgressSync('manual');
    await wait(20);

    expect(netLog.some((c) => c.includes('/api/v1/sync/'))).toBe(true);
  });

  it('normal sync is unaffected when no deletion is running', async () => {
    await recordReviewEvent('algo', 'c5', 'good', Date.now());
    await forceProgressSync('manual');
    await wait(20);

    expect(netLog.some((c) => c.includes('/api/v1/sync/push'))).toBe(true);
  });
});
