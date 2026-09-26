// src/api/admin.ts
// Admin console API, served under /api/v1/.
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

export type AdminDeckPermission = {
  deckId: number;
  deckSlug: string | null;
  deckTitle: string | null;
  locale: string | null;
  canRead: boolean;
  canWrite: boolean;
};

export type AdminUser = {
  username: string;
  sub?: string | null;
  email?: string | null;
  enabled?: boolean;
  status?: string | null;
  groups?: string[];
  createdAt?: number;
  deckPermissions?: AdminDeckPermission[];
};

export type DeckSummary = {
  id: number;
  slug: string;
  title: string;
  author?: string | null;
  description?: string | null;
  locale?: string | null;
  deckType?: number | null;
  version?: number | null;
  isDeleted?: number | boolean;
  createdAt?: string;
  updatedAt?: string;
};

async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const resp = await http.get<ApiResult<T>>(path);
    return resp.data;
  } catch (err) {
    return apiResultFromError<T>(err);
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const resp = await http.post<ApiResult<T>>(path, body ?? {});
    return resp.data;
  } catch (err) {
    return apiResultFromError<T>(err);
  }
}

// ==================== Migrate ====================

export type MigrateResult = { dryRun?: boolean; appliedCount?: number; latestAvailable?: number };

// `secret` is the API's MIGRATE_SECRET (src_C/Vpc/Db/Migrate.cs:138 — the extra
// guard on top of super_admin). When the Lambda has one configured, the request
// must carry it as `x-migrate-secret` or the API answers 403 "Bad migrate secret";
// when it has none, the header must be absent, so the no-secret call is byte-for-
// byte the old `http.post(path, {})` (adminConsoleRequests.test.tsx pins it).
export async function runMigrate(secret?: string): Promise<ApiResult<MigrateResult>> {
  const path = '/api/v1/admin/db/migrate';
  const trimmed = secret?.trim() ?? '';
  if (trimmed === '') return apiPost(path, {});
  try {
    const resp = await http.post<ApiResult<MigrateResult>>(path, {}, { headers: { 'x-migrate-secret': trimmed } });
    return resp.data;
  } catch (err) {
    return apiResultFromError<MigrateResult>(err);
  }
}

// ==================== Users ====================

// The console's user list is served by edge-public at /api/v1/admin/cognito/users,
// not by core-vpc (which has no admin-users route). The live edge-public is Node
// and its source is not in this repo, so the client accepts three shapes: the
// documented AdminUser, a { users | items } wrapper, or the raw Cognito UserType.
// Anything else surfaces as BAD_RESPONSE rather than a silently empty table.
const ADMIN_USERS_PATH = '/api/v1/admin/cognito/users';

function attributeValue(raw: Record<string, unknown>, name: string): string | null {
  const attrs = raw.Attributes;
  if (!Array.isArray(attrs)) return null;
  for (const a of attrs) {
    if (a && typeof a === 'object' && (a as { Name?: unknown }).Name === name) {
      const v = (a as { Value?: unknown }).Value;
      return typeof v === 'string' ? v : null;
    }
  }
  return null;
}

function normalizeAdminUser(raw: unknown): AdminUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const usernameRaw = o.username ?? o.Username;
  if (typeof usernameRaw !== 'string' || usernameRaw === '') return null;

  const sub = typeof o.sub === 'string' ? o.sub : attributeValue(o, 'sub');
  const email = typeof o.email === 'string' ? o.email : attributeValue(o, 'email');

  const enabledRaw = o.enabled ?? o.Enabled;
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : undefined;

  const statusRaw = o.status ?? o.UserStatus;
  const status = typeof statusRaw === 'string' ? statusRaw : undefined;

  const groups = Array.isArray(o.groups)
    ? o.groups.filter((g): g is string => typeof g === 'string')
    : [];

  const createdRaw = o.createdAt ?? o.UserCreateDate;
  let createdAt: number | undefined;
  if (typeof createdRaw === 'number' && Number.isFinite(createdRaw)) {
    createdAt = createdRaw;
  } else if (typeof createdRaw === 'string') {
    const parsed = Date.parse(createdRaw);
    if (Number.isFinite(parsed)) createdAt = parsed;
  }

  return { username: usernameRaw, sub, email, enabled, status, groups, createdAt };
}

function extractAdminUsers(data: unknown): AdminUser[] | null {
  let arr: unknown[];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === 'object' && Array.isArray((data as { users?: unknown }).users)) {
    arr = (data as { users: unknown[] }).users;
  } else if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    arr = (data as { items: unknown[] }).items;
  } else {
    return null;
  }
  return arr.map(normalizeAdminUser).filter((u): u is AdminUser => u !== null);
}

export async function listAdminUsers(): Promise<ApiResult<AdminUser[]>> {
  // users come from edge-public (Cognito admin),
  // permissions from vpc-lambda.
  const [usersRes, permsRes] = await Promise.all([
    apiGet<unknown>(ADMIN_USERS_PATH),
    apiGet<Array<{ adminSub?: string; deckId?: unknown; deckSlug?: string; deckTitle?: string; locale?: string; canRead?: boolean; canWrite?: boolean }>>('/api/v1/admin/permissions'),
  ]);

  if (!usersRes.success) return { ...usersRes, data: null };

  const users = extractAdminUsers(usersRes.data);
  if (users === null) {
    return failResult<AdminUser[]>('Unexpected response from /api/v1/admin/cognito/users.', 'BAD_RESPONSE');
  }

  if (!permsRes.success) {
    return { ...usersRes, data: users.map(u => ({ ...u, deckPermissions: [] })) };
  }

  const bySub = new Map<string, AdminDeckPermission[]>();
  for (const p of permsRes.data ?? []) {
    const sub = p.adminSub;
    if (!sub) continue;

    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub)!.push({
      deckId: Number(p.deckId),
      deckSlug: p.deckSlug ?? null,
      deckTitle: p.deckTitle ?? null,
      locale: p.locale ?? null,
      canRead: !!p.canRead,
      canWrite: !!p.canWrite,
    });
  }

  return {
    ...usersRes,
    data: users.map(u => ({
      ...u,
      deckPermissions: u.sub ? (bySub.get(u.sub) ?? []) : [],
    })),
  };
}

export async function createAdminUser(input: {
  username: string;
  email: string;
  tempPassword: string;
  groups: string[];
}): Promise<ApiResult<AdminUser>> {
  const res = await apiPost<unknown>(ADMIN_USERS_PATH, input);
  if (!res.success) return { ...res, data: null };
  return {
    ...res,
    data: normalizeAdminUser(res.data) ?? { username: input.username, email: input.email },
  };
}

// ==================== Decks ====================

export async function listAdminDecks(includeDeleted = false): Promise<ApiResult<DeckSummary[]>> {
  const qs = includeDeleted ? '?includeDeleted=1' : '';
  return apiGet<DeckSummary[]>(`/api/v1/authoring/decks${qs}`);
}

// ==================== Permissions ====================

export async function saveAdminDeckPermissionsBulk(input: {
  adminSub: string;
  permissions: Array<{ deckId: number; canRead: boolean; canWrite: boolean }>;
  mode?: 'replace' | 'merge';
}): Promise<ApiResult<{ saved: number; replace: boolean }>> {
  return apiPost<{ saved: number; replace: boolean }>('/api/v1/admin/permissions/bulk', input);
}
