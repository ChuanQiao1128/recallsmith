// src/pages/DeckListPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  ADMIN_DECKS_ENDPOINT_MISSING,
  deleteDeck,
  fetchAdminDecksPage,
  fetchAdminManifest,
  fetchDeckBySlug,
  fetchDecks,
  fetchPublishJobs,
  publishDeck,
} from '../api/authoring';
import { getContentManifestUrl } from '../api/contentManifest';
import { markEnd, markStart } from '../perf/journey';
import type { Deck } from '../types/deck';
import type { PublishJob } from '../api/authoring';
import { nextPollDelay } from '../lib/publishJobsPolling';
import type { PollOutcome } from '../lib/publishJobsPolling';
import {
  DECKS_PAGE_SIZE,
  applyDecksPage,
  derivePagedDeckStatus,
  emptyDeckPageListState,
  isStarterLike,
  removeDeckBySlug,
} from './deckListPagination';
import type { DeckPageListState, DeckStatus } from './deckListPagination';

import { clearStoredTokens } from '../auth/tokenStore';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin, type SessionUser } from '../auth/sessionUser';

import { ConsoleShell } from '../components/console/ConsoleShell';

// ==================== 缓存工具 ====================
const CACHE_KEY_DECKS = 'recallsmith_decks_cache';
const CACHE_KEY_MANIFEST = 'recallsmith_manifest_cache';
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

function getCache<T>(key: string): T | null {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    const parsed: CacheItem<T> = JSON.parse(item);
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCache<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // 忽略存储错误
  }
}

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

type ListMode = 'paginated' | 'legacy';

// Error codes that mean "the paginated endpoint is unusable here" → fall back
// to the legacy full-list load (404 = not deployed yet, 403 = not permitted).
const PAGINATED_FALLBACK_CODES = new Set<string>([
  ADMIN_DECKS_ENDPOINT_MISSING,
  'NOT_FOUND',
  'FORBIDDEN',
]);

// Unified row shape rendered by the table, produced by both the paginated
// (/api/v1/admin/decks) and legacy (full fetchDecks + manifest) data paths.
type ConsoleDeckRow = {
  key: string;
  id: number | null;
  slug: string;
  title: string;
  deckType: number | null;
  tier: string | null;
  manifestOrder: number | null;
  cardCount: number;
  status: DeckStatus;
  updatedAt: string | number | null;
};

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

// ✅ 核心修复：自动剥离外层的 { manifest: { ... } } 包装
function getManifestTarget(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.manifest)) return raw.manifest as Record<string, unknown>;
  if (isRecord(raw.data) && isRecord(raw.data.manifest)) return raw.data.manifest as Record<string, unknown>;
  if (isRecord(raw.data)) return raw.data as Record<string, unknown>;
  return raw;
}

function extractDecksArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const target = getManifestTarget(raw);
  const decks = target['decks'] ?? target['Decks'];
  if (Array.isArray(decks)) return decks;
  return [];
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
  const target = getManifestTarget(raw);

  const schemaVersion = toOptionalNumber(pick(target, ['schemaVersion', 'SchemaVersion']));
  const prefix = toOptionalString(pick(target, ['prefix', 'Prefix']));
  const generatedAtMs = toOptionalNumber(pick(target, ['generatedAtMs', 'GeneratedAtMs']));
  const publishedAt = toOptionalString(pick(target, ['publishedAt', 'PublishedAt']));
  const generatedAt = toOptionalString(pick(target, ['generatedAt', 'GeneratedAt']));

  const decksRaw = pick(target, ['decks', 'Decks']);
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

function getDeckStatusFromManifest(deck: Deck, m?: ManifestDeckLite, cardCount?: number): DeckStatus {
  const isPublished = !!(m && (m.buildId || m.path));
  const count = cardCount ?? deck.totalCards ?? 0;

  if (isPublished) return 'published';
  if (count > 0) return 'needs_publish';
  
  return 'unpublished';
}

function statusBadge(status: DeckStatus) {
  if (status === 'published') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm">Published</span>;
  }
  if (status === 'needs_publish') {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-sm">Needs Publish</span>;
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 shadow-sm">Unpublished</span>;
}

function typeBadge(deckType: number) {
  if (deckType === 1) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">Starter</span>;
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200">Paid</span>;
}

/**
 * ✅ IMPORTANT: Avoid CORS preflight:
 * - Do NOT send custom headers (e.g. Cache-Control)
 * - Rely on ?t= for cache busting
 */


