// src/pages/AdminUsersPage.tsx
//
// Users & permissions. Since edge-public was retired (2026-10-04, R27 EDGE) the console no longer
// lists, creates, disables or deletes console accounts: the owner does that with the AWS CLI
// (infra/RUNBOOK.md §13). The page keeps its route so bookmarks still land here, and keeps what
// core-vpc serves: deck permissions, keyed by an account's Cognito sub, and database migrations.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  listAdminDecks,
  listAdminPermissionHolders,
  runMigrate,
  saveAdminDeckPermissionsBulk,
  type AdminPermissionHolder,
  type DeckSummary,
} from '../api/admin';

import { AUTH_CONFIGURED } from '../auth/authConfig';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';

import { CONSOLE_NAME } from '../lib/brand';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import { Callout } from '../components/ui/Callout';

type PageState = {
  loading: boolean;
  error: string | null;
  holders: AdminPermissionHolder[];
};

type DeckState = {
  loading: boolean;
  error: string | null;
  decks: DeckSummary[];
};

type DbState = {
  running: boolean;
  lastOk: string | null;
  lastError: string | null;
};

type PermDraft = Record<number, { canRead: boolean; canWrite: boolean }>;

// A Cognito sub is a UUID. Checked before anything is saved: core-vpc stores whatever string it is
// given, so a mistyped sub would silently grant decks to an account that does not exist.
const COGNITO_SUB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function countWritePerms(h: AdminPermissionHolder): number {
  return h.deckPermissions.filter(p => p.canWrite).length;
}

function countReadPerms(h: AdminPermissionHolder): number {
  return h.deckPermissions.filter(p => p.canRead || p.canWrite).length;
}

