// mobile/src/api/apiClient.ts
import { classifyError } from './errorKind';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/+$/, '');

function joinUrl(base: string, path: string) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

// Injected 401 recovery. apiClient must not import auth code (would create an
// import cycle authStore -> apiClient -> authStore), so freshToken.ts installs
// a refresher here. Returns a fresh access token (or null when it cannot).
let _accessTokenRefresher: (() => Promise<string | null>) | null = null;

export function setAccessTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  _accessTokenRefresher = fn;
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

export async function apiJson<T>(
  path: string,
  opts: {
    method?: ApiMethod;
    accessToken?: string | null; // ✅ now optional
    body?: any;
    timeoutMs?: number;
    headers?: Record<string, string>;
  },
): Promise<T> {
  if (!API_BASE) throw new Error('Missing EXPO_PUBLIC_API_BASE');

  const url = joinUrl(API_BASE, path);

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

    // Wrap fetch so a transport rejection (offline) or an AbortController abort
    // (our 12 s timeout) escapes as a classified Error instead of a raw
    // `TypeError('Network request failed')` or an unlabelled abort. The re-sent
    // 401 request below goes through the same wrapper, so it is classified too.
    const send = async (authToken: string): Promise<Response> => {
      try {
        return await fetch(url, {
          method: opts.method ?? 'GET',
          headers: authToken
            ? { ...headers, Authorization: `Bearer ${authToken}` }
            : headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
      } catch (cause: any) {
        const aborted = cause?.name === 'AbortError';
        const err: any = new Error(aborted ? 'Request timed out' : cause?.message ?? 'Network request failed', {
          cause,
        });
        err.kind = aborted ? 'timeout' : 'offline';
        throw err;
      }
    };

    let resp = await send(token);

    // A 401 on a request that carried a bearer token usually means the access
    // token expired mid-session. Refresh once (via the injected refresher) and
    // replay the same request with the new token. Never retry more than once,
    // and never a request that was sent without a token.
    if (resp.status === 401 && token && _accessTokenRefresher) {
      const fresh = await _accessTokenRefresher().catch(() => null);
      const next = (fresh ?? '').trim();
      if (next && next !== token) {
        resp = await send(next);
      }
    }

    const text = await resp.text();
    const json = safeJsonParse(text);

    if (!resp.ok) {
      // Build the message from string candidates only, so an object payload
      // like `{ error: { code: 'X' } }` never stringifies to '[object Object]'
      // (MSHELL-10). Fall back to a truncated body, then a synthetic HTTP line.
      const pickString = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() ? value.trim() : null;
      const bodyText = typeof text === 'string' && text.trim() ? text.trim().slice(0, 200) : null;
      const msg =
        pickString(json?.error?.message) ||
        pickString(json?.error) ||
        pickString(json?.message) ||
        bodyText ||
        `HTTP ${resp.status} ${resp.statusText}`;
      // Attach status/code so callers can react to specific rejections
      // (e.g. a 400 on a stale sync cursor) — additive, status/code unchanged.
      const err: any = new Error(msg);
      err.status = resp.status;
      err.apiErrorCode = typeof json?.error?.code === 'string' ? json.error.code : null;
      err.kind = classifyError({ status: resp.status });
      throw err;
    }

    // 有些接口可能返回空 body，这里保持和之前一致：空就返回 null
    return (json as T) ?? (null as any);
  } finally {
    clearTimeout(timeout);
  }
}