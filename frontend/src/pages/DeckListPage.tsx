// src/pages/DeckListPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  deleteDeck,
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
  emptyErrorFeed,
  clearNotice,
  pollingNotice,
  reportBusinessFailure,
  reportThrownFailure,
} from '../lib/errorFeed';
import type { ErrorNotice, PollFailure } from '../lib/errorFeed';
import { ErrorBanner, ErrorBannerList } from '../components/ui/ErrorBanner';
import { useConfirm } from '../components/ui/ConfirmDialogContext';
import { removeDeckBySlug } from './deckListPagination';
import type { DeckStatus } from './deckListPagination';
import {
  extractDecksArray,
  parseManifestMeta,
  toManifestDeckLite,
} from './deckListManifest';
import type { ManifestDeckLite, ManifestMeta } from './deckListManifest';
import { buildViewRows } from './deckListRows';
import type { ConsoleDeckRow } from './deckListRows';
import { useDeckPagination } from './useDeckPagination';

import { clearStoredTokens } from '../auth/tokenStore';
import { buildLogoutUrl } from '../auth/cognito';
import { readSessionUser, isSuperAdmin, type SessionUser } from '../auth/sessionUser';

import { ConsoleShell } from '../components/console/ConsoleShell';
import { DeckConsoleHeader } from '../components/deckList/DeckConsoleHeader';
import { PublishJobsPanel } from '../components/deckList/PublishJobsPanel';
import { DeckFilterBar } from '../components/deckList/DeckFilterBar';
import { DeckRowsTable } from '../components/deckList/DeckRowsTable';
import { DeckPaginationFooter } from '../components/deckList/DeckPaginationFooter';

// Error feed keys. One per operation, because "one slot per operation" is what
// keeps a repeated failure from stacking and a publish failure from erasing a
// delete failure the user has not read yet.
const ERR_RESOLVE_ID = 'deck.resolveId';
const ERR_DELETE_DECK = 'deck.delete';
const ERR_PUBLISH_DECK = 'deck.publish';

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

