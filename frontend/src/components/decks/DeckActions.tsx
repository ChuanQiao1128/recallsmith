/**
 * DeckActions
 *
 * Action buttons for a single deck row: Cards, Edit, Preview, Publish, Delete.
 * Publish is disabled when cardCount === 0.
 * Delete uses useConfirm() for confirmation dialog.
 */

import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { useConfirm } from '../../hooks/useConfirm';
import type { Deck } from '../../types/deck';
import type { DeckStatus } from '../../hooks/useDeckListFilters';

export interface DeckActionsProps {
  deck: Deck;
  status: DeckStatus;
  cardCount: number;
  superAdmin: boolean;
  onPublish: (deckId: number) => Promise<void>;
  onDelete: (deckId: number) => Promise<void>;
  publishing: boolean;
  deleting: boolean;
}

export function DeckActions({
  deck,
  status,
  cardCount,
  superAdmin,
  onPublish,
  onDelete,
  publishing,
  deleting,
}: DeckActionsProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();

  const handlePublish = async () => {
    const ok = await confirm({
      title: 'Publish Deck?',
      body: 'This will:\n1) Upload deck.json to S3\n2) Rebuild manifest.json\n\nContinue?',
      destructive: false,
    });
    if (ok) {
      await onPublish(Number(deck.id));
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Deck?',
      body: 'This action cannot be undone.',
      destructive: true,
    });
    if (ok) {
      await onDelete(Number(deck.id));
    }
  };

  const deckId = Number(deck.id);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/decks/cards?deckId=${deckId}`)}
      >
        Cards
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/decks/edit?deckId=${deckId}`)}
      >
        Edit
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(`/decks/preview?deckId=${deckId}`)}
      >
        Preview
      </Button>

      {superAdmin && (
        <>
          <div className="w-px h-4 bg-slate-200"></div>

          <Button
            variant={status === 'needs_publish' ? 'secondary' : 'ghost'}
            size="sm"
            disabled={publishing || cardCount === 0}
            onClick={() => void handlePublish()}
            title={
              cardCount === 0 ? 'Add at least one card before publishing' : 'Publish to S3 + rebuild manifest'
            }
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>

          <Button
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      )}
    </div>
  );
}
