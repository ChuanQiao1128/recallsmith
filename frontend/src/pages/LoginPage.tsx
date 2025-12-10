import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AUTH_CONFIGURED, AUTH_CONFIG } from '../auth/authConfig';
import { useAuth } from '../auth/AuthContext';

function sanitizeNextUrl(next: string | null): string {
  const v = (next ?? '').trim();
  if (!v.startsWith('/')) return '/';
  return v;
}

export function LoginPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();

  const nextUrl = useMemo(() => sanitizeNextUrl(searchParams.get('next')), [searchParams]);
  const err = searchParams.get('error') ?? '';
  const errDesc = searchParams.get('error_description') ?? '';

  const [loading, setLoading] = useState(false);
  const config = AUTH_CONFIGURED ? AUTH_CONFIG : null;

  if (auth.isAuthenticated) return <Navigate to={nextUrl} replace />;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h1 className="text-xl font-semibold text-slate-800">Sign in</h1>
        <p className="text-xs text-slate-500 mt-1">RecallSmith Authoring Console</p>

        {err ? (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
            <div className="font-semibold">Sign-in failed</div>
            <div className="text-xs mt-1">
              {err}
              {errDesc ? `: ${errDesc}` : ''}
            </div>
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
          {loading ? 'Redirecting...' : 'Continue with Cognito'}
        </button>

        {config ? (
          <div className="mt-4 text-[11px] text-slate-500 space-y-1">
            <div>Domain: <span className="font-mono">{config.domain}</span></div>
            <div>ClientId: <span className="font-mono">{config.clientId}</span></div>
            <div>Redirect: <span className="font-mono">{config.redirectUri}</span></div>
            <div>Scopes: <span className="font-mono">{config.scopes.join(' ')}</span></div>
          </div>
        ) : null}

        <div className="mt-4">
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">← Back to Home</Link>
        </div>
      </div>
    </div>
  );
}