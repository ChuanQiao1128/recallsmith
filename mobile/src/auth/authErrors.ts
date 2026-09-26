// mobile/src/auth/authErrors.ts
//
// Friendly, user-facing copy for Cognito/Amplify auth failures, plus a small
// typed error the store throws to route the UI (e.g. an unconfirmed account
// must open ConfirmSignUp instead of dead-ending). Pure module: no imports
// from aws-amplify or react-native so it stays trivially testable.

export type AuthFlowCode =
  | 'NEEDS_CONFIRMATION'
  | 'USERNAME_EXISTS'
  | 'RESET_REQUIRED'
  | 'NEW_PASSWORD_REQUIRED'
  | 'FAILED';

export class AuthFlowError extends Error {
  readonly code: AuthFlowCode;
  constructor(code: AuthFlowCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AuthFlowError';
  }
}

export function isAuthFlowError(err: unknown, code?: AuthFlowCode): err is AuthFlowError {
  if (!(err instanceof AuthFlowError)) return false;
  return code === undefined || err.code === code;
}

// Maps Cognito exception `name`s to calm, non-leaky copy. Keys are the exact
// Amplify error names; values never expose a raw Cognito message.
export const AUTH_ERROR_COPY: Record<string, string> = {
  NotAuthorizedException: 'Incorrect email or password.',
  UserNotFoundException: 'Incorrect email or password.',
  UserNotConfirmedException: 'Please verify your email first. We sent you a new code.',
  UsernameExistsException: 'An account with this email already exists.',
  InvalidPasswordException:
    'Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.',
  CodeMismatchException: 'That code is not right. Check the newest email and try again.',
  ExpiredCodeException: 'That code has expired. Request a new one.',
  LimitExceededException: 'Too many attempts. Wait a few minutes and try again.',
  TooManyRequestsException: 'Too many attempts. Wait a few minutes and try again.',
  TooManyFailedAttemptsException: 'Too many attempts. Wait a few minutes and try again.',
  InvalidParameterException: 'Please check your email and password and try again.',
  NetworkError: 'No connection. Check your internet and try again.',
};

/**
 * Turns any thrown auth error into safe, user-facing copy. An AuthFlowError
 * already carries friendly copy, so its message passes through. Otherwise we
 * look up the Cognito `name`; a "network request failed" message maps to the
 * network copy; anything unrecognised returns the neutral fallback. This must
 * never return a raw Cognito message.
 */
export function friendlyAuthError(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof AuthFlowError) return err.message;

  const name = String((err as any)?.name ?? '');
  if (name && Object.prototype.hasOwnProperty.call(AUTH_ERROR_COPY, name)) {
    return AUTH_ERROR_COPY[name];
  }

  const message = String((err as any)?.message ?? '');
  if (/network request failed/i.test(message)) {
    return AUTH_ERROR_COPY.NetworkError;
  }

  return fallback;
}
