import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveTokens } from '../../mcp-server/src/auth/tokens';
import { LOGIN_LIFETIME_DAYS, loginExpiresAt } from '../src/login';
import { fakeJwt, writeTokenFile } from './helpers';

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

describe('loginExpiresAt', () => {
  it('computes loginExpiresAt from auth_time plus 30 days', () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-runner-login-'));
    const file = join(dir, 'mcp-tokens.json');
    expect(LOGIN_LIFETIME_DAYS).toBe(30);

    writeTokenFile(file, { auth_time: 1_790_000_000, iat: 1_790_500_000 });
    expect(loginExpiresAt(file)).toBe(new Date((1_790_000_000 + 30 * 86_400) * 1000).toISOString());

    // iat is the fallback when auth_time is absent.
    writeTokenFile(file, { iat: 1_790_500_000 });
    expect(loginExpiresAt(file)).toBe(new Date((1_790_500_000 + 30 * 86_400) * 1000).toISOString());

    writeTokenFile(file, { sub: 'no-time-claims' });
    expect(loginExpiresAt(file)).toBeNull();

    const tokens = { accessToken: 'PLACEHOLDER-a', refreshToken: 'PLACEHOLDER-r', expiresAt: 0 };
    saveTokens(file, { ...tokens, idToken: 'not-a-jwt' });
    expect(loginExpiresAt(file)).toBeNull();
    saveTokens(file, { ...tokens, idToken: `${fakeJwt({}).split('.')[0]}.%%%.x` });
    expect(loginExpiresAt(file)).toBeNull();

    writeFileSync(file, 'not json');
    expect(loginExpiresAt(file)).toBeNull();

    expect(loginExpiresAt(join(dir, 'missing.json'))).toBeNull();
  });
});
