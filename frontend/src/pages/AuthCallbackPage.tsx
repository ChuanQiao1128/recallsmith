import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { consumePostLoginRedirect, exchangeCodeForTokens } from '../auth/cognito';
import { useAuth } from '../auth/AuthContext';

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const err = searchParams.get('error');
    const errDesc = searchParams.get('error_description');
    if (err) {
      const qs = new URLSearchParams();
      qs.set('error', err);
      if (errDesc) qs.set('error_description', errDesc);
      navigate(`/login?${qs.toString()}`, { replace: true });
      return;
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state) {
      navigate('/login?error=missing_code', { replace: true });
      return;
    }

    (async () => {
      try {
        const tokenResp = await exchangeCodeForTokens(code, state);
        auth.completeSignIn(tokenResp);
        navigate(consumePostLoginRedirect(), { replace: true });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Sign-in failed.';
        navigate(`/login?error=${encodeURIComponent(msg)}`, { replace: true });
      }
    })();
  }, [auth, navigate, searchParams]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <h1 className="text-xl font-semibold text-slate-800">Signing in...</h1>
        <p className="text-sm text-slate-600 mt-2">Processing Cognito callback.</p>
        <div className="mt-4">
          <Link to="/login" className="text-sm text-indigo-600 hover:text-indigo-800">← Back to Login</Link>
        </div>
      </div>
    </div>
  );
}