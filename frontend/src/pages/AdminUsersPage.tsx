// src/pages/AdminUsersPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  createAdminUser,
  listAdminDecks,
  listAdminUsers,
  runMigrate,
  saveAdminDeckPermissionsBulk,
  type AdminUser,
  type DeckSummary,
} from '../api/admin';

import { AUTH_CONFIGURED } from '../auth/authConfig';
import { clearStoredTokens } from '../auth/tokenStore';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';

import { ConsoleShell } from '../components/console/ConsoleShell';
import { Badge } from '../components/ui/Badge';
import { Callout } from '../components/ui/Callout';

type PageState = {
  loading: boolean;
  error: string | null;
  users: AdminUser[];
};

type DeckState = {
  loading: boolean;
  error: string | null;
  decks: DeckSummary[];
};

type FormState = {
  submitting: boolean;
  error: string | null;
  ok: string | null;
};

type DbState = {
  running: boolean;
  lastOk: string | null;
  lastError: string | null;
};

type PermDraft = Record<number, { canRead: boolean; canWrite: boolean }>;

function describeGroups(groups: string[] | null | undefined): string {
  const g = (groups ?? []).filter(Boolean);
  if (g.length === 0) return '—';
  return g.join(', ');
}

function deriveRole(groups: string[] | null | undefined): 'super_admin' | 'editor' | 'unknown' {
  const g = (groups ?? []).map(x => String(x).toLowerCase());
  if (g.includes('super_admin')) return 'super_admin';
  if (g.includes('editor') || g.some(x => x.startsWith('editor_'))) return 'editor'; // 兼容旧 editor_en/editor_zh
  return 'unknown';
}

function roleBadge(groups: string[] | null | undefined) {
  const role = deriveRole(groups);
  if (role === 'super_admin') return <Badge tone="info">super_admin</Badge>;
  if (role === 'editor') return <Badge tone="success">editor</Badge>;
  return <Badge tone="neutral">unknown</Badge>;
}

function countWritePerms(u: AdminUser): number {
  const perms = u.deckPermissions ?? [];
  return perms.filter(p => p.canWrite).length;
}

function countReadPerms(u: AdminUser): number {
  const perms = u.deckPermissions ?? [];
  return perms.filter(p => p.canRead || p.canWrite).length;
}

function safeUserLabel(u: AdminUser) {
  return u.email ?? u.username ?? '—';
}

