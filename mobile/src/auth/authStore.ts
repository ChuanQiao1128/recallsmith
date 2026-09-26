// mobile/src/auth/authStore.ts
import { create } from 'zustand';

import {
  signUp,
  confirmSignUp,
  resendSignUpCode,
  signIn,
  signOut,
  fetchAuthSession,
  getCurrentUser,
  deleteUser,
  resetPassword,
  confirmResetPassword,
  autoSignIn,
} from 'aws-amplify/auth';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthFlowError, AUTH_ERROR_COPY, friendlyAuthError } from './authErrors';
import { isPasswordValid } from './passwordPolicy';

import { setSyncAccessToken, forceProgressSync, setActiveUserSub } from '../sync/progressSync';
import { adoptAnonGachaState } from '../sync/drawStateSync';
import { invalidateProgressQueueCache } from '../sync/progressQueueCache';
import { invalidateDrawStateCache } from '../features/gacha/draw/drawStateCache';

type AuthStatus = 'unknown' | 'anonymous' | 'signed_in';

// Persisted the first time we ever see a signed-in session. Lets a later
// tokenless init distinguish "this user's refresh token expired" (show the
// session-expired banner) from "never signed in" (stay quietly anonymous).
export const AUTH_WAS_SIGNED_IN_KEY = 'recallsmith:auth:wasSignedIn';

/**
 * True for transient/offline auth failures (network, timeout, abort), where
 * Amplify throws but keeps the cached tokens. False for a real expiry —
 * NotAuthorizedException means the refresh token is gone and tokens are wiped.
 */
export function isTransientAuthError(err: unknown): boolean {
  const name = String((err as any)?.name ?? '');
  if (name.startsWith('NotAuthorizedException')) return false;
  if (name === 'NetworkError' || name === 'TimeoutError' || name === 'AbortError') return true;
  const msg = String((err as any)?.message ?? '');
  return /network|timed? ?out|fetch failed|internet/i.test(msg);
}

type AuthState = {
  status: AuthStatus;
  userId: string | null; // ✅ 稳定用户标识（sub / userId）

  email: string | null;
  userSub: string | null;

  accessToken: string | null;
  idToken: string | null;

  loading: boolean;
  lastError: string | null;

  // A previously signed-in session whose refresh token expired. Drives the
  // Home "Session expired, sign in to keep syncing" banner.
  sessionExpired: boolean;
  // A transient (offline) init failure. The session was kept; retry on the
  // next foreground.
  initRetryPending: boolean;

  init: () => Promise<void>;

  markSessionExpired: () => Promise<void>;
  dismissSessionExpired: () => void;

  signUpWithEmail: (email: string, password: string) => Promise<void>;
  confirmSignUpCode: (email: string, code: string) => Promise<'signed_in' | 'needs_sign_in'>;
  resendConfirmCode: (email: string) => Promise<void>;

  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;

  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOutNow: () => Promise<void>;
  deleteAccountNow: () => Promise<void>;
};

const DEVICE_STREAK_PREFIX = 'recallsmith:streaks:';
export async function purgeUserScopedStorage(userSub: string | null): Promise<string[]> {
  const scoped = userSub ? `devcards:u:${userSub}:` : null;
  let keys: readonly string[] = [];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch {
    return [];
  }
  const doomed = keys.filter(
    (k) => (scoped !== null && k.startsWith(scoped)) || k.startsWith(DEVICE_STREAK_PREFIX),
  );
  if (doomed.length > 0) {
    try {
      await AsyncStorage.multiRemove(doomed);
    } catch {}
  }
  invalidateProgressQueueCache(userSub ?? undefined);
  invalidateDrawStateCache();
  return doomed;
}

function normEmail(v: string) {
  return String(v || '').trim().toLowerCase();
}

function tokenToString(t: any): string | null {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (typeof t?.toString === 'function') return String(t.toString());
  return null;
}

function safeStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

