// @vitest-environment jsdom
//
// What the token store does at the moment the access token dies.
//
// This is the layer the lost-draft bug actually lived in. getTokens() treated
// "the access token expired" and "the session is over" as the same event and
// deleted the record for both — including the refresh token beside it, which
// nothing in the codebase had ever read. By the time http.ts noticed anything
// was wrong there was nothing left to recover with, so the only move left was
// a hard navigation to /login.
//
// The distinction asserted below is the fix: an expired token with a way back
// is a session that needs a round trip; an expired token with no way back is a
// session that is finished. Only the second one gets deleted.
//
// getAccessToken() is asserted alongside because splitting those two meanings
// puts a new obligation on it — getTokens() returning non-null no longer means
// the string inside is safe to put in an Authorization header, and
// getAccessToken() is the caller that must still refuse it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearTokens,
  getAccessToken,
  getIdToken,
  getTokens,
  isExpired,
  readStoredTokens,
} from '../src/auth/tokenStore';

const TOKEN_KEY = 'devcards:tokens';

function write(secondsLeft: number, refreshToken?: string): void {
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

function rawStored(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe('a session whose access token is still good', () => {
  it('is returned, and its token is usable', () => {
    // The control case: every assertion below is about refusing or preserving
    // something, and a store that returned null for everything would satisfy
    // half of them.
    write(3600, 'refresh-original');

    expect(getTokens()).toMatchObject({ accessToken: 'access-original' });
    expect(getAccessToken()).toBe('access-original');
    expect(getIdToken()).toBe('id-original');
  });
});

describe('a session whose access token has expired but that can be refreshed', () => {
  it('survives in storage instead of being deleted', () => {
    // The regression this file exists for. Reading the session must not be the
    // act that destroys the refresh token, because the read happens on the very
    // request that was about to use it.
    write(-60, 'refresh-original');

    getTokens();

    expect(rawStored()).not.toBeNull();
    expect(readStoredTokens()).toMatchObject({ refreshToken: 'refresh-original' });
  });

  it('is still reported as a session, so the console does not blank out', () => {
    write(-60, 'refresh-original');

    expect(getTokens()).toMatchObject({
      accessToken: 'access-original',
      refreshToken: 'refresh-original',
    });
  });

  it('will not hand out its expired token as a bearer credential', () => {
    // The other half of that split. getTokens() answering "there is a session"
    // must not be readable as "this string is a valid token" — the request
    // interceptor refreshes before sending, and anything that skips it gets
    // null rather than a token the server will reject.
    write(-60, 'refresh-original');

    expect(getAccessToken()).toBeNull();
    expect(getIdToken()).toBeNull();
  });

  it('counts the 30-second skew as expired, on both sides of the split', () => {
    // 10 seconds of nominal life left is inside EXPIRY_SKEW_MS, so the token is
    // already unusable while the session is still perfectly refreshable.
    write(10, 'refresh-original');

    expect(isExpired(readStoredTokens()!)).toBe(true);
    expect(getAccessToken()).toBeNull();
    expect(rawStored()).not.toBeNull();
  });
});

describe('a session whose access token has expired with no way back', () => {
  it('is dropped, because there is nothing in it to revive', () => {
    write(-60, undefined);

    expect(getTokens()).toBeNull();
    expect(rawStored()).toBeNull();
  });
});

describe('a storage entry that is not a session at all', () => {
  it('is cleared on read', () => {
    // Unchanged behaviour, asserted so the new early return in readStoredTokens
    // cannot quietly start preserving garbage.
    sessionStorage.setItem(TOKEN_KEY, '{not json');
    expect(readStoredTokens()).toBeNull();
    expect(rawStored()).toBeNull();

    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 'a' }));
    expect(getTokens()).toBeNull();
    expect(rawStored()).toBeNull();
  });

  it('reports no session when storage is empty', () => {
    clearTokens();
    expect(readStoredTokens()).toBeNull();
    expect(getTokens()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});
