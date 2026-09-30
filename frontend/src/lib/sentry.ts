// src/lib/sentry.ts
//
// Where the console's uncaught failures go: Sentry, and only when a DSN was
// baked in at build time. Without one (a local build, CI, any deploy whose
// resolver found nothing) initConsoleSentry() returns false, nothing is
// imported and nothing leaves the browser. src/lib/reportError.ts is the funnel
// every entry point calls; this module is its only sink.
//
// ---------------------------------------------------------------------------
// WHY THE SDK IS LOADED LAZILY
// ---------------------------------------------------------------------------
// @sentry/react with browser tracing is about 149 kB minified, and
// tests/bundleFirstLoad.test.ts caps the static first-load closure at
// FIRST_LOAD_BUDGET_BYTES and the login page's eager closure at
// EAGER_BUDGET_BYTES, the latter with about 2 kB of headroom. So the decision
// is synchronous (initConsoleSentry() returns at once, and
// installErrorReporting() right after it already knows whether to attach its
// listeners) while the SDK and the scrubbers arrive as a separate chunk. Reports
// made through the funnel before that chunk has loaded are queued, up to
// CONSOLE_SENTRY_PENDING_MAX, and sent once Sentry is initialised.
//
// The two `await import(...)` lines stay top-level statements of
// loadConsoleSentry and stay destructured: Rollup only tree-shakes a dynamic
// import whose bindings it can see at that position, and a namespace import (or
// one inside Promise.all or a try block) keeps replay, feedback and the rest of
// the SDK in the chunk, about three times the size.
//
// ---------------------------------------------------------------------------
// WHAT IS SENT AND WHAT IS SCRUBBED
// ---------------------------------------------------------------------------
// sendDefaultPii is off and no user is ever set. Every event, transaction and
// breadcrumb passes through src/lib/sentryScrub.ts: bearer tokens, JWTs and
// email addresses are redacted, query strings and fragments are cut from URLs
// (the Cognito `code` on /auth/callback, signed CloudFront URLs), sensitive keys
// are blanked and console breadcrumbs are dropped. The route tag is the
// pathname, never the query or the hash. No replay, no feedback, no profiling.
//
// The console propagates no trace headers (tracePropagationTargets is empty):
// the API's CORS allow_headers (infra/modules/api/gateway.tf:112) lists neither
// sentry-trace nor baggage, so attaching them would fail every preflight.

import type { ErrorSource } from './reportError';

/** Reports queued while the SDK chunk loads; extra ones are dropped. */
export const CONSOLE_SENTRY_PENDING_MAX = 20;

type Capture = (error: unknown, hint: { tags: Record<string, string>; contexts?: Record<string, Record<string, unknown>> }) => string;

interface Pending {
  error: unknown;
  source: ErrorSource;
  route: string;
  detail?: string;
}

let decided: boolean | null = null;
let active = false;
let capture: Capture | null = null;
let pending: Pending[] = [];
let ready: Promise<boolean> = Promise.resolve(false);

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function send(to: Capture, report: Pending): void {
  to(report.error, {
    tags: { 'console.source': report.source, 'console.route': report.route },
    contexts: report.detail ? { react: { componentStack: clip(report.detail, 2000) } } : undefined,
  });
}

async function loadConsoleSentry(dsn: string): Promise<boolean> {
  const { init, browserTracingIntegration, captureException } = await import('@sentry/react');
  const { scrubEvent, scrubBreadcrumb } = await import('./sentryScrub');
  const environment = (import.meta.env.VITE_SENTRY_ENVIRONMENT ?? '').trim() || 'production';
  const id = (import.meta.env.VITE_BUILD_ID ?? '').trim();
  init({
    dsn,
    environment,
    ...(id ? { release: `console@${id}` } : {}),
    sendDefaultPii: false,
    integrations: [browserTracingIntegration()],
    tracesSampleRate: 0.05,
    tracePropagationTargets: [],
    maxBreadcrumbs: 50,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  capture = captureException;
  const queued = pending;
  pending = [];
  for (const report of queued) send(captureException, report);
  return true;
}

/**
 * Decides, once and synchronously, whether this page reports to Sentry. Called
 * from main.tsx right before installErrorReporting().
 */
export function initConsoleSentry(): boolean {
  if (decided !== null) return decided;
  const dsn = (import.meta.env.VITE_SENTRY_DSN ?? '').trim();
  decided = dsn !== '';
  if (!decided) return false;
  active = true;
  ready = loadConsoleSentry(dsn).catch(() => {
    // A chunk that would not load or an init that threw: stay silent rather
    // than become a second failure, and never log anything carrying the DSN.
    active = false;
    capture = null;
    pending = [];
    return false;
  });
  return true;
}

export function isConsoleSentryActive(): boolean {
  return active;
}

/** Resolves true once Sentry.init has run; false when inactive or when the load or init failed. */
export function whenConsoleSentryReady(): Promise<boolean> {
  return ready;
}

/** The funnel's sink. True when the report was handed to Sentry or queued for it. */
export function captureConsoleError(error: unknown, source: ErrorSource, detail?: string): boolean {
  try {
    if (!active) return false;
    // The pathname only: on /auth/callback the query carries the Cognito code.
    const report: Pending = {
      error,
      source,
      route: typeof window === 'undefined' ? '' : window.location.pathname,
      detail,
    };
    if (capture !== null) {
      send(capture, report);
      return true;
    }
    if (pending.length >= CONSOLE_SENTRY_PENDING_MAX) return false;
    pending.push(report);
    return true;
  } catch {
    return false;
  }
}
