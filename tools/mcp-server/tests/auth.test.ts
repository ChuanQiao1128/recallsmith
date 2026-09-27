import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthorizeUrl, runLogin } from '../src/auth/login';
import { computeCodeChallenge, createCodeVerifier } from '../src/auth/pkce';
import { getAccessToken, readTokens } from '../src/auth/tokens';
import { loadConfig } from '../src/config';
import {
  callTool,
  connect,
  envelope,
  makeTestEnv,
  sampleCard,
  sendJson,
  startFakeServer,
  TEST_ACCESS_TOKEN,
  TEST_ID_TOKEN,
  TEST_REFRESH_TOKEN,
  writeValidTokens,
  type FakeServer,
  type RecordedRequest,
  type TestEnv,
} from './helpers';

const LOGIN_ACCESS = 'test-login-access-token';
const LOGIN_ID = 'test-login-id-token';
const LOGIN_REFRESH = 'test-login-refresh-token';
const REFRESHED_ACCESS = 'test-refreshed-access-token';

function form(req: RecordedRequest): URLSearchParams {
  return new URLSearchParams(req.body);
}

describe('auth', () => {
  let env: TestEnv | undefined;
  const servers: FakeServer[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    while (servers.length > 0) await servers.pop()?.close();
    env?.cleanup();
    env = undefined;
  });

  it('derives the S256 code challenge of RFC 7636 appendix B', () => {
    expect(computeCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createCodeVerifier()).not.toBe(verifier);
  });

  it('builds the authorize URL for the console-dev client and the loopback redirect', () => {
    const config = loadConfig({ HOME: '/h' });
    const url = buildAuthorizeUrl(config, {
      redirectUri: 'http://localhost:8976/callback',
      state: 'state-1',
      challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    expect(url).toBe(
      'https://ap-southeast-24vf8ucxkt.auth.ap-southeast-2.amazoncognito.com/oauth2/authorize' +
        '?response_type=code&client_id=5au94igdq00nipsst7spsqepb7' +
        '&redirect_uri=http%3A%2F%2Flocalhost%3A8976%2Fcallback&scope=openid+email+profile' +
        '&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=state-1',
    );
  });

  it('completes the login callback and stores tokens with mode 0600', async () => {
    let challenge = '';
    let redirectUri = '';
    const cognito = await startFakeServer((req, res) => {
      const body = form(req);
      const valid =
        req.url === '/oauth2/token' &&
        body.get('grant_type') === 'authorization_code' &&
        body.get('client_id') === 'test-client' &&
        body.get('code') === 'test-auth-code' &&
        body.get('redirect_uri') === redirectUri &&
        computeCodeChallenge(body.get('code_verifier') ?? '') === challenge;
      if (!valid) return sendJson(res, 400, { error: 'invalid_grant' });
      sendJson(res, 200, {
        access_token: LOGIN_ACCESS,
        id_token: LOGIN_ID,
        refresh_token: LOGIN_REFRESH,
        expires_in: 3600,
        token_type: 'Bearer',
      });
    });
    servers.push(cognito);
    env = makeTestEnv({ cognitoDomain: cognito.base });
    const config = { ...env.config, clientId: 'test-client' };
    let callbackPage = '';

    const before = Date.now();
    await runLogin(config, {
      openBrowser: async (authorizeUrl) => {
        const url = new URL(authorizeUrl);
        expect(`${url.origin}${url.pathname}`).toBe(`${cognito.base}/oauth2/authorize`);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('client_id')).toBe('test-client');
        challenge = url.searchParams.get('code_challenge') ?? '';
        redirectUri = url.searchParams.get('redirect_uri') ?? '';
        expect(redirectUri).toMatch(/^http:\/\/localhost:\d+\/callback$/);
        const callback = new URL(redirectUri.replace('localhost', '127.0.0.1'));
        const other = await fetch(new URL('/favicon.ico', callback));
        expect(other.status).toBe(404);
        callback.searchParams.set('code', 'test-auth-code');
        callback.searchParams.set('state', url.searchParams.get('state') ?? '');
        const res = await fetch(callback);
        expect(res.status).toBe(200);
        callbackPage = await res.text();
      },
      timeoutMs: 10_000,
    });

    expect(callbackPage).toContain('Login complete. You can close this tab.');
    expect(statSync(config.tokenFile).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(config.tokenFile)).mode & 0o777).toBe(0o700);
    const stored = readTokens(config.tokenFile);
    expect(stored).toMatchObject({ accessToken: LOGIN_ACCESS, idToken: LOGIN_ID, refreshToken: LOGIN_REFRESH });
    expect(stored?.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(stored?.expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
    expect(cognito.requests).toHaveLength(1);
  });

  it('rejects a callback whose state does not match', async () => {
    const cognito = await startFakeServer((_req, res) => sendJson(res, 500, { error: 'should_not_be_called' }));
    servers.push(cognito);
    env = makeTestEnv({ cognitoDomain: cognito.base });
    const config = env.config;
    let status = 0;

    await expect(
      runLogin(config, {
        openBrowser: async (authorizeUrl) => {
          const url = new URL(authorizeUrl);
          const callback = new URL((url.searchParams.get('redirect_uri') ?? '').replace('localhost', '127.0.0.1'));
          callback.searchParams.set('code', 'test-auth-code');
          callback.searchParams.set('state', 'not-the-state');
          const res = await fetch(callback);
          status = res.status;
        },
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow(/state/);
    expect(status).toBe(400);
    expect(cognito.requests).toEqual([]);
    expect(readTokens(config.tokenFile)).toBeNull();
  });

  it('refreshes the access token when less than five minutes remain', async () => {
    const cognito = await startFakeServer((req, res) => {
      const body = form(req);
      if (
        req.url !== '/oauth2/token' ||
        body.get('grant_type') !== 'refresh_token' ||
        body.get('refresh_token') !== TEST_REFRESH_TOKEN ||
        body.get('client_id') !== env?.config.clientId
      ) {
        return sendJson(res, 400, { error: 'invalid_grant' });
      }
      sendJson(res, 200, { access_token: REFRESHED_ACCESS, id_token: 'test-refreshed-id-token', expires_in: 3600 });
    });
    servers.push(cognito);
    env = makeTestEnv({ cognitoDomain: cognito.base });

    // Plenty of lifetime left: no refresh.
    writeValidTokens(env.config, 10 * 60 * 1000);
    expect(await getAccessToken(env.config)).toBe(TEST_ACCESS_TOKEN);
    expect(cognito.requests).toHaveLength(0);

    // Four minutes left: refresh, keep the old refresh token, save.
    writeValidTokens(env.config, 4 * 60 * 1000);
    expect(await getAccessToken(env.config)).toBe(REFRESHED_ACCESS);
    expect(cognito.requests).toHaveLength(1);
    const stored = readTokens(env.config.tokenFile);
    expect(stored).toMatchObject({
      accessToken: REFRESHED_ACCESS,
      idToken: 'test-refreshed-id-token',
      refreshToken: TEST_REFRESH_TOKEN,
    });
    expect(stored?.expiresAt).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    expect(statSync(env.config.tokenFile).mode & 0o777).toBe(0o600);
  });

  it('never writes a token to a tool result or to stderr', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    // The token endpoint refuses the refresh and echoes the refresh token back in its error body.
    const cognito = await startFakeServer((req, res) =>
      sendJson(res, 400, { error: 'invalid_grant', error_description: `bad token ${form(req).get('refresh_token')}` }),
    );
    // The API rejects the bearer token and echoes it back.
    const api = await startFakeServer((req, res) => {
      if (req.url.startsWith('/api/v1/authoring/cards/similar')) {
        return sendJson(res, 200, envelope({ engine: 'fallback', threshold: 0.3, matches: [] }));
      }
      sendJson(res, 403, {
        success: false,
        data: null,
        error: { code: 'FORBIDDEN', message: `token ${req.headers.authorization ?? ''} rejected` },
      });
    });
    servers.push(cognito, api);
    env = makeTestEnv({ apiBase: api.base, cognitoDomain: cognito.base });
    const client = await connect(env.config);
    const texts: string[] = [];

    writeValidTokens(env.config);
    texts.push((await callTool(client, 'find_similar_cards', { text: 'S3 storage class' })).text);
    // A 403 whose API message quotes the token: surfaced with the token redacted.
    const forbidden = await callTool(client, 'submit_draft', { deckSlug: 'aws-saa-c03', drafts: [sampleCard()] });
    expect(forbidden).toEqual({ isError: true, text: 'HTTP 403 FORBIDDEN: token Bearer [redacted] rejected' });
    texts.push(forbidden.text);

    // Expired session whose refresh fails.
    writeValidTokens(env.config, 60 * 1000);
    const refreshFailed = await callTool(client, 'find_similar_cards', { text: 'S3 storage class' });
    expect(refreshFailed.isError).toBe(true);
    expect(refreshFailed.text).toContain('run `login`');
    texts.push(refreshFailed.text);
    await client.close();

    for (const text of [...texts, ...stderr]) {
      for (const token of [TEST_ACCESS_TOKEN, TEST_ID_TOKEN, TEST_REFRESH_TOKEN]) {
        expect(text).not.toContain(token);
      }
    }
    expect(readFileSync(env.config.tokenFile, 'utf8')).toContain(TEST_REFRESH_TOKEN);
  });
});
