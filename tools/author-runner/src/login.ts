// loginExpiresAt (A00 §11.3 step 3): the console-dev refresh token lasts 30 days
// from sign-in, so the login expires at auth_time (else iat) of the stored id token
// plus 30 days. The token is decoded without verification and never logged or returned.

import { readTokens } from '../../mcp-server/src/auth/tokens';

export const LOGIN_LIFETIME_DAYS = 30;

function signInSeconds(idToken: string): number | null {
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts[1] === undefined || parts[1] === '') return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const claims = payload as { auth_time?: unknown; iat?: unknown };
  for (const value of [claims.auth_time, claims.iat]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function loginExpiresAt(tokenFile: string): string | null {
  try {
    const tokens = readTokens(tokenFile);
    if (tokens === null) return null;
    const seconds = signInSeconds(tokens.idToken);
    if (seconds === null) return null;
    const ms = seconds * 1000 + LOGIN_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}
