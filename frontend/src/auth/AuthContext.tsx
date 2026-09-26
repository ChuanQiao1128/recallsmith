/* eslint-disable react-refresh/only-export-components */
// src/auth/AuthContext.tsx
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AUTH_CONFIGURED } from './authConfig';
import { buildLogoutUrl, startLogin, type OAuthTokenResponse } from './cognito';
import {
  clearTokens,
  getSessionUser,
  getTokens,
  saveTokens,
  type SessionUser,
  type StoredTokens,
} from './tokenStore';

export type AuthStatus = 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  status: AuthStatus;
  tokens: StoredTokens | null;
  user: SessionUser | null;
  isAuthenticated: boolean;

  signIn: (nextUrl: string) => Promise<void>;
  completeSignIn: (tokenResponse: OAuthTokenResponse) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<StoredTokens | null>(() => getTokens());
  const user = useMemo(() => getSessionUser(tokens), [tokens]);

  // With no Cognito configured, treat the session as signed in locally rather
  // than blocking every page behind an auth stack that does not exist.
  const status: AuthStatus =
    AUTH_CONFIGURED ? (tokens ? 'authenticated' : 'unauthenticated') : 'authenticated';

  async function signIn(nextUrl: string) {
    if (!AUTH_CONFIGURED) return;
    await startLogin(nextUrl);
  }

  function completeSignIn(tokenResponse: OAuthTokenResponse) {
    const stored = saveTokens({
      accessToken: tokenResponse.access_token,
      idToken: tokenResponse.id_token,
      refreshToken: tokenResponse.refresh_token,
      tokenType: tokenResponse.token_type,
      expiresIn: tokenResponse.expires_in,
    });
    setTokens(stored);
  }

  function signOut() {
    clearTokens();
    setTokens(null);
    if (AUTH_CONFIGURED) window.location.assign(buildLogoutUrl());
  }

  return (
    <AuthContext.Provider
      value={{
        status,
        tokens,
        user,
        isAuthenticated: status === 'authenticated',
        signIn,
        completeSignIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>.');
  return ctx;
}

/**
 * What `useSignOut()` returns when no provider is above it.
 *
 * A thrown "useAuth must be used within <AuthProvider>" is the usual shape here
 * and it is the wrong one for this repository. The real application always mounts
 * <AuthProvider> at its root (src/main.tsx), so this path is never taken there.
 * Page-level tests, however, mount pages bare — `<MemoryRouter><CardListPage />`
 * with no auth shell — on purpose, because the shell is not what they assert.
 * Throwing would turn every one of those files red for a reason unrelated to
 * what it tests, and the cheapest way back to green would be to wrap them all,
 * which quietly deletes the distinction between "this page works on its own" and
 * "this page works inside the app".
 *
 * So a missing provider degrades to dropping the session directly: the tokens
 * are cleared, and when Cognito is configured the browser is sent to the hosted
 * logout — the behaviour the four per-page handlers had before this hook existed.
 * The context's in-memory `tokens` state cannot be reset from here (there is no
 * provider holding it), but there is no session left for it to describe either.
 * This mirrors useConfirm's windowConfirmFallback in
 * src/components/ui/ConfirmDialogContext.ts.
 */
function signOutWithoutProvider(): void {
  clearTokens();
  if (AUTH_CONFIGURED) window.location.assign(buildLogoutUrl());
}

/**
 * The sign-out function for the tree above this component, or the provider-free
 * fallback. ConsoleShell calls it, so every page that renders through the shell
 * signs out through AuthContext.signOut in the real app — which also resets the
 * context's tokens state — and through signOutWithoutProvider in a bare page
 * test. Kept beside the provider (not barrelled in src/hooks) because it reads
 * this file's context, exactly as useConfirm reads ConfirmDialogContext.
 */
export function useSignOut(): () => void {
  return useContext(AuthContext)?.signOut ?? signOutWithoutProvider;
}