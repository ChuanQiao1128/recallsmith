// mobile/src/auth/freshToken.ts
//
// One coalesced reader of the Cognito session. The app used to read the session
// only at init() and sign-in, so a resumed-after-an-hour app kept pushing/pulling
// with an expired access token until the next cold start. getFreshAccessToken()
// re-reads the session, updates the store and the sync layer, and is called on
// every foreground and once from the API client on a 401.
import { fetchAuthSession } from 'aws-amplify/auth';

import { setSyncAccessToken } from '../sync/progressSync';
import { setAccessTokenRefresher } from '../api/apiClient';
import { useAuthStore } from './authStore';

function tokenToString(t: any): string | null {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (typeof t?.toString === 'function') return String(t.toString());
  return null;
}

// Concurrent callers (foreground + a 401 retry, say) share one in-flight
// fetchAuthSession so we never fan out into several refreshes at once.
let _inFlight: Promise<string | null> | null = null;

async function doRefresh(forceRefresh: boolean): Promise<string | null> {
  let session: any;
  try {
    session = await fetchAuthSession({ forceRefresh });
  } catch {
    // Transient/offline throw: change nothing, keep the existing session.
    return null;
  }

  const accessToken = tokenToString(session?.tokens?.accessToken) ?? null;
  const idToken = tokenToString(session?.tokens?.idToken) ?? null;

  if (!accessToken) {
    // Amplify returned no tokens => the refresh token really expired.
    await useAuthStore.getState().markSessionExpired();
    return null;
  }

  if (accessToken !== useAuthStore.getState().accessToken) {
    useAuthStore.setState({ accessToken, idToken });
    await setSyncAccessToken(accessToken);
  }

  return accessToken;
}

export function getFreshAccessToken(options?: { forceRefresh?: boolean }): Promise<string | null> {
  if (useAuthStore.getState().status !== 'signed_in') {
    return Promise.resolve(null);
  }
  if (_inFlight) return _inFlight;

  const forceRefresh = options?.forceRefresh === true;
  _inFlight = doRefresh(forceRefresh).finally(() => {
    _inFlight = null;
  });
  return _inFlight;
}

export async function refreshAuthOnForeground(): Promise<void> {
  const state = useAuthStore.getState();
  if (state.status === 'signed_in') {
    await getFreshAccessToken();
  } else if (state.initRetryPending) {
    // A prior offline cold start left the session in limbo; re-init now that we
    // are foreground again (and possibly back online).
    await state.init();
  }
}

export function installAccessTokenRefresher(): void {
  setAccessTokenRefresher(() => getFreshAccessToken({ forceRefresh: true }));
}
