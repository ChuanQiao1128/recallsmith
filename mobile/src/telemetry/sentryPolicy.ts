// mobile/src/telemetry/sentryPolicy.ts
//
// Pure decisions and scrubbers for the Sentry SDK (M02, M00 §3.2-§3.3). No react,
// react-native, expo, storage, fetch or SDK import: observability.ts (the only
// SDK importer) wires these into init, and every rule is testable without mocks.
// Event and breadcrumb shapes are handled structurally, so this module never
// names the SDK package.

export const SENTRY_SAMPLE_RATE = 1.0;
export const SENTRY_TRACES_SAMPLE_RATE = 0.2;
export const SENTRY_MAX_BREADCRUMBS = 50;
export const SENTRY_MAX_EVENTS_PER_SESSION = 25; // error events passed by beforeSend per JS session
export const SENTRY_KILL_SWITCH_TIMEOUT_MS = 300; // cap on the cached-config read before init

export type SentryInactiveReason = 'dev' | 'channel' | 'no-dsn' | 'kill-switch' | 'init-failed';
export type SentryGate =
  | { enabled: true; dsn: string; environment: string }
  | { enabled: false; reason: SentryInactiveReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Shape of a Sentry DSN (https://<public key>@<host>/<numeric project id>). The SDK
// rejects anything else without throwing and then sends nothing (R19N M02-R1).
const SENTRY_DSN_SHAPE = /^https:\/\/[^@\s/]+@[^/\s]+\/\d+$/;

/** The one "is this the production update channel" rule (Sentry gate, Debug menu gate). */
export function isProductionChannel(channel: unknown): boolean {
  return String(channel).trim().toLowerCase() === 'production';
}

/** First failing gate wins: dev, channel, no-dsn (absent, blank or malformed), kill-switch. */
export function decideSentry(i: { isDev: boolean; channel: unknown; dsn: unknown; killed: boolean }): SentryGate {
  if (i.isDev) return { enabled: false, reason: 'dev' };
  if (!isProductionChannel(i.channel)) return { enabled: false, reason: 'channel' };
  if (typeof i.dsn !== 'string' || !SENTRY_DSN_SHAPE.test(i.dsn.trim())) return { enabled: false, reason: 'no-dsn' };
  if (i.killed) return { enabled: false, reason: 'kill-switch' };
  return { enabled: true, dsn: i.dsn.trim(), environment: 'production' };
}

/** True only for a boolean `features.sentry.enabled === false` (the applyRemoteFeatures parse rule). */
export function isSentryKilled(config: unknown): boolean {
  if (!isRecord(config)) return false;
  const features = config.features;
  if (!isRecord(features)) return false;
  const sentry = features.sentry;
  if (!isRecord(sentry)) return false;
  return sentry.enabled === false;
}

// The native iOS SDK records every NSURLSession request as a breadcrumb and an
// http.client span by default. RevenueCat's requests carry the Cognito sub in
// the path (/v1/subscribers/<sub>/…), so both are switched off; the Cocoa SDK
// reads these keys from the options the JS SDK forwards to it.
export const SENTRY_NATIVE_NETWORK_OPTIONS = Object.freeze({
  enableNetworkBreadcrumbs: false,
  enableNetworkTracking: false,
});

// A UUID-shaped token (the Cognito sub, device and request ids).
const UUID_SHAPE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const REVENUECAT_HOST = 'api.revenuecat.com';

/** Tokens, emails and query strings only (tag values keep their ids). */
function scrubSecrets(s: string): string {
  return s
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){1,4}/g, '[jwt]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(\bhttps?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1?[redacted]');
}

/** Tokens, emails, query strings and UUID-shaped ids (→ `<id>`). */
export function scrubString(s: string): string {
  return scrubSecrets(s).replace(UUID_SHAPE, '<id>');
}

/** True when a breadcrumb or span names a RevenueCat request in its url, description or message. */
export function mentionsRevenueCat(item: unknown): boolean {
  if (!isRecord(item)) return false;
  const data = isRecord(item.data) ? item.data : {};
  for (const value of [item.description, item.message, data.url, data['http.url']]) {
    if (typeof value === 'string' && value.toLowerCase().includes(REVENUECAT_HOST)) return true;
  }
  return false;
}

