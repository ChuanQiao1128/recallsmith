// src/components/decks/DeckFilters.tsx
// Deck 筛选工具栏

/**
 * The two filter vocabularies, named so the <select> handlers below can assert
 * to them instead of to `any`.
 *
 * They were already written out inline in the props; naming them is what makes
 * the assertion at the call site say something. `e.target.value` is typed
 * `string` by the DOM lib, so *some* narrowing has to happen there — the choice
 * is between `as any` (which also switches off checking of the surrounding
 * expression) and `as DeckStatusFilter` (which stays wrong only if the option
 * values below stop matching the union).
 *
 * Deliberately NOT a runtime guard that falls back on an unknown value. This
 * component has no caller yet, so a fallback branch would be a code path that
 * has never executed, added to satisfy a linter; and the values are supplied by
 * the <option> elements in this same file, not by user input.
 */
export type DeckStatusFilter = 'all' | 'published' | 'needs_publish' | 'unpublished';
export type DeckTypeFilter = 'all' | 'starter' | 'paid';

interface DeckFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: DeckStatusFilter;
  onStatusChange: (value: DeckStatusFilter) => void;
  typeFilter: DeckTypeFilter;
  onTypeChange: (value: DeckTypeFilter) => void;
  onRefresh: () => void;
  onNewDeck: () => void;
  isLoading?: boolean;
}

export function DeckFilters({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  typeFilter,
  onTypeChange,
  onRefresh,
  onNewDeck,
  isLoading,
}: DeckFiltersProps) {
  return (
    <div className="flex flex-col gap-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search decks..."
          className="w-full sm:w-auto px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value as DeckStatusFilter)}
          className="px-3 py-2 rounded border border-slate-300 text-sm bg-white"
        >
          <option value="all">All Status</option>
          <option value="published">Published</option>
          <option value="needs_publish">Needs Publish</option>
          <option value="unpublished">Unpublished</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => onTypeChange(e.target.value as DeckTypeFilter)}
          className="px-3 py-2 rounded border border-slate-300 text-sm bg-white"
        >
          <option value="all">All Types</option>
          <option value="starter">Starter</option>
          <option value="paid">Paid</option>
        </select>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="px-3 py-2 rounded border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onNewDeck}
          className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
        >
          + New Deck
        </button>
      </div>
    </div>
  );
}