export function AdminUsersPage() {
  const navigate = useNavigate();

  const sessionUser = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(sessionUser), [sessionUser]);

  const [state, setState] = useState<PageState>({
    loading: true,
    error: null,
    users: [],
  });

  const [deckState, setDeckState] = useState<DeckState>({
    loading: true,
    error: null,
    decks: [],
  });

  const [userSearch, setUserSearch] = useState('');

  // create user form (always creates editor)
  const [form, setForm] = useState({
    username: '',
    email: '',
    tempPassword: '',
  });

  const [formState, setFormState] = useState<FormState>({
    submitting: false,
    error: null,
    ok: null,
  });

  // DB migrations (danger zone)
  const [dbState, setDbState] = useState<DbState>({
    running: false,
    lastOk: null,
    lastError: null,
  });

  // permissions editor
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [permDraft, setPermDraft] = useState<PermDraft>({});
  const [permSaving, setPermSaving] = useState(false);
  const [permOk, setPermOk] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [deckSearch, setDeckSearch] = useState('');

  function handleSignOut() {
    clearStoredTokens();
    try {
      window.location.assign(buildLogoutUrl());
    } catch {
      navigate('/login', { replace: true });
    }
  }

  async function loadAll(showSpinner = true) {
    try {
      if (showSpinner) {
        setState(prev => ({ ...prev, loading: true, error: null }));
        setDeckState(prev => ({ ...prev, loading: true, error: null }));
      } else {
        setState(prev => ({ ...prev, error: null }));
        setDeckState(prev => ({ ...prev, error: null }));
      }

      const [usersRes, decksRes] = await Promise.all([listAdminUsers(), listAdminDecks(false)]);

      if (!usersRes.success) {
        setState({ loading: false, error: usersRes.error?.message ?? 'Failed to load users.', users: [] });
      } else {
        const users = usersRes.data ?? [];
        setState({ loading: false, error: null, users });

        // keep selection if possible
        if (selected?.sub) {
          const nextSelected = users.find(u => u.sub && u.sub === selected.sub) ?? null;
          if (nextSelected) setSelected(nextSelected);
        }
      }

      if (!decksRes.success) {
        setDeckState({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', decks: [] });
      } else {
        setDeckState({ loading: false, error: null, decks: decksRes.data ?? [] });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error.';
      setState({ loading: false, error: msg, users: [] });
      setDeckState({ loading: false, error: msg, decks: [] });
    }
  }

  useEffect(() => {
    void loadAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectUser(u: AdminUser) {
    setSelected(u);
    setPermOk(null);
    setPermError(null);

    const next: PermDraft = {};
    for (const p of u.deckPermissions ?? []) {
      next[p.deckId] = { canRead: !!p.canRead, canWrite: !!p.canWrite };
    }
    setPermDraft(next);
  }

  function togglePerm(deckId: number, key: 'canRead' | 'canWrite') {
    setPermDraft(prev => {
      const cur = prev[deckId] ?? { canRead: false, canWrite: false };
      const next = { ...cur };

      if (key === 'canRead') {
        next.canRead = !cur.canRead;
        if (!next.canRead) next.canWrite = false;
      } else {
        next.canWrite = !cur.canWrite;
        if (next.canWrite) next.canRead = true;
      }

      return { ...prev, [deckId]: next };
    });
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return state.users;

    return (state.users ?? []).filter(u => {
      const s = `${u.username ?? ''} ${u.email ?? ''} ${describeGroups(u.groups)}`.toLowerCase();
      return s.includes(q);
    });
  }, [state.users, userSearch]);

  const filteredDecks = useMemo(() => {
    const q = deckSearch.trim().toLowerCase();
    const decks = deckState.decks ?? [];
    if (!q) return decks;

    return decks.filter(d => {
      const s = `${d.slug ?? ''} ${d.title ?? ''} ${d.locale ?? ''}`.toLowerCase();
      return s.includes(q);
    });
  }, [deckSearch, deckState.decks]);

  const selectedPermCounts = useMemo(() => {
    if (!selected) return { read: 0, write: 0 };
    let read = 0;
    let write = 0;

    for (const deck of deckState.decks) {
      const p = permDraft[Number(deck.id)];
      if (!p) continue;
      if (p.canWrite) write += 1;
      if (p.canRead || p.canWrite) read += 1;
    }
    return { read, write };
  }, [selected, permDraft, deckState.decks]);

  async function submitCreate() {
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

    setFormState({ submitting: true, error: null, ok: null });

    // ✅ Always create editor accounts from console
    // If your backend still expects editor_en/editor_zh, change this to ['editor_en'] for now.
    const groups = ['editor'];

    const res = await createAdminUser({
      username,
      email,
      tempPassword,
      groups,
    });

    if (!res.success) {
      setFormState({ submitting: false, error: res.error?.message ?? 'Create user failed.', ok: null });
      return;
    }

    setFormState({ submitting: false, error: null, ok: `Created editor: ${username}.` });
    setForm(prev => ({ ...prev, username: '', email: '', tempPassword: '' }));

    // refresh + auto-select
    const usersRes = await listAdminUsers();
    if (usersRes.success) {
      const users = usersRes.data ?? [];
      setState(prev => ({ ...prev, users }));
      const created = users.find(u => u.username === username || u.email === email) ?? null;
      if (created) selectUser(created);
    }
  }

  async function savePermissions() {
    if (!selected) return;
    if (!selected.sub) {
      setPermError('Selected user has no "sub" attribute. Cannot save permissions.');
      return;
    }
    if (permSaving) return;

    setPermSaving(true);
    setPermOk(null);
    setPermError(null);

    const payload = {
      adminSub: selected.sub,
      mode: 'replace' as const,
      permissions: deckState.decks
        .map(d => {
          const id = Number(d.id);
          const p = permDraft[id] ?? { canRead: false, canWrite: false };
          return { deckId: id, canRead: p.canRead, canWrite: p.canWrite };
        })
        .filter(p => p.canRead || p.canWrite),
    };

    const resp = await saveAdminDeckPermissionsBulk(payload);

    if (!resp.success) {
      setPermSaving(false);
      setPermError(resp.error?.message ?? 'Save failed.');
      return;
    }

    setPermSaving(false);
    setPermOk(`Saved. (${resp.data?.saved ?? 0} deck(s) now assigned)`);

    // refresh users + keep selection
    const usersRes = await listAdminUsers();
    if (usersRes.success) {
      const users = usersRes.data ?? [];
      setState(prev => ({ ...prev, users }));
      const updatedSelected = users.find(u => u.sub && selected.sub && u.sub === selected.sub) ?? null;
      if (updatedSelected) setSelected(updatedSelected);
    }
  }

  async function runMigrateClick(reset: boolean) {
    if (dbState.running) return;

    if (reset) {
      const ok = window.confirm(
        'This will DROP and recreate core tables (decks/cards/progress/logs/permissions).\n\nOnly use this in DEV.\n\nContinue?',
      );
      if (!ok) return;
    }

    setDbState({ running: true, lastOk: null, lastError: null });

    const resp = await runMigrate(reset);
    if (!resp.success) {
      setDbState({ running: false, lastOk: null, lastError: resp.error?.message ?? 'Migration failed.' });
      return;
    }

    const resetFlag = resp.data?.reset ? ' (reset + migrate)' : '';
    setDbState({ running: false, lastOk: `Migration completed${resetFlag}.`, lastError: null });

    await loadAll(false);
  }

  // --- Access guard: must be super_admin ---
  if (!superAdmin) {
    return (
      <ConsoleShell
        title="RecallSmith Console"
        subtitle="Admin · Users & Permissions"
        userLabel={sessionUser ? `${sessionUser.email ?? sessionUser.username ?? 'Signed in'} · editor` : '—'}
        superAdmin={false}
        onSignOut={handleSignOut}
      >
        <Callout tone="danger" title="Access denied">
          This page requires <span className="font-semibold">super_admin</span>.
        </Callout>

        <button
          type="button"
          className="text-sm px-3 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          onClick={() => navigate('/', { replace: true })}
        >
          Back to Decks
        </button>
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title="RecallSmith Console"
      subtitle="Admin · Users & Permissions"
      userLabel={sessionUser ? `${sessionUser.email ?? sessionUser.username ?? 'Signed in'} · super_admin` : '—'}
      superAdmin={true}
      onSignOut={handleSignOut}
      onGoAdminUsers={() => navigate('/admin/users')}
    >
      {!AUTH_CONFIGURED ? (
        <Callout tone="warning" title="Auth not configured">
          This page will work after you configure Cognito + backend API.
        </Callout>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Editors</div>
          <div className="text-xs text-slate-500 mt-1">
            Create editors and assign which decks they can read/write. Cards inherit deck permission.
          </div>
        </div>

        <button
          type="button"
          className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          onClick={() => void loadAll(false)}
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Create + Users */}
        <div className="lg:col-span-2 space-y-4">
          {/* Create user */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Create editor</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Creates a Cognito user as <span className="font-semibold">editor</span>. Then assign deck permissions on the right.
                </p>
              </div>

              <Badge tone="success">editor</Badge>
            </div>

            {formState.error ? (
              <div className="mt-3">
                <Callout tone="danger" title="Create failed">
                  {formState.error}
                </Callout>
              </div>
            ) : null}

            {formState.ok ? (
              <div className="mt-3">
                <Callout tone="success" title="Success">
                  {formState.ok}
                </Callout>
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={form.username}
                  onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="alice_editor"
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

            <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
              New users created here are <span className="font-semibold">editor</span> by default. Assign which decks they can read/write on the right.
            </div>

            <div className="mt-4">
              <button
                type="button"
                disabled={formState.submitting}
                onClick={() => void submitCreate()}
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium
                           bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                           disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {formState.submitting ? 'Creating...' : 'Create editor'}
              </button>
            </div>
          </div>

          {/* Users list */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Users</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Select a user to manage deck permissions.</p>
                </div>

                <div className="text-xs text-slate-500">
                  {state.loading ? 'Loading…' : `${filteredUsers.length} user(s)`}
                </div>
              </div>

              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Search users by username/email/groups…"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
            </div>

            {state.loading ? (
              <div className="px-4 py-6 text-slate-600">Loading users...</div>
            ) : state.error ? (
              <div className="px-4 py-6">
                <Callout tone="danger" title="Failed to load users">
                  {state.error}
                </Callout>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">User</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">Role</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">Deck perms</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">Status</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                          No users returned.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map(u => {
                        const isActive = selected?.sub && u.sub && selected.sub === u.sub;
                        const readCount = countReadPerms(u);
                        const writeCount = countWritePerms(u);

                        return (
                          <tr
                            key={u.username}
                            className={`border-b border-slate-100 align-top ${isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-4 py-2">
                              <div className="font-mono text-xs text-slate-800">{u.username}</div>
                              <div className="text-xs text-slate-500">{u.email ?? '—'}</div>
                              <div className="mt-1 text-[11px] text-slate-400">Groups: {describeGroups(u.groups)}</div>
                            </td>

                            <td className="px-4 py-2">{roleBadge(u.groups)}</td>

                            <td className="px-4 py-2 text-slate-600 text-xs">
                              <div>{readCount} read</div>
                              <div>{writeCount} write</div>
                            </td>

                            <td className="px-4 py-2 text-slate-600 text-xs">
                              {u.status ?? '—'}
                              {u.enabled === false ? ' (disabled)' : ''}
                            </td>

                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => selectUser(u)}
                                className={`text-xs px-2 py-1 rounded border ${
                                  isActive
                                    ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Danger zone: migrations (keep for now) */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            <details className="group">
              <summary className="cursor-pointer px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Danger zone · Database migrations</div>
                  <div className="text-xs text-slate-500 mt-0.5">Keep this for DEV. Later we’ll move it to /admin/system.</div>
                </div>
                <span className="text-xs text-slate-500 group-open:hidden">Expand</span>
                <span className="text-xs text-slate-500 hidden group-open:inline">Collapse</span>
              </summary>

              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runMigrateClick(false)}
                    disabled={dbState.running}
                    className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium
                               border border-slate-300 text-slate-700 bg-white
                               hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {dbState.running ? 'Running migrate...' : 'Run migrate (no reset)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void runMigrateClick(true)}
                    disabled={dbState.running}
                    className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium
                               border border-red-300 text-red-700 bg-red-50
                               hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {dbState.running ? 'Running (reset)...' : 'Reset & migrate (DEV only)'}
                  </button>
                </div>

                {dbState.lastError ? (
                  <div className="mt-3">
                    <Callout tone="danger" title="Migration failed">
                      {dbState.lastError}
                    </Callout>
                  </div>
                ) : null}

                {dbState.lastOk ? (
                  <div className="mt-3">
                    <Callout tone="success" title="Migration completed">
                      {dbState.lastOk}
                    </Callout>
                  </div>
                ) : null}

                <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
                  <span className="font-semibold">Hint</span>: “Run migrate (no reset)” is safe for prod. “Reset & migrate” will <span className="font-semibold">DROP</span> core tables and recreate them (DEV only).
                </p>
              </div>
            </details>
          </div>
        </div>

        {/* RIGHT: Permission editor */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Deck permissions</h2>
            <p className="text-xs text-slate-500 mt-0.5">Assign which decks this user can read/write. Write implies Read.</p>
          </div>

          {!selected ? (
            <div className="px-4 py-6 text-slate-600 text-sm">Select a user from the table to manage permissions.</div>
          ) : (
            <div className="p-4">
              <div className="text-xs text-slate-600">
                <div className="font-semibold text-slate-900">{safeUserLabel(selected)}</div>
                <div className="mt-1">{roleBadge(selected.groups)}</div>
                <div className="mt-2">Groups: {describeGroups(selected.groups)}</div>

                <div className="mt-2">
                  Current draft: <span className="font-semibold">{selectedPermCounts.read}</span> read ·{' '}
                  <span className="font-semibold">{selectedPermCounts.write}</span> write
                </div>
              </div>

              {deckState.loading ? (
                <div className="mt-3 text-slate-600 text-sm">Loading decks...</div>
              ) : deckState.error ? (
                <div className="mt-3">
                  <Callout tone="danger" title="Failed to load decks">
                    {deckState.error}
                  </Callout>
                </div>
              ) : (
                <>
                  <div className="mt-3">
                    <input
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Search decks by slug/title/locale..."
                      value={deckSearch}
                      onChange={e => setDeckSearch(e.target.value)}
                    />
                  </div>

                  <div className="mt-3 max-h-[460px] overflow-auto border border-slate-200 rounded">
                    <div className="grid grid-cols-12 bg-slate-50 text-[11px] text-slate-600 border-b border-slate-200 px-2 py-2">
                      <div className="col-span-7 font-semibold">Deck</div>
                      <div className="col-span-2 font-semibold text-center">Read</div>
                      <div className="col-span-3 font-semibold text-center">Write</div>
                    </div>

                    {filteredDecks.length === 0 ? (
                      <div className="px-3 py-6 text-center text-slate-500 text-sm">No decks.</div>
                    ) : (
                      filteredDecks.map(d => {
                        const id = Number(d.id);
                        const p = permDraft[id] ?? { canRead: false, canWrite: false };

                        return (
                          <div key={id} className="grid grid-cols-12 items-center px-2 py-2 border-b border-slate-100">
                            <div className="col-span-7">
                              <div className="text-xs font-medium text-slate-900">{d.title}</div>
                              <div className="text-[11px] text-slate-500 font-mono">{d.slug}</div>
                              <div className="text-[11px] text-slate-400">{d.locale ?? '—'}</div>
                            </div>

                            <div className="col-span-2 flex justify-center">
                              <input type="checkbox" checked={p.canRead} onChange={() => togglePerm(id, 'canRead')} />
                            </div>

                            <div className="col-span-3 flex justify-center">
                              <input type="checkbox" checked={p.canWrite} onChange={() => togglePerm(id, 'canWrite')} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {permError ? (
                    <div className="mt-3">
                      <Callout tone="danger" title="Save failed">
                        {permError}
                      </Callout>
                    </div>
                  ) : null}

                  {permOk ? (
                    <div className="mt-3">
                      <Callout tone="success" title="Saved">
                        {permOk}
                      </Callout>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void savePermissions()}
                      disabled={permSaving}
                      className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium
                                 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {permSaving ? 'Saving...' : 'Save permissions'}
                    </button>

                    <button
                      type="button"
                      onClick={() => selectUser(selected)}
                      className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium
                                 border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      Reset draft
                    </button>
                  </div>

                  <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
                    Rule: Write implies Read. Editors without write permission will be blocked from POST/PUT/DELETE on decks/cards in that deck.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </ConsoleShell>
  );
}