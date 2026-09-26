import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore } = vi.hoisted(() => ({ asyncStore: new Map<string, string>() }));

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
  deleteUser: vi.fn(async () => {}),
  resetPassword: vi.fn(async () => {}),
  confirmResetPassword: vi.fn(async () => {}),
  autoSignIn: vi.fn(),
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

import {
  signUp,
  confirmSignUp,
  signIn,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  confirmResetPassword,
  autoSignIn,
} from 'aws-amplify/auth';
import { useAuthStore } from '../../src/auth/authStore';
import {
  AuthFlowError,
  AUTH_ERROR_COPY,
  friendlyAuthError,
  isAuthFlowError,
} from '../../src/auth/authErrors';
import { PASSWORD_RULES, evaluatePassword, isPasswordValid } from '../../src/auth/passwordPolicy';
import { leaveAuthFlow } from '../../src/auth/leaveAuthFlow';

const mockSignUp = vi.mocked(signUp);
const mockConfirmSignUp = vi.mocked(confirmSignUp);
const mockSignIn = vi.mocked(signIn);
const mockFetchAuthSession = vi.mocked(fetchAuthSession);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockResetPassword = vi.mocked(resetPassword);
const mockConfirmResetPassword = vi.mocked(confirmResetPassword);
const mockAutoSignIn = vi.mocked(autoSignIn);

