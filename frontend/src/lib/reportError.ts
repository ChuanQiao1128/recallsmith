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
// WHERE A REPORT GOES
// ---------------------------------------------------------------------------
// To Sentry, through src/lib/sentry.ts, and only when the build was made with a
// build-time DSN (frontend/deploy.sh resolves one; see the README's Deployment
// section). Without one, sentry.ts never becomes active, reportError returns
// false, and nothing leaves the browser from any of the three entry points.
//
// ---------------------------------------------------------------------------
// WHY THE LISTENERS ARE NOT ATTACHED WHILE SENTRY IS ACTIVE
// ---------------------------------------------------------------------------
// Sentry installs its own global handlers for `error` and `unhandledrejection`
// and reports those failures with better stacks than an event listener sees.
// Attaching ours as well would send every window-level failure twice. So when
// Sentry is active installErrorReporting() attaches nothing, and the funnel's
// remaining caller on that path is ChunkErrorBoundary, whose render-time errors
// never reach `window`.
//
// ---------------------------------------------------------------------------
// WHY THE ROUTE IS THE PATH AND NOT THE URL
// ---------------------------------------------------------------------------
// `location.search` is deliberately NOT sent. On /auth/callback the query
// string carries the Cognito authorization `code`, and a failure on that route
// is exactly when a report would fire — so the obvious "send the full URL"
// would ship a live credential to the error tracker. The pathname answers the
// only question a report needs ("which screen"), and cannot carry one. The tag
// is set in sentry.ts, and the event's own URLs are cut at the query by
// sentryScrub.ts.

import { captureConsoleError, isConsoleSentryActive } from './sentry';

export type ErrorSource = 'window.onerror' | 'unhandledrejection' | 'react';

/**
 * The funnel. Every entry point below, and ChunkErrorBoundary, calls this.
 *
 * Returns whether a report was handed to Sentry (or queued for it while the SDK
 * loads), so the tests can tell "sent" from "deliberately silent" without
 * reading a global. Never throws: reporting a failure must not become a second
 * failure, least of all inside componentDidCatch.
 */
export function reportError(error: unknown, source: ErrorSource, detail?: string): boolean {
  return captureConsoleError(error, source, detail);
}

let uninstall: (() => void) | null = null;

/**
 * Attach the two window-level entry points. Called once from main.tsx, right
 * after initConsoleSentry().
 *
 * With Sentry active this attaches nothing and returns a no-op (see the header).
 * Otherwise: addEventListener rather than assigning `window.onerror`, because
 * that property has a single owner, and taking it means silently replacing
 * whatever else set it. Idempotent, and returns its own removal, so a second
 * call cannot double every report.
 */
export function installErrorReporting(): () => void {
  if (uninstall !== null) return uninstall;

  if (isConsoleSentryActive()) {
    uninstall = () => {};
    return uninstall;
  }

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