export function AdminUsersPage() {
  const navigate = useNavigate();

  const sessionUser = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(sessionUser), [sessionUser]);

  const [state, setState] = useState<PageState>({
    loading: true,
    error: null,
    holders: [],
  });

  const [deckState, setDeckState] = useState<DeckState>({
    loading: true,
    error: null,
    decks: [],
  });

  const [accountSearch, setAccountSearch] = useState('');

  // "Open an account by its sub": the way to reach an account that holds no deck permission yet.
  const [subInput, setSubInput] = useState('');
  const [subError, setSubError] = useState<string | null>(null);

  // DB migrations (danger zone)
  const [dbState, setDbState] = useState<DbState>({
    running: false,
    lastOk: null,
    lastError: null,
  });
  // Held in component state only — never persisted, never logged. Production
  // APIs configure MIGRATE_SECRET, so the button is unusable there without it
  // (2026-09-21: "Bad migrate secret" on the first prod migration attempt).
  const [migrateSecret, setMigrateSecret] = useState('');

  // permissions editor
  const [selected, setSelected] = useState<AdminPermissionHolder | null>(null);
  const [permDraft, setPermDraft] = useState<PermDraft>({});
  const [permSaving, setPermSaving] = useState(false);
  const [permOk, setPermOk] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [deckSearch, setDeckSearch] = useState('');

  async function loadAll(showSpinner = true) {
    try {
      if (showSpinner) {
        setState(prev => ({ ...prev, loading: true, error: null }));
        setDeckState(prev => ({ ...prev, loading: true, error: null }));
      } else {
        setState(prev => ({ ...prev, error: null }));
        setDeckState(prev => ({ ...prev, error: null }));
      }

      const [holdersRes, decksRes] = await Promise.all([listAdminPermissionHolders(), listAdminDecks(false)]);

      if (!holdersRes.success) {
        setState({ loading: false, error: holdersRes.error?.message ?? 'Failed to load deck permissions.', holders: [] });
      } else {
        const holders = holdersRes.data ?? [];
        setState({ loading: false, error: null, holders });

        // Keep the selection, with what the server now says about it. A sub that holds no deck
        // permission any more is absent from the holders, so it stays selected with an empty grant
        // rather than keeping its old one (which "Reset draft" would otherwise restore).
        if (selected) {
          setSelected(holders.find(h => h.sub === selected.sub) ?? { sub: selected.sub, deckPermissions: [] });
        }
      }

      if (!decksRes.success) {
        setDeckState({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', decks: [] });
      } else {
        setDeckState({ loading: false, error: null, decks: decksRes.data ?? [] });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error.';
      setState({ loading: false, error: msg, holders: [] });
      setDeckState({ loading: false, error: msg, decks: [] });
    }
  }

  useEffect(() => {
    void loadAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectHolder(h: AdminPermissionHolder) {
    setSelected(h);
    setPermOk(null);
    setPermError(null);

    const next: PermDraft = {};
    for (const p of h.deckPermissions) {
      next[p.deckId] = { canRead: !!p.canRead, canWrite: !!p.canWrite };
    }
    setPermDraft(next);
  }

  function openBySub() {
    const sub = subInput.trim().toLowerCase();
    if (!COGNITO_SUB.test(sub)) {
      setSubError('Enter the account\'s Cognito sub: a UUID such as 0b5c3f8e-1d2a-4c6b-9e7f-123456789abc, as the RUNBOOK list command prints it.');
      return;
    }
    setSubError(null);
    setSubInput('');
    selectHolder(state.holders.find(h => h.sub === sub) ?? { sub, deckPermissions: [] });
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

  const filteredHolders = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return state.holders;
    return state.holders.filter(h => h.sub.includes(q));
  }, [state.holders, accountSearch]);

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

  async function savePermissions() {
    if (!selected) return;
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

    // refresh the accounts + keep selection
    const holdersRes = await listAdminPermissionHolders();
    if (holdersRes.success) {
      const holders = holdersRes.data ?? [];
      setState(prev => ({ ...prev, holders }));
      // After an empty grant the sub is no longer among the holders: keep it selected with no decks,
      // not with the grants that were just revoked.
      setSelected(holders.find(h => h.sub === selected.sub) ?? { sub: selected.sub, deckPermissions: [] });
    }
  }

  async function runMigrateClick() {
    if (dbState.running) return;

    setDbState({ running: true, lastOk: null, lastError: null });

    const secret = migrateSecret.trim();
    const resp = secret === '' ? await runMigrate() : await runMigrate(secret);
    if (!resp.success) {
      setDbState({ running: false, lastOk: null, lastError: resp.error?.message ?? 'Migration failed.' });
      return;
    }

    setDbState({ running: false, lastOk: 'Migration completed.', lastError: null });

    await loadAll(false);
  }

  // --- Access guard: must be super_admin ---
  if (!superAdmin) {
    return (
      <ConsoleShell
        title={CONSOLE_NAME}
        subtitle="Admin · Users & Permissions"
        userLabel={sessionUser ? `${sessionUser.email ?? sessionUser.username ?? 'Signed in'} · editor` : '—'}
        superAdmin={false}
        {...consoleNav()}
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
      title={CONSOLE_NAME}
      subtitle="Admin · Users & Permissions"
      userLabel={sessionUser ? `${sessionUser.email ?? sessionUser.username ?? 'Signed in'} · super_admin` : '—'}
      superAdmin={true}
      {...consoleNav()}
    >
      {!AUTH_CONFIGURED ? (
        <Callout tone="warning" title="Auth not configured">
          This page will work after you configure Cognito + backend API.
        </Callout>
      ) : null}

      <Callout tone="info" title="Console accounts are managed with the AWS CLI">
        Listing, creating, disabling and deleting console sign-ins is no longer done here: the edge-public
        Lambda that served it was retired on 2026-10-04. The owner runs the <code>aws cognito-idp</code> commands
        in <code>infra/RUNBOOK.md</code>, section 13 &quot;Console admin accounts&quot;. Deck permissions below still
        work. They are keyed by an account&apos;s Cognito <code>sub</code>, which the RUNBOOK&apos;s list command
        prints.
      </Callout>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Deck permissions</div>
          <div className="text-xs text-slate-500 mt-1">
            Assign which decks an editor can read/write. Cards inherit deck permission.
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
        {/* LEFT: Open by sub + accounts with permissions */}
        <div className="lg:col-span-2 space-y-4">
          {/* Open an account by its sub */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
            <h2 className="text-sm font-semibold text-slate-900">Open an account</h2>
            <p className="text-xs text-slate-500 mt-1">
              For an account that holds no deck permission yet, such as a new editor: paste its Cognito sub.
            </p>

            {subError ? (
              <div className="mt-3">
                <Callout tone="danger" title="Not a Cognito sub">
                  {subError}
                </Callout>
              </div>
            ) : null}

            <form
              className="mt-3 flex flex-col md:flex-row md:items-end gap-3"
              onSubmit={e => {
                e.preventDefault();
                openBySub();
              }}
            >
              <div className="flex-1">
                <label htmlFor="account-sub" className="block text-xs font-medium text-slate-700 mb-1">Cognito sub</label>
                <input
                  id="account-sub"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                  value={subInput}
                  onChange={e => setSubInput(e.target.value)}
                  placeholder="0b5c3f8e-1d2a-4c6b-9e7f-123456789abc"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium
                           bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800"
              >
                Open
              </button>
            </form>
          </div>

          {/* Accounts that hold deck permissions */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Accounts with deck permissions</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Select an account to manage its deck permissions.</p>
                </div>

                <div className="text-xs text-slate-500">
                  {state.loading ? 'Loading…' : `${filteredHolders.length} account(s)`}
                </div>
              </div>

              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Search accounts by sub…"
                aria-label="Search accounts by sub"
                value={accountSearch}
                onChange={e => setAccountSearch(e.target.value)}
              />
            </div>

            {state.loading ? (
              <div className="px-4 py-6 text-slate-600">Loading accounts...</div>
            ) : state.error ? (
              <div className="px-4 py-6">
                <Callout tone="danger" title="Failed to load deck permissions">
                  {state.error}
                </Callout>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">Account (Cognito sub)</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">Deck perms</th>
                      <th className="px-4 py-2 text-left font-semibold text-slate-600">Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredHolders.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                          No account holds a deck permission.
                        </td>
                      </tr>
                    ) : (
                      filteredHolders.map(h => {
                        const isActive = selected?.sub === h.sub;

                        return (
                          <tr
                            key={h.sub}
                            className={`border-b border-slate-100 align-top ${isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-4 py-2">
                              <div className="font-mono text-xs text-slate-800">{h.sub}</div>
                            </td>

                            <td className="px-4 py-2 text-slate-600 text-xs">
                              <div>{countReadPerms(h)} read</div>
                              <div>{countWritePerms(h)} write</div>
                            </td>

                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => selectHolder(h)}
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

          {/* Database migrations */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            <details className="group">
              <summary className="cursor-pointer px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Database migrations</div>
                  <div className="text-xs text-slate-500 mt-0.5">Applies any pending migrations to the database this API uses. Safe to run again.</div>
                </div>
                <span className="text-xs text-slate-500 group-open:hidden">Expand</span>
                <span className="text-xs text-slate-500 hidden group-open:inline">Collapse</span>
              </summary>

              <div className="p-4">
                <label className="block mb-3">
                  <span className="block text-xs font-medium text-slate-700 mb-1">Migrate secret</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={migrateSecret}
                    onChange={(e) => setMigrateSecret(e.target.value)}
                    disabled={dbState.running}
                    placeholder="MIGRATE_SECRET of the API Lambda (leave empty if the API has none)"
                    aria-label="Migrate secret"
                    className="w-full max-w-xl px-3 py-1.5 rounded-md border border-slate-300 text-sm bg-white
                               disabled:opacity-60"
                  />
                  <span className="block text-xs text-slate-500 mt-1">
                    Sent once as <code>x-migrate-secret</code>; not stored. Production APIs require it.
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runMigrateClick()}
                    disabled={dbState.running}
                    className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium
                               border border-slate-300 text-slate-700 bg-white
                               hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {dbState.running ? 'Running migrations...' : 'Run migrations'}
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
              </div>
            </details>
          </div>
        </div>

        {/* RIGHT: Permission editor */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Deck permissions</h2>
            <p className="text-xs text-slate-500 mt-0.5">Assign which decks this account can read/write. Write implies Read.</p>
          </div>

          {!selected ? (
            <div className="px-4 py-6 text-slate-600 text-sm">Open an account by its sub, or pick one from the table, to manage its permissions.</div>
          ) : (
            <div className="p-4">
              <div className="text-xs text-slate-600">
                <div className="text-slate-500">Cognito sub</div>
                <div className="font-mono font-semibold text-slate-900 break-all">{selected.sub}</div>

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
                              <input type="checkbox" checked={p.canRead} onChange={() => togglePerm(id, 'canRead')} aria-label={`Read permission for ${d.slug}`} />
                            </div>

                            <div className="col-span-3 flex justify-center">
                              <input type="checkbox" checked={p.canWrite} onChange={() => togglePerm(id, 'canWrite')} aria-label={`Write permission for ${d.slug}`} />
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
                      onClick={() => selectHolder(selected)}
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
