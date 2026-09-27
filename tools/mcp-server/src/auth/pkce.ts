// PKCE (RFC 7636) with the S256 method, as the console does in frontend/src/auth/pkce.ts.

import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url: a 43-character verifier. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** base64url(SHA-256(verifier)). */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
