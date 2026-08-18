// @vitest-environment jsdom
//
// What happens to a session — and to whatever is on screen — when the access
// token ages out.
//
// The behaviour this replaces: getTokens() deleted the whole record the moment
// the token expired, refresh token included, so the next request left with no
// Authorization header, came back 401, and the response interceptor sent the
// browser to /login. A full-document navigation, mid-edit, with the value that
// could have prevented it deleted one function call earlier. The refresh token
// had been written to sessionStorage since the OAuth callback was first
// implemented and read by nothing in the codebase.
//
// ---------------------------------------------------------------------------
// HOW THE INTERCEPTORS ARE REACHED
// ---------------------------------------------------------------------------
// Through a real `http.get()`, with `http.defaults.adapter` replaced. Calling
// `http.interceptors.request.handlers[0].fulfilled(config)` by hand would be
// shorter and would assert against a chain axios might not run in that order,
// with headers it might not have normalised yet. Swapping the adapter is the
// only seam that leaves every other part of axios in place, and it is also how
// the response half gets a 401 to react to.
//
// ---------------------------------------------------------------------------
// WHY EACH TEST RE-IMPORTS THE MODULE
// ---------------------------------------------------------------------------
// Both fixes are module-level state — the single in-flight refresh promise and
// the one-shot redirect latch — and module state that survives between tests is
// state one test can hand to another. vi.resetModules() before each import
// gives every case a module as fresh as a page load, which is the only
// condition under which "exactly once" means anything.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';

const cognito = vi.hoisted(() => ({ refreshTokens: vi.fn() }));

vi.mock('../src/auth/cognito', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/auth/cognito')>();
  return { ...actual, ...cognito };
});

const TOKEN_KEY = 'devcards:tokens';

/** A token response shaped like Cognito's, with a distinguishable access token. */
function cognitoRefreshResponse(marker: string) {
  return {
    access_token: `access-${marker}`,
    id_token: `id-${marker}`,
    // Absent on purpose: Cognito's refresh_token grant does not return one.
    // The store is expected to keep the token it already had.
    expires_in: 3600,
    token_type: 'Bearer',
  };
}

/** Put a session in storage whose access token expires in `secondsLeft`. */
function storeSession(secondsLeft: number, refreshToken?: string): void {
  sessionStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: 'access-original',
      idToken: 'id-original',
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: Date.now() + secondsLeft * 1000,
    }),
  );
}

function storedSession(): Record<string, unknown> | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

/** Every URL the module handed to location.assign, in order. */
let assigned: string[] = [];
let realLocation: PropertyDescriptor | undefined;

/** The Authorization header each request reached the adapter with. */
let sentAuth: (string | null)[] = [];

function authHeaderOf(config: InternalAxiosRequestConfig): string | null {
  const value = (config.headers as AxiosHeaders).get('Authorization');
  return typeof value === 'string' ? value : null;
}

/**
 * Load a fresh copy of the module and give it an adapter that records what it
 * was handed. `status` drives whether the response half of the chain sees a
 * successful call or a 401.
 */
async function loadHttp(status: 200 | 401 = 200) {
  vi.resetModules();
  const { http } = await import('../src/api/http');

  http.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    sentAuth.push(authHeaderOf(config));
    if (status === 401) {
      // The shape the interceptor reads. Axios's own adapters reject with an
      // AxiosError built by settle(); a custom adapter has to reject itself,
      // because resolving with a 4xx status does not fail the request.
      return Promise.reject({ isAxiosError: true, config, response: { status: 401, data: null } });
    }
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  };

  return http;
}

beforeEach(() => {
  sessionStorage.clear();
  assigned = [];
  sentAuth = [];
  cognito.refreshTokens.mockReset();

  // jsdom's Location has non-configurable methods, so assign() cannot be
  // spied — but `window.location` itself is configurable, so the whole object
  // can be swapped and put back. pathname/search are set to something specific
  // because the redirect is supposed to preserve them in `?next=`.
  realLocation = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/decks/edit',
      search: '?id=7',
      assign: (url: string) => {
        assigned.push(url);
      },
    },
  });
});

afterEach(() => {
  if (realLocation) Object.defineProperty(window, 'location', realLocation);
  sessionStorage.clear();
});

describe('a request made while the access token is still good', () => {
  it('goes out with that token and refreshes nothing', async () => {
    storeSession(3600, 'refresh-original');
    const http = await loadHttp();

    await http.get('/api/v1/authoring/decks');

    expect(cognito.refreshTokens).not.toHaveBeenCalled();
    expect(sentAuth).toEqual(['Bearer access-original']);
  });
});

