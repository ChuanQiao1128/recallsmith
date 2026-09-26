// mobile/src/auth/deleteServerAccount.ts
//
// Server-side account deletion. deleteAccountNow calls this BEFORE the Cognito
// deleteUser so the user's rows (email, progress events, draw state, wallet) are
// removed from RDS first — App Store Guideline 5.1.1(v). Wave F's F15 builds the
// authenticated `DELETE /api/v1/user/me` endpoint; until it ships the core-vpc
// router answers unknown routes with 404, which we treat as "not deployed yet"
// and let deletion continue exactly as today.
//
// Pure TS: never imports react-native, amplify, or revenuecat — AccountSection
// imports this module under settings-copy.spec.ts's minimal RN mock. Uses the
// global fetch; the caller may inject fetchImpl/apiBase for tests.

export const DELETE_ME_PATH = '/api/v1/user/me';

export type ServerDeleteOutcome = 'deleted' | 'endpoint_unavailable';

export const ACCOUNT_DELETION_COPY = {
  network:
    'We could not reach our servers to delete your data. Check your connection and try again.',
  server: 'Our servers could not delete your data right now. Please try again in a moment.',
  auth: 'Your session has expired. Sign out, sign back in, then delete your account.',
} as const;

export type AccountDeletionErrorKind = keyof typeof ACCOUNT_DELETION_COPY;

export class AccountDeletionError extends Error {
  readonly kind: AccountDeletionErrorKind;
  readonly status: number | null;

  constructor(kind: AccountDeletionErrorKind, status: number | null = null) {
    super(ACCOUNT_DELETION_COPY[kind]);
    this.name = 'AccountDeletionError';
    this.kind = kind;
    this.status = status;
    // Keep `instanceof` working after down-level transpilation of `extends Error`.
    Object.setPrototypeOf(this, AccountDeletionError.prototype);
  }
}

/**
 * Delete the signed-in user's server-side data via `DELETE /api/v1/user/me`.
 *
 * - 2xx                    → 'deleted'
 * - 404 / 405 / 501        → 'endpoint_unavailable' (F15 not deployed; caller continues)
 * - 401 / 403              → throws AccountDeletionError('auth')  — keep the session
 * - any other status       → throws AccountDeletionError('server')
 * - fetch throw / timeout  → throws AccountDeletionError('network')
 *
 * An empty API base (a dev build with no server) resolves to 'endpoint_unavailable'
 * so deletion can still proceed; a blank access token is an 'auth' failure.
 */
export async function deleteServerAccountData(
  accessToken: string | null,
  opts?: { apiBase?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ServerDeleteOutcome> {
  // Literal member access so Expo inlines EXPO_PUBLIC_API_BASE at build time.
  const base =
    opts?.apiBase ?? (process.env.EXPO_PUBLIC_API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return 'endpoint_unavailable';

  const token = (accessToken ?? '').trim();
  if (!token) throw new AccountDeletionError('auth');

  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? 15000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetchImpl(`${base}${DELETE_ME_PATH}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch {
    // Network failure or the AbortController firing on timeout.
    throw new AccountDeletionError('network');
  } finally {
    clearTimeout(timeout);
  }

  const status = resp.status;
  if (status >= 200 && status < 300) return 'deleted';
  // F15 not deployed yet (core-vpc 404), or the method/route is not wired: not fatal.
  if (status === 404 || status === 405 || status === 501) return 'endpoint_unavailable';
  if (status === 401 || status === 403) throw new AccountDeletionError('auth', status);
  throw new AccountDeletionError('server', status);
}