export function DeckListPage() {
  const navigate = useNavigate();

  const user = useMemo<SessionUser | null>(() => readSessionUser(), []);
  const superAdmin = useMemo<boolean>(() => isSuperAdmin(user), [user]);

  const manifestUrl = useMemo(() => getContentManifestUrl(), []);

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

  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [publishingSlug, setPublishingSlug] = useState<string | null>(null);

  // Paginated deck list state (GET /api/v1/admin/decks). Falls back to the
  // legacy full-list load when the endpoint is unavailable (feature-detect).
  // Non-superadmin sessions start in legacy mode directly: the paginated
  // endpoint is super_admin-gated, so probing it would be a guaranteed 403.
  const [listMode, setListMode] = useState<ListMode>(() => (superAdmin ? 'paginated' : 'legacy'));
  const listModeRef = useRef<ListMode>(superAdmin ? 'paginated' : 'legacy');
  const [paged, setPaged] = useState<DeckPageListState>(emptyDeckPageListState);
  const [pagedInitialized, setPagedInitialized] = useState(false);
  const [pagedLoading, setPagedLoading] = useState(true);
  const [pagedLoadingMore, setPagedLoadingMore] = useState(false);
  const [pagedError, setPagedError] = useState<string | null>(null);
  const pagedRequestSeq = useRef(0);
  // slug → deck id cache: the paginated contract does not guarantee ids, but
  // every row action needs one; resolved lazily via GET /authoring/decks?slug=.
  const resolvedIdsRef = useRef<Map<string, number>>(new Map());
  const [debouncedQ, setDebouncedQ] = useState('');

  // Publish Jobs state
  const [publishJobs, setPublishJobs] = useState<PublishJob[]>([]);
  // Job id of the publish currently being timed, if any.
  const pendingPublishJobIdRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<'decks' | 'publishJobs'>('decks');
  const [publishJobsError, setPublishJobsError] = useState<string | null>(null);
  // Derived from the timer rather than set by a branch, so a future path that
  // forgets to reschedule surfaces as a visible banner instead of silence.
  const [pollingStopped, setPollingStopped] = useState(false);

  // 轮询使用的 Ref
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePollsRef = useRef(0);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeckStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'starter' | 'paid'>('all');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function loadAll(forceRefresh = false) {
    // 💡 缓存优化：先检查缓存
    const cachedDecks = getCache<Deck[]>(CACHE_KEY_DECKS);
    const cachedManifest = getCache<{ meta: ManifestMeta; bySlug: Record<string, ManifestDeckLite>; raw: unknown }>(CACHE_KEY_MANIFEST);
    
    // 如果有缓存且不强刷，立即显示缓存（无 loading），然后后台刷新
    const hasCache = cachedDecks && cachedManifest;
    if (hasCache && !forceRefresh) {
      setDeckState({ loading: false, error: null, decks: cachedDecks });
      setManifestState({
        loading: false,
        error: null,
        url: manifestUrl,
        meta: cachedManifest.meta,
        bySlug: cachedManifest.bySlug,
        raw: cachedManifest.raw,
      });
    } else {
      // 无缓存或强制刷新时显示 loading
      setDeckState(prev => ({ ...prev, loading: true, error: null }));
      setManifestState(prev => ({ ...prev, loading: true, error: null, url: manifestUrl }));
    }

    try {
      // 并行请求 decks 和 manifest
      const [decksRes, manifestRes] = await Promise.all([
        fetchDecks(),
        fetchAdminManifest(),
      ]);

      if (!mountedRef.current) return;

      if (!decksRes.success) {
        if (!cachedDecks) {
          setDeckState({ loading: false, error: decksRes.error?.message ?? 'Failed to load decks.', decks: [] });
        }
      } else {
        const decks = decksRes.data ?? [];
        setCache(CACHE_KEY_DECKS, decks);
        setDeckState({ loading: false, error: null, decks });
      }

      if (!manifestRes.success) {
        if (!cachedManifest) {
          setManifestState({
            loading: false,
            error: manifestRes.error?.message ?? 'Failed to load manifest.',
            url: manifestUrl,
            meta: {},
            bySlug: {},
            raw: null,
          });
        }
      } else {
        let raw = manifestRes.data;
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch { /* ignore */ }
        }

        const meta = parseManifestMeta(raw);
        const deckArr = extractDecksArray(raw);

        const bySlug: Record<string, ManifestDeckLite> = {};
        for (const d of deckArr) {
          const lite = toManifestDeckLite(d);
          if (lite) bySlug[lite.slug] = lite;
        }

        setCache(CACHE_KEY_MANIFEST, { meta, bySlug, raw });
        setManifestState({
          loading: false,
          error: null,
          url: manifestUrl,
          meta,
          bySlug,
          raw,
        });
      }

      // ✅ 卡片数量直接使用 DB 中的 total_cards，不再逐个调 API

      // 同时刷新 publish jobs（强制刷新时）
      if (forceRefresh) {
        void loadPublishJobs();
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Network error.';
      // 如果有缓存，不显示错误
      if (!cachedDecks) {
        setDeckState({ loading: false, error: message, decks: [] });
        setManifestState({ loading: false, error: message, url: manifestUrl, meta: {}, bySlug: {}, raw: null });
      }
    }
  }

  // ==================== paginated loading (new admin decks endpoint) ====================

  async function loadPagedFirst(query: string) {
    const seq = ++pagedRequestSeq.current;
    setPagedLoading(true);
    setPagedLoadingMore(false);
    setPagedError(null);

    const res = await fetchAdminDecksPage({ limit: DECKS_PAGE_SIZE, q: query });
    if (!mountedRef.current || seq !== pagedRequestSeq.current) return;

    if (!res.success) {
      // Feature-detect: endpoint not deployed (404) or not permitted (403) →
      // fall back to the legacy full-list load and stay in legacy mode.
      if (res.error && PAGINATED_FALLBACK_CODES.has(res.error.code)) {
        console.warn(
          `[DeckListPage] GET /api/v1/admin/decks unavailable (${res.error.code}); falling back to legacy deck list load.`,
        );
        listModeRef.current = 'legacy';
        setListMode('legacy');
        setPagedLoading(false);
        void loadAll(false);
        return;
      }
      setPagedLoading(false);
      setPagedInitialized(true);
      setPagedError(res.error?.message ?? 'Failed to load decks.');
      return;
    }

    setPaged(
      applyDecksPage(
        emptyDeckPageListState,
        res.data ?? { items: [], nextCursor: null, hasMore: false },
        'reset',
      ),
    );
    setPagedLoading(false);
    setPagedInitialized(true);
  }

  async function loadPagedMore() {
    if (pagedLoading || pagedLoadingMore || !paged.hasMore || !paged.nextCursor) return;

    const seq = ++pagedRequestSeq.current;
    setPagedLoadingMore(true);
    setPagedError(null);

    const res = await fetchAdminDecksPage({
      limit: DECKS_PAGE_SIZE,
      cursor: paged.nextCursor,
      q: debouncedQ,
    });
    if (!mountedRef.current) return;
    setPagedLoadingMore(false);
    if (seq !== pagedRequestSeq.current) return; // superseded by a newer load

    if (!res.success) {
      setPagedError(res.error?.message ?? 'Failed to load more decks.');
      return;
    }
    const page = res.data ?? { items: [], nextCursor: null, hasMore: false };
    setPaged(prev => applyDecksPage(prev, page, 'append'));
  }

  async function resolveDeckId(row: ConsoleDeckRow): Promise<number | null> {
    if (row.id !== null && Number.isFinite(row.id)) return row.id;
    const cached = resolvedIdsRef.current.get(row.slug);
    if (cached !== undefined) return cached;

    const res = await fetchDeckBySlug(row.slug);
    const id = res.success && res.data ? Number(res.data.id) : Number.NaN;
    if (Number.isFinite(id)) {
      resolvedIdsRef.current.set(row.slug, id);
      return id;
    }
    alert(res.error?.message ?? 'Failed to resolve deck id.');
    return null;
  }

  async function navigateWithDeckId(row: ConsoleDeckRow, to: (id: number) => string) {
    const id = await resolveDeckId(row);
    if (id === null) return;
    navigate(to(id));
  }

  // Debounce the search box → server-side q for the paginated endpoint.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Sessions that START in legacy mode (non-superadmin) load the legacy list on
  // mount — the paginated effect below never fires for them, and the 403
  // fallback path (which normally triggers loadAll) is deliberately skipped.
  useEffect(() => {
    if (listModeRef.current === 'legacy') void loadAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial load + search-driven reloads. Paginated mode only: legacy mode
  // filters client-side over the already-loaded full list.
  useEffect(() => {
    if (listModeRef.current === 'legacy') return;
    void loadPagedFirst(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  async function handleDeleteDeck(row: ConsoleDeckRow) {
    if (!superAdmin) return;

    const ok = window.confirm('Delete deck is destructive.\n\nContinue?');
    if (!ok) return;

    try {
      setDeletingSlug(row.slug);
      const deckId = await resolveDeckId(row);
      if (deckId === null) return;

      const res = await deleteDeck(deckId);
      if (!res.success) {
        alert(res.error?.message ?? 'Delete deck failed.');
        return;
      }
      if (listModeRef.current === 'paginated') {
        setPaged(prev => removeDeckBySlug(prev, row.slug));
      } else {
        setDeckState(prev => ({ ...prev, decks: prev.decks.filter(d => String(d.slug) !== row.slug) }));
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setDeletingSlug(null);
    }
  }

  async function handlePublish(row: ConsoleDeckRow) {
    if (!superAdmin) return;

    const ok = window.confirm(
      'Publish will:\n1) Upload deck.json to S3\n2) Rebuild manifest.json\n\nContinue?',
    );
    if (!ok) return;

    // The journey starts once the user has committed, so the time the dialog
    // sat open is not counted as our latency.
    markStart('publish');

    try {
      setPublishingSlug(row.slug);
      const deckId = await resolveDeckId(row);
      if (deckId === null) return;

      const pub = await publishDeck(deckId);
      if (!pub.success) {
        alert(pub.error?.message ?? 'Publish failed.');
        return;
      }
      pendingPublishJobIdRef.current = pub.data?.jobId ?? null;

      // 发布成功后强制刷新，确保数据最新
      if (listModeRef.current === 'paginated') {
        void loadPublishJobs();
        await loadPagedFirst(debouncedQ);
      } else {
        await loadAll(true);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setPublishingSlug(null);
    }
  }

  // Publish is only done, from the user's point of view, when the new job is
  // on screen, so the measure closes on the render that first shows it rather
  // than when the POST resolves.
  useEffect(() => {
    const pending = pendingPublishJobIdRef.current;
    if (!pending) return;
    if (publishJobs.some(job => job.jobId === pending)) {
      pendingPublishJobIdRef.current = null;
      markEnd('publish');
    }
  }, [publishJobs]);

  // Loads publish jobs and reschedules itself with a backoff.
  //
  // Invariant: every path leaving this function either schedules the next poll
  // or tells the user that auto refresh has stopped. The third state, quietly
  // not polling, is invisible to both the user and the developer, which makes
  // it the worst of the three: the page keeps rendering stale rows and a
  // publish that already finished still looks stuck. That is exactly what a
  // resolved-but-unsuccessful response used to produce here, because the
  // success branch owned the rescheduling and had no else.
  //
  // The scheduling decision itself lives in nextPollDelay so each branch is
  // testable without a DOM; this function only wires it to state and timers.
  async function loadPublishJobs() {
    // 每次调用前清除旧定时器，防止并行请求竞态
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    let outcome: PollOutcome;
    try {
      outcome = { kind: 'response', result: await fetchPublishJobs() };
    } catch (err) {
      outcome = { kind: 'exception', error: err };
    }

    // Unmounted is the one legitimate stop: the effect cleanup already owns
    // the timer, and there is no longer a user to tell.
    if (!mountedRef.current) return;

    const decision = nextPollDelay(outcome, activePollsRef.current);
    activePollsRef.current = decision.nextActivePolls;

    if (decision.jobs) setPublishJobs(decision.jobs);
    setPublishJobsError(decision.showError);
    if (decision.showError) console.error('Failed to load publish jobs:', decision.showError);

    if (!decision.stopped) {
      pollTimerRef.current = setTimeout(() => void loadPublishJobs(), decision.delayMs);
    }

    // Backstop for the invariant: the flag is read back off the timer instead
    // of being set by whichever branch ran, so a branch added later that
    // forgets to reschedule still turns the banner on rather than going quiet.
    setPollingStopped(pollTimerRef.current === null);
  }

  // 初次挂载时启动轮询，卸载时清理
  useEffect(() => {
    void loadPublishJobs();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  function handleSignOut() {
    clearStoredTokens();
    try {
      window.location.assign(buildLogoutUrl());
    } catch {
      navigate('/login', { replace: true });
    }
  }

  const decks = useMemo<Deck[]>(() => deckState.decks ?? [], [deckState.decks]);

  const viewRows = useMemo<ConsoleDeckRow[]>(() => {
    if (listMode === 'paginated') {
      // Server already applied q (ILIKE on slug/title) and ordering
      // (updated_at DESC, slug); status/type filters remain client-side
      // refinements over the loaded pages.
      return paged.items
        .map<ConsoleDeckRow>(item => ({
          key: item.slug,
          id: item.id ?? null,
          slug: item.slug,
          title: item.title ?? '',
          deckType: item.deckType ?? null,
          tier: item.tier ?? null,
          manifestOrder: null,
          cardCount: item.totalCards ?? 0,
          status: derivePagedDeckStatus(item),
          updatedAt: item.updatedAtMs ?? null,
        }))
        .filter(row => {
          if (statusFilter !== 'all' && row.status !== statusFilter) return false;
          if (typeFilter !== 'all') {
            const starter = isStarterLike(row.deckType, row.tier);
            if (typeFilter === 'starter' && !starter) return false;
            if (typeFilter === 'paid' && starter) return false;
          }
          return true;
        });
    }

    const query = q.trim().toLowerCase();

    return decks
      .map(d => {
        const m = manifestState.bySlug[String(d.slug || '').trim()];
        const cardCount = d.totalCards ?? 0;
        const status = getDeckStatusFromManifest(d, m, cardCount);
        return { deck: d, status, cardCount };
      })
      .filter(row => {
        const d = row.deck;

        if (query) {
          const s = `${d.slug ?? ''} ${d.title ?? ''}`.toLowerCase();
          if (!s.includes(query)) return false;
        }

        if (statusFilter !== 'all' && row.status !== statusFilter) return false;

        if (typeFilter !== 'all') {
          if (typeFilter === 'starter' && d.deckType !== 1) return false;
          if (typeFilter === 'paid' && d.deckType === 1) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const oA = typeof (a.deck as Deck & { manifestOrder?: number }).manifestOrder === 'number' ? (a.deck as Deck & { manifestOrder?: number }).manifestOrder! : 999999;
        const oB = typeof (b.deck as Deck & { manifestOrder?: number }).manifestOrder === 'number' ? (b.deck as Deck & { manifestOrder?: number }).manifestOrder! : 999999;
        return oA - oB;
      })
      .map<ConsoleDeckRow>(({ deck: d, status, cardCount }) => {
        const withDates = d as Deck & { updatedAt?: string | null; createdAt?: string | null };
        const idNum = Number(d.id);
        return {
          key: String(d.id),
          id: Number.isFinite(idNum) ? idNum : null,
          slug: String(d.slug ?? ''),
          title: String(d.title ?? ''),
          deckType: typeof d.deckType === 'number' ? d.deckType : null,
          tier: d.tier ?? null,
          manifestOrder: typeof d.manifestOrder === 'number' ? d.manifestOrder : null,
          cardCount,
          status,
          updatedAt: withDates.updatedAt ?? withDates.createdAt ?? null,
        };
      });
  }, [listMode, paged.items, decks, manifestState.bySlug, q, statusFilter, typeFilter]);



  const initialLoading = listMode === 'paginated' ? !pagedInitialized : deckState.loading;
  const fatalError =
    listMode === 'paginated'
      ? pagedInitialized && !pagedLoading && paged.items.length === 0 && pagedError
        ? pagedError
        : null
      : deckState.error;

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-slate-600 text-lg">Loading console…</div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm max-w-md">
          <div className="font-semibold mb-1">Failed to load decks</div>
          <div className="text-sm">{String(fatalError)}</div>
          <button
            type="button"
            className="mt-3 text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
            onClick={() => {
              if (listMode === 'paginated') void loadPagedFirst(debouncedQ);
              else void loadAll(true);
            }}
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
      onGoContentIntelligence={() => navigate('/content-intelligence')}
      onGoAdminUsers={superAdmin ? () => navigate('/admin/users') : undefined}
    >
      <div className="w-full mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {activeTab === 'decks' ? 'Decks' : 'Publish Jobs'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {activeTab === 'decks' 
                ? 'Manage your flashcard decks, edit content, and publish to mobile.' 
                : 'View and monitor deck publishing tasks.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Tab Switcher - 横向开关样式 */}
            {superAdmin && (
              <div className="flex items-center bg-white border border-slate-300 rounded-xl p-1 shadow-sm">
                <button
                  type="button"
                  className={`relative px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    activeTab === 'decks'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  onClick={() => setActiveTab('decks')}
                >
                  Decks
                </button>
                <button
                  type="button"
                  className={`relative px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                    activeTab === 'publishJobs'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                  onClick={() => setActiveTab('publishJobs')}
                >
                  Publish Jobs
                  {publishJobs.filter(j => j.status === 'PENDING' || j.status === 'PROCESSING').length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      activeTab === 'publishJobs' ? 'bg-white text-indigo-600' : 'bg-amber-500 text-white'
                    }`}>
                      {publishJobs.filter(j => j.status === 'PENDING' || j.status === 'PROCESSING').length}
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Refresh 按钮 - 两个标签页都有 */}
            {activeTab === 'decks' ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 shadow-sm transition-all active:scale-95"
                onClick={() => {
                  if (listModeRef.current === 'paginated') void loadPagedFirst(debouncedQ);
                  else void loadAll(false);
                }}
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 shadow-sm transition-all active:scale-95"
                onClick={() => void loadPublishJobs()}
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}
            {superAdmin ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 shadow-sm transition-all active:scale-95"
                onClick={() => navigate('/decks/new')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Deck
              </button>
            ) : null}
          </div>
        </div>

        {/* Manifest Error Banner */}
        {!!manifestState.error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
            <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-red-800">Manifest Sync Error</h3>
              <p className="text-xs text-red-700 mt-1">Failed to load manifest.json from S3. Decks may incorrectly show as Unpublished. Error: {String(manifestState.error)}</p>
            </div>
          </div>
        )}

        {/* Publish Jobs Refresh Banner. A failed refresh has to be visible:
            silently stale job rows read as "the publish is stuck". */}
        {superAdmin && (!!publishJobsError || pollingStopped) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 shadow-sm">
            <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-red-800">Publish Jobs Not Refreshing</h3>
              <p className="text-xs text-red-700 mt-1">
                {publishJobsError ?? 'Could not refresh publish jobs.'} Job statuses shown below may be out of date.
              </p>
              {pollingStopped && (
                <button
                  type="button"
                  onClick={() => void loadPublishJobs()}
                  className="mt-2 text-xs font-semibold text-red-800 underline underline-offset-2 hover:text-red-900"
                >
                  Auto-refresh stopped. Click to retry.
                </button>
              )}
            </div>
          </div>
        )}

        {/* <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-500">Total Decks</div>
              <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
            </div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{0}</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-500">Published</div>
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100">
                <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
            </div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{0}</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-transparent pointer-events-none"></div>
            <div className="flex items-center justify-between relative">
              <div className="text-sm font-medium text-amber-700">Needs Publish</div>
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center border border-amber-200">
                <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              </div>
            </div>
            <div className="mt-3 text-3xl font-bold text-amber-700 relative">{0}</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-500">Unpublished</div>
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" /></svg>
              </div>
            </div>
            <div className="mt-3 text-3xl font-bold text-slate-900">{0}</div>
          </div>
        </div> -->

        {/* Main List Container - Tab Content */}
        {activeTab === 'publishJobs' && superAdmin ? (
          /* Publish Jobs List */
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Recent Publish Jobs</h3>
              <button
                type="button"
                onClick={() => void loadPublishJobs()}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Refresh
              </button>
            </div>
            <div className="overflow-auto">
              {publishJobs.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-500">No publish jobs yet.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-medium">
                    <tr>
                      <th className="px-4 py-3 text-left">Job ID</th>
                      <th className="px-4 py-3 text-left">Deck</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Note</th>
                      <th className="px-4 py-3 text-left">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {publishJobs.map(job => (
                      <tr key={job.jobId} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{job.jobId.slice(0, 8)}...</td>
                        <td className="px-4 py-3 font-medium text-slate-700">{job.deckSlug}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium ${
                            job.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' :
                            job.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                            job.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">{job.note || '-'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{safeDateTime(job.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Filters Bar */}
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Search by slug or title..."
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-lg border border-slate-300 py-2 pl-3 pr-8 text-sm bg-white font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as 'all' | DeckStatus)}
                  aria-label="Filter by status"
                >
                  <option value="all">All Status</option>
                  <option value="published">Published</option>
                  <option value="needs_publish">Needs Publish</option>
                  <option value="unpublished">Unpublished</option>
                </select>
                <select
                  className="rounded-lg border border-slate-300 py-2 pl-3 pr-8 text-sm bg-white font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value as 'all' | 'starter' | 'paid')}
                  aria-label="Filter by type"
                >
                  <option value="all">All Types</option>
                  <option value="starter">Starter</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              <tr>
                <th className="px-6 py-4">Deck</th>
                <th className="px-6 py-4">Cards</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Updated</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {listMode === 'paginated' && pagedLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">
                    Loading decks…
                  </td>
                </tr>
              ) : viewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">
                    {q.trim() ? 'No decks match your search.' : 'No decks match your filters.'}
                  </td>
                </tr>
              ) : (
                viewRows.map(row => (
                  <tr key={row.key} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 shadow-sm" title="Manifest Order">
                          #{String(row.manifestOrder ?? '-')}
                        </span>
                        <div>
                          <div className="text-slate-900 font-medium">{row.title}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{row.slug}</div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => void navigateWithDeckId(row, id => `/decks/cards?deckId=${id}`)}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-mono border shadow-sm transition-colors bg-slate-100 text-slate-700 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 cursor-pointer"
                        title="Manage Cards"
                      >
                        {row.cardCount}
                      </button>
                    </td>

                    <td className="px-6 py-4">{typeBadge(isStarterLike(row.deckType, row.tier) ? 1 : 2)}</td>

                    <td className="px-6 py-4">{statusBadge(row.status)}</td>

                    <td className="px-6 py-4 text-slate-500 text-xs">{safeDateTime(row.updatedAt)}</td>

                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void navigateWithDeckId(row, id => `/decks/cards?deckId=${id}`)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          Cards
                        </button>

                        <button
                          type="button"
                          onClick={() => void navigateWithDeckId(row, id => `/decks/edit?deckId=${id}`)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => void navigateWithDeckId(row, id => `/decks/preview?deckId=${id}`)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          Preview
                        </button>

                        {superAdmin ? (
                          <>
                            <span className="w-px h-4 bg-slate-200 mx-1"></span>
                            <button
                              type="button"
                              disabled={publishingSlug === row.slug}
                              onClick={() => void handlePublish(row)}
                              className={`text-xs px-3 py-1.5 rounded-lg border ${
                                row.status === 'needs_publish'
                                  ? 'bg-amber-500 border-transparent text-white hover:bg-amber-600 shadow-sm font-semibold'
                                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                              } disabled:opacity-60 disabled:cursor-not-allowed transition-colors`}
                            >
                              {publishingSlug === row.slug ? 'Publishing…' : 'Publish'}
                            </button>
                          </>
                        ) : null}

                        {superAdmin ? (
                          <button
                            type="button"
                            disabled={deletingSlug === row.slug}
                            onClick={() => void handleDeleteDeck(row)}
                            className="text-xs font-medium px-2 text-red-500 hover:text-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                          >
                            {deletingSlug === row.slug ? 'Deleting…' : 'Delete'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer (paginated mode only) */}
        {listMode === 'paginated' && (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {pagedLoading
                ? 'Loading…'
                : `Loaded ${paged.items.length} deck${paged.items.length === 1 ? '' : 's'}${
                    !paged.hasMore && paged.items.length > 0 ? ' · end of list' : ''
                  }`}
            </span>
            <div className="flex items-center gap-3">
              {pagedError && paged.items.length > 0 ? (
                <span className="text-xs text-red-600">{pagedError}</span>
              ) : null}
              {paged.hasMore ? (
                <button
                  type="button"
                  disabled={pagedLoadingMore || pagedLoading}
                  onClick={() => void loadPagedMore()}
                  className="text-xs font-semibold px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {pagedLoadingMore ? 'Loading more…' : 'Load more'}
                </button>
              ) : null}
            </div>
          </div>
        )}
        </div>
        )}

        {/* Developer Debug Panel for Manifest Response */}
        {superAdmin && manifestState.raw !== null && (
          <details className="mt-8 bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all">
            <summary className="text-xs font-semibold text-slate-500 cursor-pointer outline-none select-none hover:text-slate-700">
              [Developer] Inspect Raw S3 manifest.json
            </summary>
            <pre className="mt-3 text-[11px] text-slate-600 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
              {JSON.stringify(manifestState.raw, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </ConsoleShell>
  );
}