beforeEach(() => {
  vi.clearAllMocks();
  asyncStore.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('authRecovery', () => {
  it('maps Cognito error names to friendly copy', () => {
    expect(friendlyAuthError({ name: 'NotAuthorizedException' })).toBe(
      AUTH_ERROR_COPY.NotAuthorizedException,
    );
    expect(friendlyAuthError({ name: 'UserNotConfirmedException' })).toBe(
      AUTH_ERROR_COPY.UserNotConfirmedException,
    );
    expect(friendlyAuthError({ name: 'UsernameExistsException' })).toBe(
      AUTH_ERROR_COPY.UsernameExistsException,
    );
    expect(friendlyAuthError({ name: 'CodeMismatchException' })).toBe(
      AUTH_ERROR_COPY.CodeMismatchException,
    );
    expect(friendlyAuthError({ name: 'LimitExceededException' })).toBe(
      AUTH_ERROR_COPY.LimitExceededException,
    );
    // A generic network failure with no matching name still maps to network copy.
    expect(friendlyAuthError({ name: 'Error', message: 'Network request failed' })).toBe(
      AUTH_ERROR_COPY.NetworkError,
    );
    // An AuthFlowError passes its own friendly message straight through.
    expect(friendlyAuthError(new AuthFlowError('NEEDS_CONFIRMATION', 'friendly copy'))).toBe(
      'friendly copy',
    );
    expect(isAuthFlowError(new AuthFlowError('USERNAME_EXISTS', 'x'), 'USERNAME_EXISTS')).toBe(true);
    expect(isAuthFlowError(new AuthFlowError('USERNAME_EXISTS', 'x'), 'FAILED')).toBe(false);
    expect(isAuthFlowError(new Error('x'))).toBe(false);
  });

  it('never returns the raw Cognito message for an unknown error', () => {
    const raw = 'PreSignUp failed with error internal-secret-detail.';
    const result = friendlyAuthError({ name: 'SomeUnmappedException', message: raw });
    expect(result).not.toContain('internal-secret-detail');
    expect(result).not.toBe(raw);
    expect(result).toBe('Something went wrong. Please try again.');
    // A custom fallback is honoured, and still never leaks the raw message.
    expect(friendlyAuthError({ name: 'Whatever', message: raw }, 'custom fallback')).toBe(
      'custom fallback',
    );
  });

  it('password checklist mirrors the pool policy', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(['length', 'upper', 'lower', 'number', 'symbol']);
    expect(isPasswordValid('Abcdef1!')).toBe(true);
    // Missing each individual requirement fails.
    expect(isPasswordValid('Abcde1!')).toBe(false); // too short
    expect(isPasswordValid('abcdef1!')).toBe(false); // no upper
    expect(isPasswordValid('ABCDEF1!')).toBe(false); // no lower
    expect(isPasswordValid('Abcdefg!')).toBe(false); // no number
    expect(isPasswordValid('Abcdefg1')).toBe(false); // no symbol
    const evaluated = evaluatePassword('abc');
    expect(evaluated.find((r) => r.id === 'length')?.ok).toBe(false);
    expect(evaluated.find((r) => r.id === 'lower')?.ok).toBe(true);
    expect(evaluated.map((r) => r.label)).toEqual([
      'At least 8 characters',
      'An uppercase letter',
      'A lowercase letter',
      'A number',
      'A symbol',
    ]);
  });

  it('leaveAuthFlow pops every auth route back to the screen that opened sign-in', () => {
    const popTo = vi.fn();
    const reset = vi.fn();
    const navigation = {
      getState: () => ({
        routes: [
          { name: 'Home', params: { tab: 'library' } },
          { name: 'SignIn' },
          { name: 'ConfirmSignUp', params: { email: 'a@b.com' } },
          { name: 'ForgotPassword' },
        ],
      }),
      popTo,
      reset,
    };
    leaveAuthFlow(navigation);
    expect(popTo).toHaveBeenCalledWith('Home', { tab: 'library' });
    expect(reset).not.toHaveBeenCalled();

    // A stack that is entirely auth routes resets to Home.
    const popTo2 = vi.fn();
    const reset2 = vi.fn();
    leaveAuthFlow({
      getState: () => ({ routes: [{ name: 'SignIn' }, { name: 'SignUp' }] }),
      popTo: popTo2,
      reset: reset2,
    });
    expect(popTo2).not.toHaveBeenCalled();
    expect(reset2).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Home' }] });
  });

  it('leaveAuthFlow is a no-op once the top route is not an auth route', () => {
    const popTo = vi.fn();
    const reset = vi.fn();
    leaveAuthFlow({
      getState: () => ({ routes: [{ name: 'SignIn' }, { name: 'Home' }] }),
      popTo,
      reset,
    });
    expect(popTo).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('signInWithEmail throws a NEEDS_CONFIRMATION AuthFlowError for an unconfirmed account', async () => {
    mockSignIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
    } as any);

    await expect(
      useAuthStore.getState().signInWithEmail('user@example.com', 'whatever'),
    ).rejects.toMatchObject({ name: 'AuthFlowError', code: 'NEEDS_CONFIRMATION' });

    // A thrown UserNotConfirmedException maps to the same routed error.
    mockSignIn.mockRejectedValue({ name: 'UserNotConfirmedException', message: 'raw' });
    await expect(
      useAuthStore.getState().signInWithEmail('user@example.com', 'whatever'),
    ).rejects.toMatchObject({ name: 'AuthFlowError', code: 'NEEDS_CONFIRMATION' });
  });

  it('signUpWithEmail requests autoSignIn and throws USERNAME_EXISTS for an existing email', async () => {
    mockSignUp.mockResolvedValue({ isSignUpComplete: false, nextStep: { signUpStep: 'CONFIRM_SIGN_UP' } } as any);
    await useAuthStore.getState().signUpWithEmail('New@Example.com', 'Abcdef1!');
    expect(mockSignUp).toHaveBeenCalledTimes(1);
    const arg = mockSignUp.mock.calls[0][0] as any;
    expect(arg.username).toBe('new@example.com');
    expect(arg.options.autoSignIn).toEqual({ authFlowType: 'USER_PASSWORD_AUTH' });

    // An existing email surfaces a routed USERNAME_EXISTS error.
    mockSignUp.mockRejectedValue({ name: 'UsernameExistsException', message: 'raw exists' });
    await expect(
      useAuthStore.getState().signUpWithEmail('taken@example.com', 'Abcdef1!'),
    ).rejects.toMatchObject({ name: 'AuthFlowError', code: 'USERNAME_EXISTS' });

    // A weak password is rejected before any network call.
    mockSignUp.mockClear();
    await expect(
      useAuthStore.getState().signUpWithEmail('weak@example.com', 'short'),
    ).rejects.toBeInstanceOf(AuthFlowError);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('confirmSignUpCode completes auto sign-in when Cognito offers it', async () => {
    mockConfirmSignUp.mockResolvedValue({
      isSignUpComplete: true,
      nextStep: { signUpStep: 'COMPLETE_AUTO_SIGN_IN' },
    } as any);
    mockAutoSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } } as any);
    mockFetchAuthSession.mockResolvedValue({ tokens: { accessToken: 'atok', idToken: 'itok' } } as any);
    mockGetCurrentUser.mockResolvedValue({ userId: undefined } as any);

    const outcome = await useAuthStore.getState().confirmSignUpCode('user@example.com', '123456');
    expect(mockAutoSignIn).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('signed_in');
    expect(useAuthStore.getState().status).toBe('signed_in');

    // If auto sign-in is not offered, the caller must sign in manually.
    mockConfirmSignUp.mockResolvedValue({
      isSignUpComplete: true,
      nextStep: { signUpStep: 'DONE' },
    } as any);
    mockAutoSignIn.mockClear();
    const outcome2 = await useAuthStore.getState().confirmSignUpCode('user@example.com', '123456');
    expect(mockAutoSignIn).not.toHaveBeenCalled();
    expect(outcome2).toBe('needs_sign_in');

    // A thrown autoSignIn never propagates — it just falls back to manual.
    mockConfirmSignUp.mockResolvedValue({
      isSignUpComplete: true,
      nextStep: { signUpStep: 'COMPLETE_AUTO_SIGN_IN' },
    } as any);
    mockAutoSignIn.mockRejectedValue(new Error('AutoSignInException'));
    const outcome3 = await useAuthStore.getState().confirmSignUpCode('user@example.com', '123456');
    expect(outcome3).toBe('needs_sign_in');
  });

  it('requestPasswordReset and confirmPasswordReset call Amplify resetPassword and confirmResetPassword', async () => {
    await useAuthStore.getState().requestPasswordReset('Reset@Example.com');
    expect(mockResetPassword).toHaveBeenCalledWith({ username: 'reset@example.com' });

    await useAuthStore.getState().confirmPasswordReset('Reset@Example.com', '654321', 'Abcdef1!');
    expect(mockConfirmResetPassword).toHaveBeenCalledWith({
      username: 'reset@example.com',
      confirmationCode: '654321',
      newPassword: 'Abcdef1!',
    });

    // A weak new password is rejected before the confirmResetPassword call.
    mockConfirmResetPassword.mockClear();
    await expect(
      useAuthStore.getState().confirmPasswordReset('reset@example.com', '654321', 'weak'),
    ).rejects.toBeInstanceOf(AuthFlowError);
    expect(mockConfirmResetPassword).not.toHaveBeenCalled();
  });
});
