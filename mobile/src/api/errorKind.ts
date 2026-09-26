// mobile/src/api/errorKind.ts
//
// A tiny, PURE error taxonomy for load failures. Screens render raw
// `error.message` today — HTTP bodies, HTML fragments from deck installs,
// `'Network request failed'` from fetch, and `'[object Object]'` when an API
// returns `{ error: {...} }` without a string message (MSHELL-10). This module
// classifies any thrown value into one of six kinds and maps each to fixed
// friendly copy. It imports nothing from react-native, screens, stores or sync
// so every screen test can load it unmocked.

export type AppErrorKind = 'offline' | 'timeout' | 'auth' | 'server' | 'content' | 'unknown';

const ALL_KINDS: readonly AppErrorKind[] = ['offline', 'timeout', 'auth', 'server', 'content', 'unknown'];

export const FRIENDLY_ERROR_COPY: Readonly<Record<AppErrorKind, string>> = Object.freeze({
  offline: "You're offline. Check your connection and try again.",
  timeout: 'This is taking too long. Check your connection and try again.',
  auth: 'Your session has expired. Sign in again to continue.',
  server: 'Our server had a problem. Please try again in a moment.',
  content: "This pack couldn't be loaded. Try again, or pick another pack.",
  unknown: 'Something went wrong. Please try again.',
});

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readName(error: unknown): string {
  if (error && typeof error === 'object') return readString((error as { name?: unknown }).name);
  return '';
}

function readMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') return readString((error as { message?: unknown }).message);
  return '';
}

// A numeric HTTP status, whether attached to the error object or embedded in a
// deck-layer message like `download_failed_http_404: <html…>`.
function readStatus(error: unknown, message: string): number | null {
  if (error && typeof error === 'object') {
    const raw = (error as { status?: unknown }).status;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  const match = /download_failed_http_(\d{3})/.exec(message);
  if (match) return Number(match[1]);
  return null;
}

function isAppErrorKind(value: unknown): value is AppErrorKind {
  return typeof value === 'string' && (ALL_KINDS as readonly string[]).includes(value);
}

export function classifyError(error: unknown): AppErrorKind {
  // 1. Already tagged (e.g. apiClient attaches `err.kind`).
  if (error && typeof error === 'object') {
    const kind = (error as { kind?: unknown }).kind;
    if (isAppErrorKind(kind)) return kind;
  }

  const name = readName(error);
  const message = readMessage(error);

  // 2. Aborts / timeouts.
  if (name === 'AbortError' || /abort|timed? ?out/i.test(message)) return 'timeout';

  // 3. Transport failures = offline.
  if (
    /network request failed|network error|failed to fetch|internet connection appears to be offline|offline|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(
      message,
    )
  ) {
    return 'offline';
  }

  // 4. HTTP status (direct or parsed from a deck download message).
  const status = readStatus(error, message);
  if (status !== null) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 408) return 'timeout';
    if (status === 429 || status >= 500) return 'server';
    if (status >= 400) return 'content';
  }

  // 5. Amplify auth exceptions.
  if (name === 'NotAuthorizedException' || name === 'UserUnAuthenticatedException') return 'auth';

  // 6. Malformed / undecodable content.
  if (name === 'SyntaxError' || /JSON|Unexpected token|checksum|sha256|invalid deck/i.test(message)) {
    return 'content';
  }

  // 7. Fall through.
  return 'unknown';
}

export function friendlyErrorMessage(kind: AppErrorKind): string {
  return FRIENDLY_ERROR_COPY[kind];
}

export function errorToMessage(error: unknown): string {
  return friendlyErrorMessage(classifyError(error));
}

// For logs/diagnostics only — never user-facing copy. Guarantees a readable
// string and never `'[object Object]'`.
export function safeErrorText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
    try {
      return JSON.stringify(value);
    } catch {
      // Circular or otherwise non-serialisable.
      return String(value);
    }
  }
  return String(value);
}
