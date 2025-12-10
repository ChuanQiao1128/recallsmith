// src/auth/tokenStore.ts
export type StoredTokens = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn: number;   // seconds
  expiresAt: number;   // epoch ms
};

export type SessionUser = {
  email?: string;
  username?: string;
  groups: string[];
};

const TOKEN_KEY = 'devcards:tokens';
const EXPIRY_SKEW_MS = 30_000;

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const b64url = parts[1];
    const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');

    const json = atob(b64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readGroupsFromPayload(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const raw = payload['cognito:groups'] ?? payload['groups'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  return [];
}

export function isExpired(tokens: StoredTokens): boolean {
  return Date.now() >= tokens.expiresAt - EXPIRY_SKEW_MS;
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** ✅ 兼容旧名字 */
export function clearStoredTokens(): void {
  clearTokens();
}

export function getTokens(): StoredTokens | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  const parsed = safeJsonParse<StoredTokens>(raw);
  if (!parsed || !parsed.accessToken || !parsed.idToken || !parsed.expiresAt) {
    clearTokens();
    return null;
  }

  if (isExpired(parsed)) {
    clearTokens();
    return null;
  }

  return parsed;
}

/** ✅ 兼容旧名字：直接拿 access token（没有或过期则 null） */
export function getAccessToken(): string | null {
  return getTokens()?.accessToken ?? null;
}

export function getIdToken(): string | null {
  return getTokens()?.idToken ?? null;
}

export function saveTokens(input: {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn: number;
  expiresAt?: number;
}): StoredTokens {
  const expiresAt =
    typeof input.expiresAt === 'number'
      ? input.expiresAt
      : Date.now() + input.expiresIn * 1000;

  const stored: StoredTokens = {
    accessToken: input.accessToken,
    idToken: input.idToken,
    refreshToken: input.refreshToken,
    tokenType: input.tokenType,
    expiresIn: input.expiresIn,
    expiresAt,
  };

  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(stored));
  return stored;
}

/**
 * ✅ 兼容旧名字：setStoredTokens
 * 允许两种输入：
 * 1) 已经是 StoredTokens（包含 expiresAt）
 * 2) token + expiresIn（自动计算 expiresAt）
 */
export function setStoredTokens(input: StoredTokens | {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn: number;
  expiresAt?: number;
}): StoredTokens {
  const v = input as StoredTokens;
  if (typeof v.expiresAt === 'number' && typeof v.expiresIn === 'number') {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(v));
    return v;
  }

  const i = input as {
    accessToken: string;
    idToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn: number;
    expiresAt?: number;
  };
  return saveTokens(i);
}

/** ⚠️ 常见坑：groups 可能在 access token，不一定在 id token */
export function getUserGroups(tokens?: StoredTokens | null): string[] {
  const t = tokens ?? getTokens();
  if (!t) return [];

  const fromId = readGroupsFromPayload(decodeJwtPayload(t.idToken));
  if (fromId.length > 0) return fromId;

  return readGroupsFromPayload(decodeJwtPayload(t.accessToken));
}

export function getSessionUser(tokens?: StoredTokens | null): SessionUser | null {
  const t = tokens ?? getTokens();
  if (!t) return null;

  const payload = decodeJwtPayload(t.idToken) ?? decodeJwtPayload(t.accessToken);
  if (!payload) return null;

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const username =
    typeof payload['cognito:username'] === 'string'
      ? (payload['cognito:username'] as string)
      : typeof payload.username === 'string'
        ? (payload.username as string)
        : undefined;

  return { email, username, groups: getUserGroups(t) };
}