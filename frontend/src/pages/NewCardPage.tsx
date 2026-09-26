// src/pages/NewCardPage.tsx
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCards, useCreateCard } from '../hooks/useCards';
import { useDeck } from '../hooks/useDecks';
import { parseDeckId } from '../lib/parseDeckId';
import { CardForm, type CardFormValues } from '../components/CardForm';
import { buildCardBody } from '../lib/authoringBodies';

/**
 * Where the next card goes in the deck's running order.
 *
 * Every new card used to be created at 1. The second one collided with the
 * first, and from there the export validation this same console runs reported
 * "Duplicate OrderInDeck: 1" for the rest of the deck — a defect the console
 * both caused and then complained about.
 *
 * Steps of ten match what the markdown importer does (`cards.length * 10`) and
 * leave room to slot a card between two others without renumbering. An empty
 * deck starts at 10 rather than the importer's 0, because the export validator
 * warns on OrderInDeck <= 0 and there is no reason to create a card it will
 * complain about.
 */
const ORDER_STEP = 10;

function nextOrderInDeck(existing: readonly { orderInDeck?: number | null }[]): number {
  const highest = existing.reduce((max, card) => {
    const n = card.orderInDeck;
    return typeof n === 'number' && Number.isFinite(n) && n > max ? n : max;
  }, 0);

  return highest + ORDER_STEP;
}

export function NewCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Shared with CardListPage and EditCardPage now, and adopting it CHANGES what
  // this page does with a negative id: `?deckId=-5` used to be refused here
  // before any request went out, and now goes to the server and comes back as
  // whatever the server says about deck -5. That is the point rather than a
  // side effect -- the same URL used to produce "Missing or invalid deckId." on
  // this page and the server's own 404 wording one route away, and only one of
  // those two can be the console's answer.
  const deckId = parseDeckId(searchParams.get('deckId'));
  const invalidDeckId = deckId === null;
  const numericDeckId = deckId ?? Number.NaN;

  // Hooks first, above the early returns. The deck and its cards come through
  // the shared cache; the card list is read only to suggest the next order, and
  // a failed one must not hold the form shut.
  const deckQuery = useDeck(numericDeckId);
  const cardsQuery = useCards(numericDeckId);

  // The write goes through react-query so the list this card belongs to is
  // invalidated when it lands. Before this, creating a card told nothing in the
  // application that anything had changed: CardListPage could only avoid
  // showing a stale list by refusing to cache at all.
  const createCardMutation = useCreateCard();

  if (invalidDeckId) {
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-800">New Card</h1>
            <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← Back to Decks
            </Link>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            Missing or invalid deckId.
          </div>
        </main>
      </div>
    );
  }

  // Both must settle before the form mounts, whether the cards read succeeded or
  // failed: CardForm copies initialValues into its own state on first render, so
  // a card list that lands after that would compute a next order nobody sees.
  if (deckQuery.isPending || cardsQuery.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading deck...</div>
      </div>
    );
  }

  if (deckQuery.isError || !deckQuery.data) {
    const message = deckQuery.error instanceof Error ? deckQuery.error.message : 'Deck not found.';
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-800">New Card</h1>
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

  const deck = deckQuery.data;

  // A card list that failed leaves nextOrder at its default. The deck itself
  // loaded, so the person can still write a card; the only thing lost is the
  // suggestion, and they can type over it. ORDER_STEP is also the right answer
  // for a deck whose cards could not be read but which is in fact empty.
  const nextOrder = cardsQuery.isSuccess ? nextOrderInDeck(cardsQuery.data) : ORDER_STEP;

  const initialValues: CardFormValues = {
    question: '',
    stableUid: '',
    explanation: '',
    realWorldUsage: '',
    codeSnippet: '',
    codeLanguage: 'js',
    difficulty: 2,
    orderInDeck: nextOrder,
    revision: 1,
  };

  async function handleSubmit(
    values: CardFormValues,
  ): Promise<{ ok: boolean; error?: string }> {
    // buildCardBody trims and coerces every field the form collects, so a string
    // never reaches validation and a cleared optional text field is sent as ''.
    const { result } = await createCardMutation.mutateAsync({
      ...buildCardBody(values),
      deckId: Number(deck.id),
      stableUid: values.stableUid,
    });

    if (!result.success) {
      return {
        ok: false,
        error: result.error?.message ?? 'Create card failed.',
      };
    }

    navigate(`/decks/cards?deckId=${deck.id}`, { replace: true });
    return { ok: true };
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">New Card</h1>
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
          mode="create"
          deck={deck}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          onCancel={() => navigate(-1)}
        />
      </main>
    </div>
  );
}
