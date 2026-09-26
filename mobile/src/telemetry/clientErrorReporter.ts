// mobile/src/telemetry/clientErrorReporter.ts
//
// Interim, OTA-safe client error reporter (MSHELL-02 / MSHELL-12). Until Sentry
// lands in the 1.7.0 binary (H02), this posts a tiny JSON blob to Wave F's F16
// endpoint (`/api/v1/user/client-errors`) with the signed-in user's bearer
// token — fire-and-forget, rate-limited, all failures swallowed, and nothing at
// all for anonymous users.
//
// IMPORTANT: this module imports nothing at runtime (types only). The access
// token, device info, current screen and fetch implementation are injected from
// App.tsx via `configureClientErrorReporting`, so rootErrorBoundary.test can
// pull it in behind a minimal react-native mock without dragging authStore,
// amplify, AsyncStorage or expo modules into the graph.

export const CLIENT_ERRORS_PATH = '/api/v1/user/client-errors';
export const CLIENT_ERROR_STACK_MAX_CHARS = 4096;
export const CLIENT_ERROR_MESSAGE_MAX_CHARS = 1000;
export const CLIENT_ERROR_RATE_LIMIT = Object.freeze({ maxEvents: 10, windowMs: 60_000 });

export type ClientErrorEnv = {
  appVersion: string | null;
  updateId: string | null;
  platform: string;
};

export type ClientErrorKind = 'js_error' | 'unhandled_rejection' | 'boundary' | 'other';

export type ClientErrorPayload = {
  kind: ClientErrorKind;
  message: string;
  stack: string | null;
  screen: string | null;
  appVersion: string | null;
  updateId: string | null;
  platform: string;
};

export type ClientErrorReporterDeps = {
  apiBase: string | null;
  getAccessToken: () => string | null | undefined;
  getEnv: () => ClientErrorEnv;
  getCurrentScreen: () => string | null;
  fetchImpl: typeof fetch;
  now: () => number;
};

type ReportContext = { screen?: string | null; kind?: ClientErrorKind };

function safeMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      return error.message || 'Unknown error';
    }
    if (typeof error === 'string') {
      return error || 'Unknown error';
    }
    if (error == null) {
      return 'Unknown error';
    }
    const json = JSON.stringify(error);
    if (json && json !== '{}') return json;
    const str = String(error);
    return str || 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

export function buildClientErrorPayload(
  error: unknown,
  screen: string | null,
  env: ClientErrorEnv,
  kind: ClientErrorKind = 'js_error',
): ClientErrorPayload {
  const message = safeMessage(error).slice(0, CLIENT_ERROR_MESSAGE_MAX_CHARS);
  const rawStack = error instanceof Error && typeof error.stack === 'string' ? error.stack : null;
  const stack = rawStack != null ? rawStack.slice(0, CLIENT_ERROR_STACK_MAX_CHARS) : null;
  return {
    kind,
    message,
    stack,
    screen,
    appVersion: env.appVersion,
    updateId: env.updateId,
    platform: env.platform,
  };
}

const DEFAULT_ENV: ClientErrorEnv = { appVersion: null, updateId: null, platform: 'unknown' };

function defaultApiBase(): string | null {
  return (process.env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/+$/, '');
}

export function createClientErrorReporter(
  deps: Partial<ClientErrorReporterDeps>,
): { report(error: unknown, ctx?: ReportContext): boolean } {
  // Rolling window of send timestamps for the rate limiter.
  const sentAt: number[] = [];

  function report(error: unknown, ctx?: ReportContext): boolean {
    try {
      const apiBase = deps.apiBase !== undefined ? deps.apiBase : defaultApiBase();
      if (!apiBase) return false;

      const token = (deps.getAccessToken ? deps.getAccessToken() : null) ?? null;
      if (typeof token !== 'string' || token.trim() === '') return false;

      const now = (deps.now ?? Date.now)();
      const windowStart = now - CLIENT_ERROR_RATE_LIMIT.windowMs;
      while (sentAt.length > 0 && sentAt[0] <= windowStart) sentAt.shift();
      if (sentAt.length >= CLIENT_ERROR_RATE_LIMIT.maxEvents) return false;

      const env = deps.getEnv ? deps.getEnv() : DEFAULT_ENV;
      const screen =
        ctx && ctx.screen !== undefined
          ? ctx.screen
          : deps.getCurrentScreen
            ? deps.getCurrentScreen()
            : null;
      const kind = ctx?.kind ?? 'js_error';
      const payload = buildClientErrorPayload(error, screen, env, kind);

      const fetchImpl = deps.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
      if (typeof fetchImpl !== 'function') return false;

      sentAt.push(now);

      // Fire-and-forget: never await, never retry. Wrapping the call in a
      // resolved promise means a *synchronous* throw from fetchImpl is also
      // swallowed, so a failure inside the reporter can never reach the global
      // handler and recurse.
      Promise.resolve()
        .then(() =>
          fetchImpl(`${apiBase}${CLIENT_ERRORS_PATH}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          }),
        )
        .catch(() => {});

      return true;
    } catch {
      return false;
    }
  }

  return { report };
}

let reporter = createClientErrorReporter({});

export function configureClientErrorReporting(deps: Partial<ClientErrorReporterDeps>): void {
  reporter = createClientErrorReporter(deps);
}

export function reportClientError(error: unknown, ctx?: ReportContext): void {
  try {
    reporter.report(error, ctx);
  } catch {
    // never throw
  }
}

const installedTargets = new WeakSet<object>();

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

type HermesLike = {
  enablePromiseRejectionTracker?: (opts: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

export function installGlobalErrorHandlers(
  target: object = globalThis,
  opts?: { trackRejections?: boolean },
): void {
  try {
    if (installedTargets.has(target)) return;
    installedTargets.add(target);

    const errorUtils = (target as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
      const previous =
        typeof errorUtils.getGlobalHandler === 'function' ? errorUtils.getGlobalHandler() : undefined;
      errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        reportClientError(error, { kind: 'js_error' });
        if (typeof previous === 'function') previous(error, isFatal);
      });
    }

    const devFlag = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
    const trackRejections = opts?.trackRejections ?? !devFlag;
    if (trackRejections) {
      const hermes = (target as { HermesInternal?: HermesLike }).HermesInternal;
      if (hermes && typeof hermes.enablePromiseRejectionTracker === 'function') {
        hermes.enablePromiseRejectionTracker({
          allRejections: true,
          onUnhandled: (_id: number, rejection: unknown) =>
            reportClientError(rejection, { kind: 'unhandled_rejection' }),
          onHandled: () => {},
        });
      }
    }
  } catch {
    // never throw
  }
}