async function applySessionToState(set: any) {
  const session: any = await fetchAuthSession();

  const accessTokObj = session.tokens?.accessToken;
  const idTokObj = session.tokens?.idToken;

  const at = tokenToString(accessTokObj) ?? null;
  const it = tokenToString(idTokObj) ?? null;

  // ✅ Prefer claims from idToken (real email attribute)
  const claims: any =
    idTokObj && typeof idTokObj === 'object' && 'payload' in idTokObj
      ? (idTokObj as any).payload
      : null;

  let email: string | null =
    safeStr(claims?.email) ??
    safeStr(claims?.['cognito:username']) ??
    null;

  let userSub: string | null = safeStr(claims?.sub) ?? null;

  // ✅ Optional fallback: getCurrentUser for userSub if needed (do NOT override email)
  try {
    const user = await getCurrentUser();
    userSub = userSub ?? safeStr(user?.userId);
  } catch {
    // ignore
  }

  // ✅ 关键：立刻设置 activeUserSub（让 Home 读取正确的 user-scoped progress）
  await setActiveUserSub(userSub);

  // Union any anonymous-period collection/pity/wallet into this account before
  // the first signed-in render (Library/Home read draw state on that render)
  // and before the first cloud push. A no-op when the anon partition is empty,
  // including the init() path.
  if (userSub) await adoptAnonGachaState();

  // Remember that this device has held a real session (best-effort), and derive
  // the session-expired flag: a token means the session is valid; no token means
  // it expired only if we had previously been signed in on this device.
  let sessionExpired = false;
  if (at) {
    try {
      await AsyncStorage.setItem(AUTH_WAS_SIGNED_IN_KEY, '1');
    } catch {}
  } else {
    try {
      sessionExpired = (await AsyncStorage.getItem(AUTH_WAS_SIGNED_IN_KEY)) === '1';
    } catch {
      sessionExpired = false;
    }
  }

  set({
    status: at ? 'signed_in' : 'anonymous',
    userId: userSub,
    email,
    userSub,
    accessToken: at,
    idToken: it,
    lastError: null,
    sessionExpired,
    initRetryPending: false,
  });

  // ✅ Inject token into progress sync layer
  await setSyncAccessToken(at);

  // ✅ Best-effort sync, never block UI
  if (at) void forceProgressSync('token_set');
}