// The anonymous routes (POST /api/v1/public/events, the funnel, and POST /api/v1/public/card-reports, R28
// ANONREPORT) are unauthenticated on purpose and their XHRs carry no trace header (funnel.ts). Sentry's JS XHR
// breadcrumb handler still records them (it ignores __sentry_own_request__), and a later error event would then
// carry the method, URL, status and time of the POST next to the event's device, release and session data, which
// is enough to join an anonymous row to that event by its timestamp. So no breadcrumb or span naming a public
// route is ever kept (R28 ANONREPORT-R1). The native SDK's network breadcrumbs are already off (above).
const ANONYMOUS_ROUTE_PATH = /\/api\/v1\/public\//i;

/** True when a breadcrumb or span names an anonymous /api/v1/public/ request in its url, description or message. */
export function mentionsAnonymousRoute(item: unknown): boolean {
  if (!isRecord(item)) return false;
  const data = isRecord(item.data) ? item.data : {};
  for (const value of [item.description, item.message, data.url, data['http.url']]) {
    if (typeof value === 'string' && ANONYMOUS_ROUTE_PATH.test(value)) return true;
  }
  return false;
}

/** Cuts everything from the first `?` or `#` (relative URLs too). */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|password|token|access_?token|id_?token|refresh_?token|email)$/i;
const DROPPED_KEYS: ReadonlySet<string> = new Set(['http.query', 'http.fragment']);
const URL_KEYS: ReadonlySet<string> = new Set(['url', 'http.url', 'from', 'to']);
const REQUEST_DROPPED_KEYS: ReadonlySet<string> = new Set(['cookies', 'query_string', 'data']);
const MAX_DEPTH = 10;
const DROP: unique symbol = Symbol('drop');

type Walked = unknown | typeof DROP;

/**
 * Deep copy with the shared rules applied. `urlZone` marks the subtrees
 * (breadcrumbs[].data, spans[].data, contexts) whose url/from/to values are
 * stripped of their query string. Values deeper than MAX_DEPTH are dropped.
 */
function walk(value: unknown, depth: number, urlZone: boolean): Walked {
  if (depth > MAX_DEPTH) return DROP;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const next = walk(item, depth + 1, urlZone);
      if (next !== DROP) out.push(next);
    }
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = walkEntry(key, child, depth + 1, urlZone);
      if (next !== DROP) out[key] = next;
    }
    return out;
  }
  return value;
}

function walkEntry(key: string, value: unknown, depth: number, urlZone: boolean): Walked {
  if (depth > MAX_DEPTH) return DROP;
  if (DROPPED_KEYS.has(key)) return DROP;
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (urlZone && URL_KEYS.has(key) && typeof value === 'string') return scrubString(stripQuery(value));
  return walk(value, depth, urlZone);
}

/** Breadcrumb / span holder: its `data` subtree is a url zone. */
function walkDataHolder(value: unknown, depth: number): Walked {
  if (depth > MAX_DEPTH) return DROP;
  if (!isRecord(value)) return walk(value, depth, false);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = walkEntry(key, child, depth + 1, key === 'data');
    if (next !== DROP) out[key] = next;
  }
  return out;
}

function walkRequest(value: unknown, depth: number): Walked {
  if (depth > MAX_DEPTH) return DROP;
  if (!isRecord(value)) return walk(value, depth, false);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (REQUEST_DROPPED_KEYS.has(key)) continue;
    const next =
      key === 'url' && typeof child === 'string'
        ? scrubString(stripQuery(child))
        : walkEntry(key, child, depth + 1, false);
    if (next !== DROP) out[key] = next;
  }
  return out;
}

/** Deep copy (depth cap 10) with personal data and query strings removed; never mutates `event`. */
export function scrubEvent<T>(event: T): T {
  if (!isRecord(event)) {
    const walked = walk(event, 0, false);
    return (walked === DROP ? undefined : walked) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === 'user') continue;
    let next: Walked;
    if (key === 'tags' && isRecord(value)) {
      // Our own tags (ota.update_id is a UUID); secrets are still scrubbed.
      const tags: Record<string, unknown> = {};
      for (const [tag, tagValue] of Object.entries(value)) {
        if (SENSITIVE_KEY.test(tag)) tags[tag] = '[redacted]';
        else tags[tag] = typeof tagValue === 'string' ? scrubSecrets(tagValue) : tagValue;
      }
      next = tags;
    } else if (key === 'request') {
      next = walkRequest(value, 1);
    } else if ((key === 'breadcrumbs' || key === 'spans') && Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value) {
        if (mentionsRevenueCat(item) || mentionsAnonymousRoute(item)) continue;
        const walked = walkDataHolder(item, 2);
        if (walked !== DROP) items.push(walked);
      }
      next = items;
    } else if (key === 'contexts') {
      next = walkEntry(key, value, 1, true);
    } else {
      next = walkEntry(key, value, 1, false);
    }
    if (next !== DROP) out[key] = next;
  }
  return out as T;
}

