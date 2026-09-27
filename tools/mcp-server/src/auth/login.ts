// `login`: authorization code + PKCE (S256) against the console pool's console-dev
// public client, with a one-shot loopback listener on 127.0.0.1 for the redirect.

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Config } from '../config';
import { computeCodeChallenge, createCodeVerifier } from './pkce';
import { postTokenForm, saveTokens, tokensFromResponse } from './tokens';

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export function buildAuthorizeUrl(
  config: Config,
  p: { redirectUri: string; state: string; challenge: string },
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: p.redirectUri,
    scope: 'openid email profile',
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
  });
  return `${config.cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

function page(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>DeveloperCards login</title><p>${text}</p>\n`);
}

export async function runLogin(
  config: Config,
  deps: { openBrowser: (url: string) => void | Promise<void>; timeoutMs?: number },
): Promise<void> {
  const state = randomBytes(16).toString('base64url');
  const verifier = createCodeVerifier();
  let redirectUri = '';
  let handled = false;

  let resolveDone!: () => void;
  let rejectDone!: (err: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/callback') {
      page(res, 404, 'Not found.');
      return;
    }
    if (handled) {
      page(res, 400, 'This login attempt has already been handled.');
      return;
    }
    handled = true;

    const error = url.searchParams.get('error');
    if (error !== null) {
      page(res, 400, 'Login failed. Return to the terminal for details.');
      rejectDone(new Error(`authorization failed: ${error}`));
      return;
    }
    if (url.searchParams.get('state') !== state) {
      page(res, 400, 'Login failed: the state parameter does not match this login attempt.');
      rejectDone(new Error('authorization failed: state mismatch'));
      return;
    }
    const code = url.searchParams.get('code');
    if (code === null || code === '') {
      page(res, 400, 'Login failed: no authorization code.');
      rejectDone(new Error('authorization failed: no code in the callback'));
      return;
    }
    try {
      const response = await postTokenForm(config, {
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      saveTokens(config.tokenFile, tokensFromResponse(response));
    } catch (err) {
      page(res, 500, 'Login failed while exchanging the code. Return to the terminal for details.');
      rejectDone(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    page(res, 200, 'Login complete. You can close this tab.');
    resolveDone();
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) page(res, 500, 'Unexpected error.');
      rejectDone(err instanceof Error ? err : new Error(String(err)));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.redirectPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const timer = setTimeout(
    () => rejectDone(new Error('timed out waiting for the browser login')),
    deps.timeoutMs ?? LOGIN_TIMEOUT_MS,
  );
  // The callback can settle while openBrowser is still awaited: observe it now so a
  // rejection is never unhandled, and close the listener whatever the outcome.
  const settled = done.finally(() => {
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
  });
  settled.catch(() => undefined);

  try {
    const { port } = server.address() as AddressInfo;
    redirectUri = `http://localhost:${port}/callback`;
    const authorizeUrl = buildAuthorizeUrl(config, {
      redirectUri,
      state,
      challenge: computeCodeChallenge(verifier),
    });
    await deps.openBrowser(authorizeUrl);
  } catch (err) {
    rejectDone(err instanceof Error ? err : new Error(String(err)));
  }
  await settled;
}
