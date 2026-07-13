// src/auth/signOut.ts
//
// Single source-of-truth for "the user is leaving". Replaces the inline
// clearStoredTokens() + window.location.assign(buildLogoutUrl()) pattern that
// was duplicated across DeckListPage, AdminUsersPage, NewDeckPage, etc.
//
// Why centralize:
//   - The previous implementation didn't clear the per-user localStorage cache,
//     so the next user signing in on the same browser briefly saw the previous
//     user's deck list.
//   - Each page that started its own polling timer needs a chance to stop it.
//   - One place to add telemetry / analytics if/when we want it.
import { buildLogoutUrl } from './cognito';
import { clearStoredTokens } from './tokenStore';

// Keep this list in sync with cache keys used by pages.
const CACHE_KEYS = [
  'recallsmith_decks_cache',
  'recallsmith_manifest_cache',
];

export interface SignOutOptions {
  /**
   * Run before tokens are cleared — pages can stop polling timers, abort
   * in-flight requests, etc. Errors here are caught and logged so they don't
   * block the logout.
   */
  beforeSignOut?: () => void;
  /**
   * If false, return after clearing local state instead of redirecting to the
   * Cognito logout URL. Useful when a caller wants to do its own navigation.
   */
  redirect?: boolean;
}

export function signOut(options: SignOutOptions = {}): void {
  const { beforeSignOut, redirect = true } = options;

  if (beforeSignOut) {
    try {
      beforeSignOut();
    } catch (err) {
      console.warn('[signOut] beforeSignOut hook threw:', err);
    }
  }

  // 1) Per-user caches first — even if logout url fails, we don't want stale
  //    data to leak across users.
  for (const key of CACHE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore quota / privacy-mode errors
    }
  }

  // 2) Tokens.
  clearStoredTokens();

  // 3) Off to Cognito.
  if (redirect) {
    try {
      window.location.assign(buildLogoutUrl());
    } catch (err) {
      console.warn('[signOut] buildLogoutUrl failed; falling back to /login:', err);
      window.location.assign('/login');
    }
  }
}
