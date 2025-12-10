// src/auth/cognito.ts
import { AUTH_CONFIG, assertAuthConfig } from './authConfig';
import { pkceChallenge, randomVerifier } from './pkce';

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
  sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, nextUrl);

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

export function consumePostLoginRedirect(): string {
  const next = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY) ?? '/';
  sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  return next;
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