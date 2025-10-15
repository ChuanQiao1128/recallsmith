import ky, { HTTPError } from 'ky';

const base = import.meta.env.VITE_API_BASE ?? 'http://localhost:5121';

export interface ApiErrorShape {
  error?: { code?: string; message?: string };
}

export async function parseApiError(e: unknown): Promise<string> {
  if (e instanceof HTTPError) {
    try {
      const j = await e.response.json<ApiErrorShape>();
      return j.error?.message ?? `${e.response.status} ${e.response.statusText}`;
    } catch {
      return `${e.response.status} ${e.response.statusText}`;
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export const api = ky.create({
  prefixUrl: base,
  headers: { 'Content-Type': 'application/json' }
});