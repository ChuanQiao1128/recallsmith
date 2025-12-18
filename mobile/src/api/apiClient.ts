// mobile/src/api/apiClient.ts
type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/+$/, '');

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
      throw new Error(msg);
    }

    // 有些接口可能返回空 body，这里保持和之前一致：空就返回 null
    return (json as T) ?? (null as any);
  } finally {
    clearTimeout(timeout);
  }
}