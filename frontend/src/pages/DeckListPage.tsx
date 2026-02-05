// src/pages/DeckListPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { deleteDeck, fetchAdminManifest, fetchDecks, publishDeck, rebuildManifest } from '../api/authoring';
import { getContentManifestUrl } from '../api/contentManifest';
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

  totalCards?: number | null;

  path?: string | null;

  previewCards?: number | null;
  previewBuildId?: string | null;
  previewPath?: string | null;
};

type ManifestMeta = {
  schemaVersion?: number;
  prefix?: string;
  generatedAtMs?: number;
  publishedAt?: string;
  generatedAt?: string;
  deckCount?: number;
};

type ManifestState = {
  loading: boolean;
  error: string | null;
  url: string;
  meta: ManifestMeta;
  bySlug: Record<string, ManifestDeckLite>;
  raw: unknown | null;
};

type DeckStatus = 'published' | 'needs_publish' | 'unpublished';

const MANIFEST_URL_OVERRIDE_KEY = 'rs_manifest_url_override';

function safeDateTime(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toOptionalString(v: unknown): string | undefined {
  if (!isNonEmptyString(v)) return undefined;
  return v.trim();
}

function toOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toOptionalNullableNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = toOptionalNumber(v);
  return n === undefined ? null : n;
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in o) return o[k];
  }
  return undefined;
}

