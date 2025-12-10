// src/pages/DeckListPage.tsx

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDecks } from '../api/authoring';
import type { Deck } from '../types/deck';

interface DeckListState {
  loading: boolean;
  error: string | null;
  decks: Deck[];
}

type SessionUser = {
  email?: string;
  username?: string;
  groups: string[];
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const b64url = parts[1];

    const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');

    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readSessionUser(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem('devcards:tokens');
    if (!raw) return null;

    const j = JSON.parse(raw) as { idToken?: string } | null;
    const idToken = j?.idToken;
    if (!idToken) return null;

    const p = decodeJwtPayload(idToken);
    if (!p) return null;

    const groupsRaw = p['cognito:groups'] ?? p['groups'] ?? [];
    const groups = Array.isArray(groupsRaw) ? groupsRaw : [];

    return {
      email: typeof p.email === 'string' ? p.email : undefined,
      username: typeof p['cognito:username'] === 'string' ? p['cognito:username'] : typeof p.username === 'string' ? p.username : undefined,
      groups,
    };
  } catch {
    return null;
  }
}

export function DeckListPage() {
  const [state, setState] = useState<DeckListState>({
    loading: true,
    error: null,
    decks: [],
  });

  const navigate = useNavigate();

  // ⚠️ 你现在还没弄 Cognito：这里不会阻塞页面，只是“有 token 才显示用户/退出/管理员入口”
  const user = useMemo(() => readSessionUser(), []);
  const isSuperAdmin = (user?.groups ?? []).includes('super_admin');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }));

        const result = await fetchDecks();

        if (cancelled) return;

        if (!result.success) {
          setState({
            loading: false,
            error: result.error?.message ?? 'Unknown error',
            decks: [],
          });
          return;
        }

        setState({
          loading: false,
          error: null,
          decks: result.data ?? [],
        });
      } catch (err: unknown) {
        if (cancelled) return;

        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Network error',
          decks: [],
        });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSignOut() {
    // 先做“本地退出”即可：清 token + 回首页
    sessionStorage.removeItem('devcards:tokens');
    navigate('/', { replace: true });
    // 如果你后面接 Cognito，再把这里升级成：跳转 Cognito /logout 即可
  }

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading decks...</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm">
          <div className="font-semibold mb-1">Failed to load decks</div>
          <div className="text-sm">{state.error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">
            RecallSmith Authoring Console
          </h1>

          {/* Right header actions */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">P3-mini · Deck 列表</span>

            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600">
              {user
                ? `${user.email ?? user.username ?? 'Signed in'}${isSuperAdmin ? ' · super_admin' : ''}`
                : 'Local mode (no auth)'}
            </span>

            {isSuperAdmin ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => navigate('/admin/users')}
                title="Admin: manage console users (requires Cognito backend later)"
              >
                Admin
              </button>
            ) : null}

            {user ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Decks</h2>

            <button
              type="button"
              className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                         bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                         focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              // ✅ 修复：New Deck 应该去 /decks/new
              onClick={() => navigate('/decks/new')}
            >
              + New Deck
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">ID</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Slug</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Title</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Locale</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Type</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Created</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>

              <tbody>
                {state.decks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500 text-sm">
                      No decks found. You can create the first JS Starter deck later.
                    </td>
                  </tr>
                ) : (
                  state.decks.map(deck => (
                    <tr
                      key={deck.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-2 text-slate-700">{deck.id}</td>

                      <td className="px-4 py-2 text-slate-700 font-mono text-xs">{deck.slug}</td>

                      <td className="px-4 py-2 text-slate-800">{deck.title}</td>

                      <td className="px-4 py-2 text-slate-600">{deck.locale}</td>

                      <td className="px-4 py-2 text-slate-600">
                        {deck.deckType === 1 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            Starter
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800">
                            Paid
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {new Date(deck.createdAt).toLocaleString()}
                      </td>

                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => navigate(`/decks/cards?deckId=${deck.id}`)}>View Cards</button>


                          <button
                            type="button"
                            // ✅ 修复：Preview 必须是 /decks/preview?deckId=xxx
                            onClick={() => navigate(`/decks/preview?deckId=${deck.id}`)}
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                            title="Preview mobile DeckExport JSON"
                          >
                            Preview
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}