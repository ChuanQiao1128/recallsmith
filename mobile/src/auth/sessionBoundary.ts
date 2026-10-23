// Kept free of authStore imports: API and auth share this boundary without a cycle.
let generation = 0;

export function getAuthSessionGeneration(): number {
  return generation;
}

export function invalidateAuthSession(): void {
  generation += 1;
}

/** Identity comparison only; the server remains responsible for JWT verification. */
export function accessTokenSubject(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = typeof globalThis.atob === 'function'
      ? globalThis.atob(padded)
      : typeof Buffer !== 'undefined' ? Buffer.from(padded, 'base64').toString('utf8') : null;
    const sub = json ? JSON.parse(json)?.sub : null;
    return typeof sub === 'string' && sub.trim() ? sub.trim() : null;
  } catch {
    return null;
  }
}
