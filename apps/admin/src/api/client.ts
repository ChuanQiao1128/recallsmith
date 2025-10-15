const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5121';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

export async function http<TRes>(path: string, init?: RequestInit): Promise<TRes> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let code: string | undefined;
    let msg: string | undefined;
    try {
      const data = await res.json();
      code = data?.error?.code;
      msg = data?.error?.message;
    } catch { /* ignore */ }
    throw new ApiError(res.status, code, msg);
  }
  // 有些 204/空响应
  if (res.status === 204) return undefined as unknown as TRes;
  return res.json() as Promise<TRes>;
}

export async function parseApiError(e: unknown) {
  if (e instanceof ApiError) {
    return e.code ? `${e.code}: ${e.message}` : e.message;
  }
  return (e as Error)?.message ?? 'Unexpected error';
}