/**
 * DeckListHeader
 *
 * Compact action row for the deck list page. We deliberately *don't* render
 * a big H1 "Decks" here — the ConsoleShell already says "Authoring · Decks"
 * in its breadcrumb. Stacking another <h1> looked redundant.
 *
 * Instead we show a count summary on the left and the actions on the right.
 */

import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';

export interface DeckListHeaderProps {
  onRefresh: () => void;
  onNewDeck: () => void;
  superAdmin: boolean;
  /** Total deck count, optional — when present, rendered as a subtle summary. */
  totalCount?: number;
  /** How many of those are published. */
  publishedCount?: number;
}

export function DeckListHeader({
  onRefresh,
  onNewDeck,
  superAdmin,
  totalCount,
  publishedCount,
}: DeckListHeaderProps) {
  const navigate = useNavigate();

  const summary =
    typeof totalCount === 'number'
      ? `${totalCount} ${totalCount === 1 ? 'deck' : 'decks'}` +
        (typeof publishedCount === 'number' ? ` · ${publishedCount} published` : '')
      : 'Manage your flashcard decks, edit content, and publish to mobile.';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
      <p className="text-sm text-slate-500 dark:text-slate-400">{summary}</p>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh deck list and publish status">
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </Button>

        {superAdmin && (
          <Button variant="ghost" size="sm" onClick={() => navigate('/publish-jobs')}>
            Publish Jobs →
          </Button>
        )}

        {superAdmin && (
          <Button variant="primary" size="sm" onClick={onNewDeck}>
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Deck
          </Button>
        )}
      </div>
    </div>
  );
}
