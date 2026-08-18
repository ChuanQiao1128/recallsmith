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