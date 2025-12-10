import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearStoredTokens, getStoredTokens, isExpired, setStoredTokens } from './tokenStore';
import { buildLogoutUrl, consumePostLoginRedirect, exchangeCodeForTokens, startLogin } from './cognito';
import { userFromIdToken, type AuthUser } from './jwt';

type AuthState = {
  loading: boolean;
  isAuthed: boolean;
  user: AuthUser | null;
  idToken: string | null;
  accessToken: string | null;

  signIn: (nextUrl: string) => Promise<void>;
  signOut: () => void;

  completeRedirect: (search: URLSearchParams) => Promise<string>; // returns nextUrl
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const t = getStoredTokens();
    if (!t || isExpired(t)) {
      clearStoredTokens();
      setIdToken(null);
      setAccessToken(null);
      setUser(null);
      setLoading(false);
      return;
    }

    setIdToken(t.idToken);
    setAccessToken(t.accessToken);
    setUser(userFromIdToken(t.idToken));
    setLoading(false);
  }, []);

  const api: AuthState = useMemo(
    () => ({
      loading,
      isAuthed: !!accessToken && !!idToken,
      user,
      idToken,
      accessToken,

      async signIn(nextUrl: string) {
        await startLogin(nextUrl);
      },

      signOut() {
        clearStoredTokens();
        setIdToken(null);
        setAccessToken(null);
        setUser(null);
        window.location.assign(buildLogoutUrl());
      },

      async completeRedirect(search: URLSearchParams) {
        const err = search.get('error');
        if (err) {
          const desc = search.get('error_description') ?? '';
          throw new Error(`${err}${desc ? `: ${desc}` : ''}`);
        }

        const code = search.get('code');
        const state = search.get('state');

        if (!code || !state) throw new Error('Missing code/state in callback.');

        const tokens = await exchangeCodeForTokens(code, state);

        const expiresAt = Date.now() + tokens.expires_in * 1000;
        setStoredTokens({
          accessToken: tokens.access_token,
          idToken: tokens.id_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
        });

        setIdToken(tokens.id_token);
        setAccessToken(tokens.access_token);
        setUser(userFromIdToken(tokens.id_token));

        return consumePostLoginRedirect();
      },
    }),
    [accessToken, idToken, loading, user],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}