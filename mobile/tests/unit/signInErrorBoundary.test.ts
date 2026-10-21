import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(), signUp: vi.fn(), confirmSignUp: vi.fn(), resendSignUpCode: vi.fn(),
  signOut: vi.fn(), fetchAuthSession: vi.fn(), getCurrentUser: vi.fn(), deleteUser: vi.fn(),
  resetPassword: vi.fn(), confirmResetPassword: vi.fn(), autoSignIn: vi.fn(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn(),
} }));
vi.mock('../../src/auth/deleteServerAccount', () => ({ deleteServerAccountData: vi.fn() }));
vi.mock('../../src/sync/progressSync', () => ({
  setSyncAccessToken: vi.fn(), forceProgressSync: vi.fn(), setActiveUserSub: vi.fn(),
}));
vi.mock('../../src/sync/drawStateSync', () => ({ adoptAnonGachaState: vi.fn() }));
vi.mock('../../src/sync/syncGuard', () => ({ unblockSync: vi.fn() }));
vi.mock('../../src/sync/stopSyncForDeletion', () => ({ resumeSyncAfterFailedDeletion: vi.fn(), stopSyncForDeletion: vi.fn() }));
vi.mock('../../src/sync/progressQueueCache', () => ({ invalidateProgressQueueCache: vi.fn() }));
vi.mock('../../src/features/gacha/draw/drawStateCache', () => ({ invalidateDrawStateCache: vi.fn() }));

import { signIn, resetPassword, signOut } from 'aws-amplify/auth';
import { useAuthStore } from '../../src/auth/authStore';
import { friendlyAuthError, isAuthFlowError } from '../../src/auth/authErrors';
import { setActiveUserSub, forceProgressSync } from '../../src/sync/progressSync';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ status: 'anonymous', loading: false, lastError: null });
});

describe('QA regression: real sign-in store -> screen error formatter boundary', () => {
  it.each([
    ['NotAuthorizedException', 'Incorrect email or password.'],
    ['UserNotFoundException', 'Incorrect email or password.'],
    ['NetworkError', 'No connection. Check your internet and try again.'],
    ['TooManyRequestsException', 'Too many attempts. Wait a few minutes and try again.'],
    ['InvalidParameterException', 'Please check your email and password and try again.'],
    ['UnknownProviderException', 'Something went wrong. Please try again.'],
  ])('keeps safe copy for %s through both layers', async (name, expected) => {
    vi.mocked(signIn).mockRejectedValueOnce({ name, message: 'RAW_INTERNAL_PROVIDER_DETAIL' });
    const error = await useAuthStore.getState()
      .signInWithEmail('qa@example.invalid', 'SYNTHETIC_TEST_ONLY')
      .catch(e => e);
    // This is the same second formatting operation used by SignInScreen.
    expect(friendlyAuthError(error)).toBe(expected);
    expect(friendlyAuthError(error)).not.toContain('RAW_INTERNAL_PROVIDER_DETAIL');
    expect(useAuthStore.getState().lastError).toBe(expected);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().loading).toBe(false);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(resetPassword).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(setActiveUserSub).not.toHaveBeenCalled();
    expect(forceProgressSync).not.toHaveBeenCalled();
  });

  it('preserves the unconfirmed-account route', async () => {
    vi.mocked(signIn).mockRejectedValueOnce({ name: 'UserNotConfirmedException', message: 'RAW_INTERNAL_PROVIDER_DETAIL' });
    const error = await useAuthStore.getState()
      .signInWithEmail('qa@example.invalid', 'SYNTHETIC_TEST_ONLY').catch(e => e);
    expect(isAuthFlowError(error, 'NEEDS_CONFIRMATION')).toBe(true);
    expect(friendlyAuthError(error)).toBe('Please verify your email first. We sent you a new code.');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('keeps the existing-session reinitialization signal recognizable', async () => {
    vi.mocked(signIn).mockRejectedValueOnce({ name: 'UserAlreadyAuthenticatedException', message: 'User is already signed in' });
    const error = await useAuthStore.getState()
      .signInWithEmail('qa@example.invalid', 'SYNTHETIC_TEST_ONLY').catch(e => e);
    expect(error.name).toBe('UserAlreadyAuthenticatedException');
    expect(error.message).toMatch(/already.*signed in/i);
    expect(signOut).not.toHaveBeenCalled();
  });
});
