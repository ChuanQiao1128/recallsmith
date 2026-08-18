// @vitest-environment jsdom
//
// The last leg of sign-in: the redirect Cognito sends the browser back on.
//
// This is the only page in the console that turns an untrusted URL into a
// session, and until now nothing exercised it. Everything it does is a decision
// about trust — is this state the one we issued, is this destination ours, did
// the exchange actually succeed — and every one of those decisions was reachable
// only by hand.
//
// ---------------------------------------------------------------------------
// WHY THE ENVIRONMENT IS STUBBED IN vi.hoisted()
// ---------------------------------------------------------------------------
// src/auth/authConfig.ts reads import.meta.env at MODULE SCOPE, so AUTH_CONFIG
// is frozen the first time anything imports it. Stubbing inside beforeEach
// would therefore be too late, and the usual repair — vi.resetModules() plus
// dynamic imports — is wrong here for a specific reason: resetting the registry
// hands the re-imported page a SECOND copy of react and react-router-dom, whose
// contexts the statically imported <MemoryRouter> in this file does not
// satisfy. vi.hoisted() runs before this file's imports are evaluated, which is
// exactly early enough and changes nothing else.
//
// It is not decoration. `frontend/.env.local` is an untracked copy of
// `.env.development` that vitest DOES load in mode 'test', so on this machine
// AUTH_CONFIG is populated and on a CI runner — which has no such file — it is
// empty and AUTH_CONFIGURED is false. A test written against whatever happens
// to be there would pass locally and behave differently in CI. These four
// values make the file say what it depends on.
//
// ---------------------------------------------------------------------------
// WHAT IS FAKED AND WHAT IS NOT
// ---------------------------------------------------------------------------
// Only `fetch`. exchangeCodeForTokens, the PKCE storage keys, sanitizeNextUrl,
// the token store and AuthProvider are all the real ones, so an assertion about
// "the session was written" is about the same sessionStorage record the console
// reads on the next page load. Mocking src/auth/cognito would have made the
// interesting half of this page — which is entirely in that module — untested
// while still looking covered.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, waitFor } from '@testing-library/react';

vi.hoisted(() => {
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://auth.callback-tests.invalid');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'callback-tests-client');
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', 'http://localhost:5173/auth/callback');
  vi.stubEnv('VITE_COGNITO_SCOPES', 'openid email profile');
});

import { AuthProvider } from '../src/auth/AuthContext';
import { AuthCallbackPage } from '../src/pages/AuthCallbackPage';
import { readStoredTokens } from '../src/auth/tokenStore';
import { locationText, renderAt } from './support/routerProbe';

const COGNITO_DOMAIN = 'https://auth.callback-tests.invalid';
const TOKEN_ENDPOINT = `${COGNITO_DOMAIN}/oauth2/token`;

const PKCE_VERIFIER_KEY = 'devcards:pkce:verifier';
const PKCE_STATE_KEY = 'devcards:pkce:state';
const POST_LOGIN_REDIRECT_KEY = 'devcards:postLoginRedirect';

/** The verifier and state this browser is pretending it created at startLogin(). */
const OUR_VERIFIER = 'verifier-this-browser-generated';
const OUR_STATE = 'state-this-browser-generated';

/** Every fetch the page made, as [url, init] pairs. */
let fetchCalls: [string, RequestInit | undefined][] = [];

/**
 * Answer the next token request with `payload`, or refuse it.
 *
 * Shaped as the two things exchangeCodeForTokens actually touches — `ok` and
 * `text()` — rather than as a full Response. A fuller fake would be a second
 * implementation of the platform with its own ways of being wrong.
 */
function stubTokenEndpoint(response: { ok: boolean; status: number; body: unknown }): void {
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
    fetchCalls.push([String(input), init]);
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      text: () =>
        Promise.resolve(
          typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
        ),
    });
  });
}

/** A Cognito authorization_code response, with a refresh token as the real one carries. */
function cognitoTokens() {
  return {
    access_token: 'access-from-callback',
    id_token: 'id-from-callback',
    refresh_token: 'refresh-from-callback',
    expires_in: 3600,
    token_type: 'Bearer',
  };
}

/** Put the PKCE pair in storage, as startLogin() would have before the redirect. */
function browserStartedTheFlow(postLoginRedirect = '/decks/edit?id=7'): void {
  sessionStorage.setItem(PKCE_VERIFIER_KEY, OUR_VERIFIER);
  sessionStorage.setItem(PKCE_STATE_KEY, OUR_STATE);
  sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, postLoginRedirect);
}

/** Mount the callback page at `/auth/callback` + `search`, with a location probe beside it. */
function renderCallback(search: string) {
  return renderAt(
    <AuthProvider>
      <AuthCallbackPage />
    </AuthProvider>,
    [`/auth/callback${search}`],
  );
}

