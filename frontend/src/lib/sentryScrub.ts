// src/lib/sentryScrub.ts
//
// What is removed from every console event, transaction and breadcrumb before
// Sentry sends it. Loaded only by src/lib/sentry.ts, lazily, together with the
// SDK, so none of this is in the first-load bundle.
//
// Pure on purpose: no imports, its own structural types, no SDK. The rules are
// the M00 §3.3 table, the same as the mobile app's scrubbers, so an event looks
// the same whichever client sent it:
//
//   1. bearer tokens         -> `Bearer [redacted]`
//   2. JWTs (and JWE tokens) -> `[jwt]`
//   3. email addresses       -> `[email]`
//   4. query strings and fragments of URLs inside text -> `?[redacted]`
//
// Row 1's character class spells `/` without a backslash: inside a class it
// needs none, and the frontend's no-useless-escape rule rejects the escaped
// form. The two spellings match exactly the same strings.
//
// Structured fields get more than the text rules: `user`, request cookies,
// query string and body are deleted; any key named like a credential or an
// email is blanked at any depth; URL-valued fields under breadcrumb data, span
// data and contexts lose everything from the first `?` or `#`, which is where
// the Cognito authorization `code` of /auth/callback sits.

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|password|token|access_?token|id_?token|refresh_?token|email)$/i;
const URL_KEYS = new Set(['url', 'http.url', 'from', 'to']);
const DROPPED_KEYS = new Set(['http.query', 'http.fragment']);
const REDACTED = '[redacted]';
const MAX_DEPTH = 10;

type Plain = Record<string, unknown>;

export function scrubString(s: string): string {
  return s
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){1,4}/g, '[jwt]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(\bhttps?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1?[redacted]');
}

/** Everything before the first `?` or `#`; relative URLs included. */
export function stripQuery(url: string): string {
  const at = url.search(/[?#]/);
  return at === -1 ? url : url.slice(0, at);
}

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A scrubbed deep copy. `urlZone` is true under breadcrumb data, span data and
 * contexts, where URL-valued keys are cut at the query; `zoneKey` switches it on
 * for one child key of the object at this level.
 */
function copy(value: unknown, depth: number, urlZone: boolean, zoneKey?: string): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.map(item => copy(item, depth + 1, urlZone));
  const out: Plain = {};
  for (const [key, child] of Object.entries(value)) {
    if (DROPPED_KEYS.has(key)) continue;
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
    } else if (urlZone && URL_KEYS.has(key) && typeof child === 'string') {
      out[key] = scrubString(stripQuery(child));
    } else {
      out[key] = copy(child, depth + 1, urlZone || key === zoneKey);
    }
  }
  return out;
}

/** breadcrumbs[] and spans[]: each item's `data` is a URL zone. */
function copyItems(value: unknown, depth: number): unknown {
  if (!Array.isArray(value)) return copy(value, depth, false);
  return value.map(item => copy(item, depth + 1, false, 'data'));
}

export function scrubEvent<T>(event: T): T {
  if (!isPlain(event)) return event;
  const out: Plain = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === 'user' || DROPPED_KEYS.has(key)) continue;
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
    } else if (key === 'request' && isPlain(value)) {
      const request = copy(value, 1, false) as Plain;
      delete request.cookies;
      delete request.query_string;
      delete request.data;
      if (typeof value.url === 'string') request.url = scrubString(stripQuery(value.url));
      out[key] = request;
    } else if (key === 'breadcrumbs' || key === 'spans') {
      out[key] = copyItems(value, 1);
    } else {
      out[key] = copy(value, 1, key === 'contexts');
    }
  }
  return out as T;
}

export function scrubBreadcrumb<T extends { category?: string; message?: string; data?: Record<string, unknown> }>(
  b: T,
): T | null {
  if (b.category === 'console') return null;
  return copy(b, 0, false, 'data') as T;
}
