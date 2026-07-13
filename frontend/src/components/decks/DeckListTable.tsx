/**
 * DeckListTable
 *
 * Table of decks with columns: Deck, Cards, Type, Status, Updated, Actions.
 * Uses Badge for status/type indicators.
 */

import { Badge } from '../ui/Badge';
import { DeckActions } from './DeckActions';
import type { Deck } from '../../types/deck';
import type { DeckStatus } from '../../hooks/useDeckListFilters';
import type { ManifestDeckLite } from '../../types/manifest';

function safeDateTime(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function statusBadge(status: DeckStatus) {
  if (status === 'published') {
    return <Badge tone="success">Published</Badge>;
  }
  if (status === 'needs_publish') {
    return <Badge tone="warn">Needs Publish</Badge>;
  }
  return <Badge tone="neutral">Unpublished</Badge>;
}

function typeBadge(deckType: number) {
  if (deckType === 1) {
    return <Badge tone="info">Starter</Badge>;
  }
  return <Badge tone="neutral">Paid</Badge>;
}

interface ViewRow {
  deck: Deck;
  manifest: ManifestDeckLite | undefined;
  status: DeckStatus;
  cardCount: number;
}

export interface DeckListTableProps {
  rows: ViewRow[];
  loading: boolean;
  error: string | null;
  superAdmin: boolean;
  onPublish: (deckId: number) => Promise<void>;
  onDelete: (deckId: number) => Promise<void>;
  publishingId: number | null;
  deletingId: number | null;
  onNavigate: (path: string) => void;
}

export function DeckListTable({
  rows,
  loading,
  error,
  superAdmin,
  onPublish,
  onDelete,
  publishingId,
  deletingId,
}: DeckListTableProps) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
        <div className="text-sm">Loading decks…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="font-semibold text-red-800 mb-2">Failed to load decks</div>
        <div className="text-sm text-red-700">{String(error)}</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-slate-500">
        <div className="text-sm">No decks match your filters.</div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
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
            {rows.map(row => {
              const deck = row.deck as Deck & { updatedAt?: string | null; createdAt?: string | null; manifestOrder?: number };
              const updatedAt = deck.updatedAt ?? deck.createdAt ?? null;
              const deckId = Number(deck.id);
              const isPublishing = publishingId === deckId;
              const isDeleting = deletingId === deckId;

              return (
                <tr
                  key={String(deck.id)}
                  className="hover:bg-slate-50/60 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200"
                        title="Manifest Order"
                      >
                        #{String(deck.manifestOrder ?? '-')}
                      </span>
                      <div>
                        <div className="text-slate-900 font-medium">
                          {String(deck.title ?? '')}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {String(deck.slug ?? '')}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-mono border bg-slate-100 text-slate-700 border-slate-200">
                      {row.cardCount}
                    </span>
                  </td>

                  <td className="px-6 py-4">{typeBadge(deck.deckType)}</td>

                  <td className="px-6 py-4">{statusBadge(row.status)}</td>

                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {safeDateTime(updatedAt)}
                  </td>

                  <td className="px-6 py-4">
                    <DeckActions
                      deck={deck}
                      status={row.status}
                      cardCount={row.cardCount}
                      superAdmin={superAdmin}
                      onPublish={onPublish}
                      onDelete={onDelete}
                      publishing={isPublishing}
                      deleting={isDeleting}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
