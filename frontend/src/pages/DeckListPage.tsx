// src/pages/DeckListPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { deleteDeck, fetchDecks, publishDeck, rebuildManifest } from '../api/authoring';
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
  title?: string;
  locale?: string;

  availability?: string;
  tier?: string;
  downloadMode?: string;

  version?: string;
  buildId?: string | null;

  path?: string | null;

  previewCards?: number | null;
  previewBuildId?: string | null;
  previewPath?: string | null;
};

type ManifestState = {
  loading: boolean;
  error: string | null;
  publishedAt?: unknown;
  bySlug: Record<string, ManifestDeckLite>;
  raw: unknown | null;
};

type DeckStatus = 'published' | 'needs_publish' | 'unpublished';

function safeDateTime(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function toManifestDeckLite(input: unknown): ManifestDeckLite | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;

  const slug = typeof o.slug === 'string' ? o.slug : '';
  if (!slug) return null;

  const buildId =
    typeof o.buildId === 'string' ? o.buildId : o.buildId === null ? null : undefined;

  const path = typeof o.path === 'string' ? o.path : o.path === null ? null : undefined;

  const previewPath =
    typeof o.previewPath === 'string' ? o.previewPath : o.previewPath === null ? null : undefined;

  const previewBuildId =
    typeof o.previewBuildId === 'string'
      ? o.previewBuildId
      : o.previewBuildId === null
        ? null
        : undefined;

  const previewCards =
    typeof o.previewCards === 'number' ? o.previewCards : o.previewCards === null ? null : undefined;

  return {
    slug,
    title: typeof o.title === 'string' ? o.title : undefined,
    locale: typeof o.locale === 'string' ? o.locale : undefined,

    availability: typeof o.availability === 'string' ? o.availability : undefined,
    tier: typeof o.tier === 'string' ? o.tier : undefined,
    downloadMode: typeof o.downloadMode === 'string' ? o.downloadMode : undefined,

    version: typeof o.version === 'string' ? o.version : undefined,
    buildId,
    path,

    previewCards,
    previewBuildId,
    previewPath,
  };
}

function getManifestPublishedAt(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.publishedAt === 'string') return o.publishedAt;
  if (typeof o.generatedAt === 'string') return o.generatedAt;
  if (typeof o.generatedAtMs === 'number') return o.generatedAtMs;
  return undefined;
}

