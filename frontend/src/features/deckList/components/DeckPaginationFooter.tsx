// src/features/deckList/components/DeckPaginationFooter.tsx
//
// The "Loaded N decks" strip and Load more. Lifted from DeckListPage.tsx lines
// 989-1012.
//
// RENAMES APPLIED:
//   paged.items.length -> loadedCount     (x4)
//   paged.hasMore      -> hasMore         (x2)
//   pagedLoadingMore   -> loadingMore     (x2)
//   pagedLoading       -> loading         (x2)
//   pagedError         -> error           (x2)
//   void loadPagedMore() -> onLoadMore()
//
// (The count of paged.items.length is four, not the three a first reading
// suggests: three are in the template literal and a fourth guards the inline
// error span.)
//
// THE `paged` OBJECT IS DELIBERATELY NOT PASSED. It is useDeckPagination's own
// state shape, and handing it to a presentational component would let this file
// start reading nextCursor or items[] and quietly become a second consumer of
// the pagination contract. Six scalars cannot do that.
//
// The `listMode === 'paginated' &&` gate that decides whether the footer renders
// at all stays on the page.
//
// PROVENANCE. The JSX below was moved out of src/pages/DeckListPage.tsx and is
// byte-identical to the original apart from the renames listed above. Its
// ORIGINAL INDENTATION IS PRESERVED ON PURPOSE, even though it looks over-deep
// for a file this small: re-indenting would destroy the only cheap proof that
// nothing else changed in the move. eslint has no indent rule here, so this
// costs nothing but the look of it.
//
// NO HOOKS, NO memo, NO useCallback. tests/deckListHookOrder.test.ts C2
// enforces this over the whole directory. The reason is C1: the page's recorded
// hook sequence only describes the rendered tree while the children add nothing
// to it. It is also exactly why the older src/components/decks/DeckTable.tsx
// could not be reused — it calls useNavigate() internally.

export interface DeckPaginationFooterProps {
  loadedCount: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
}

export function DeckPaginationFooter({
  loadedCount,
  hasMore,
  loading,
  loadingMore,
  error,
  onLoadMore,
}: DeckPaginationFooterProps) {
  return (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {loading
                ? 'Loading…'
                : `Loaded ${loadedCount} deck${loadedCount === 1 ? '' : 's'}${
                    !hasMore && loadedCount > 0 ? ' · end of list' : ''
                  }`}
            </span>
            <div className="flex items-center gap-3">
              {error && loadedCount > 0 ? (
                <span className="text-xs text-red-600">{error}</span>
              ) : null}
              {hasMore ? (
                <button
                  type="button"
                  disabled={loadingMore || loading}
                  onClick={() => onLoadMore()}
                  className="text-xs font-semibold px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {loadingMore ? 'Loading more…' : 'Load more'}
                </button>
              ) : null}
            </div>
          </div>
  );
}
