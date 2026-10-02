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

const { store, netLog, fetchAuthSessionMock, net, storeBehaviour } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  netLog: [] as string[],
  fetchAuthSessionMock: { token: 'fresh-access' },
  // Per-endpoint round-trip time and an optional gate a test can hold a request
  // on, so a sync can be caught with a request on the wire.
  net: {
    delayMs: {} as Record<string, number>,
    gate: {} as Record<string, Promise<void> | undefined>,
  },
  // A slow AsyncStorage read keeps a draw-state run busy reading local state.
  storeBehaviour: { getDelayMs: 0 },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (storeBehaviour.getDelayMs > 0) await new Promise((r) => setTimeout(r, storeBehaviour.getDelayMs));
      return store.get(key) ?? null;
    }),
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

function endpointKey(path: string): string {
  if (path.startsWith('/api/v1/user/bootstrap')) return 'bootstrap';
  if (path.startsWith('/api/v1/sync/push')) return 'push';
  if (path.startsWith('/api/v1/draw-state/sync')) return 'draw';
  return 'other';
}

vi.mock('../../src/api/apiClient', () => ({
  setAccessTokenRefresher: vi.fn(),
  apiJson: vi.fn(async (path: string, opts: any) => {
    const call = `${opts?.method ?? 'GET'} ${path}`;
    netLog.push(call);
    // A real round trip takes time; this is what lets a sync that started
    // before the DELETE overlap it.
    const key = endpointKey(path);
    await wait(net.delayMs[key] ?? 5);
    const gate = net.gate[key];
    if (gate) await gate;
    // The response is back: the request can no longer be in flight.
    netLog.push(`done ${call}`);
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
import { isSyncBlocked, unblockSync } from '../../src/sync/syncGuard';
import { AccountDeletionError } from '../../src/auth/deleteServerAccount';
import { deleteUser, signIn } from 'aws-amplify/auth';

const PUSH = 'POST /api/v1/sync/push';
const DRAW_POST = 'POST /api/v1/draw-state/sync';
const DELETE = 'DELETE /api/v1/user/me';

async function until(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`until: condition not met; netLog=${JSON.stringify(netLog)}`);
    await wait(1);
  }
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

let held: (() => void)[] = [];

/** Forget the draw-state stamps so the next draw-state run has something to push. */
function clearDrawStamps() {
  for (const k of [...store.keys()]) if (k.includes('sync:drawState:v1')) store.delete(k);
}

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
  net.delayMs = {};
  net.gate = {};
  storeBehaviour.getDelayMs = 0;
  fetchAuthSessionMock.token = `fresh-access-${Math.random()}`;
  // A successful deletion in an earlier test leaves the block on (in the app,
  // the next sign-in lifts it); every test starts signed in and unblocked.
  unblockSync();
  await resetProgressSyncState();
  await signedIn();
});

afterEach(async () => {
  vi.useRealTimers();
  for (const release of held) release();
  held = [];
  net.delayMs = {};
  storeBehaviour.getDelayMs = 0;
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

  it('the next sign-in lifts the block', async () => {
    await useAuthStore.getState().deleteAccountNow();
    await wait(20);
    (signIn as any).mockResolvedValueOnce({ isSignedIn: true });

    await useAuthStore.getState().signInWithEmail('demo@example.com', 'a-Fake-passw0rd');
    await recordReviewEvent('algo', 'c6', 'good', Date.now());
    await forceProgressSync('manual');
    await wait(20);

    expect(callsAfterDelete().some((c) => c.includes('/api/v1/sync/push'))).toBe(true);
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

  it('a progress push already on the wire finishes before the DELETE is sent', async () => {
    await recordReviewEvent('algo', 'c7', 'good', Date.now());
    netLog.length = 0;
    net.delayMs.push = 80;

    void forceProgressSync('manual');
    await until(() => netLog.includes(PUSH));
    await useAuthStore.getState().deleteAccountNow();
    await wait(60);

    const done = netLog.indexOf(`done ${PUSH}`);
    expect(done).toBeGreaterThanOrEqual(0);
    expect(done).toBeLessThan(netLog.indexOf(DELETE));
    expect(callsAfterDelete()).toEqual([]);
  });

  it('a running sync sends no further push round and no pull once deletion starts', async () => {
    // 60 queued reviews = three 25-event push rounds.
    for (let i = 0; i < 60; i += 1) await recordReviewEvent('algo', `big-${i}`, 'good', Date.now());
    netLog.length = 0;
    net.delayMs.push = 30;

    void forceProgressSync('manual');
    await until(() => netLog.includes(PUSH));
    await useAuthStore.getState().deleteAccountNow();
    await wait(60);

    expect(netLog.filter((c) => c === PUSH)).toEqual([PUSH]);
    expect(netLog.some((c) => c.includes('/api/v1/sync/progress'))).toBe(false);
    expect(callsAfterDelete()).toEqual([]);
  });

  it('a sync whose bootstrap is on the wire when deletion starts never pushes', async () => {
    await recordReviewEvent('algo', 'c8', 'good', Date.now());
    netLog.length = 0;
    net.delayMs.bootstrap = 40;

    void forceProgressSync('manual');
    await until(() => netLog.includes('POST /api/v1/user/bootstrap'));
    await useAuthStore.getState().deleteAccountNow();
    await wait(60);

    expect(netLog.some((c) => c.includes('/api/v1/sync/push'))).toBe(false);
    expect(callsAfterDelete()).toEqual([]);
  });

  it('deletion fails without sending the DELETE when a sync is still on the wire at the end of the wait', async () => {
    await recordReviewEvent('algo', 'c9', 'good', Date.now());
    netLog.length = 0;
    const gate = deferred();
    held.push(gate.release);
    net.gate.push = gate.promise;

    void forceProgressSync('manual');
    await until(() => netLog.includes(PUSH));
    // Only Date is faked: the wait's own sleeps still run, but its clock jumps
    // past the 20 s cap while the push is still held.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const deleting = useAuthStore.getState().deleteAccountNow();
    const outcome = deleting.then(
      () => 'resolved',
      (e) => e,
    );
    await wait(30);
    vi.setSystemTime(Date.now() + 25_000);
    const result = await outcome;
    vi.useRealTimers();

    expect(result).toBeInstanceOf(AccountDeletionError);
    expect(netLog).not.toContain(DELETE);
    expect(isSyncBlocked()).toBe(false);
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(useAuthStore.getState().lastError).toBeTruthy();
  });

  it('a draw-state run reading local state when deletion starts never posts', async () => {
    clearDrawStamps();
    netLog.length = 0;
    storeBehaviour.getDelayMs = 3;

    const drawing = syncDrawStateNow('old-access');
    await wait(1);
    await useAuthStore.getState().deleteAccountNow();
    await drawing;
    await wait(60);

    expect(netLog).not.toContain(DRAW_POST);
    expect(callsAfterDelete()).toEqual([]);
  });

  it('a draw-state post already on the wire finishes before the DELETE is sent', async () => {
    clearDrawStamps();
    netLog.length = 0;
    net.delayMs.draw = 80;

    void syncDrawStateNow('old-access');
    await until(() => netLog.includes(DRAW_POST));
    await useAuthStore.getState().deleteAccountNow();
    await wait(60);

    const done = netLog.indexOf(`done ${DRAW_POST}`);
    expect(done).toBeGreaterThanOrEqual(0);
    expect(done).toBeLessThan(netLog.indexOf(DELETE));
    expect(callsAfterDelete()).toEqual([]);
  });

  it('a failed Cognito deleteUser lifts the block so normal sync resumes', async () => {
    (deleteUser as any).mockRejectedValueOnce(new Error('Network error'));
    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();
    await wait(60);
    netLog.length = 0;

    await recordReviewEvent('algo', 'c10', 'good', Date.now());
    await forceProgressSync('manual');
    await wait(20);

    expect(isSyncBlocked()).toBe(false);
    expect(netLog).toContain(PUSH);
  });

  it.each([
    ['the server DELETE', () => (deleteBehaviour.fail = true)],
    ['Cognito deleteUser', () => (deleteUser as any).mockRejectedValueOnce(new Error('Network error'))],
  ])('when %s fails, the sync deletion suppressed runs again without a manual trigger', async (_label, failIt) => {
    await recordReviewEvent('algo', 'c11', 'good', Date.now());
    // The rating debounce armed just before the user tapped Delete account;
    // deletion cancels it.
    scheduleProgressSync({ reason: 'rating' });
    netLog.length = 0;
    failIt();

    await expect(useAuthStore.getState().deleteAccountNow()).rejects.toThrow();
    await wait(80);

    expect(netLog).toContain(PUSH);
  });
});
