import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireGroup({
  anyOf,
  children,
}: {
  anyOf: string[];
  children: React.ReactElement;
}) {
  const auth = useAuth();
  const groups = auth.user?.groups ?? [];
  const ok = anyOf.some(g => groups.includes(g));

  if (!ok) return <Navigate to="/" replace />;
  return children;
}