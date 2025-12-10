function b64UrlDecodeToString(b64url: string) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64);
}

export function decodeJwtPayload<T = unknown>(token: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const json = b64UrlDecodeToString(parts[1]);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export type AuthUser = {
  sub?: string;
  username?: string;
  email?: string;
  groups: string[];
};

export function userFromIdToken(idToken: string): AuthUser | null {
  const p = decodeJwtPayload<Record<string, unknown>>(idToken);
  if (!p) return null;

  const groupsRaw = p['cognito:groups'] ?? p['groups'] ?? [];
  const groups = Array.isArray(groupsRaw) ? groupsRaw : [];

  return {
    sub: typeof p.sub === 'string' ? p.sub : undefined,
    username: typeof p['cognito:username'] === 'string' ? p['cognito:username'] : typeof p.username === 'string' ? p.username : undefined,
    email: typeof p.email === 'string' ? p.email : undefined,
    groups,
  };
}