describe('a request made once the access token has expired', () => {
  it('refreshes first, then goes out with the new token', async () => {
    // The whole point: nothing 401s, nothing navigates, the caller just gets
    // its response. A page mid-edit never finds out this happened.
    storeSession(-60, 'refresh-original');
    cognito.refreshTokens.mockResolvedValue(cognitoRefreshResponse('renewed'));
    const http = await loadHttp();

    const response = await http.get('/api/v1/authoring/decks');

    expect(cognito.refreshTokens).toHaveBeenCalledWith('refresh-original');
    expect(sentAuth).toEqual(['Bearer access-renewed']);
    expect(response.status).toBe(200);
    expect(assigned).toEqual([]);
  });

  it('keeps the refresh token Cognito did not send back', async () => {
    // Cognito's refresh grant returns access_token and id_token and no
    // refresh_token. Writing the response through verbatim would store
    // undefined over the only value that can revive the session, and the
    // SECOND expiry would be the hard sign-out this change just removed.
    storeSession(-60, 'refresh-original');
    cognito.refreshTokens.mockResolvedValue(cognitoRefreshResponse('renewed'));
    const http = await loadHttp();

    await http.get('/api/v1/authoring/decks');

    expect(storedSession()).toMatchObject({
      accessToken: 'access-renewed',
      idToken: 'id-renewed',
      refreshToken: 'refresh-original',
    });
  });

  it('refreshes a token that is merely about to expire, before it can fail in flight', async () => {
    // 20 seconds left is inside the 60s lead time. It is also inside
    // tokenStore's own 30s skew, which is what makes this case matter rather
    // than being a nicety: below that line the store already calls the token
    // dead, so a request that did not refresh here would go out with no
    // Authorization header at all.
    storeSession(20, 'refresh-original');
    cognito.refreshTokens.mockResolvedValue(cognitoRefreshResponse('renewed'));
    const http = await loadHttp();

    await http.get('/api/v1/authoring/decks');

    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(sentAuth).toEqual(['Bearer access-renewed']);
  });
});

describe('several requests that all notice the expiry at once', () => {
  it('share one refresh instead of racing', async () => {
    // This is the case a console page produces on every cold mount: the deck
    // list, the manifest and the publish-jobs poller all fire together. Without
    // the shared promise each would spend the refresh token separately, and
    // against a provider that rotates them the losers are signed out.
    storeSession(-60, 'refresh-original');

    let release: (value: unknown) => void = () => {};
    const pending = new Promise(resolve => {
      release = resolve;
    });
    // Held open on purpose, so all three requests are provably inside the
    // window at the same time rather than passing through it one at a time.
    cognito.refreshTokens.mockReturnValue(pending);

    const http = await loadHttp();

    const inFlight = Promise.all([
      http.get('/api/v1/authoring/decks'),
      http.get('/api/v1/authoring/cards'),
      http.get('/api/v1/authoring/publish'),
    ]);

    await Promise.resolve();
    await Promise.resolve();
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);

    release(cognitoRefreshResponse('renewed'));
    await inFlight;

    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(sentAuth).toEqual([
      'Bearer access-renewed',
      'Bearer access-renewed',
      'Bearer access-renewed',
    ]);
  });

  it('starts a new refresh for a later expiry rather than replaying the old promise', async () => {
    // The singleton has to be released when it settles. A version that latched
    // forever would pass the test above and then serve a stale token for the
    // rest of the session — which is the same class of defect, inverted.
    storeSession(-60, 'refresh-original');
    cognito.refreshTokens
      .mockResolvedValueOnce(cognitoRefreshResponse('first'))
      .mockResolvedValueOnce(cognitoRefreshResponse('second'));
    const http = await loadHttp();

    await http.get('/api/v1/authoring/decks');
    // Age the freshly-stored session out again.
    storeSession(-60, 'refresh-original');
    await http.get('/api/v1/authoring/cards');

    expect(cognito.refreshTokens).toHaveBeenCalledTimes(2);
    expect(sentAuth).toEqual(['Bearer access-first', 'Bearer access-second']);
  });
});

