// The token file: { accessToken, idToken, refreshToken, expiresAt } (epoch ms),
// written atomically with mode 0600 in a 0700 directory. Token values never
// appear in a log line, an error message or a tool result.

import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from '../config';

export interface StoredTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Cognito's /oauth2/token response (only the fields used here). */
export interface TokenResponse {
  access_token?: unknown;
  id_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

/** Thrown when there is no usable session; the message is safe to show and never holds a token. */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/** Refresh when less than this much lifetime remains. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function saveTokens(file: string, tokens: StoredTokens): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
  chmodSync(file, 0o600);
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === 'string' &&
    typeof v.idToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresAt === 'number'
  );
}

/** null when the file is missing; throws AuthRequiredError when it is unreadable or malformed. */
export function readTokens(file: string): StoredTokens | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AuthRequiredError('the token file cannot be read');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AuthRequiredError('the token file is not valid JSON');
  }
  if (!isStoredTokens(parsed)) throw new AuthRequiredError('the token file has an unexpected shape');
  return parsed;
}

/** POSTs a form to <cognitoDomain>/oauth2/token; errors name the HTTP status and OAuth error code only. */
export async function postTokenForm(config: Config, form: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`${config.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText;
    throw new Error(`token endpoint answered HTTP ${res.status} ${code}`);
  }
  if (typeof body !== 'object' || body === null) throw new Error('token endpoint returned no JSON');
  return body as TokenResponse;
}

/** Builds the stored shape from a token response; `previous` supplies what Cognito omits on refresh. */
export function tokensFromResponse(response: TokenResponse, previous?: StoredTokens): StoredTokens {
  const accessToken = typeof response.access_token === 'string' ? response.access_token : undefined;
  const idToken = typeof response.id_token === 'string' ? response.id_token : previous?.idToken;
  const refreshToken = typeof response.refresh_token === 'string' ? response.refresh_token : previous?.refreshToken;
  const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : Number(response.expires_in);
  if (accessToken === undefined || idToken === undefined || refreshToken === undefined || !Number.isFinite(expiresIn)) {
    throw new Error('token endpoint response is missing a token or expires_in');
  }
  return { accessToken, idToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 };
}

/** The current access token, refreshed (and saved) when less than five minutes remain. */
export async function getAccessToken(config: Config): Promise<string> {
  const tokens = readTokens(config.tokenFile);
  if (tokens === null) throw new AuthRequiredError('no token file');
  if (tokens.expiresAt - Date.now() >= REFRESH_MARGIN_MS) return tokens.accessToken;

  let refreshed: StoredTokens;
  try {
    const response = await postTokenForm(config, {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: tokens.refreshToken,
    });
    refreshed = tokensFromResponse(response, tokens);
  } catch (err) {
    throw new AuthRequiredError(`the session could not be refreshed (${err instanceof Error ? err.message : String(err)})`);
  }
  saveTokens(config.tokenFile, refreshed);
  return refreshed.accessToken;
}