function getDeckStatusFromManifest(m?: ManifestDeckLite): DeckStatus {
  if (!m) return 'unpublished';

  const availability = String(m.availability ?? '').trim().toLowerCase();
  if (availability && availability !== 'live') return 'unpublished';

  const buildId = String(m.buildId ?? '').trim();
  if (buildId) return 'published';

  // live but no build => needs publish
  return 'needs_publish';
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
    raw: null,
  });

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);

  // UI filters
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeckStatus>('all');
  const [localeFilter, setLocaleFilter] = useState<'all' | string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'starter' | 'paid'>('all');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function loadAll(showSpinner = false) {
    if (showSpinner) {
      setDeckState(prev => ({ ...prev, loading: true, error: null }));
      setManifestState(prev => ({ ...prev, loading: true, error: null }));
    } else {
      setDeckState(prev => ({ ...prev, error: null }));
      setManifestState(prev => ({ ...prev, error: null }));
    }

    try {
      const [decksRes, manifestRes] = await Promise.all([
        fetchDecks(),
        fetchContentManifest({ bustCache: true }),
      ]);

      if (!mountedRef.current) return;

      // decks
      if (!decksRes.success) {
        setDeckState({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', decks: [] });
      } else {
        setDeckState({ loading: false, error: null, decks: decksRes.data ?? [] });
      }

      // manifest
      if (!manifestRes.ok) {
        setManifestState({ loading: false, error: manifestRes.error, publishedAt: undefined, bySlug: {}, raw: null });
      } else {
        const raw = manifestRes.data as unknown;

        const bySlug: Record<string, ManifestDeckLite> = {};
        const decksRaw =
          raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).decks)
            ? ((raw as Record<string, unknown>).decks as unknown[])
            : [];

        for (const d of decksRaw) {
          const lite = toManifestDeckLite(d);
          if (lite) bySlug[lite.slug] = lite;
        }

        setManifestState({
          loading: false,
          error: null,
          publishedAt: getManifestPublishedAt(raw),
          bySlug,
          raw,
        });
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Network error.';
      setDeckState({ loading: false, error: message, decks: [] });
      setManifestState({ loading: false, error: message, publishedAt: undefined, bySlug: {}, raw: null });
    }
  }

  useEffect(() => {
    void loadAll(true);
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

      setDeckState(prev => ({ ...prev, decks: prev.decks.filter(d => Number(d.id) !== deckId) }));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePublish(deckId: number) {
    if (!superAdmin) return;

    const ok = window.confirm(
      'Publish will:\n' +
        '1) Export cards and upload deck.json to S3\n' +
        '2) Rebuild manifest.json\n\n' +
        'IMPORTANT: Mobile can only read cards when manifest availability=live.\n\n' +
        'Continue?',
    );
    if (!ok) return;

    try {
      setPublishingId(deckId);

      const pub = await publishDeck({ deckId });
      if (!pub.success) {
        alert(pub.error?.message ?? 'Publish failed.');
        return;
      }

      const rb = await rebuildManifest();
      if (!rb.success) {
        alert(rb.error?.message ?? 'Manifest rebuild failed (publish succeeded).');
      }

      await loadAll(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPublishingId(null);
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
        const m = manifestState.bySlug[d.slug];
        const status = getDeckStatusFromManifest(m);

        return { deck: d, manifest: m, status };
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
      const m = manifestState.bySlug[d.slug];
      const st = getDeckStatusFromManifest(m);
      if (st === 'published') published += 1;
      if (st === 'needs_publish') needs += 1;
      if (st === 'unpublished') unpub += 1;
    }

    return { total: decks.length, published, needsPublish: needs, unpublished: unpub };
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
      userLabel={
        user
          ? `${user.email ?? user.username ?? 'Signed in'}${superAdmin ? ' · super_admin' : ' · editor'}`
          : '—'
      }
      superAdmin={superAdmin}
      onSignOut={handleSignOut}
      onGoAdminUsers={superAdmin ? () => navigate('/admin/users') : undefined}
    >
      {/* Top strip: manifest + refresh */}
      <div className="flex flex-col gap-2">
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

        {/* ✅ manifest.json raw viewer */}
        {!manifestState.error && manifestState.raw ? (
          <details className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3">
            <summary className="cursor-pointer text-sm text-slate-700 select-none">
              View manifest.json (raw)
            </summary>
            <div className="mt-3 overflow-x-auto">
              <pre className="text-xs text-slate-700 whitespace-pre">
                {JSON.stringify(manifestState.raw, null, 2)}
              </pre>
            </div>
          </details>
        ) : null}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
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
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm mt-3">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Decks</h2>
              <p className="text-xs text-slate-500 mt-1">
                Status is derived from manifest availability + buildId. (live+buildId =&gt; Published)
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
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Manifest</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Status</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Updated</th>
                <th className="px-4 py-2 text-left font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>

            <tbody>
              {viewRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500 text-sm">
                    No decks match your filters.
                  </td>
                </tr>
              ) : (
                viewRows.map(row => {
                  const deck = row.deck;
                  const m = row.manifest;

                  const deckWithDates = deck as Deck & { updatedAt?: unknown; createdAt?: unknown };
                  const updatedAt = deckWithDates.updatedAt ?? deckWithDates.createdAt;

                  const canWrite = superAdmin || (typeof deck.canWrite === 'boolean' ? deck.canWrite : false);

                  return (
                    <tr key={deck.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-slate-900 font-medium">{deck.title}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{deck.slug}</div>
                      </td>

                      <td className="px-4 py-3 text-slate-700">{deck.locale ?? '—'}</td>

                      <td className="px-4 py-3">{typeBadge(deck.deckType)}</td>

                      <td className="px-4 py-3 text-xs text-slate-700">
                        {!m ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="space-y-1">
                            <div className="font-mono">
                              availability={m.availability ?? '—'} • download={m.downloadMode ?? '—'}
                            </div>
                            <div className="font-mono">buildId={m.buildId ?? '—'}</div>
                            <div className="font-mono">path={m.path ?? '—'}</div>
                            {m.previewPath ? <div className="font-mono">previewPath={m.previewPath}</div> : null}
                          </div>
                        )}
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
                            onClick={() => navigate(`/decks/edit?deckId=${deck.id}`)}
                            disabled={!canWrite}
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            title={canWrite ? 'Edit deck metadata' : 'You do not have write permission for this deck'}
                          >
                            Edit
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
                              disabled={publishingId === Number(deck.id)}
                              onClick={() => void handlePublish(Number(deck.id))}
                              className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 disabled:cursor-not-allowed"
                              title="Upload deck.json + rebuild manifest"
                            >
                              {publishingId === Number(deck.id) ? 'Publishing…' : 'Publish'}
                            </button>
                          ) : null}

                          {superAdmin ? (
                            <button
                              type="button"
                              disabled={deletingId === Number(deck.id)}
                              onClick={() => void handleDeleteDeck(Number(deck.id))}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                              title="super_admin only"
                            >
                              {deletingId === Number(deck.id) ? 'Deleting…' : 'Delete'}
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
