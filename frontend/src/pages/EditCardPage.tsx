// src/pages/EditCardPage.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchDeckById, fetchCardsByDeck } from '../api/authoring';
import { VERSION_CONFLICT } from '../api/errors';
import { useUpdateCard } from '../hooks/useCards';
import { parseDeckId } from '../lib/parseDeckId';
import type { Deck } from '../types/deck';
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

interface PageState {
  loading: boolean;
  deck: Deck | null;
  card: Card | null;
  error: string | null;
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

  const [state, setState] = useState<PageState>({
    loading: !invalidId,
    deck: null,
    card: null,
    error: invalidId ? 'Missing or invalid deckId/cardId.' : null,
  });

  // The write goes through react-query, so a saved card invalidates the list it
  // belongs to instead of leaving every other reader to guess.
  const updateCardMutation = useUpdateCard();

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

  useEffect(() => {
    if (invalidId) return;

    let cancelled = false;

    async function load() {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }));

        const [deckResult, cardsResult] = await Promise.all([
          fetchDeckById(numericDeckId),
          fetchCardsByDeck(numericDeckId),
        ]);

        if (cancelled) return;

        if (!deckResult.success || !deckResult.data) {
          setState({
            loading: false,
            deck: null,
            card: null,
            error: deckResult.error?.message ?? 'Deck not found.',
          });
          return;
        }

        if (!cardsResult.success || !cardsResult.data) {
          setState({
            loading: false,
            deck: deckResult.data,
            card: null,
            error: cardsResult.error?.message ?? 'Failed to load cards.',
          });
          return;
        }

        const cards = cardsResult.data as Card[];
        // The backend id may arrive as a string, so compare as numbers.
        const target = cards.find(c => Number(c.id) === numericCardId);

        if (!target) {
          setState({
            loading: false,
            deck: deckResult.data,
            card: null,
            error: `Card with id ${numericCardId} not found in this deck.`,
          });
          return;
        }

        setState({
          loading: false,
          deck: deckResult.data,
          card: target,
          error: null,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setState({
          loading: false,
          deck: null,
          card: null,
          error: err instanceof Error ? err.message : 'Network error.',
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [invalidId, numericDeckId, numericCardId]);

  if (invalidId) {
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
            {state.error ?? 'Missing or invalid deckId/cardId.'}
          </div>
        </main>
      </div>
    );
  }

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading card...</div>
      </div>
    );
  }

  if (!state.deck || !state.card) {
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
            {state.error ?? 'Card not found.'}
          </div>
        </main>
      </div>
    );
  }

  const deck = state.deck;
  const card = state.card;

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
   * Same request the initial load makes -- there is no single-card endpoint --
   * so this is one extra list read on the one path that needs it, rather than a
   * new API surface for a recovery that happens rarely.
   */
  async function readCurrentCard(): Promise<Card | null> {
    try {
      const cardsResult = await fetchCardsByDeck(numericDeckId);
      if (!cardsResult.success || !cardsResult.data) return null;
      return cardsResult.data.find(c => Number(c.id) === numericCardId) ?? null;
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

        setState(prev => ({ ...prev, card: latest }));
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