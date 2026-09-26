import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AUTH_CONFIGURED, AUTH_CONFIG } from '../auth/authConfig';
import { useAuth } from '../auth/AuthContext';
import { CONSOLE_NAME } from '../lib/brand';
// Was a four-line local copy that let `//evil.com` through. It now lives in
// src/auth/safeRedirect.ts so this page and the OAuth callback share one
// answer; see that file for what the leading-slash test missed.
import { sanitizeNextUrl } from '../auth/safeRedirect';

export function LoginPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();

  const nextUrl = useMemo(() => sanitizeNextUrl(searchParams.get('next')), [searchParams]);
  // The error code arrives via the URL, and anyone can put anything in a URL.
  // Rendering it verbatim let a plain link place attacker-chosen text inside
  // this page's official red box. React escapes it, so it was never XSS, but a
  // phishing sentence in the product's own voice does not need script tags to
  // do damage. Codes map to fixed copy; anything unrecognised gets the generic
  // sentence, and error_description is never read at all.
  const ERROR_COPY: Record<string, string> = {
    access_denied: 'Sign-in was cancelled before it finished.',
    missing_code: 'The sign-in response was incomplete. Please try again.',
    exchange_failed: 'Sign-in could not be completed. Please try again.',
    session_expired: 'Your session expired. Sign in again to pick up where you left off.',
    unauthorized: 'Your session is no longer valid. Sign in again to continue.',
  };
  const errCode = searchParams.get('error');
  const err = errCode ? (ERROR_COPY[errCode] ?? 'Something went wrong during sign-in. Please try again.') : '';
  // An idle-timeout redirect is not a failed sign-in — the last one worked and
  // then aged out — so those two codes get an honest heading. Every other code
  // keeps "Sign-in failed".
  const errHeading = errCode === 'session_expired' || errCode === 'unauthorized' ? 'Session ended' : 'Sign-in failed';

  const [loading, setLoading] = useState(false);
  // Read import.meta.env.DEV in the component body, not at module scope, so a
  // test can stub it: the Cognito configuration is a developer aid and must not
  // show on the production login page.
  const config = import.meta.env.DEV && AUTH_CONFIGURED ? AUTH_CONFIG : null;

  if (auth.isAuthenticated) return <Navigate to={nextUrl} replace />;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h1 className="text-xl font-semibold text-slate-800">Sign in</h1>
        <p className="text-xs text-slate-500 mt-1">{CONSOLE_NAME}</p>

        {err ? (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
            <div className="font-semibold">{errHeading}</div>
            <div className="text-xs mt-1">{err}</div>
          </div>
        ) : null}

        {!AUTH_CONFIGURED ? (
          <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded text-sm">
            <div className="font-semibold mb-1">Auth is not configured</div>
            <div className="text-xs">
              Please set env vars: <span className="font-mono">VITE_COGNITO_DOMAIN</span>,{' '}
              <span className="font-mono">VITE_COGNITO_CLIENT_ID</span>,{' '}
              <span className="font-mono">VITE_COGNITO_REDIRECT_URI</span>.
            </div>
          </div>
        ) : null}

        <button
          type="button"
          disabled={!AUTH_CONFIGURED || loading}
          className="mt-4 w-full inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium
                     bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                     disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={async () => {
            try {
              setLoading(true);
              await auth.signIn(nextUrl);
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? 'Redirecting...' : 'Sign in'}
        </button>

        {config ? (
          <div className="mt-4 text-[11px] text-slate-500 space-y-1">
            <div>Domain: <span className="font-mono">{config.domain}</span></div>
            <div>ClientId: <span className="font-mono">{config.clientId}</span></div>
            <div>Redirect: <span className="font-mono">{config.redirectUri}</span></div>
            <div>Scopes: <span className="font-mono">{config.scopes.join(' ')}</span></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}