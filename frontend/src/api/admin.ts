// src/api/admin.ts
import type { ApiResult } from '../types/api';
import { http } from './http';
import axios from 'axios';

export type AdminUser = {
  username: string;
  email?: string | null;
  enabled?: boolean;
  status?: string | null;
  groups?: string[];
  createdAt?: number;
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

export async function listAdminUsers(): Promise<ApiResult<AdminUser[]>> {
  try {
    const resp = await http.get<ApiResult<AdminUser[]>>('/api/admin/users');
    return resp.data;
  } catch (err) {
    return fail<AdminUser[]>(toApiErrorMessage(err));
  }
}

export async function createAdminUser(input: {
  username: string;
  email: string;
  tempPassword: string;
  groups: string[];
}): Promise<ApiResult<AdminUser>> {
  try {
    const resp = await http.post<ApiResult<AdminUser>>('/api/admin/users', input);
    return resp.data;
  } catch (err) {
    return fail<AdminUser>(toApiErrorMessage(err));
  }
}