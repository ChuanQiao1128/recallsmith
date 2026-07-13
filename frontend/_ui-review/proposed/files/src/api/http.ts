// src/api/http.ts
import axios from 'axios';
import { getAccessToken, clearStoredTokens } from '../auth/tokenStore';

const rawBase =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_BASE ??
  '';

// Use absolute base URLs when provided; otherwise rely on same-origin (works with Vite dev proxy)
const baseURL = typeof rawBase === 'string' ? rawBase.trim() : '';
const axiosBaseURL = /^https?:\/\//i.test(baseURL) ? baseURL : '';

export const http = axios.create({
  baseURL: axiosBaseURL,
  timeout: 15_000,
});

/**
 * Turn any thrown thing (axios error, network failure, plain Error) into a
 * user-facing message. Replaces the inline duplicates that used to live in
 * admin.ts and authoring.ts.
 *
 * Goals:
 *   - 401/403 → say something the user can act on, not the bare "Request failed"
 *   - network / no response → distinguish from server returning an error body
 *   - sanitize backend dev-leak text (TODO/FIXME/DEBUG) in production builds so
 *     internals like "TODO: admin users list" never reach the UI
 */
export function toApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;

    // Backend supplied an error body — use its message but sanitize.
    if (data && typeof data === 'object' && 'error' in data) {
      const errorData = data as { error?: { message?: string } };
      const raw = errorData?.error?.message;
      if (raw) return sanitizeBackendMessage(raw, status);
    }

    // No body (or unrecognized shape) — synthesize from status code.
    if (status === 401) return 'Your session has expired. Please sign in again.';
    if (status === 403) return "You don't have permission to access this resource.";
    if (status === 404) return 'Not found.';
    if (status === 408 || err.code === 'ECONNABORTED') return 'Request timed out. Please try again.';
    if (status && status >= 500) return `Server error (HTTP ${status}). Please try again later.`;
    if (!status) return 'Could not reach the server. Please check your connection.';
    return `Request failed (HTTP ${status}).`;
  }

  return err instanceof Error ? err.message : 'Network error.';
}

/**
 * Strip developer placeholder strings from backend error messages in production
 * so end-users never see "TODO: admin users list" or similar. In DEV we leave
 * them through so engineers see what the backend really said.
 */
function sanitizeBackendMessage(message: string, status: number | undefined): string {
  if (!import.meta.env.DEV) {
    if (/\b(TODO|FIXME|XXX|DEBUG)\b/i.test(message)) {
      if (status === 401) return 'Your session has expired. Please sign in again.';
      if (status === 403) return "You don't have permission to access this resource.";
      if (status && status >= 500) return `Server error (HTTP ${status}). Please try again later.`;
      return 'This feature is not available right now.';
    }
  }
  return message;
}

// attach bearer token
http.interceptors.request.use(cfg => {
  const token = getAccessToken();
  if (token) {
    cfg.headers = cfg.headers ?? {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// auto sign-out on 401
http.interceptors.response.use(
  res => res,
  err => {
    const status = err?.response?.status;
    if (status === 401) {
      clearStoredTokens();

      // 可选：跳回登录（如果你不想自动跳转，删掉这段）
      if (typeof window !== 'undefined') {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.assign(`/login?next=${next}&error=unauthorized`);
      }
    }
    return Promise.reject(err);
  },
);
