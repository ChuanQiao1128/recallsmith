// src/features/deckList/components/DeckRowsTable.tsx
//
// The deck table. Lifted from DeckListPage.tsx lines 866-985, together with the
// two module-private badge helpers from lines 106-121.
//
// RENAMES APPLIED:
//   listMode === 'paginated' && pagedLoading  -> loading
//   viewRows.length / viewRows.map            -> rows.length / rows.map
//   the q.trim() ternary                      -> {emptyMessage}
//   void navigateWithDeckId(row, ...)         -> onNavigate(row, ...)   (x4)
//   void handlePublish(row)                   -> onPublish(row)
//   void handleDeleteDeck(row)                -> onDelete(row)
//
// `loading` and `emptyMessage` replace two expressions that read page state
// (listMode, q). Those two words stay on the page: which mode the list is in and
// whether the user typed something are page facts, and a table that had to know
// them would be a page in disguise.
//
// THE ROW IS STILL INLINE IN .map(). Extracting it would add one fiber per row
// instead of five for the whole page, and every existing assertion about
// per-row pending state would then be describing a different tree.
//
// `publishingSlug === row.slug` IS KEPT VERBATIM, not narrowed to a boolean
// prop, and that is the safety-critical detail of this file. A table given a
// single `publishing` boolean puts EVERY row in the pending state while one
// publishes. tests/deckListPagePendingActions.test.tsx P1 asserts the other two
// rows stay untouched precisely so that mistake cannot land quietly; mutation
// M4b confirmed it goes red.
//
// statusBadge and typeBadge are NOT exported. Exporting a non-component from a
// .tsx module trips react-refresh/only-export-components, which is an error in
// this repo's eslint config.
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

import { isStarterLike } from '../deckListPagination';
import type { DeckStatus } from '../deckListPagination';
import { safeDateTime } from '../deckListManifest';
import type { ConsoleDeckRow } from '../deckListRows';

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

export interface DeckRowsTableProps {
  rows: ConsoleDeckRow[];
  loading: boolean;
  emptyMessage: string;
  superAdmin: boolean;
  publishingSlug: string | null;
  deletingSlug: string | null;
  onNavigate: (row: ConsoleDeckRow, to: (id: number) => string) => void;
  onPublish: (row: ConsoleDeckRow) => void;
  onDelete: (row: ConsoleDeckRow) => void;
}

export function DeckRowsTable({
  rows,
  loading,
  emptyMessage,
  superAdmin,
  publishingSlug,
  deletingSlug,
  onNavigate,
  onPublish,
  onDelete,
}: DeckRowsTableProps) {
  return (
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
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">
                    Loading decks…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                rows.map(row => (
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
                        onClick={() => onNavigate(row, id => `/decks/cards?deckId=${id}`)}
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
                          onClick={() => onNavigate(row, id => `/decks/cards?deckId=${id}`)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          Cards
                        </button>

                        <button
                          type="button"
                          onClick={() => onNavigate(row, id => `/decks/edit?deckId=${id}`)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => onNavigate(row, id => `/decks/preview?deckId=${id}`)}
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
                              onClick={() => onPublish(row)}
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
                            onClick={() => onDelete(row)}
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
  );
}
