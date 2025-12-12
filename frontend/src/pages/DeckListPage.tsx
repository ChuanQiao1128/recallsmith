// src/pages/DeckListPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchDecks, deleteDeck } from '../api/authoring';
import { fetchContentManifest } from '../api/contentManifest';
import type { Deck } from '../types/deck';

import { clearStoredTokens } from '../auth/tokenStore';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin } from '../auth/sessionUser';

import { ConsoleShell } from '../components/console/ConsoleShell';
import { Badge } from '../components/ui/Badge';

interface DeckListState {
  loading: boolean;
  error: string | null;
  decks: Deck[];
}

type ManifestDeckLite = {
  slug: string;
  version: string;
  locale?: string;
};

type ManifestState = {
  loading: boolean;
  error: string | null;
  publishedAt?: string;
  bySlug: Record<string, ManifestDeckLite>;
};

type DeckStatus = 'published' | 'needs_publish' | 'unpublished';

function safeDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/**
 * normalize version for comparison:
 * - "12" vs 12 => "12"
 * - "v12" => "12"
 * - "2025-12-12" => "2025-12-12" (fallback)
 */
function normalizeVersion(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  // match first number token (v12 -> 12)
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

function getDeckStatus(deck: Deck, publishedVersionRaw: string | undefined): DeckStatus {
  const published = (publishedVersionRaw ?? '').trim();
  if (!published) return 'unpublished';

  const deckWithVersion = deck as Deck & { version?: unknown };
  const draftV = normalizeVersion(deckWithVersion.version);
  const pubV = normalizeVersion(published);

  // if we can normalize to numbers, compare those; otherwise compare raw string
  if (draftV && pubV) {
    return draftV === pubV ? 'published' : 'needs_publish';
  }
  return String(deckWithVersion.version ?? '') === published ? 'published' : 'needs_publish';
}

function statusBadge(status: DeckStatus) {
  switch (status) {
    case 'published':
      return <Badge tone="success">Published</Badge>;
    case 'needs_publish':
      return <Badge tone="warning">Needs publish</Badge>;
    case 'unpublished':
      return <Badge tone="neutral">Unpublished</Badge>;
    default:
      return <Badge tone="neutral">—</Badge>;
  }
}

function typeBadge(deckType: number) {
  if (deckType === 1) return <Badge tone="success">Starter</Badge>;
  return <Badge tone="info">Paid</Badge>;
}

export function DeckListPage() {
  const navigate = useNavigate();

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  const [deckState, setDeckState] = useState<DeckListState>({
    loading: true,
    error: null,
    decks: [],
  });

  const [manifestState, setManifestState] = useState<ManifestState>({
    loading: true,
    error: null,
    publishedAt: undefined,
    bySlug: {},
  });

  const [deletingId, setDeletingId] = useState<number | null>(null);

  // UI filters
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeckStatus>('all');
  const [localeFilter, setLocaleFilter] = useState<'all' | string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'starter' | 'paid'>('all');

  async function loadAll(showSpinner = false) {
    if (showSpinner) {
      setDeckState(prev => ({ ...prev, loading: true, error: null }));
      setManifestState(prev => ({ ...prev, loading: true, error: null }));
    } else {
      // keep previous data, just clear errors
      setDeckState(prev => ({ ...prev, error: null }));
      setManifestState(prev => ({ ...prev, error: null }));
    }

    try {
      const [decksRes, manifestRes] = await Promise.all([
        fetchDecks(),
        fetchContentManifest({ bustCache: true }),
      ]);

      // decks
      if (!decksRes.success) {
        setDeckState({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', decks: [] });
      } else {
        setDeckState({ loading: false, error: null, decks: decksRes.data ?? [] });
      }

      // manifest
      if (!manifestRes.ok) {
        setManifestState({ loading: false, error: manifestRes.error, publishedAt: undefined, bySlug: {} });
      } else {
        const bySlug: Record<string, ManifestDeckLite> = {};
        for (const d of manifestRes.data.decks) {
          bySlug[d.slug] = { slug: d.slug, version: d.version, locale: d.locale };
        }

        setManifestState({
          loading: false,
          error: null,
          publishedAt: manifestRes.data.publishedAt ?? manifestRes.data.generatedAt,
          bySlug,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error.';
      setDeckState({ loading: false, error: message, decks: [] });
      setManifestState({ loading: false, error: message, publishedAt: undefined, bySlug: {} });
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setDeckState(prev => ({ ...prev, loading: true, error: null }));
      setManifestState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const [decksRes, manifestRes] = await Promise.all([
          fetchDecks(),
          fetchContentManifest({ bustCache: true }),
        ]);
        if (cancelled) return;

        if (!decksRes.success) {
          setDeckState({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', decks: [] });
        } else {
          setDeckState({ loading: false, error: null, decks: decksRes.data ?? [] });
        }

        if (!manifestRes.ok) {
          setManifestState({ loading: false, error: manifestRes.error, publishedAt: undefined, bySlug: {} });
        } else {
          const bySlug: Record<string, ManifestDeckLite> = {};
          for (const d of manifestRes.data.decks) bySlug[d.slug] = { slug: d.slug, version: d.version, locale: d.locale };

          setManifestState({
            loading: false,
            error: null,
            publishedAt: manifestRes.data.publishedAt ?? manifestRes.data.generatedAt,
            bySlug,
          });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Network error.';
        setDeckState({ loading: false, error: message, decks: [] });
        setManifestState({ loading: false, error: message, publishedAt: undefined, bySlug: {} });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDeleteDeck(deckId: number) {
    if (!superAdmin) return;

    const ok = window.confirm(
      'Delete deck is a destructive action.\n\nThis will delete the deck (and likely its cards).\nAre you sure?',
    );
    if (!ok) return;

    try {
      setDeletingId(deckId);
      const res = await deleteDeck(deckId);

      if (!res.success) {
        alert(res.error?.message ?? 'Delete deck failed.');
        return;
      }

      setDeckState(prev => ({ ...prev, decks: prev.decks.filter(d => d.id !== deckId) }));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setDeletingId(null);
    }
  }

  function handleSignOut() {
    clearStoredTokens();
    try {
      window.location.assign(buildLogoutUrl());
    } catch {
      navigate('/login', { replace: true });
    }
  }

  const decks = useMemo(() => deckState.decks ?? [], [deckState.decks]);

  const localeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of decks) {
      if (d.locale) set.add(d.locale);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [decks]);

  const viewRows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return decks
      .map(d => {
        const published = manifestState.bySlug[d.slug]?.version ?? '';
        const status = getDeckStatus(d, published);

        return {
          deck: d,
          publishedVersion: published,
          status,
        };
      })
      .filter(row => {
        const d = row.deck;

        // search
        if (query) {
          const s = `${d.slug ?? ''} ${d.title ?? ''} ${d.locale ?? ''}`.toLowerCase();
          if (!s.includes(query)) return false;
        }

        // status filter
        if (statusFilter !== 'all' && row.status !== statusFilter) return false;

        // locale filter
        if (localeFilter !== 'all' && String(d.locale) !== localeFilter) return false;

        // type filter
        if (typeFilter !== 'all') {
          if (typeFilter === 'starter' && d.deckType !== 1) return false;
          if (typeFilter === 'paid' && d.deckType === 1) return false;
        }

        return true;
      });
  }, [decks, manifestState.bySlug, q, statusFilter, localeFilter, typeFilter]);

  const stats = useMemo(() => {
    let published = 0;
    let needs = 0;
    let unpub = 0;

    for (const d of decks) {
      const pv = manifestState.bySlug[d.slug]?.version;
      const st = getDeckStatus(d, pv);
      if (st === 'published') published += 1;
      if (st === 'needs_publish') needs += 1;
      if (st === 'unpublished') unpub += 1;
    }

    return {
      total: decks.length,
      published,
      needsPublish: needs,
      unpublished: unpub,
    };
  }, [decks, manifestState.bySlug]);

  if (deckState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-slate-600 text-lg">Loading console…</div>
      </div>
    );
  }

  if (deckState.error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm max-w-md">
          <div className="font-semibold mb-1">Failed to load decks</div>
          <div className="text-sm">{deckState.error}</div>

          <button
            type="button"
            className="mt-3 text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
            onClick={() => void loadAll(true)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <ConsoleShell
      title="RecallSmith Console"
      subtitle="Authoring · Decks"
      userLabel={user ? `${user.email ?? user.username ?? 'Signed in'}${superAdmin ? ' · super_admin' : ' · editor'}` : '—'}
      superAdmin={superAdmin}
      onSignOut={handleSignOut}
      onGoAdminUsers={superAdmin ? () => navigate('/admin/users') : undefined}
    >
      {/* Top strip: manifest + refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-xs text-slate-600">
          {manifestState.loading ? (
            <span>Loading manifest…</span>
          ) : manifestState.error ? (
            <span className="text-amber-800">
              Manifest unavailable: {manifestState.error}
              <span className="text-slate-500"> (set VITE_CONTENT_MANIFEST_URL + S3 CORS)</span>
            </span>
          ) : (
            <span>
              Manifest OK{manifestState.publishedAt ? ` · publishedAt=${safeDateTime(manifestState.publishedAt)}` : ''}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
            onClick={() => void loadAll(false)}
            title="Reload decks + manifest"
          >
            Refresh
          </button>

          {superAdmin ? (
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
              onClick={() => navigate('/decks/new')}
              title="super_admin only"
            >
              + New Deck
            </button>
          ) : (
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded bg-slate-200 text-slate-500 cursor-not-allowed"
              disabled
              title="Only super_admin can create decks"
            >
              + New Deck
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <div className="text-xs text-slate-500">Total decks</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{stats.total}</div>
          <div className="mt-1 text-[11px] text-slate-400">Visible to you (permission-filtered)</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <div className="text-xs text-slate-500">Published</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{stats.published}</div>
          <div className="mt-2">{statusBadge('published')}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <div className="text-xs text-slate-500">Needs publish</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{stats.needsPublish}</div>
          <div className="mt-2">{statusBadge('needs_publish')}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <div className="text-xs text-slate-500">Unpublished</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{stats.unpublished}</div>
          <div className="mt-2">{statusBadge('unpublished')}</div>
        </div>
      </div>

      {/* Filters + table */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Decks</h2>
              <p className="text-xs text-slate-500 mt-1">
                Compare DB draft version vs published manifest version. Editors only see assigned decks.
              </p>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
            <div className="flex-1">
              <input
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by slug / title / locale…"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | DeckStatus)}
                title="Status filter"
              >
                <option value="all">All status</option>
                <option value="published">Published</option>
                <option value="needs_publish">Needs publish</option>
                <option value="unpublished">Unpublished</option>
              </select>

              <select
                className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
                value={localeFilter}
                onChange={e => setLocaleFilter(e.target.value)}
                title="Locale filter"
              >
                <option value="all">All locales</option>
                {localeOptions.map(loc => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>

              <select
                className="rounded-md border border-slate-300 px-2 py-2 text-sm bg-white"
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as 'all' | 'starter' | 'paid')}
                title="Type filter"
              >
                <option value="all">All types</option>
                <option value="starter">Starter</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Deck</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Locale</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Type</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Draft v</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Published v</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Status</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Updated</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>

            <tbody>
              {viewRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500 text-sm">
                    No decks match your filters.
                  </td>
                </tr>
              ) : (
                viewRows.map(row => {
                  const deck = row.deck;
                  const published = row.publishedVersion;
                  const hasPublished = (published ?? '').trim().length > 0;

                  const deckWithDates = deck as Deck & { updatedAt?: unknown; createdAt?: unknown };
                  const updatedAt = deckWithDates.updatedAt ?? deckWithDates.createdAt;

                  return (
                    <tr key={deck.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-slate-900 font-medium">{deck.title}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{deck.slug}</div>
                      </td>

                      <td className="px-4 py-3 text-slate-700">{deck.locale ?? '—'}</td>

                      <td className="px-4 py-3">{typeBadge(deck.deckType)}</td>

                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">{String((deck as Deck & { version?: unknown }).version ?? '—')}</td>

                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">
                        {hasPublished ? published : <span className="text-slate-400">—</span>}
                      </td>

                      <td className="px-4 py-3">{statusBadge(row.status)}</td>

                      <td className="px-4 py-3 text-slate-500 text-xs">{safeDateTime(updatedAt)}</td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/decks/cards?deckId=${deck.id}`)}
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                          >
                            View Cards
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(`/decks/preview?deckId=${deck.id}`)}
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                            title="Preview mobile DeckExport JSON"
                          >
                            Preview
                          </button>

                          {superAdmin ? (
                            <button
                              type="button"
                              disabled={deletingId === deck.id}
                              onClick={() => void handleDeleteDeck(deck.id)}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                              title="super_admin only"
                            >
                              {deletingId === deck.id ? 'Deleting…' : 'Delete'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ConsoleShell>
  );
}