type ManifestState = {
  loading: boolean;
  error: string | null;
  url: string;
  meta: ManifestMeta;
  bySlug: Record<string, ManifestDeckLite>;
  raw: unknown | null;
};

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

  // Deliberately above the paginated block below, not inside it: that block is
  // lifted into a hook in the next step, and a hook call that had drifted into
  // the middle of it would travel with the move.
  const confirm = useConfirm();

  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [publishingSlug, setPublishingSlug] = useState<string | null>(null);

  // slug → deck id cache: the paginated contract does not guarantee ids, but
  // every row action needs one; resolved lazily via GET /authoring/decks?slug=.
  const resolvedIdsRef = useRef<Map<string, number>>(new Map());
  const [debouncedQ, setDebouncedQ] = useState('');

  // Publish Jobs state
  const [publishJobs, setPublishJobs] = useState<PublishJob[]>([]);
  // Job id of the publish currently being timed, if any.
  const pendingPublishJobIdRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<'decks' | 'publishJobs'>('decks');
  // Message and kind travel together: two useState calls could drift apart and
  // label a transport failure as a refusal, which gives the opposite advice.
  const [pollFailure, setPollFailure] = useState<PollFailure | null>(null);
  // Derived from the timer rather than set by a branch, so a future path that
  // forgets to reschedule surfaces as a visible banner instead of silence.
  const [pollingStopped, setPollingStopped] = useState(false);

  // One feed for every action that can fail on this page. Keyed by operation,
  // so a retry loop replaces its own notice instead of stacking copies.
  const [errors, setErrors] = useState<ErrorNotice[]>(emptyErrorFeed);
  const pollNotice = pollingNotice(pollFailure, pollingStopped);

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

  // Called HERE, immediately after the mountedRef effect, rather than up beside
  // the other state declarations: `mountedRef` is a const and would still be in
  // its temporal dead zone up there, while `loadAll` is a hoisted function
  // declaration and so is safe to name before its body appears below.
  const {
    listMode,
    listModeRef,
    paged,
    setPaged,
    pagedInitialized,
    pagedLoading,
    pagedLoadingMore,
    pagedError,
    loadPagedFirst,
    loadPagedMore,
  } = useDeckPagination({ superAdmin, debouncedQ, mountedRef, loadAll });

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

  async function resolveDeckId(row: ConsoleDeckRow): Promise<number | null> {
    if (row.id !== null && Number.isFinite(row.id)) return row.id;
    const cached = resolvedIdsRef.current.get(row.slug);
    if (cached !== undefined) return cached;

    setErrors(prev => clearNotice(prev, ERR_RESOLVE_ID));
    const res = await fetchDeckBySlug(row.slug);
    const id = res.success && res.data ? Number(res.data.id) : Number.NaN;
    if (Number.isFinite(id)) {
      resolvedIdsRef.current.set(row.slug, id);
      return id;
    }
    setErrors(prev =>
      reportBusinessFailure(
        prev,
        ERR_RESOLVE_ID,
        `Could not look up deck "${row.slug}"`,
        res.error?.message,
      ),
    );
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

  async function handleDeleteDeck(row: ConsoleDeckRow) {
    if (!superAdmin) return;

    const ok = await confirm({
      title: `Delete deck "${row.slug}"?`,
      body: 'The deck and its cards are removed from the console. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete deck',
    });
    if (!ok) return;

    // Clearing before the attempt is what makes a success wipe the banner:
    // every success path would otherwise have to remember to do it.
    setErrors(prev => clearNotice(prev, ERR_DELETE_DECK));

    try {
      setDeletingSlug(row.slug);
      const deckId = await resolveDeckId(row);
      if (deckId === null) return;

      const res = await deleteDeck(deckId);
      if (!res.success) {
        setErrors(prev =>
          reportBusinessFailure(
            prev,
            ERR_DELETE_DECK,
            `Deleting deck "${row.slug}" failed`,
            res.error?.message,
          ),
        );
        return;
      }
      if (listModeRef.current === 'paginated') {
        setPaged(prev => removeDeckBySlug(prev, row.slug));
      } else {
        setDeckState(prev => ({ ...prev, decks: prev.decks.filter(d => String(d.slug) !== row.slug) }));
      }
    } catch (err: unknown) {
      setErrors(prev =>
        reportThrownFailure(prev, ERR_DELETE_DECK, `Deleting deck "${row.slug}" failed`, err),
      );
    } finally {
      setDeletingSlug(null);
    }
  }

  async function handlePublish(row: ConsoleDeckRow) {
    if (!superAdmin) return;

    // Not destructive: publishing uploads a new deck.json and rebuilds the
    // manifest. It can be run again, and running it again is the fix for having
    // run it too early. So this one is role="dialog", not "alertdialog", and it
    // opens with focus on Publish rather than on Cancel.
    const ok = await confirm({
      title: `Publish deck "${row.slug}"?`,
      body: 'Publish will:\n1) Upload deck.json to S3\n2) Rebuild manifest.json',
      confirmLabel: 'Publish',
    });
    if (!ok) return;

    // The journey starts once the user has committed, so the time the dialog
    // sat open is not counted as our latency.
    markStart('publish');
    setErrors(prev => clearNotice(prev, ERR_PUBLISH_DECK));

    try {
      setPublishingSlug(row.slug);
      const deckId = await resolveDeckId(row);
      if (deckId === null) return;

      const pub = await publishDeck(deckId);
      if (!pub.success) {
        setErrors(prev =>
          reportBusinessFailure(
            prev,
            ERR_PUBLISH_DECK,
            `Publishing deck "${row.slug}" failed`,
            pub.error?.message,
          ),
        );
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
      setErrors(prev =>
        reportThrownFailure(prev, ERR_PUBLISH_DECK, `Publishing deck "${row.slug}" failed`, err),
      );
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
    // The outcome is the only place that still knows whether the server
    // answered or the transport threw, so the kind is captured here and not
    // guessed from the message text later.
    setPollFailure(
      decision.showError === null
        ? null
        : { kind: outcome.kind === 'exception' ? 'network' : 'business', message: decision.showError },
    );
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
    return buildViewRows({
      listMode,
      pagedItems: paged.items,
      decks,
      manifestBySlug: manifestState.bySlug,
      q,
      statusFilter,
      typeFilter,
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
        <DeckConsoleHeader
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          superAdmin={superAdmin}
          publishJobs={publishJobs}
          onRefreshDecks={() => {
            if (listModeRef.current === 'paginated') void loadPagedFirst(debouncedQ);
            else void loadAll(false);
          }}
          onRefreshJobs={() => void loadPublishJobs()}
          onNewDeck={() => navigate('/decks/new')}
        />

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

        {/* Failed actions on this page. Non-blocking by construction: the
            banners sit in the flow, so nothing about a failure parks the main
            thread the way window.alert did. */}
        <ErrorBannerList
          notices={errors}
          onDismiss={key => setErrors(prev => clearNotice(prev, key))}
        />

        {/* Publish Jobs Refresh Banner. A failed refresh has to be visible:
            silently stale job rows read as "the publish is stuck". It is not
            dismissible, because it is derived from live poll state and would
            come straight back; it leaves when the poll recovers. */}
        {superAdmin && pollNotice && (
          <ErrorBanner
            notice={pollNotice}
            onRetry={pollingStopped ? () => void loadPublishJobs() : undefined}
            retryLabel="Auto-refresh stopped. Click to retry."
          />
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
          <PublishJobsPanel jobs={publishJobs} onRefresh={() => void loadPublishJobs()} />
        ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Filters Bar */}
          <DeckFilterBar
            q={q}
            onSearchChange={setQ}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            typeFilter={typeFilter}
            onTypeChange={setTypeFilter}
          />

          <DeckRowsTable
            rows={viewRows}
            loading={listMode === 'paginated' && pagedLoading}
            emptyMessage={q.trim() ? 'No decks match your search.' : 'No decks match your filters.'}
            superAdmin={superAdmin}
            publishingSlug={publishingSlug}
            deletingSlug={deletingSlug}
            onNavigate={(row, to) => void navigateWithDeckId(row, to)}
            onPublish={row => void handlePublish(row)}
            onDelete={row => void handleDeleteDeck(row)}
          />

        {/* Pagination footer (paginated mode only) */}
        {listMode === 'paginated' && (
          <DeckPaginationFooter
            loadedCount={paged.items.length}
            hasMore={paged.hasMore}
            loading={pagedLoading}
            loadingMore={pagedLoadingMore}
            error={pagedError}
            onLoadMore={() => void loadPagedMore()}
          />
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
