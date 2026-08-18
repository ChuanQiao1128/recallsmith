// src/api/http.ts
import axios from 'axios';
import { refreshTokens } from '../auth/cognito';
import {
  clearStoredTokens,
  readStoredTokens,
  saveTokens,
  type StoredTokens,
} from '../auth/tokenStore';

const rawBase =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_BASE ??
  '';

// Use absolute base URLs when provided; otherwise rely on same-origin (works with Vite dev proxy)
const baseURL = typeof rawBase === 'string' ? rawBase.trim() : '';
const axiosBaseURL = /^https?:\/\//i.test(baseURL) ? baseURL : '';

export const http = axios.create({
  baseURL: axiosBaseURL,
  timeout: 15_000,
});

/**
 * How much life an access token must have left to be sent as it is.
 *
 * Two floors decide this number, and it has to clear both.
 *
 *  - The request timeout above is 15s. A token sent with less than that
 *    remaining can still be in flight when it expires, and the 401 that comes
 *    back is exactly the failure the refresh exists to prevent.
 *  - tokenStore's own EXPIRY_SKEW_MS is 30s: getAccessToken() calls a token
 *    dead once it is inside that window. A lead time below 30s would leave a
 *    band where this interceptor is happy to send a token the store has
 *    already disowned — the request would go out with no Authorization header
 *    at all, which is the silent-401 path this whole change removes.
 *
 * 60s clears both with room to spare, and costs at most one extra refresh over
 * the hour-long life of a Cognito access token.
 */
const REFRESH_LEAD_MS = 60_000;

function needsRefresh(tokens: StoredTokens): boolean {
  return Date.now() >= tokens.expiresAt - REFRESH_LEAD_MS;
}

/**
 * The refresh in flight, if there is one.
 *
 * A console page issues several requests at once — the deck list, the publish
 * jobs poller and the manifest all fire together on mount — and without this
 * they would each notice the same expired token and start their own refresh.
 * That is not merely wasteful: Cognito can rotate or invalidate a refresh
 * token, so the later calls race to spend a value the first one may already
 * have replaced, and the loser signs the user out.
 *
 * Every caller that arrives while a refresh is running awaits that same
 * promise instead. It is cleared when the refresh settles, so the next expiry
 * starts a new one rather than replaying a stale result.
 */
let refreshInFlight: Promise<StoredTokens | null> | null = null;

function refreshOnce(refreshToken: string): Promise<StoredTokens | null> {
  refreshInFlight ??= refreshTokens(refreshToken)
    .then(resp =>
      saveTokens({
        accessToken: resp.access_token,
        idToken: resp.id_token,
        // Kept rather than overwritten. Cognito's refresh_token grant does not
        // return a refresh token, so `resp.refresh_token` is normally
        // undefined; writing it through would erase the only thing that can
        // revive the session and make the SECOND expiry a hard sign-out — the
        // same defect this change is removing, one hour later.
        refreshToken: resp.refresh_token ?? refreshToken,
        tokenType: resp.token_type,
        expiresIn: resp.expires_in,
      }),
    )
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/**
 * Whether this page has already given up and sent the browser to /login.
 *
 * The same fan-out that makes the refresh singleton necessary applies here: a
 * dead session fails every in-flight request, and each 401 used to call
 * location.assign() again. Repeat navigations to the same URL are not free —
 * they stack history entries and can restart the requests that are still
 * settling — so the first one wins and the rest are dropped. It is deliberately
 * never reset: once the browser is leaving, nothing later in this document's
 * life has anything to add.
 */
let redirectedToLogin = false;

function redirectToLogin(reason: string): void {
  if (typeof window === 'undefined') return;
  if (redirectedToLogin) return;
  redirectedToLogin = true;

  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}&error=${reason}`);
}

// Attach the bearer token, refreshing it first if it is about to expire.
//
// This interceptor is async on purpose: axios awaits what it returns, so the
// request is held until the refresh lands and then goes out with a token that
// is actually valid. The version before this one read a token synchronously,
// got null the moment it expired, and let the request leave with no
// Authorization header at all — the server said 401, the response handler
// below signed the user out, and whatever was being edited went with it.
http.interceptors.request.use(async cfg => {
  // readStoredTokens, not getAccessToken: this is the one caller that wants
  // the record even when the access token in it is dead, because the refresh
  // token is the point.
  const stored = readStoredTokens();
  if (!stored) return cfg;

  let usable: StoredTokens | null = stored;

  if (needsRefresh(stored)) {
    usable = stored.refreshToken ? await refreshOnce(stored.refreshToken) : null;

    if (!usable) {
      // Either there was nothing to refresh with, or Cognito refused. Now the
      // session really is over, so clearing is right — which it was not before
      // the refresh had been tried.
      clearStoredTokens();
      redirectToLogin('session_expired');

      // Rejected rather than sent anyway. The request is already known to be
      // unauthenticated, so letting it out only buys a round trip and a 401
      // that says the same thing later. Axios routes a request-interceptor
      // rejection past dispatchRequest to the response handler below, where it
      // arrives with no `response` and therefore no status — so this cannot
      // re-enter the 401 branch. Callers see a failed ApiResult carrying this
      // message, which is what the api layer does with any Error.
      throw new Error('Your session expired. Please sign in again.');
    }
  }

  cfg.headers = cfg.headers ?? {};
  cfg.headers.Authorization = `Bearer ${usable.accessToken}`;
  return cfg;
});

// A 401 on a request that did carry a fresh token means the session is not
// recoverable by refreshing — the token was rejected for some other reason, or
// it was revoked between being issued and being used. Requests whose refresh
// already failed never reach the server, so they never arrive here with a
// status at all.
http.interceptors.response.use(
  res => res,
  err => {
    const status = err?.response?.status;
    if (status === 401) {
      clearStoredTokens();
      redirectToLogin('unauthorized');
    }
    return Promise.reject(err);
  },
);
