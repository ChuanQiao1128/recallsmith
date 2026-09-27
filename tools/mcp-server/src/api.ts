// A small client for the DeveloperCards API: global fetch, bearer token from the
// token file, envelope unwrapping (contract §4.1). Every failure is a ToolFailure
// with a one-line message that names the HTTP status and API error code and never
// contains a token.

import { AuthRequiredError, getAccessToken } from './auth/tokens';
import type { Config } from './config';

export const LOGIN_HINT =
  "run `login` (node tools/mcp-server/dist/index.js login); if this repeats right after a login, the API does not accept the console-dev client yet (R18 J06)";

const REQUEST_TIMEOUT_MS = 30_000;
const DECK_PAGE_LIMIT = 10;

export class ToolFailure extends Error {
  constructor(message: string) {
    super(message.replace(/[\r\n]+/g, ' '));
    this.name = 'ToolFailure';
  }
}

interface Envelope {
  success?: unknown;
  data?: unknown;
  error?: { code?: unknown; message?: unknown } | null;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'success' in value;
}

export interface ApiClient {
  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>;
  resolveDeckId(slug: string): Promise<number>;
}

export function createApiClient(config: Config): ApiClient {
  const deckIds = new Map<string, number>();

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let token: string;
    try {
      token = await getAccessToken(config);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        throw new ToolFailure(err.message === 'no token file' ? LOGIN_HINT : `HTTP 401: ${LOGIN_HINT} [${err.message}]`);
      }
      throw new ToolFailure(`HTTP 401: ${LOGIN_HINT} [${err instanceof Error ? err.message : String(err)}]`);
    }

    const pathOnly = path.split('?')[0] ?? path;
    let res: Response;
    try {
      res = await fetch(`${config.apiBase}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? (err.name === 'TimeoutError' ? 'timed out' : err.message) : String(err);
      throw new ToolFailure(`Network error calling ${pathOnly}: ${reason}`);
    }

    if (res.status === 401) throw new ToolFailure(`HTTP 401: ${LOGIN_HINT}`);

    let parsed: unknown = undefined;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }

    if (isEnvelope(parsed)) {
      if (res.ok && parsed.success === true) return parsed.data as T;
      const code = typeof parsed.error?.code === 'string' ? parsed.error.code : 'UNKNOWN_ERROR';
      const message = typeof parsed.error?.message === 'string' ? parsed.error.message : res.statusText;
      throw new ToolFailure(`HTTP ${res.status} ${code}: ${message}`);
    }
    if (!res.ok) throw new ToolFailure(`HTTP ${res.status}: ${res.statusText}`);
    throw new ToolFailure(`HTTP ${res.status}: ${pathOnly} did not return an API envelope`);
  }

  async function resolveDeckId(slug: string): Promise<number> {
    const cached = deckIds.get(slug);
    if (cached !== undefined) return cached;

    let cursor: string | null = null;
    for (let page = 0; page < DECK_PAGE_LIMIT; page++) {
      const params = new URLSearchParams({ q: slug, limit: '100' });
      if (cursor !== null) params.set('cursor', cursor);
      const data = await request<{ items?: Array<{ id?: unknown; slug?: unknown }>; nextCursor?: unknown; hasMore?: unknown }>(
        'GET',
        `/api/v1/admin/decks?${params.toString()}`,
      );
      const match = (data?.items ?? []).find((item) => item.slug === slug && typeof item.id === 'number');
      if (match !== undefined) {
        const id = match.id as number;
        deckIds.set(slug, id);
        return id;
      }
      if (data?.hasMore !== true || typeof data.nextCursor !== 'string') break;
      cursor = data.nextCursor;
    }
    throw new ToolFailure(`DECK_NOT_FOUND: no deck with slug "${slug}"`);
  }

  return { request, resolveDeckId };
}
