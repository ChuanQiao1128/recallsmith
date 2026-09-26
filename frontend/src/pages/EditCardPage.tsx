// src/pages/EditCardPage.tsx
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchCardById } from '../api/authoring';
import { VERSION_CONFLICT } from '../api/errors';
import { QueryKeys, useAppQueryClient } from '../api/queryClient';
import { useCard, useUpdateCard } from '../hooks/useCards';
import { useDeck } from '../hooks/useDecks';
import { parseDeckId } from '../lib/parseDeckId';
import type { Card } from '../types/card';
import { CardForm, type CardFormValues } from '../components/CardForm';
import { buildCardBody } from '../lib/authoringBodies';

/**
 * The label on the recovery button, and the sentence that explains it.
 *
 * Kept beside each other because they are one message: the button is the verb
 * and the sentence is what pressing it will do. Splitting them across the page
 * is how the two drift into describing different actions.
 */
const RETRY_WITH_LATEST = 'Retry with latest version';

const CONFLICT_HINT =
  `Your edits are still here. Press "${RETRY_WITH_LATEST}" to apply them to the ` +
  'copy that is on the server now.';

/**
 * What is said when the conflict cannot be recovered from, because the reread
 * that would have supplied the current version did not come back. No button is
 * offered in this state: the page has nothing newer to send than what it just
 * sent, so a retry would fail identically.
 */
const CONFLICT_UNRECOVERABLE =
  'Reload the page before trying again — this console could not read the ' +
  'current version of the card.';

/** The header-plus-red-box shell every failure on this page renders through. */
function EditCardErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">Edit Card</h1>
          <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
            ← Back to Decks
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          {message}
        </div>
      </main>
    </div>
  );
}

