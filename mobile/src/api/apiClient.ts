// mobile/src/api/apiClient.ts
import { resolveApiBase, resolveApiFallback } from '../config/hosts';
import { classifyError } from './errorKind';

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

// Injected 401 recovery. apiClient must not import auth code (would create an
// import cycle authStore -> apiClient -> authStore), so freshToken.ts installs
// a refresher here. Returns a fresh access token (or null when it cannot).
let _accessTokenRefresher: (() => Promise<string | null>) | null = null;

export function setAccessTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  _accessTokenRefresher = fn;
}

// Injected trace-header provider (R19M M03). apiClient must not import telemetry
// or the crash-reporting SDK, so the telemetry layer installs a provider here only
// while crash reporting is active. With no provider installed no header is sent and
// requests are unchanged.
let _traceHeaderProvider: (() => string | null) | null = null;

export function setTraceHeaderProvider(fn: (() => string | null) | null): void {
  _traceHeaderProvider = fn;
}

const TRACE_HEADER_NAME = 'x-dc-trace-id';
// Must agree with TraceContext.cs:28 (server) and the telemetry DC_TRACE_HEADER_PATTERN;
// kept as a local copy so apiClient stays free of telemetry imports.
const TRACE_HEADER_PATTERN = /^1-[0-9a-f]{8}-[0-9a-f]{24}$/;

/** Existing value of the trace header in `headers` (any key casing), else undefined. */
function findTraceHeader(headers: Record<string, string>): string | undefined {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === TRACE_HEADER_NAME) return headers[key];
  }
  return undefined;
}

/** The provider's value when it is a valid trace header; a throw or anything else ⇒ null. */
function readTraceHeader(): string | null {
  const provider = _traceHeaderProvider;
  if (!provider) return null;
  try {
    const value = provider();
    return typeof value === 'string' && TRACE_HEADER_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
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

/** "Could not reach the host" (DNS, TLS, connection refused). fetch reports it as a
 *  TypeError; requestOnce's send() wrapper (MSHELL-10) re-throws it as an Error with
 *  kind 'offline'. Timeouts (kind 'timeout') and HTTP statuses do not count. */
function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e as { kind?: unknown } | null)?.kind === 'offline';
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

    // A caller-supplied trace header (any casing) wins; otherwise ask the provider.
    // The 401 replay reuses this object, and the fallback retry runs requestOnce again.
    const callerTraceHeader = findTraceHeader(headers);
    let sentTraceHeader: string | null = callerTraceHeader ? callerTraceHeader : null;
    if (callerTraceHeader === undefined) {
      const provided = readTraceHeader();
      if (provided) {
        headers[TRACE_HEADER_NAME] = provided;
        sentTraceHeader = provided;
      }
    }

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
      // Lookup keys for the backend log line: the envelope traceId (API Gateway request
      // id) and the x-dc-trace-id header this request carried.
      err.requestId = typeof json?.traceId === 'string' ? json.traceId : null;
      err.dcTraceId = sentTraceHeader;
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
