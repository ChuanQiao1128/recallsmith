// src/components/decks/DeckFilters.tsx
// Deck 筛选工具栏

interface DeckFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: 'all' | 'published' | 'needs_publish' | 'unpublished';
  onStatusChange: (value: 'all' | 'published' | 'needs_publish' | 'unpublished') => void;
  typeFilter: 'all' | 'starter' | 'paid';
  onTypeChange: (value: 'all' | 'starter' | 'paid') => void;
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
          onChange={(e) => onStatusChange(e.target.value as any)}
          className="px-3 py-2 rounded border border-slate-300 text-sm bg-white"
        >
          <option value="all">All Status</option>
          <option value="published">Published</option>
          <option value="needs_publish">Needs Publish</option>
          <option value="unpublished">Unpublished</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => onTypeChange(e.target.value as any)}
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