export const useAuthStore = create<AuthState>((set, get) => ({
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

  init: async () => {
    set({ loading: true, lastError: null });
    try {
      await applySessionToState(set);
    } catch (err) {
      if (isTransientAuthError(err)) {
        // Transient/offline failure: Amplify still holds the session. Keep the
        // sync token and the user's storage scope (do NOT clear them) so the
        // app reads the account's own data offline, and retry on next foreground.
        set({
          status: 'anonymous',
          userId: null,
          email: null,
          userSub: null,
          accessToken: null,
          idToken: null,
          lastError: null,
          initRetryPending: true,
        });
      } else {
        // ✅ critical: ensure unsigned-in => no sync token (also clears activeUserSub)
        await setSyncAccessToken(null);

        let sessionExpired = false;
        try {
          sessionExpired = (await AsyncStorage.getItem(AUTH_WAS_SIGNED_IN_KEY)) === '1';
        } catch {
          sessionExpired = false;
        }

        set({
          status: 'anonymous',
          userId: null,
          email: null,
          userSub: null,
          accessToken: null,
          idToken: null,
          lastError: null,
          sessionExpired,
          initRetryPending: false,
        });
      }
    } finally {
      set({ loading: false });
    }
  },

  markSessionExpired: async () => {
    await setSyncAccessToken(null);
    set({
      status: 'anonymous',
      userId: null,
      email: null,
      userSub: null,
      accessToken: null,
      idToken: null,
      sessionExpired: true,
      initRetryPending: false,
    });
  },

  dismissSessionExpired: () => {
    set({ sessionExpired: false });
  },

  signUpWithEmail: async (email: string, password: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');
    if (!isPasswordValid(password)) {
      // Block before the round-trip; the checklist already tells the user why.
      throw new AuthFlowError('FAILED', AUTH_ERROR_COPY.InvalidPasswordException);
    }

    set({ loading: true, lastError: null });
    try {
      await signUp({
        username: e,
        password,
        options: {
          userAttributes: { email: e },
          // Arm auto sign-in so a user who confirms within the 3-minute window
          // is signed in without retyping the password. Stays USER_PASSWORD_AUTH
          // (SRP switch is G49).
          autoSignIn: { authFlowType: 'USER_PASSWORD_AUTH' },
        },
      });
    } catch (err: any) {
      if (err?.name === 'UsernameExistsException') {
        set({ lastError: AUTH_ERROR_COPY.UsernameExistsException });
        throw new AuthFlowError('USERNAME_EXISTS', AUTH_ERROR_COPY.UsernameExistsException);
      }
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  confirmSignUpCode: async (email: string, code: string) => {
    const e = normEmail(email);
    const c = String(code || '').trim();
    if (!e) throw new Error('Email required');
    if (!c) throw new Error('Code required');

    set({ loading: true, lastError: null });
    try {
      const result: any = await confirmSignUp({ username: e, confirmationCode: c });

      if (result?.nextStep?.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
        // Auto sign-in is in-memory and expires after ~3 minutes / an app
        // restart. Never throw here: a failed auto sign-in just means the user
        // signs in manually, which is a fine fallback, not an error.
        try {
          const signInOutput: any = await autoSignIn();
          if (signInOutput?.isSignedIn) {
            await applySessionToState(set);
            return 'signed_in';
          }
        } catch {
          // fall through to manual sign-in
        }
      }
      return 'needs_sign_in';
    } catch (err: any) {
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  resendConfirmCode: async (email: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');

    set({ loading: true, lastError: null });
    try {
      await resendSignUpCode({ username: e });
    } catch (err: any) {
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  requestPasswordReset: async (email: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');

    set({ loading: true, lastError: null });
    try {
      // The pool has prevent_user_existence_errors ENABLED, so this resolves
      // even for an unknown email; the UI shows neutral "if an account exists"
      // copy rather than confirming the address.
      await resetPassword({ username: e });
    } catch (err: any) {
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  confirmPasswordReset: async (email: string, code: string, newPassword: string) => {
    const e = normEmail(email);
    const c = String(code || '').trim();
    if (!e) throw new Error('Email required');
    if (!c) throw new Error('Code required');
    if (!isPasswordValid(newPassword)) {
      throw new AuthFlowError('FAILED', AUTH_ERROR_COPY.InvalidPasswordException);
    }

    set({ loading: true, lastError: null });
    try {
      await confirmResetPassword({ username: e, confirmationCode: c, newPassword });
    } catch (err: any) {
      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  signInWithEmail: async (email: string, password: string) => {
    const e = normEmail(email);
    if (!e) throw new Error('Email required');
    if (!password) throw new Error('Password required');

    set({ loading: true, lastError: null });
    try {
      const r: any = await signIn({
        username: e,
        password,
        options: { authFlowType: 'USER_PASSWORD_AUTH' },
      });

      if (r?.isSignedIn) {
        await applySessionToState(set);
        return;
      }

      const step = r?.nextStep?.signInStep || r?.nextStep?.step;

      if (step === 'CONFIRM_SIGN_UP') {
        throw new AuthFlowError('NEEDS_CONFIRMATION', AUTH_ERROR_COPY.UserNotConfirmedException);
      }
      if (step === 'RESET_PASSWORD') {
        throw new AuthFlowError(
          'RESET_REQUIRED',
          'Please reset your password to continue.',
        );
      }
      if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        throw new AuthFlowError(
          'NEW_PASSWORD_REQUIRED',
          'A new password is required for this account.',
        );
      }

      throw new Error(friendlyAuthError(undefined));
    } catch (err: any) {
      if (__DEV__) console.log('[auth] signIn error:', err?.name);

      // Step-routing errors we raised above already carry friendly copy.
      if (err instanceof AuthFlowError) {
        set({ lastError: err.message });
        throw err;
      }

      const name = String(err?.name ?? '');

      // Amplify may throw this instead of returning the CONFIRM_SIGN_UP step.
      if (name === 'UserNotConfirmedException') {
        const e2 = new AuthFlowError(
          'NEEDS_CONFIRMATION',
          AUTH_ERROR_COPY.UserNotConfirmedException,
        );
        set({ lastError: e2.message });
        throw e2;
      }

      // Keep the "already signed in" message recognisable so SignInScreen's
      // /already.*signed in/i re-init branch (G05/MACCT-16) still fires.
      if (name === 'UserAlreadyAuthenticatedException') {
        set({ lastError: err?.message ?? null });
        throw err;
      }

      const msg = friendlyAuthError(err);
      set({ lastError: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  signOutNow: async () => {
    set({ loading: true, lastError: null });
    try {
      await signOut();
    } finally {
      // ✅ 关键：先清 sync token / activeUserSub，再更新 UI（避免 Home reload 还读旧 scope）
      await setSyncAccessToken(null);

      // Explicit sign-out clears the was-signed-in flag so the session-expired
      // banner never shows after a deliberate sign-out.
      try {
        await AsyncStorage.removeItem(AUTH_WAS_SIGNED_IN_KEY);
      } catch {}

      set({
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
      });
    }
  },

  deleteAccountNow: async () => {
    const sub = get().userSub;
    set({ lastError: null });
    try {
      await deleteUser();
    } catch (err: any) {
      // Account still exists: keep the session, surface the error, purge nothing.
      const msg = err?.message ?? 'Delete account failed';
      set({ lastError: msg });
      throw new Error(msg);
    }
    try {
      await signOut();
    } catch {}
    await setSyncAccessToken(null); // clears activeUserSub + cancels pending sync (frozen helper, unchanged)
    await purgeUserScopedStorage(sub);
    // Deleting the account is an explicit sign-out too: never show the banner.
    try {
      await AsyncStorage.removeItem(AUTH_WAS_SIGNED_IN_KEY);
    } catch {}
    set({ status: 'anonymous', userId: null, email: null, userSub: null, accessToken: null, idToken: null, lastError: null, sessionExpired: false, initRetryPending: false });
  },
}));

// ✅ helper: no object selector (avoid infinite loop in React 18 + zustand)
export function useAuthUser() {
  const status = useAuthStore((s) => s.status);
  const email = useAuthStore((s) => s.email);
  const loading = useAuthStore((s) => s.loading);
  const isSignedIn = useAuthStore((s) => s.status === 'signed_in');

  return { status, email, loading, isSignedIn };
}