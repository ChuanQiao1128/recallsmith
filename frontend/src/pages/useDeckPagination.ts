// src/pages/useDeckPagination.ts
//
// The paginated deck channel of DeckListPage, lifted out whole: six pieces of
// state, two refs, the two loaders, and the effect that re-runs the first one
// when the debounced query changes. Every line of those four blocks arrived
// here byte-for-byte — the extraction changed no logic, and the per-block
// sha256 comparison that proves it is recorded in the step report.
//
// WHY THE PARAMETERS ARE NAMED AFTER WHAT THEY REPLACE. `superAdmin`,
// `debouncedQ`, `mountedRef` and `loadAll` are the four page-level
// identifiers the moved code closed over. Naming the options after them is what
// let the bodies move without a single rename, which is what makes "identical
// hash" a meaningful claim rather than a coincidence of formatting.
//
// WHAT DELIBERATELY DID NOT COME WITH IT:
//   * resolvedIdsRef — declared two lines below the block that moved, and read
//     only by resolveDeckId, which writes the page's error feed (ERR_RESOLVE_ID).
//     Taking it would have dragged error reporting into a data-fetching hook.
//   * debouncedQ and its 300ms debounce effect — the debounce is read by three
//     page-level call sites (Retry, Refresh, handlePublish) as well as by this
//     hook, so it belongs to the page. It arrives here as an input.
//
// TWO HARD RULES ABOUT THIS FILE, both of which have a test that notices:
//
// 1. loadPagedFirst and loadPagedMore stay PLAIN `async function`
//    declarations. No useCallback, no useMemo. They are rebuilt on every
//    render, and that is the point: each one therefore closes over the newest
//    `paged` and the newest `loadAll`. Memoising either would freeze
//    `paged.nextCursor` at whatever it was when the callback was created, and
//    the deck list would stall on page 2 while still looking healthy.
//    tests/deckPaginationLoadMore.test.tsx T1 loads a THIRD page for exactly
//    this reason — two pages cannot tell a fresh cursor from a stale one.
//
// 2. pagedRequestSeq stays a useRef. It is compared against the value captured
//    when a request STARTED, so it has to be the same mutable cell across
//    renders; a useState would compare against a snapshot, every guard would
//    pass, and the last response to arrive would win instead of the newest one
//    requested. tests/deckPaginationRace.test.tsx is that assertion.
//
// EFFECT ORDER CHANGED, and the change is unobservable rather than absent.
// Before: mountedRef(1), [q] debounce(2), legacy-mount loadAll(3),
// [debouncedQ] loadPagedFirst(4). After: mountedRef(1),
// [debouncedQ] loadPagedFirst(2), [q] debounce(3), legacy-mount(4) — because
// the hook is called immediately after the mountedRef effect and a hook's
// effects register where it is called. Pairwise:
//   * old 2 only arms a 300ms setTimeout. It touches no state this frame and
//     cannot interact with anything that runs in the same commit.
//   * old 3 and old 4 are mutually exclusive by construction: each opens with
//     a listModeRef.current test and one of them returns immediately. Their
//     relative order is not observable in either mode.
// mountedRef stays first, which is the one ordering that must not move: both
// loaders read mountedRef.current after their await.
// Note that the tests mount <DeckListPage /> bare while production renders it
// inside React.StrictMode (src/main.tsx), so the double-invocation of these
// effects is exercised only in the browser.

import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import { ADMIN_DECKS_ENDPOINT_MISSING, fetchAdminDecksPage } from '../api/authoring';
import {
  DECKS_PAGE_SIZE,
  applyDecksPage,
  emptyDeckPageListState,
} from './deckListPagination';
import type { DeckPageListState } from './deckListPagination';
import type { ListMode } from './deckListRows';

// Error codes that mean "the paginated endpoint is unusable here" → fall back
// to the legacy full-list load (404 = not deployed yet, 403 = not permitted).
const PAGINATED_FALLBACK_CODES = new Set<string>([
  ADMIN_DECKS_ENDPOINT_MISSING,
  'NOT_FOUND',
  'FORBIDDEN',
]);

export interface UseDeckPaginationOptions {
  /** Only super admins may probe the paginated endpoint; everyone else starts legacy. */
  superAdmin: boolean;
  /** The search box, already debounced by the page. Re-running is driven by this. */
  debouncedQ: string;
  /**
   * Still-mounted flag, owned by the page. Passed in rather than re-created
   * here so that both loaders test the same cell the rest of the page does.
   */
  mountedRef: RefObject<boolean>;
  /** The legacy full-list load, used only by the feature-detect fallback. */
  loadAll: (forceRefresh?: boolean) => Promise<void>;
}

export interface UseDeckPaginationResult {
  listMode: ListMode;
  /**
   * Returned as the ref OBJECT, never as a .current snapshot, and that is a
   * correctness requirement rather than tidiness. handleDeleteDeck and
   * handlePublish both read it AFTER an await — and since the confirmations
   * became in-page dialogs, that await can now last as long as the user leaves
   * the dialog open, during which the [debouncedQ] effect below can complete a
   * whole loadPagedFirst and flip the mode from paginated to legacy. A snapshot
   * would hand those handlers the value from the render that drew the row.
   */
  listModeRef: RefObject<ListMode>;
  paged: DeckPageListState;
  /** Exposed so handleDeleteDeck can drop one row without refetching the page. */
  setPaged: Dispatch<SetStateAction<DeckPageListState>>;
  pagedInitialized: boolean;
  pagedLoading: boolean;
  pagedLoadingMore: boolean;
  pagedError: string | null;
  loadPagedFirst: (query: string) => Promise<void>;
  loadPagedMore: () => Promise<void>;
}

/**
 * setListMode and pagedRequestSeq are deliberately NOT returned. The only
 * writer of the former is inside loadPagedFirst, and the latter has no reader
 * outside the two loaders; publishing either would invite a second source of
 * truth for a value this hook is supposed to own.
 * tests/deckPaginationHookWiring.test.ts pins the returned set at exactly ten.
 */
export function useDeckPagination({
  superAdmin,
  debouncedQ,
  mountedRef,
  loadAll,
}: UseDeckPaginationOptions): UseDeckPaginationResult {
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

  // Initial load + search-driven reloads. Paginated mode only: legacy mode
  // filters client-side over the already-loaded full list.
  useEffect(() => {
    if (listModeRef.current === 'legacy') return;
    void loadPagedFirst(debouncedQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  return {
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
  };
}
