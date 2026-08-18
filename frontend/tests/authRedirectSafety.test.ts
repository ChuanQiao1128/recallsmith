// @vitest-environment jsdom
//
// Where sign-in is allowed to send the browser afterwards.
//
// `?next=` on the login page is attacker-supplied by definition — the whole
// purpose of the parameter is that something else wrote it — and the check on
// it was `startsWith('/')`, which two ordinary spellings walk straight
// through. Both are covered below with the payload written out, not described,
// because the bug was that the two look same-origin and are not.
//
// The second half is the part that made a local fix insufficient: LoginPage was
// not the only reader. startLogin() stashes the value in sessionStorage,
// AuthCallbackPage takes it back out after the OAuth round trip and hands it to
// navigate() — so sanitising one end leaves the other end one storage write away
// from the same redirect. Both ends are asserted here against the same function.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sanitizeNextUrl } from '../src/auth/safeRedirect';
import { consumePostLoginRedirect } from '../src/auth/cognito';

/** The key startLogin() writes; named here so the storage half is real. */
const POST_LOGIN_REDIRECT_KEY = 'devcards:postLoginRedirect';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe('sanitizeNextUrl', () => {
  it('keeps an ordinary in-app path, query and all', () => {
    // The control case. Every other assertion here is a rejection, and a
    // function that returned '/' unconditionally would satisfy all of them.
    expect(sanitizeNextUrl('/ok')).toBe('/ok');
    expect(sanitizeNextUrl('/decks/cards?deckId=7')).toBe('/decks/cards?deckId=7');
  });

  it('rejects a protocol-relative URL, which a leading-slash test calls a path', () => {
    // `//evil.com` begins with '/', so the old check passed it. The browser
    // reads it as scheme-relative and navigates off-origin.
    expect(sanitizeNextUrl('//evil.com')).toBe('/');
    expect(sanitizeNextUrl('//evil.com/pretend/login')).toBe('/');
  });

  it('rejects the backslash spelling of the same thing', () => {
    // `/\evil.com` also begins with '/'. The URL parser treats a backslash as a
    // slash for http(s), so this resolves to the authority evil.com just like
    // the pair of forward slashes above — which is why enumerating '//' alone
    // would have been a half fix.
    expect(sanitizeNextUrl('/\\evil.com')).toBe('/');
    expect(sanitizeNextUrl('/\\/evil.com')).toBe('/');
  });

  it('falls back to the root for nothing at all', () => {
    expect(sanitizeNextUrl('')).toBe('/');
    expect(sanitizeNextUrl('   ')).toBe('/');
    expect(sanitizeNextUrl(null)).toBe('/');
    expect(sanitizeNextUrl(undefined)).toBe('/');
  });

  it('rejects a relative string that is not an absolute path', () => {
    // The leading-slash rule, which the origin check does NOT subsume: 'decks'
    // resolves to '/decks' on this very origin, so an origin test alone would
    // start accepting a shape the previous contract refused. Same-origin and
    // therefore harmless, which is exactly why it needs an assertion — nothing
    // else would notice the rule disappearing.
    expect(sanitizeNextUrl('decks')).toBe('/');
    expect(sanitizeNextUrl('decks/cards?deckId=7')).toBe('/');
  });

  it('rejects the authority-with-no-host spellings, which do not parse at all', () => {
    // '//' and '/\\' are the degenerate forms of the two attacks above: the
    // parser reads them as the start of an authority, finds no host, and
    // throws rather than returning something with an origin to compare. So
    // they exercise a different branch than '//evil.com' does, and without
    // this the failure would be an exception thrown out of LoginPage's
    // useMemo during render.
    expect(sanitizeNextUrl('//')).toBe('/');
    expect(sanitizeNextUrl('///')).toBe('/');
    expect(sanitizeNextUrl('/\\')).toBe('/');
  });

  it('rejects the shapes that never looked like a path either', () => {
    // Not regressions — the leading-slash test already refused these — but they
    // are what the origin check has to keep refusing now that it, rather than
    // the prefix, is doing the work.
    expect(sanitizeNextUrl('https://evil.com')).toBe('/');
    expect(sanitizeNextUrl('javascript:alert(1)')).toBe('/');
    expect(sanitizeNextUrl('\\\\evil.com')).toBe('/');
  });
});

describe('the destination stored across the OAuth round trip', () => {
  it('comes back sanitised, not as it was written', () => {
    // AuthCallbackPage feeds this return value straight into navigate(). The
    // value is written before the redirect to Cognito and read after coming
    // back, so anything that can write this origin's sessionStorage in between
    // chose the destination — until this call re-checked it.
    sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, '//evil.com/callback');

    expect(consumePostLoginRedirect()).toBe('/');
  });

  it('still returns a legitimate destination unchanged, and consumes it', () => {
    sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, '/decks/cards?deckId=7');

    expect(consumePostLoginRedirect()).toBe('/decks/cards?deckId=7');
    // Single use: the key is gone, so a later sign-in cannot inherit an old
    // destination.
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBeNull();
  });

  it('falls back to the root when nothing was stored', () => {
    expect(consumePostLoginRedirect()).toBe('/');
  });
});
