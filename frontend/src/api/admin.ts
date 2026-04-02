// src/api/admin.ts
// 管理后台 API - 使用 /api/v1/ 路径
import type { ApiResult } from '../types/api';
import { http } from './http';
import axios from 'axios';

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

function toApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    if (data && typeof data === 'object' && 'error' in data) {
      const errorData = data as { error?: { message?: string } };
      return errorData?.error?.message ?? `Request failed (HTTP ${status})`;
    }
    return `Request failed${status ? ` (HTTP ${status})` : ''}`;
  }
  return err instanceof Error ? err.message : 'Network error.';
}

function fail<T>(message: string, code = 'NETWORK_ERROR'): ApiResult<T> {
  return { success: false, data: null, error: { code, message }, traceId: '' };
}

async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const resp = await http.get<ApiResult<T>>(path);
    return resp.data;
  } catch (err) {
    return fail<T>(toApiErrorMessage(err));
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const resp = await http.post<ApiResult<T>>(path, body ?? {});
    return resp.data;
  } catch (err) {
    return fail<T>(toApiErrorMessage(err));
  }
}

// ==================== Migrate ====================

export async function runMigrate(reset: boolean): Promise<ApiResult<{ migrated: boolean; reset: boolean }>> {
  const qs = reset ? '?reset=1' : '';
  return apiPost(`/api/v1/admin/db/migrate${qs}`, {});
}

// ==================== Users ====================

export async function listAdminUsers(): Promise<ApiResult<AdminUser[]>> {
  // users 走 cognito-admin-lambda
  // permissions 走 vpc-lambda
  const [usersRes, permsRes] = await Promise.all([
    apiGet<AdminUser[]>('/api/v1/admin/users'),
    apiGet<Array<{ adminSub?: string; deckId?: unknown; deckSlug?: string; deckTitle?: string; locale?: string; canRead?: boolean; canWrite?: boolean }>>('/api/v1/admin/permissions'),
  ]);

  if (!usersRes.success) return usersRes;

  const users = usersRes.data ?? [];

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
  return apiPost<AdminUser>('/api/v1/admin/users', input);
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