export function scrubBreadcrumb<T extends { category?: string; message?: string; data?: Record<string, unknown> }>(b: T): T | null {
  if (b.category === 'console') return null;
  if (mentionsRevenueCat(b) || mentionsAnonymousRoute(b)) return null;
  const copy: Record<string, unknown> = { ...b };
  if (typeof b.message === 'string') copy.message = scrubString(b.message);
  if (b.data !== undefined) {
    const data = walk(b.data, 1, true);
    if (data === DROP) delete copy.data;
    else copy.data = data;
  }
  return copy as T;
}

/** Offline / timeout failures (apiClient.ts sets `kind`) are expected, not bugs. */
export function shouldDropEvent(hint: { originalException?: unknown } | undefined): boolean {
  const original = hint?.originalException;
  if (typeof original !== 'object' || original === null) return false;
  const kind = (original as { kind?: unknown }).kind;
  return kind === 'offline' || kind === 'timeout';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function originOf(url: string): string | null {
  const match = /^(https?:\/\/[^/?#\s]+)/i.exec(url.trim());
  return match ? match[1] : null;
}

/** One anchored regex per distinct API origin; never a catch-all, never the CDN. */
export function buildTracePropagationTargets(apiBase: string, fallback: string | null): RegExp[] {
  const origins: string[] = [];
  for (const candidate of [apiBase, fallback]) {
    if (typeof candidate !== 'string') continue;
    const origin = originOf(candidate);
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins.map((origin) => new RegExp(`^${escapeRegExp(origin)}(/|$)`));
}

function tagValue(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return 'unknown';
}

export function buildOtaTags(
  u: { updateId?: unknown; channel?: unknown; runtimeVersion?: unknown; isEmbeddedLaunch?: unknown } | null,
): Record<string, string> {
  const updateId = u?.updateId;
  const embedded = u?.isEmbeddedLaunch;
  let id = 'unknown';
  // expo-updates reports the embedded update's UUID on an embedded launch (R19N M02-R4).
  if (embedded === true) id = 'embedded';
  else if (typeof updateId === 'string' && updateId.trim() !== '') id = updateId.trim();
  else if (u && (updateId === null || typeof updateId === 'string')) id = 'embedded';
  return {
    'ota.update_id': id,
    'ota.channel': tagValue(u?.channel),
    'ota.runtime_version': tagValue(u?.runtimeVersion),
    'ota.is_embedded': typeof embedded === 'boolean' ? String(embedded) : 'unknown',
  };
}

// --- x-dc-trace-id (R19M M03, M00 §4.2) ---
// The header links a mobile event to the core-vpc log line of the request that
// caused it (logged there as upstreamTraceId). The pattern must agree with
// TraceContext.cs:28 and apiClient.ts's local copy.

export const DC_TRACE_HEADER = 'x-dc-trace-id';
export const DC_TRACE_HEADER_PATTERN = /^1-[0-9a-f]{8}-[0-9a-f]{24}$/;

const SENTRY_TRACE_ID = /^[0-9a-f]{32}$/;
const ZERO_TRACE_ID = '0'.repeat(32);

/** 32 lower-case hex (not all zeros) → `1-<8 hex>-<24 hex>`; anything else → null. Never throws. */
export function toDcTraceHeader(sentryTraceId: unknown): string | null {
  if (typeof sentryTraceId !== 'string') return null;
  if (!SENTRY_TRACE_ID.test(sentryTraceId) || sentryTraceId === ZERO_TRACE_ID) return null;
  return `1-${sentryTraceId.slice(0, 8)}-${sentryTraceId.slice(8)}`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Event tags from an apiClient error (status, error code, envelope request id, header sent). Never throws. */
export function apiErrorTags(err: unknown): Record<string, string> {
  const tags: Record<string, string> = {};
  if (typeof err !== 'object' || err === null) return tags;
  try {
    const e = err as { status?: unknown; apiErrorCode?: unknown; requestId?: unknown; dcTraceId?: unknown };
    if (typeof e.status === 'number' && Number.isFinite(e.status)) tags['api.status'] = String(e.status);
    if (nonEmptyString(e.apiErrorCode)) tags['api.error_code'] = e.apiErrorCode;
    if (nonEmptyString(e.requestId)) tags['api.request_id'] = e.requestId;
    if (nonEmptyString(e.dcTraceId)) tags['api.dc_trace_id'] = e.dcTraceId;
  } catch {
    // a throwing getter yields the tags read so far
  }
  return tags;
}
