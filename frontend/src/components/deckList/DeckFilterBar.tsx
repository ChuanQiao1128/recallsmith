// src/components/deckList/DeckFilterBar.tsx
//
// Search box plus the status and type selects. Lifted from DeckListPage.tsx
// lines 827-864.
//
// RENAMES APPLIED:
//   setQ(e.target.value)            -> onSearchChange(e.target.value)
//   setStatusFilter(e.target.value) -> onStatusChange(e.target.value)
//   setTypeFilter(e.target.value)   -> onTypeChange(e.target.value)
//
// The casts stay on this side of the boundary, unchanged, because they are part
// of the moved text; the page's setters have the narrow types either way.
//
// NOT src/components/decks/DeckFilters.tsx, despite that file being touched on
// the same day this one was written. It renders different markup: no search
// icon, the placeholder reads "Search decks..." rather than "Search by slug or
// title...", neither select carries an aria-label, the classNames differ, and it
// bundles Refresh and New Deck, which belong to the header. Adopting it would
// have changed the DOM, which is the one thing this split may not do.
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

import type { DeckStatus } from '../../pages/deckListPagination';

export interface DeckFilterBarProps {
  q: string;
  onSearchChange: (value: string) => void;
  statusFilter: 'all' | DeckStatus;
  onStatusChange: (value: 'all' | DeckStatus) => void;
  typeFilter: 'all' | 'starter' | 'paid';
  onTypeChange: (value: 'all' | 'starter' | 'paid') => void;
}

export function DeckFilterBar({
  q,
  onSearchChange,
  statusFilter,
  onStatusChange,
  typeFilter,
  onTypeChange,
}: DeckFilterBarProps) {
  return (
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                  value={q}
                  onChange={e => onSearchChange(e.target.value)}
                  placeholder="Search by slug or title..."
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-lg border border-slate-300 py-2 pl-3 pr-8 text-sm bg-white font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={statusFilter}
                  onChange={e => onStatusChange(e.target.value as 'all' | DeckStatus)}
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
                  onChange={e => onTypeChange(e.target.value as 'all' | 'starter' | 'paid')}
                  aria-label="Filter by type"
                >
                  <option value="all">All Types</option>
                  <option value="starter">Starter</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>
          </div>
  );
}
