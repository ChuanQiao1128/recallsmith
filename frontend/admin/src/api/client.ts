const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5121';
const MOCK = (import.meta.env.VITE_MOCK ?? '0') === '1';

export type ApiError = { code: string; message: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!resp.ok) {
    let msg = `${resp.status} ${resp.statusText}`;
    try {
      const j = await resp.json();
      if (j?.error?.message) msg = j.error.message;
    } catch {
      // Failed to parse JSON error response, use default message
    }
    throw new Error(msg);
  }
  if (resp.status === 204) return undefined as unknown as T;
  return (await resp.json()) as T;
}

export const http = { request, API_BASE, MOCK };