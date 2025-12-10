import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AUTH_CONFIGURED } from './authConfig';
import { useAuth } from './AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!AUTH_CONFIGURED) return <>{children}</>;
  if (isAuthenticated) return <>{children}</>;

  const next = encodeURIComponent(`${location.pathname}${location.search}`);
  return <Navigate to={`/login?next=${next}`} replace />;
}