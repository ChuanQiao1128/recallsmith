// mobile/src/api/apiClient.ts
type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/+$/, '');

function joinUrl(base: string, path: string) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function apiJson<T>(
  path: string,
  opts: {
    method?: ApiMethod;
    accessToken: string;
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
    const resp = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${opts.accessToken}`,
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    const text = await resp.text();
    const json = text ? JSON.parse(text) : null;

    if (!resp.ok) {
      const msg =
        json?.error?.message ||
        json?.message ||
        `HTTP ${resp.status} ${resp.statusText}`;
      throw new Error(msg);
    }

    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}