function toManifestDeckLite(input: unknown): ManifestDeckLite | null {
  if (!isRecord(input)) return null;

  const slugV = pick(input, ['slug', 'Slug']);
  const slug = toOptionalString(slugV) ?? '';
  if (!slug) return null;

  const title = toOptionalString(pick(input, ['title', 'Title']));
  const locale = toOptionalString(pick(input, ['locale', 'Locale']));

  const availability = toOptionalString(pick(input, ['availability', 'Availability']));
  const tier = toOptionalString(pick(input, ['tier', 'Tier']));
  const downloadMode = toOptionalString(pick(input, ['downloadMode', 'DownloadMode']));

  const version = toOptionalString(pick(input, ['version', 'Version']));

  const buildIdRaw = pick(input, ['buildId', 'BuildId']);
  const buildId =
    buildIdRaw === null ? null : isNonEmptyString(buildIdRaw) ? String(buildIdRaw).trim() : undefined;

  const pathRaw = pick(input, ['path', 'Path']);
  const path = pathRaw === null ? null : isNonEmptyString(pathRaw) ? String(pathRaw).trim() : undefined;

  const totalCards = toOptionalNullableNumber(pick(input, ['totalCards', 'TotalCards']));

  const previewCards = toOptionalNullableNumber(pick(input, ['previewCards', 'PreviewCards']));

  const previewBuildIdRaw = pick(input, ['previewBuildId', 'PreviewBuildId']);
  const previewBuildId =
    previewBuildIdRaw === null
      ? null
      : isNonEmptyString(previewBuildIdRaw)
        ? String(previewBuildIdRaw).trim()
        : undefined;

  const previewPathRaw = pick(input, ['previewPath', 'PreviewPath']);
  const previewPath =
    previewPathRaw === null
      ? null
      : isNonEmptyString(previewPathRaw)
        ? String(previewPathRaw).trim()
        : undefined;

  return {
    slug,
    ...(title ? { title } : {}),
    ...(locale ? { locale } : {}),

    ...(availability ? { availability } : {}),
    ...(tier ? { tier } : {}),
    ...(downloadMode ? { downloadMode } : {}),

    ...(version ? { version } : {}),
    ...(buildId !== undefined ? { buildId } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(totalCards !== undefined ? { totalCards } : {}),

    ...(previewCards !== undefined ? { previewCards } : {}),
    ...(previewBuildId !== undefined ? { previewBuildId } : {}),
    ...(previewPath !== undefined ? { previewPath } : {}),
  };
}

function parseManifestMeta(raw: unknown): ManifestMeta {
  if (!isRecord(raw)) return {};

  const schemaVersion = toOptionalNumber(pick(raw, ['schemaVersion', 'SchemaVersion']));
  const prefix = toOptionalString(pick(raw, ['prefix', 'Prefix']));
  const generatedAtMs = toOptionalNumber(pick(raw, ['generatedAtMs', 'GeneratedAtMs']));
  const publishedAt = toOptionalString(pick(raw, ['publishedAt', 'PublishedAt']));
  const generatedAt = toOptionalString(pick(raw, ['generatedAt', 'GeneratedAt']));

  const decksRaw = pick(raw, ['decks', 'Decks']);
  const deckCount = Array.isArray(decksRaw) ? decksRaw.length : undefined;

  return {
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ...(prefix ? { prefix } : {}),
    ...(generatedAtMs !== undefined ? { generatedAtMs } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(generatedAt ? { generatedAt } : {}),
    ...(deckCount !== undefined ? { deckCount } : {}),
  };
}

function getManifestPublishedAt(meta: ManifestMeta): unknown {
  if (typeof meta.generatedAtMs === 'number') return meta.generatedAtMs;
  if (meta.publishedAt) return meta.publishedAt;
  if (meta.generatedAt) return meta.generatedAt;
  return undefined;
}

function getDeckStatusFromManifest(m?: ManifestDeckLite): DeckStatus {
  if (!m) return 'unpublished';

  const availability = String(m.availability ?? '').trim().toLowerCase();
  if (availability && availability !== 'live') return 'unpublished';

  const buildId = String(m.buildId ?? '').trim();
  if (buildId) return 'published';

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

function stripQuery(u: string): string {
  const i = u.indexOf('?');
  return i >= 0 ? u.slice(0, i) : u;
}

function buildDeckAssetUrl(manifestUrl: string, prefix: string | undefined, assetPath: string): string {
  const clean = stripQuery(manifestUrl);
  const safePath = assetPath.replace(/^\/+/, '');

  if (prefix && clean.includes(`/${prefix}/manifest.json`)) {
    const base = clean.split(`/${prefix}/manifest.json`)[0] + `/${prefix}/`;
    return base + safePath;
  }

  if (clean.endsWith('/manifest.json')) {
    return clean.slice(0, clean.length - '/manifest.json'.length + 1) + safePath;
  }

  const lastSlash = clean.lastIndexOf('/');
  const dir = lastSlash >= 0 ? clean.slice(0, lastSlash + 1) : clean + '/';
  return dir + safePath;
}

/**
 * ✅ IMPORTANT: Avoid CORS preflight:
 * - Do NOT send custom headers (e.g. Cache-Control)
 * - Rely on ?t= for cache busting
 */


export function DeckListPage() {
  const navigate = useNavigate();

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  const defaultManifestUrl = useMemo(() => getContentManifestUrl(), []);
  const [manifestUrlOverride, setManifestUrlOverride] = useState<string>(() => {
    try {
      return localStorage.getItem(MANIFEST_URL_OVERRIDE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const manifestUrl = useMemo(() => {
    const o = manifestUrlOverride.trim();
    return o || defaultManifestUrl;
  }, [manifestUrlOverride, defaultManifestUrl]);

  const isLikelyMockUrl = useMemo(() => {
    const u = manifestUrl.trim();
    return u === '/manifest/index.json' || u.startsWith('/manifest/');
  }, [manifestUrl]);

  const [deckState, setDeckState] = useState<DeckListState>({
    loading: true,
    error: null,
    decks: [],
  });

  const [manifestState, setManifestState] = useState<ManifestState>({
    loading: true,
    error: null,
    url: manifestUrl,
    meta: {},
    bySlug: {},
    raw: null,
  });

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);

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
      setManifestState(prev => ({ ...prev, loading: true, error: null, url: manifestUrl }));
    } else {
      setDeckState(prev => ({ ...prev, error: null }));
      setManifestState(prev => ({ ...prev, error: null, url: manifestUrl }));
    }

    try {
      const [decksRes, manifestRes] = await Promise.all([
  fetchDecks(),
  fetchAdminManifest(),
]);


      if (!mountedRef.current) return;

      if (!decksRes.success) {
        setDeckState({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', decks: [] });
      } else {
        setDeckState({ loading: false, error: null, decks: decksRes.data ?? [] });
      }

      if (!manifestRes.success) {
        setManifestState({
          loading: false,
          error: manifestRes.error?.message ?? 'Failed to load manifest.',
          url: manifestUrl,
          meta: {},
          bySlug: {},
          raw: null,
        });
      } else {
        const raw = manifestRes.data;
        const meta = parseManifestMeta(raw);

        const decksRaw = isRecord(raw) ? pick(raw, ['decks', 'Decks']) : null;
        const deckArr: unknown[] = Array.isArray(decksRaw) ? decksRaw : [];

        const bySlug: Record<string, ManifestDeckLite> = {};
        for (const d of deckArr) {
          const lite = toManifestDeckLite(d);
          if (lite) bySlug[lite.slug] = lite;
        }

        setManifestState({
          loading: false,
          error: null,
          url: manifestUrl,
          meta,
          bySlug,
          raw,
        });
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Network error.';
      setDeckState({ loading: false, error: message, decks: [] });
      setManifestState({ loading: false, error: message, url: manifestUrl, meta: {}, bySlug: {}, raw: null });
    }
  }

  useEffect(() => {
    void loadAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestUrl]);

  async function handleDeleteDeck(deckId: number) {
    if (!superAdmin) return;

    const ok = window.confirm('Delete deck is destructive.\n\nContinue?');
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
      'Publish will:\n1) Upload deck.json to S3\n2) Rebuild manifest.json\n\nContinue?',
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
    for (const d of decks) if (d.locale) set.add(d.locale);
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

        if (query) {
          const s = `${d.slug ?? ''} ${d.title ?? ''} ${d.locale ?? ''}`.toLowerCase();
          if (!s.includes(query)) return false;
        }

        if (statusFilter !== 'all' && row.status !== statusFilter) return false;
        if (localeFilter !== 'all' && String(d.locale) !== localeFilter) return false;

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

  function applyManifestUrlOverride() {
    try {
      const trimmed = manifestUrlOverride.trim();
      if (trimmed) localStorage.setItem(MANIFEST_URL_OVERRIDE_KEY, trimmed);
      else localStorage.removeItem(MANIFEST_URL_OVERRIDE_KEY);
    } catch {
      // Ignore localStorage errors
    }
    void loadAll(true);
  }

  function clearManifestUrlOverride() {
    setManifestUrlOverride('');
    try {
      localStorage.removeItem(MANIFEST_URL_OVERRIDE_KEY);
    } catch {
      // Ignore localStorage errors
    }
    void loadAll(true);
  }

  const manifestPublishedAt = getManifestPublishedAt(manifestState.meta);

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
      title="DeveloperCards Console"
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
      {/* Top strip */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="text-xs text-slate-600">
            <div>
              <span className="font-semibold">Manifest URL:</span>{' '}
              <a className="underline text-slate-700" href={manifestState.url} target="_blank" rel="noreferrer">
                {manifestState.url}
              </a>
            </div>

            {isLikelyMockUrl ? (
              <div className="mt-1 text-amber-800">
                ⚠️ Probably MOCK manifest ({manifestState.url}). Use S3/CloudFront URL (…/content/manifest.json)
              </div>
            ) : null}

            {manifestState.loading ? (
              <div className="mt-1">Loading manifest…</div>
            ) : manifestState.error ? (
              <div className="mt-1 text-amber-800">Manifest unavailable: {manifestState.error}</div>
            ) : (
              <div className="mt-1">
                Manifest OK
                {manifestState.meta.schemaVersion != null ? ` · schema=${manifestState.meta.schemaVersion}` : ''}
                {manifestState.meta.prefix ? ` · prefix=${manifestState.meta.prefix}` : ''}
                {manifestPublishedAt ? ` · generatedAt=${safeDateTime(manifestPublishedAt)}` : ''}
                {manifestState.meta.deckCount != null ? ` · decks=${manifestState.meta.deckCount}` : ''}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => void loadAll(false)}
            >
              Refresh
            </button>

            {superAdmin ? (
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={() => navigate('/decks/new')}
              >
                + New Deck
              </button>
            ) : null}
          </div>
        </div>

        <details className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3">
          <summary className="cursor-pointer text-sm text-slate-700 select-none">Manifest URL override (debug)</summary>
          <div className="mt-3 flex flex-col md:flex-row gap-2 md:items-center">
            <input
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              value={manifestUrlOverride}
              onChange={e => setManifestUrlOverride(e.target.value)}
              placeholder="https://<cloudfront>/content/manifest.json"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs px-3 py-2 rounded bg-slate-900 text-white hover:bg-slate-800"
                onClick={applyManifestUrlOverride}
              >
                Apply
              </button>
              <button
                type="button"
                className="text-xs px-3 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={clearManifestUrlOverride}
              >
                Clear
              </button>
            </div>
          </div>
        </details>

        {!manifestState.error && manifestState.raw ? (
          <details className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3">
            <summary className="cursor-pointer text-sm text-slate-700 select-none">View manifest.json (raw)</summary>
            <div className="mt-3 overflow-x-auto">
              <pre className="text-xs text-slate-700 whitespace-pre">{JSON.stringify(manifestState.raw, null, 2)}</pre>
            </div>
          </details>
        ) : null}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <div className="text-xs text-slate-500">Total decks</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{stats.total}</div>
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
                aria-label="Filter by status"
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
                aria-label="Filter by locale"
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
                aria-label="Filter by type"
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

                  const updatedAt =
                    (deck as Deck & { updatedAt?: unknown; createdAt?: unknown }).updatedAt ?? (deck as Deck & { updatedAt?: unknown; createdAt?: unknown }).createdAt ?? null;

                  const prefix = manifestState.meta.prefix;

                  const deckJsonUrl =
                    m?.path ? buildDeckAssetUrl(manifestState.url, prefix, m.path) : null;

                  const previewDeckJsonUrl =
                    m?.previewPath ? buildDeckAssetUrl(manifestState.url, prefix, m.previewPath) : null;

                  return (
                    <tr key={String(deck.id)} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
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
                              availability={m.availability ?? '—'} • tier={m.tier ?? '—'} • download={m.downloadMode ?? '—'}
                            </div>
                            <div className="font-mono">
                              buildId={m.buildId ?? '—'} • version={m.version ?? '—'} • totalCards={m.totalCards ?? '—'}
                            </div>
                            <div className="font-mono break-all">
                              path={m.path ?? '—'}{' '}
                              {deckJsonUrl ? (
                                <a className="underline text-slate-700" href={deckJsonUrl} target="_blank" rel="noreferrer">
                                  (open)
                                </a>
                              ) : null}
                            </div>
                            {m.previewPath ? (
                              <div className="font-mono break-all">
                                previewPath={m.previewPath}{' '}
                                {previewDeckJsonUrl ? (
                                  <a className="underline text-slate-700" href={previewDeckJsonUrl} target="_blank" rel="noreferrer">
                                    (open)
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
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
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(`/decks/preview?deckId=${deck.id}`)}
                            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                          >
                            Preview
                          </button>

                          {superAdmin ? (
                            <button
                              type="button"
                              disabled={publishingId === Number(deck.id)}
                              onClick={() => void handlePublish(Number(deck.id))}
                              className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 disabled:cursor-not-allowed"
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