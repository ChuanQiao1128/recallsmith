// src/auth/pkce.ts
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomVerifier(byteLength = 64): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Legacy name for randomVerifier(64). */
export function generateCodeVerifier(): string {
  return randomVerifier(64);
}
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  return pkceChallenge(verifier);
}
export function randomState(): string {
  return randomVerifier(24);
}