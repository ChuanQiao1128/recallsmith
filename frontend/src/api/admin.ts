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

/**
 * One console account as core-vpc knows it: the Cognito sub its deck permissions are stored under
 * (table admin_deck_permissions). The account itself lives in the console Cognito pool, which the
 * console no longer reads: see "Users" below.
 */
export type AdminPermissionHolder = {
  sub: string;
  deckPermissions: AdminDeckPermission[];
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

// Console accounts (list, create, disable, delete) are not managed from the console any more. They
// used to go through edge-public's Cognito admin routes; edge-public was retired on 2026-10-04
// (R27 EDGE) and the owner now runs the aws cognito-idp commands in infra/RUNBOOK.md §14.
// What the console still manages is core-vpc's deck permissions, keyed by an account's Cognito sub,
// so the accounts listed here are the subs that hold at least one deck permission.

type AdminPermissionRow = {
  adminSub?: unknown;
  deckId?: unknown;
  deckSlug?: unknown;
  deckTitle?: unknown;
  locale?: unknown;
  canRead?: unknown;
  canWrite?: unknown;
};

function optionalString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export async function listAdminPermissionHolders(): Promise<ApiResult<AdminPermissionHolder[]>> {
  const res = await apiGet<unknown>('/api/v1/admin/permissions');
  if (!res.success) return { ...res, data: null };
  if (!Array.isArray(res.data)) {
    return failResult<AdminPermissionHolder[]>('Unexpected response from /api/v1/admin/permissions.', 'BAD_RESPONSE');
  }

  // core-vpc returns one row per (sub, deck), ordered by sub; a Map keeps that order.
  const bySub = new Map<string, AdminDeckPermission[]>();
  for (const raw of res.data as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as AdminPermissionRow;
    const sub = typeof row.adminSub === 'string' ? row.adminSub.trim() : '';
    if (sub === '') continue;

    const perms = bySub.get(sub) ?? [];
    perms.push({
      deckId: Number(row.deckId),
      deckSlug: optionalString(row.deckSlug),
      deckTitle: optionalString(row.deckTitle),
      locale: optionalString(row.locale),
      canRead: !!row.canRead,
      canWrite: !!row.canWrite,
    });
    bySub.set(sub, perms);
  }

  return {
    ...res,
    data: [...bySub].map(([sub, deckPermissions]) => ({ sub, deckPermissions })),
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
