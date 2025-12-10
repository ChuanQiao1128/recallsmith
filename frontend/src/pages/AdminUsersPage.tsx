// src/pages/AdminUsersPage.tsx

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createAdminUser, listAdminUsers, type AdminUser } from '../api/admin';
import { AUTH_CONFIGURED } from '../auth/authConfig';

type PageState = {
  loading: boolean;
  error: string | null;
  users: AdminUser[];
};

type FormState = {
  submitting: boolean;
  error: string | null;
  ok: string | null;
};

const GROUP_OPTIONS = [
  { value: 'super_admin', label: 'super_admin (full access)' },
  { value: 'editor_en', label: 'editor_en (en-US decks)' },
  { value: 'editor_zh', label: 'editor_zh (zh-CN decks)' },
];

export function AdminUsersPage() {
  const [state, setState] = useState<PageState>({
    loading: true,
    error: null,
    users: [],
  });

  const [form, setForm] = useState({
    username: '',
    email: '',
    tempPassword: '',
    groups: ['editor_en'] as string[],
  });

  const [formState, setFormState] = useState<FormState>({
    submitting: false,
    error: null,
    ok: null,
  });

  // ✅ 手动刷新用：会先把 loading=true（这是按钮触发，不属于 effect）
  async function loadWithSpinner() {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const res = await listAdminUsers();
      if (!res.success) {
        setState({ loading: false, error: res.error?.message ?? 'Failed to load users.', users: [] });
        return;
      }
      setState({ loading: false, error: null, users: res.data ?? [] });
    } catch (e: unknown) {
      setState({ loading: false, error: e instanceof Error ? e.message : 'Network error.', users: [] });
    }
  }

  // ✅ 初次加载：effect 内不再同步 setState，避免 lint 报错
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await listAdminUsers();
        if (cancelled) return;

        if (!res.success) {
          setState({ loading: false, error: res.error?.message ?? 'Failed to load users.', users: [] });
          return;
        }

        setState({ loading: false, error: null, users: res.data ?? [] });
      } catch (e: unknown) {
        if (cancelled) return;
        setState({ loading: false, error: e instanceof Error ? e.message : 'Network error.', users: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleGroup(g: string) {
    setForm(prev => {
      const has = prev.groups.includes(g);
      return { ...prev, groups: has ? prev.groups.filter(x => x !== g) : [...prev.groups, g] };
    });
  }

  async function submit() {
    const username = form.username.trim();
    const email = form.email.trim();
    const tempPassword = form.tempPassword;

    if (!username) {
      setFormState({ submitting: false, error: 'Username is required.', ok: null });
      return;
    }
    if (!email || !email.includes('@')) {
      setFormState({ submitting: false, error: 'Valid email is required.', ok: null });
      return;
    }
    if (!tempPassword || tempPassword.length < 8) {
      setFormState({ submitting: false, error: 'Temp password must be >= 8 chars.', ok: null });
      return;
    }
    if (form.groups.length === 0) {
      setFormState({ submitting: false, error: 'Select at least one group.', ok: null });
      return;
    }

    setFormState({ submitting: true, error: null, ok: null });

    const res = await createAdminUser({
      username,
      email,
      tempPassword,
      groups: form.groups,
    });

    if (!res.success) {
      setFormState({
        submitting: false,
        error: res.error?.message ?? 'Create user failed.',
        ok: null,
      });
      return;
    }

    setFormState({ submitting: false, error: null, ok: 'Created successfully.' });
    setForm(prev => ({ ...prev, username: '', email: '', tempPassword: '' }));

    await loadWithSpinner();
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Admin · Users</h1>
            <p className="text-xs text-slate-500 mt-1">Create/list console admins (super_admin only)</p>
          </div>
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to Decks
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {!AUTH_CONFIGURED ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded">
            Auth not configured. This page will work after you configure Cognito + backend API.
          </div>
        ) : null}

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <h2 className="text-sm font-semibold text-slate-800">Create admin user</h2>

          {formState.error ? (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm">
              {formState.error}
            </div>
          ) : null}

          {formState.ok ? (
            <div className="mt-3 bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded text-sm">
              {formState.ok}
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.username}
                onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
                placeholder="alice_admin"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.email}
                onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="alice@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Temp password</label>
              <input
                type="password"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={form.tempPassword}
                onChange={e => setForm(prev => ({ ...prev, tempPassword: e.target.value }))}
                placeholder="min 8 chars"
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xs font-medium text-slate-700 mb-1">Groups</div>
            <div className="flex flex-wrap gap-3">
              {GROUP_OPTIONS.map(opt => (
                <label key={opt.value} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.groups.includes(opt.value)}
                    onChange={() => toggleGroup(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              disabled={formState.submitting}
              onClick={submit}
              className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium
                         bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {formState.submitting ? 'Creating...' : 'Create user'}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Users</h2>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => loadWithSpinner()}
              disabled={state.loading}
            >
              Refresh
            </button>
          </div>

          {state.loading ? (
            <div className="px-4 py-6 text-slate-600">Loading users...</div>
          ) : state.error ? (
            <div className="px-4 py-6 text-red-700">{state.error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Username</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Email</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Groups</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {state.users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                        No users returned.
                      </td>
                    </tr>
                  ) : (
                    state.users.map(u => (
                      <tr key={u.username} className="border-b border-slate-100">
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">{u.username}</td>
                        <td className="px-4 py-2 text-slate-700">{u.email ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-700">
                          {(u.groups ?? []).length ? (u.groups ?? []).join(', ') : '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{u.status ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}