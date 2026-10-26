// src/auth/cognito.ts
import { AUTH_CONFIG, assertAuthConfig } from './authConfig';
import { pkceChallenge, randomVerifier } from './pkce';
import { sanitizeNextUrl } from './safeRedirect';

const PKCE_VERIFIER_KEY = 'devcards:pkce:verifier';
const PKCE_STATE_KEY = 'devcards:pkce:state';
const POST_LOGIN_REDIRECT_KEY = 'devcards:postLoginRedirect';

function makeState(): string {
  return randomVerifier(24);
}

export async function startLogin(nextUrl: string): Promise<void> {
  assertAuthConfig();

  const verifier = randomVerifier(64);
  const challenge = await pkceChallenge(verifier);
  const state = makeState();

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(PKCE_STATE_KEY, state);
  sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, sanitizeNextUrl(nextUrl));

  const qs = new URLSearchParams();
  qs.set('response_type', 'code');
  qs.set('client_id', AUTH_CONFIG.clientId);
  qs.set('redirect_uri', AUTH_CONFIG.redirectUri);
  qs.set('scope', AUTH_CONFIG.scopes.join(' '));
  qs.set('state', state);
  qs.set('code_challenge_method', 'S256');
  qs.set('code_challenge', challenge);

  window.location.assign(`${AUTH_CONFIG.domain}/oauth2/authorize?${qs.toString()}`);
}

export function buildLogoutUrl(): string {
  assertAuthConfig();
  const qs = new URLSearchParams();
  qs.set('client_id', AUTH_CONFIG.clientId);
  qs.set('logout_uri', AUTH_CONFIG.logoutUri);
  return `${AUTH_CONFIG.domain}/logout?${qs.toString()}`;
}

/**
 * Where to go now that sign-in finished, taken from storage and re-checked.
 *
 * Re-checked rather than trusted: the value went in at startLogin() time from
 * LoginPage's `?next=`, and AuthCallbackPage feeds whatever comes out straight
 * into navigate(). Sanitising only on the way in leaves the read side one
 * sessionStorage write away from an open redirect, and the write side of a
 * key in the same origin's storage is not a boundary this code controls. The
 * check is cheap and idempotent, so both ends run it.
 */
export function consumePostLoginRedirect(): string {
  const next = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
  sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  return sanitizeNextUrl(next);
}

export type OAuthTokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

export async function exchangeCodeForTokens(code: string, returnedState: string): Promise<OAuthTokenResponse> {
  assertAuthConfig();

  const expectedState = sessionStorage.getItem(PKCE_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);

  sessionStorage.removeItem(PKCE_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  if (!expectedState || returnedState !== expectedState) {
    throw new Error('Invalid auth state. Please try login again.');
  }
  if (!verifier) {
    throw new Error('Missing PKCE verifier. Please try login again.');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', AUTH_CONFIG.clientId);
  body.set('code', code);
  body.set('redirect_uri', AUTH_CONFIG.redirectUri);
  body.set('code_verifier', verifier);

  const resp = await fetch(`${AUTH_CONFIG.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`Token exchange failed: HTTP ${resp.status} ${text}`);

  const json = JSON.parse(text) as Partial<OAuthTokenResponse>;
  if (!json.access_token || !json.id_token || !json.expires_in || !json.token_type) {
    throw new Error('Token response missing required fields.');
  }
  return json as OAuthTokenResponse;
}

export class TokenRefreshError extends Error {
  readonly kind: 'temporary' | 'permanent';
  readonly status?: number;
  readonly oauthError?: string;

  constructor(kind: 'temporary' | 'permanent', status?: number, oauthError?: string) {
    super(kind === 'permanent'
      ? 'Your session expired. Please sign in again.'
      : 'Unable to refresh your session right now. Please try again.');
    this.name = 'TokenRefreshError';
    this.kind = kind;
    this.status = status;
    this.oauthError = oauthError;
  }
}

/**
 * Trade a refresh token for a fresh access + id token pair.
 *
 * The refresh grant takes no PKCE verifier and no client secret: this is a
 * public Cognito app client, so the body is client_id + refresh_token and
 * nothing else. It is the one OAuth call here that does not touch the PKCE
 * keys in sessionStorage, which is what makes it safe to fire from an
 * interceptor in the middle of an unrelated request.
 *
 * Callers must keep their existing refresh token unless the response carries a
 * replacement — see the note at the call site in src/api/http.ts. Cognito does
 * not rotate it on this grant, so the field is usually absent.
 */
export async function refreshTokens(refreshToken: string): Promise<OAuthTokenResponse> {
  assertAuthConfig();

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', AUTH_CONFIG.clientId);
  body.set('refresh_token', refreshToken);

  const controller = new AbortController();
  // Axios's request deadline does not cover this preflight fetch or its body.
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`${AUTH_CONFIG.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    const text = await resp.text();
    if (!resp.ok) {
      let oauthError: string | undefined;
      try {
        const payload = JSON.parse(text) as { error?: unknown } | null;
        if (typeof payload?.error === 'string') oauthError = payload.error;
      } catch { /* An outage may return HTML rather than OAuth JSON. */ }
      // Only an explicit grant rejection proves the stored session is dead.
      // Provider outages/rate limits take precedence over a contradictory body.
      const permanent = resp.status >= 400 && resp.status < 500 && resp.status !== 429 && oauthError === 'invalid_grant';
      throw new TokenRefreshError(permanent ? 'permanent' : 'temporary', resp.status, oauthError);
    }

    const json = JSON.parse(text) as Partial<OAuthTokenResponse> | null;
    // The console needs id_token claims for group gating, too.
    if (!json?.access_token || !json.id_token || !json.expires_in || !json.token_type) {
      throw new TokenRefreshError('temporary');
    }
    return json as OAuthTokenResponse;
  } catch (err) {
    if (err instanceof TokenRefreshError) throw err;
    // Network, timeout and malformed responses do not revoke a refresh token.
    throw new TokenRefreshError('temporary');
  } finally {
    clearTimeout(timeout);
  }
}
