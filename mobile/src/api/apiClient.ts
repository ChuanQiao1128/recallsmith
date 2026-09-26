// mobile/src/api/apiClient.ts
import { resolveApiBase, resolveApiFallback } from '../config/hosts';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type ApiOpts = {
  method?: ApiMethod;
  accessToken?: string | null; // ✅ now optional
  body?: any;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

// The base that last answered. Null until a request settles, so every process starts
// on the primary hostname; a network failure there moves it to the fallback for the
// rest of the process, and a failure on the fallback sends the next call back to the
// primary (E09, E00 §2.9.4).
let activeBase: string | null = null;

/** Test seam: forget the remembered base. */
export function resetApiBaseForTests(): void {
  activeBase = null;
}

function joinUrl(base: string, path: string) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function safeJsonParse(text: string): any | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** A thrown TypeError is how fetch reports "could not reach the host" (DNS, TLS,
 *  connection refused). Aborts (timeouts) and HTTP statuses are never TypeErrors. */
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}

async function requestOnce<T>(base: string, path: string, opts: ApiOpts): Promise<T> {
  const url = joinUrl(base, path);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(opts.headers || {}),
    };

    const token = (opts.accessToken ?? '').trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const resp = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    const text = await resp.text();
    const json = safeJsonParse(text);

    if (!resp.ok) {
      const msg =
        json?.error?.message ||
        json?.error ||
        json?.message ||
        (typeof text === 'string' && text.trim() ? text.trim() : null) ||
        `HTTP ${resp.status} ${resp.statusText}`;
      // Attach status/code so callers can react to specific rejections
      // (e.g. a 400 on a stale sync cursor) — additive, message unchanged.
      const err: any = new Error(msg);
      err.status = resp.status;
      err.apiErrorCode = typeof json?.error?.code === 'string' ? json.error.code : null;
      throw err;
    }

    // 有些接口可能返回空 body，这里保持和之前一致：空就返回 null
    return (json as T) ?? (null as any);
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiJson<T>(path: string, opts: ApiOpts): Promise<T> {
  const primary = resolveApiBase();
  const fallback = resolveApiFallback();
  const base = activeBase ?? primary;

  try {
    const out = await requestOnce<T>(base, path, opts);
    activeBase = base;
    return out;
  } catch (e) {
    const canRetry = base === primary && !!fallback && fallback !== primary && isNetworkError(e);
    if (!canRetry) {
      if (base !== primary) activeBase = null;
      throw e;
    }
    try {
      const out = await requestOnce<T>(fallback as string, path, opts);
      activeBase = fallback;
      return out;
    } catch (e2) {
      activeBase = null;
      throw e2;
    }
  }
}
