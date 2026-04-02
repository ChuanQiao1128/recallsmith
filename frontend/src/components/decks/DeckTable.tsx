// src/components/decks/DeckTable.tsx
// Deck 列表表格组件 - 纯展示，无业务逻辑

import { useNavigate } from 'react-router-dom';
import type { Deck } from '../../types/deck';

type DeckStatus = 'published' | 'needs_publish' | 'unpublished';

interface ViewRow {
  deck: Deck;
  status: DeckStatus;
  cardCount: number;
}

interface DeckTableProps {
  rows: ViewRow[];
  loading?: boolean;
  onDelete?: (deck: Deck) => void;
  deletingId?: number | null;
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

function safeDateTime(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function DeckTable({ rows, loading, onDelete, deletingId }: DeckTableProps) {
  const navigate = useNavigate();

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading decks...</div>;
  }

  if (rows.length === 0) {
    return <div className="p-8 text-center text-slate-500">No decks found.</div>;
  }

  return (
    <table className="min-w-full text-sm">
      <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
        <tr>
          <th className="px-6 py-3 text-left">Deck</th>
          <th className="px-6 py-3 text-left">Cards</th>
          <th className="px-6 py-3 text-left">Type</th>
          <th className="px-6 py-3 text-left">Status</th>
          <th className="px-6 py-3 text-left">Updated</th>
          <th className="px-6 py-3 text-left">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(({ deck, status, cardCount }) => {
          const updatedAt = (deck as unknown as { updatedAt?: number | string }).updatedAt;
          return (
            <tr key={deck.id} className="hover:bg-slate-50">
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/decks/edit?deckId=${deck.id}`)}
                    className="text-sm font-semibold text-indigo-700 hover:text-indigo-900 text-left"
                    title="Edit deck"
                  >
                    {deck.title}
                  </button>
                  <span className="text-xs text-slate-400">({deck.slug})</span>
                </div>
              </td>

              <td className="px-6 py-4">
                <button
                  type="button"
                  onClick={() => navigate(`/decks/cards?deckId=${deck.id}`)}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-mono border shadow-sm transition-colors bg-slate-100 text-slate-700 border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 cursor-pointer"
                  title="Manage Cards"
                >
                  {cardCount}
                </button>
              </td>

              <td className="px-6 py-4">{typeBadge(deck.deckType)}</td>

              <td className="px-6 py-4">{statusBadge(status)}</td>

              <td className="px-6 py-4 text-slate-500 text-xs">{safeDateTime(updatedAt)}</td>

              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/decks/cards?deckId=${deck.id}`)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/decks/edit?deckId=${deck.id}`)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    Edit
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      disabled={deletingId === deck.id}
                      onClick={() => onDelete(deck)}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-800 transition-colors disabled:opacity-50"
                    >
                      {deletingId === deck.id ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