describe('a refresh the provider refuses', () => {
  it('drops the session and sends the browser to login once', async () => {
    storeSession(-60, 'refresh-original');
    cognito.refreshTokens.mockRejectedValue(new Error('Token refresh failed: HTTP 400'));
    const http = await loadHttp();

    // The caller is rejected rather than served a doomed round trip, with a
    // message the api layer turns into a failed ApiResult.
    await expect(http.get('/api/v1/authoring/decks')).rejects.toThrow(
      'Your session expired. Please sign in again.',
    );
    // Nothing reached the adapter: the request was stopped before it left.
    expect(sentAuth).toEqual([]);
    expect(storedSession()).toBeNull();
    expect(assigned).toEqual([
      `/login?next=${encodeURIComponent('/decks/edit?id=7')}&error=session_expired`,
    ]);
  });

  it('gives up together when the whole page notices the expiry at once', async () => {
    // The success version of this fan-out is asserted above; this is the same
    // three requests against a refresh that fails, and it is the case where the
    // two module-level guards have to cooperate rather than merely both exist.
    // The refresh singleton has to hold, so one dead refresh token is spent
    // once instead of three times, AND the redirect latch has to hold across
    // three separate interceptor invocations that each independently conclude
    // the session is over. Getting either one wrong looks identical from a
    // single request, which is all the existing case exercises.
    storeSession(-60, 'refresh-original');

    let refuse: (reason: unknown) => void = () => {};
    const pending = new Promise((_resolve, reject) => {
      refuse = reject;
    });
    // Held open so all three are provably inside the refresh window together.
    cognito.refreshTokens.mockReturnValue(pending);

    const http = await loadHttp();

    const settled = Promise.allSettled([
      http.get('/api/v1/authoring/decks'),
      http.get('/api/v1/authoring/cards'),
      http.get('/api/v1/authoring/publish'),
    ]);

    await Promise.resolve();
    await Promise.resolve();
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);

    refuse(new Error('Token refresh failed: HTTP 400'));
    const outcomes = await settled;

    // Every caller hears about it — none is left hanging on a promise the
    // refresh failure resolved for somebody else.
    expect(outcomes.map(o => o.status)).toEqual(['rejected', 'rejected', 'rejected']);
    for (const outcome of outcomes) {
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({
        message: 'Your session expired. Please sign in again.',
      });
    }

    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(sentAuth).toEqual([]);
    expect(storedSession()).toBeNull();
    expect(assigned).toEqual([
      `/login?next=${encodeURIComponent('/decks/edit?id=7')}&error=session_expired`,
    ]);
  });

  it('does not try to refresh a session that has no refresh token', async () => {
    // The pre-Cognito-refresh sessions, and any provider that declines to issue
    // one. There is nothing to spend, so this is a genuine sign-out.
    storeSession(-60, undefined);
    const http = await loadHttp();

    await expect(http.get('/api/v1/authoring/decks')).rejects.toThrow(
      'Your session expired. Please sign in again.',
    );

    expect(cognito.refreshTokens).not.toHaveBeenCalled();
    expect(storedSession()).toBeNull();
    expect(assigned).toHaveLength(1);
  });
});

describe('a 401 that refreshing cannot explain', () => {
  it('navigates to login exactly once no matter how many requests fail', async () => {
    // Every in-flight request fails together when a session dies. Each 401 used
    // to call location.assign(), stacking history entries and re-entering the
    // login page while the other responses were still settling.
    storeSession(3600, 'refresh-original');
    const http = await loadHttp(401);

    await Promise.allSettled([
      http.get('/api/v1/authoring/decks'),
      http.get('/api/v1/authoring/cards'),
      http.get('/api/v1/authoring/publish'),
    ]);

    expect(sentAuth).toHaveLength(3);
    expect(assigned).toEqual([
      `/login?next=${encodeURIComponent('/decks/edit?id=7')}&error=unauthorized`,
    ]);
    expect(storedSession()).toBeNull();
    // And it does NOT reach for the refresh token, which is sitting right
    // there. That is the design decision in the comment above this interceptor
    // written down: a token that was fresh when it left and was still refused
    // was not refused for being old, so refreshing it would spend the one value
    // that can revive the session on a question already answered. Without this
    // line the paragraph is the only thing holding the behaviour.
    expect(cognito.refreshTokens).not.toHaveBeenCalled();
  });

  it('does not navigate a second time for a session already given up on', async () => {
    // The two redirect reasons come from opposite ends of the chain — the
    // request interceptor says `session_expired`, the response interceptor says
    // `unauthorized` — and a real page produces both in this order: the first
    // call finds the token dead and the refresh refused, and a later call, now
    // with an empty store, goes out bare and is refused by the server.
    //
    // One latch has to cover both. Per-reason latches would pass every other
    // case in this file and still stack two navigations here, which is the
    // history-entry pile-up the latch exists to stop.
    storeSession(-60, 'refresh-original');
    cognito.refreshTokens.mockRejectedValue(new Error('Token refresh failed: HTTP 400'));
    const http = await loadHttp(401);

    await expect(http.get('/api/v1/authoring/decks')).rejects.toThrow(
      'Your session expired. Please sign in again.',
    );
    expect(assigned).toEqual([
      `/login?next=${encodeURIComponent('/decks/edit?id=7')}&error=session_expired`,
    ]);

    // Storage is empty now, so this one is not stopped by the request
    // interceptor at all: it leaves without an Authorization header and the
    // server answers 401.
    await expect(http.get('/api/v1/authoring/cards')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(sentAuth).toEqual([null]);

    expect(assigned).toHaveLength(1);
  });
});
