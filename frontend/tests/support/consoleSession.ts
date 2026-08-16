// tests/support/consoleSession.ts
//
// Session setup for the console wiring tests.
//
// Why a real token instead of vi.mock('../src/auth/sessionUser'): every
// super-admin-only surface on these pages is gated on readSessionUser() ->
// isSuperAdmin(), and mocking that pair would let the test assert against a
// permission model the app does not actually have. Writing a token through the
// real tokenStore exercises the same path the browser does, costs three lines,
// and keeps the storage key in one place.
//
// Not collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

import { setStoredTokens } from '../../src/auth/tokenStore';

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A syntactically valid, unsigned JWT. Nothing in the console verifies the
 * signature, it only reads claims, so a fake third segment is enough and no
 * crypto is involved.
 */
function fakeJwt(claims: Record<string, unknown>): string {
  return `${base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64Url(
    JSON.stringify(claims),
  )}.signature-not-verified-by-the-client`;
}

export const TEST_ADMIN_EMAIL = 'console-tests@example.invalid';

/** Put a non-expired super_admin session in sessionStorage. */
export function signInAsSuperAdmin(): void {
  const token = fakeJwt({
    email: TEST_ADMIN_EMAIL,
    'cognito:username': 'console-tests',
    'cognito:groups': ['super_admin'],
  });

  setStoredTokens({
    accessToken: token,
    idToken: token,
    // Well clear of the 30s expiry skew, and short enough that a test which
    // advances fake timers by minutes still cannot age the session out.
    expiresIn: 24 * 60 * 60,
  });
}

/** Drop the session, so no test can inherit another test's permissions. */
export function signOut(): void {
  sessionStorage.clear();
  localStorage.clear();
}