export function EditCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const cardIdRaw = searchParams.get('cardId') ?? '';

  // deckId goes through the shared rule; see the note in NewCardPage for what
  // adopting it changes (a negative deck id now reaches the server instead of
  // being refused here).
  //
  // cardId keeps its own `<= 0` check, deliberately and narrowly: the shared
  // rule is about deck ids, this page is the only holder of the card-id rule,
  // and widening it here would be a second behaviour change smuggled in beside
  // the first with nothing asking for it.
  const deckId = parseDeckId(searchParams.get('deckId'));
  const numericCardId = Number(cardIdRaw);

  const invalidId = deckId === null || Number.isNaN(numericCardId) || numericCardId <= 0;
  const numericDeckId = deckId ?? Number.NaN;

  // Hooks first and above every early return, as in CardListPage. The deck and
  // the one card come through the shared cache: List -> Edit no longer downloads
  // the whole deck to show a single row, and the single-card read is exactly the
  // ?id= endpoint the old comment here claimed did not exist. Both are disabled
  // for an invalid id (useDeck skips 0/NaN, useCard requires a finite id > 0), so
  // an invalidId page never issues a request.
  const deckQuery = useDeck(numericDeckId);
  const cardQuery = useCard(numericCardId);

  // The write goes through react-query, so a saved card invalidates the list it
  // belongs to and its own ['card', id] entry instead of leaving every other
  // reader to guess.
  const updateCardMutation = useUpdateCard();
  const queryClient = useAppQueryClient();

  /**
   * Whether the last save lost a version race AND a newer version was read back.
   *
   * Both halves matter. Without the reread this flag would offer a retry that
   * re-sends the version the server has already rejected once, which is what
   * this page did before: the banner appeared, the user pressed Save Changes,
   * and the identical request failed identically, forever. A conflict is the
   * one failure on this page that CANNOT be cleared by trying the same thing
   * again, and it was the only one whose UI implied it could.
   */
  const [conflictRecoverable, setConflictRecoverable] = useState(false);

  if (invalidId) {
    return <EditCardErrorScreen message="Missing or invalid deckId/cardId." />;
  }

  // Ahead of the pending check, for the reason CardListPage spells out: a
  // disabled query stays status 'pending' forever, so an invalid id has to be
  // answered before isPending is read. It is, above.
  if (deckQuery.isPending || cardQuery.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading card...</div>
      </div>
    );
  }

  if (deckQuery.isError || !deckQuery.data) {
    const message = deckQuery.error instanceof Error ? deckQuery.error.message : 'Deck not found.';
    return <EditCardErrorScreen message={message} />;
  }

  if (cardQuery.isError || !cardQuery.data) {
    const message = cardQuery.error instanceof Error ? cardQuery.error.message : 'Card not found.';
    return <EditCardErrorScreen message={message} />;
  }

  // Bound after the guards so their non-null types survive into the closures
  // below (a const captured before the guard keeps its `T | undefined` type).
  const deck = deckQuery.data;
  const card = cardQuery.data;

  // The card was read by its own id, so it is the right card or none — what is
  // left to check is that it belongs to the deck in the URL. The backend id may
  // arrive as a string, so compare as numbers.
  if (Number(card.deckId) !== numericDeckId) {
    return (
      <EditCardErrorScreen message={`Card with id ${numericCardId} not found in this deck.`} />
    );
  }

  const initialValues: CardFormValues = {
    question: card.question,
    stableUid: card.stableUid,
    explanation: card.explanation ?? '',
    realWorldUsage:
      (card as unknown as { realWorldUsage?: string | null }).realWorldUsage ?? '',
    codeSnippet: card.codeSnippet ?? '',
    codeLanguage: card.codeLanguage ?? '',
    difficulty:
      typeof card.difficulty === 'number'
        ? card.difficulty
        : Number(card.difficulty) || 2,
    orderInDeck:
      typeof card.orderInDeck === 'number'
        ? card.orderInDeck
        : Number(card.orderInDeck) || 1,
    revision:
      (card as unknown as { revision?: number | null }).revision ?? 1,
  };

  /**
   * The card as the server holds it right now, or null if it could not be read.
   *
   * A fresh ?id= read that deliberately skips the cache: on success it writes
   * the row into ['card', id] with setQueryData, so the next render — and the
   * next save — carries the version the server is actually holding.
   */
  async function readCurrentCard(): Promise<Card | null> {
    try {
      const cardResult = await fetchCardById(numericCardId);
      if (!cardResult.success || !cardResult.data) return null;
      const latest = cardResult.data;
      queryClient.setQueryData(QueryKeys.card(numericCardId), latest);
      return latest;
    } catch {
      return null;
    }
  }

  async function handleSubmit(
    values: CardFormValues,
  ): Promise<{ ok: boolean; error?: string }> {
    // buildCardBody trims every optional text field, so a cleared explanation,
    // usage note or snippet is sent as '' rather than dropped — the api layer
    // omits undefined keys, and an absent key leaves the old value in the row.
    // mcq and topic are deliberately absent, so a stored MCQ blob is left alone.
    const { result } = await updateCardMutation.mutateAsync({
      ...buildCardBody(values),
      id: Number(card.id),
      deckId: Number(card.deckId),
      stableUid: card.stableUid,
      expectedVersion: card.version,
    });

    if (!result.success) {
      const message =
        result.error?.message ?? 'Update card failed (possible version conflict).';

      if (result.error?.code === VERSION_CONFLICT) {
        // Read the row back, so the next attempt carries the version the server
        // is actually holding. The card's CONTENT is deliberately not copied
        // into the form: the user's edits stay exactly as they typed them, and
        // pressing the recovery button applies them on top of whatever is there
        // now. That is last-writer-wins, stated plainly, and it is the same
        // resolution the markdown importer offers -- the alternative, showing
        // both versions and asking which to keep, is a feature rather than a
        // recovery path, and pretending otherwise by silently merging would be
        // the worst of the three.
        const latest = await readCurrentCard();

        if (latest === null) {
          setConflictRecoverable(false);
          return { ok: false, error: `${message} ${CONFLICT_UNRECOVERABLE}` };
        }

        setConflictRecoverable(true);
        return { ok: false, error: `${message} ${CONFLICT_HINT}` };
      }

      setConflictRecoverable(false);
      return { ok: false, error: message };
    }

    navigate(`/decks/cards?deckId=${deck.id}`, { replace: true });
    return { ok: true };
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Edit Card</h1>
            <p className="text-xs text-slate-500 mt-1">
              {deck.title} · <span className="font-mono">{deck.slug}</span>
            </p>
          </div>
          <Link
            to={`/decks/cards?deckId=${deck.id}`}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            ← Back to Cards
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <CardForm
          mode="edit"
          deck={deck}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
          recoveryLabel={conflictRecoverable ? RETRY_WITH_LATEST : null}
          mcq={card.mcq ?? null}
        />
      </main>
    </div>
  );
}
