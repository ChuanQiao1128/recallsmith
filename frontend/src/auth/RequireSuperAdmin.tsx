// src/auth/RequireSuperAdmin.tsx

import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { AUTH_CONFIGURED } from './authConfig';
import { getUserGroups } from './tokenStore';

export function RequireSuperAdmin({ children }: { children: ReactElement }) {
  if (!AUTH_CONFIGURED) return children; // 本地模式：不拦

  const groups = getUserGroups();
  const ok = groups.includes('super_admin');

  if (ok) return children;

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 max-w-md w-full">
        <div className="font-semibold text-slate-800">Unauthorized</div>
        <div className="text-sm text-slate-600 mt-1">
          This page requires <span className="font-mono">super_admin</span>.
        </div>
        <div className="mt-4">
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to Decks
          </Link>
        </div>
      </div>
    </div>
  );
}