/** The form body of the nth fetch, parsed. */
function sentForm(index = 0): URLSearchParams {
  const body = fetchCalls[index]?.[1]?.body;
  return new URLSearchParams(String(body));
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchCalls = [];
  sessionStorage.clear();
  localStorage.clear();
  // The failure paths now log their real reason here instead of putting it on
  // the URL, so the spy is what lets those tests assert the reason survived.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  // Explicit because vitest.config.ts sets `globals: false`, which is also what
  // switches off Testing Library's own auto-cleanup — it registers that through
  // a global afterEach that does not exist here. Without it every render stays
  // in the document and `locationText()` keeps reading the FIRST probe it
  // finds, so each case would be asserting against the previous case's
  // navigation. That is how this file failed on its first run.
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe('a callback carrying the code Cognito issued', () => {
  it('writes the session to the token store and leaves for the console', async () => {
    browserStartedTheFlow('/decks/edit?id=7');
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback(`?code=the-authorization-code&state=${OUR_STATE}`);

    await waitFor(() => expect(locationText()).toBe('/decks/edit?id=7'));

    // The record the rest of the console reads, not a spy on completeSignIn.
    // The refresh token in particular: it is the value phase A's interceptor
    // needs an hour from now, and it arrives only through this page.
    const stored = readStoredTokens();
    expect(stored).toMatchObject({
      accessToken: 'access-from-callback',
      idToken: 'id-from-callback',
      refreshToken: 'refresh-from-callback',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(stored!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('completes PKCE by sending back the verifier it kept', async () => {
    browserStartedTheFlow();
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback(`?code=the-authorization-code&state=${OUR_STATE}`);

    await waitFor(() => expect(fetchCalls).toHaveLength(1));

    const [url, init] = fetchCalls[0];
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(init?.method).toBe('POST');

    const form = sentForm();
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-authorization-code');
    expect(form.get('client_id')).toBe('callback-tests-client');
    expect(form.get('redirect_uri')).toBe('http://localhost:5173/auth/callback');
    // The half of PKCE this page is responsible for. Without it the exchange is
    // a bare code grant on a public client, which is the attack PKCE exists for.
    expect(form.get('code_verifier')).toBe(OUR_VERIFIER);

    // And it goes in the body, not the query string: a verifier in a URL is
    // written to every proxy log between here and Cognito.
    expect(url).not.toContain(OUR_VERIFIER);
  });

  it('spends the one-time values, so a replayed callback has nothing to reuse', async () => {
    browserStartedTheFlow();
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback(`?code=the-authorization-code&state=${OUR_STATE}`);

    await waitFor(() => expect(readStoredTokens()).not.toBeNull());

    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBeNull();
    expect(sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBeNull();
  });
});

describe('the destination remembered across the round trip', () => {
  it('is sanitised on the way out, not only on the way in', async () => {
    // The stored value is written by LoginPage before the browser leaves, and
    // this page reads it back after a full navigation through a third party.
    // Anything that can write one key of this origin's sessionStorage owns that
    // value, so `//evil.com/pwn` — protocol-relative, and a path by the only
    // test the old code applied — has to be refused HERE too. src/auth/
    // safeRedirect.ts is the shared answer; this asserts the page is wired to
    // it rather than that the function exists.
    browserStartedTheFlow('//evil.com/pwn');
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback(`?code=the-authorization-code&state=${OUR_STATE}`);

    await waitFor(() => expect(readStoredTokens()).not.toBeNull());

    expect(locationText()).toBe('/');
    expect(locationText()).not.toContain('evil.com');
  });

  it('falls back to the console when nothing was remembered', async () => {
    // A callback reached without a stored destination — a bookmark, a second
    // tab, a storage that was cleared mid-flow. There is still a session, so
    // the answer is the front door rather than an error.
    sessionStorage.setItem(PKCE_VERIFIER_KEY, OUR_VERIFIER);
    sessionStorage.setItem(PKCE_STATE_KEY, OUR_STATE);
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback(`?code=the-authorization-code&state=${OUR_STATE}`);

    await waitFor(() => expect(locationText()).toBe('/'));
    expect(readStoredTokens()).not.toBeNull();
  });
});

describe('a callback that must not become a session', () => {
  it('refuses a state this browser did not issue, without asking the network', async () => {
    // The CSRF check. A code injected by a third party arrives with a state
    // they chose; spending it would sign this browser into their account. The
    // strong half of the assertion is that NO request goes out — a version
    // that exchanged first and checked afterwards would still end up on
    // /login while having burned a real code.
    browserStartedTheFlow();
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback('?code=a-code-someone-else-obtained&state=not-the-state-we-issued');

    await waitFor(() => expect(locationText()).toContain('/login?error='));

    expect(fetchCalls).toEqual([]);
    expect(readStoredTokens()).toBeNull();
    // The URL now carries a stable code; the real reason went to the console.
    // Anything that rides the URL ends up rendered on the login screen, and
    // 'Invalid auth state' was the tame end of what an Error message can hold.
    expect(locationText()).toBe('/login?error=exchange_failed');
    expect(
      consoleError.mock.calls.some((call: unknown[]) => call.join(' ').includes('Invalid auth state')),
    ).toBe(true);
    // The keys are consumed even on this path, so a second attempt starts a
    // whole new flow rather than retrying against a state now known to be stale.
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
  });

  it('leaves no half-written session when the token endpoint refuses', async () => {
    browserStartedTheFlow();
    stubTokenEndpoint({ ok: false, status: 400, body: 'invalid_grant' });

    renderCallback(`?code=an-expired-code&state=${OUR_STATE}`);

    await waitFor(() => expect(locationText()).toContain('/login?error='));

    expect(readStoredTokens()).toBeNull();
    // Same split as the stale-state case above: stable code on the URL, the
    // HTTP status only in the console.
    expect(locationText()).toBe('/login?error=exchange_failed');
    expect(
      consoleError.mock.calls.some((call: unknown[]) => call.join(' ').includes('400')),
    ).toBe(true);
  });

  it('carries an error Cognito sent instead of a code straight to the login page', async () => {
    browserStartedTheFlow();
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback('?error=access_denied&error_description=User+cancelled');

    await waitFor(() => expect(locationText()).toContain('/login?'));

    // The code travels; the description does not. It is free text from a URL,
    // and the login page renders fixed copy per code, so forwarding it would
    // only preserve a string an attacker controls.
    expect(locationText()).toBe('/login?error=access_denied');
    expect(fetchCalls).toEqual([]);
    expect(readStoredTokens()).toBeNull();
  });

  it('says so when there is no code at all rather than starting an exchange', async () => {
    browserStartedTheFlow();
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderCallback('');

    await waitFor(() => expect(locationText()).toBe('/login?error=missing_code'));
    expect(fetchCalls).toEqual([]);
  });

  it('will not accept a token response that is missing a required field', async () => {
    // Cognito's own contract: the console reads id_token claims for the group
    // gating, so a response without one would produce a session that is
    // authenticated and permissionless — visibly signed in, refused everywhere.
    browserStartedTheFlow();
    stubTokenEndpoint({
      ok: true,
      status: 200,
      body: { access_token: 'a', expires_in: 3600, token_type: 'Bearer' },
    });

    renderCallback(`?code=the-authorization-code&state=${OUR_STATE}`);

    await waitFor(() => expect(locationText()).toContain('/login?error='));
    expect(readStoredTokens()).toBeNull();
  });
});

describe('the guard around the effect', () => {
  it('attempts the exchange once even though React mounts the effect twice', async () => {
    // An authorization code is single-use, and so is the PKCE pair beside it:
    // exchangeCodeForTokens deletes both keys before it validates them. A
    // second invocation therefore finds nothing, throws "Invalid auth state"
    // and redirects to /login — after the first one has already succeeded.
    // StrictMode is how the real application runs this page (src/main.tsx
    // mounts inside it), so the double invocation is production behaviour
    // rather than a test artefact.
    //
    // WHAT IS COUNTED, AND WHY IT IS NOT THE NAVIGATION.
    // The first version of this test asserted only the final location and the
    // fetch count. Removing the `ran` guard left it GREEN: the second
    // invocation never reaches the network — it throws on the missing state
    // first — so the fetch count stays 1, and which of the two navigations
    // lands last is a microtask race. Counting reads of the PKCE state key is
    // the observation that actually distinguishes one attempt from two, and it
    // does not depend on ordering.
    const readKeys = vi.spyOn(Storage.prototype, 'getItem');

    browserStartedTheFlow();
    stubTokenEndpoint({ ok: true, status: 200, body: cognitoTokens() });

    renderAt(
      <StrictMode>
        <AuthProvider>
          <AuthCallbackPage />
        </AuthProvider>
      </StrictMode>,
      [`/auth/callback?code=the-authorization-code&state=${OUR_STATE}`],
    );

    await waitFor(() => expect(locationText()).toBe('/decks/edit?id=7'));

    const stateReads = readKeys.mock.calls.filter(([key]) => key === PKCE_STATE_KEY).length;
    expect(stateReads).toBe(1);
    expect(fetchCalls).toHaveLength(1);

    readKeys.mockRestore();
  });
});
