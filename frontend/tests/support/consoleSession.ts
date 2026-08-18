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

/**
 * The two accounts' Cognito subjects.
 *
 * Carried because `sub` is what src/lib/sessionCache.ts scopes DeckListPage's
 * localStorage deck list by, so a token without one puts every test on the "no
 * identity, no cache" branch and quietly stops exercising the cache at all.
 * They are DIFFERENT strings on purpose: that is what makes it possible to
 * write down "one account cannot be served the other's rows" as an assertion
 * rather than as an intention.
 */
export const TEST_ADMIN_SUB = 'console-tests-admin-sub';
export const TEST_EDITOR_SUB = 'console-tests-editor-sub';

/** Put a non-expired super_admin session in sessionStorage. */
export function signInAsSuperAdmin(): void {
  const token = fakeJwt({
    sub: TEST_ADMIN_SUB,
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

/**
 * Put a non-expired session in sessionStorage that is *not* super_admin.
 *
 * DeckListPage branches on this at mount: super admins start against the
 * cursor-paged admin endpoint, everyone else starts on the legacy full-list
 * path. Reaching that path by signing in as an editor exercises the same
 * decision the app makes; forcing listMode some other way would test a state
 * no session can produce.
 */
export function signInAsEditor(): void {
  const token = fakeJwt({
    sub: TEST_EDITOR_SUB,
    email: TEST_ADMIN_EMAIL,
    'cognito:username': 'console-tests-editor',
    'cognito:groups': ['editor'],
  });

  setStoredTokens({
    accessToken: token,
    idToken: token,
    expiresIn: 24 * 60 * 60,
  });
}

/**
 * Drop the session, so no test can inherit another test's permissions.
 *
 * The localStorage.clear() is load-bearing beyond permissions: DeckListPage
 * keeps its own five-minute deck and manifest caches there (today under
 * `recallsmith/v1/<sub>/…`, via src/lib/sessionCache.ts), and a test that
 * inherited one would render a previous test's rows without issuing a single
 * request. Tests that mount that page rely on this call to start cold. A
 * helper naming those keys directly was considered and rejected: it would
 * go silently stale the day a key is renamed — as it in fact was renamed —
 * whereas clearing everything cannot.
 */
export function signOut(): void {
  sessionStorage.clear();
  localStorage.clear();
}
