// src/lib/reportError.ts
//
// One funnel for every uncaught failure in the console, and nothing else.
//
// Three things can go wrong in a browser without any of this application's own
// code getting a chance to say so: a script throws outside React, a promise
// rejects with nobody awaiting it, and a component throws during render. The
// first two reach `window` and used to reach nothing else; the third was caught
// by ChunkErrorBoundary and written to console.error, which is a record only for
// whoever happens to have devtools open. All three now arrive here.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS AND IS NOT
// ---------------------------------------------------------------------------
// It is not an error-tracking product and does not pretend to be one: no
// batching, no retry, no offline queue, no breadcrumbs, no sampling, no
// dependency. There is also, today, NO SERVER COLLECTING THIS. That is stated
// rather than hidden, because it decides the design: with no endpoint
// configured the module makes zero network calls, so the honest default is
// "wired and silent" rather than "posting into the void" or "a TODO nobody
// wires up later". The value now is that the three entry points exist, funnel
// into one function, and are pinned by tests — so turning it on later is
// setting one environment variable, not writing this again under pressure
// during an incident.
//
// ---------------------------------------------------------------------------
// WHY THE ROUTE IS THE PATH AND NOT THE URL
// ---------------------------------------------------------------------------
// `location.search` is deliberately NOT sent. On /auth/callback the query
// string carries the Cognito authorization `code`, and a failure on that route
// is exactly when a report would fire — so the obvious "send the full URL"
// would ship a live credential to whatever host the endpoint names. The
// pathname answers the only question a report needs ("which screen"), and
// cannot carry one.

/** Where a report is POSTed. Blank or unset means: do not send anything. */
function endpoint(): string {
  // Read per call rather than at module scope so a test can set it without
  // re-importing the module. This costs nothing in production: Vite replaces
  // `import.meta.env.VITE_*` with a string literal at build time wherever it
  // appears, so the shipped code has no property access here at all.
  return (import.meta.env.VITE_ERROR_REPORT_URL ?? '').trim();
}

/**
 * Which build produced this error.
 *
 * Injected at build time from the environment — CI passes the commit sha as
 * VITE_BUILD_ID — because the one question an error report has to answer before
 * any other is "is this still happening on the current build". Falls back to the
 * mode rather than to a fake hash: "development" is useless but true, while a
 * placeholder that looks like a sha would send someone to check out a commit
 * that does not exist.
 */
function buildId(): string {
  return (import.meta.env.VITE_BUILD_ID ?? '').trim() || import.meta.env.MODE;
}

/** Where the failure happened, and never anything from the query string. */
function route(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname;
}

/** Bounds one field. sendBeacon refuses payloads over the UA's limit and a
 *  refusal is silent, so a stack from a deep React tree must not be the reason
 *  a report is dropped. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export type ErrorSource = 'window.onerror' | 'unhandledrejection' | 'react';

/**
 * The funnel. Every entry point below, and ChunkErrorBoundary, calls this.
 *
 * Returns whether a report was handed to the browser, so the tests can tell
 * "sent" from "deliberately silent" without reading a global.
 */
export function reportError(error: unknown, source: ErrorSource, detail?: string): boolean {
  const url = endpoint();
  if (url === '') return false;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;

  const asError = error instanceof Error ? error : undefined;
  const payload = {
    source,
    build: buildId(),
    route: route(),
    at: new Date().toISOString(),
    name: asError?.name ?? typeof error,
    message: clip(asError?.message ?? String(error), 500),
    stack: clip(asError?.stack ?? '', 4000),
    detail: detail === undefined ? undefined : clip(detail, 2000),
  };

  try {
    return navigator.sendBeacon(url, JSON.stringify(payload));
  } catch {
    // Reporting a failure must never become a second failure — a throw here
    // would propagate out of a window listener, or out of componentDidCatch and
    // straight past the boundary that was handling the first error.
    return false;
  }
}

let uninstall: (() => void) | null = null;

/**
 * Attach the two window-level entry points. Called once from main.tsx.
 *
 * addEventListener rather than assigning `window.onerror`: that property has a
 * single owner, and taking it means silently replacing whatever else set it.
 * Idempotent, and returns its own removal, so a second call cannot double every
 * report.
 */
export function installErrorReporting(): () => void {
  if (uninstall !== null) return uninstall;

  const onError = (event: ErrorEvent): void => {
    // event.error is null for cross-origin script errors, where the browser
    // withholds everything but the message. Reporting the message alone is
    // still worth more than reporting nothing.
    reportError(event.error ?? event.message, 'window.onerror');
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    reportError(event.reason, 'unhandledrejection');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  uninstall = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    uninstall = null;
  };
  return uninstall;
}
