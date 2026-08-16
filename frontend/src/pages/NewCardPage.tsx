// src/pages/NewCardPage.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createCard, fetchCardsByDeck, fetchDeckById } from '../api/authoring';
import type { Deck } from '../types/deck';
import { CardForm, type CardFormValues } from '../components/CardForm';

interface PageState {
  loadingDeck: boolean;
  deck: Deck | null;
  error: string | null;
}

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

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const numericDeckId = Number(deckIdRaw);
  const invalidDeckId = Number.isNaN(numericDeckId) || numericDeckId <= 0;

  const [state, setState] = useState<PageState>({
    loadingDeck: !invalidDeckId,
    deck: null,
    error: invalidDeckId ? 'Missing or invalid deckId.' : null,
  });

  // Kept out of PageState on purpose: knowing the next number is a convenience,
  // not a precondition for writing a card. A failed or slow card list must not
  // hold the form shut, so this settles on its own and the form opens either
  // way. ORDER_STEP is the fallback, which is also the right answer for a deck
  // whose cards could not be read but which is in fact empty.
  const [nextOrder, setNextOrder] = useState<number>(ORDER_STEP);

  useEffect(() => {
    if (invalidDeckId) return;

    let cancelled = false;

    async function loadDeck() {
      try {
        setState(prev => ({ ...prev, loadingDeck: true, error: null }));

        // Both at once, and both awaited before the form is allowed to mount.
        // CardForm copies initialValues into its own state on first render, so
        // a card list that lands after that would be a number nobody sees.
        const [result, cards] = await Promise.all([
          fetchDeckById(numericDeckId),
          fetchCardsByDeck(numericDeckId),
        ]);
        if (cancelled) return;

        if (!result.success || !result.data) {
          setState({
            loadingDeck: false,
            deck: null,
            error: result.error?.message ?? 'Deck not found.',
          });
          return;
        }

        // A card list that failed leaves nextOrder at its default. The deck
        // itself loaded, so the person can still write a card; the only thing
        // lost is the suggestion, and they can type over it.
        if (cards.success && cards.data) setNextOrder(nextOrderInDeck(cards.data));

        setState({
          loadingDeck: false,
          deck: result.data,
          error: null,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setState({
          loadingDeck: false,
          deck: null,
          error: err instanceof Error ? err.message : 'Network error.',
        });
      }
    }

    void loadDeck();

    return () => {
      cancelled = true;
    };
  }, [invalidDeckId, numericDeckId]);

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
            {state.error ?? 'Missing or invalid deckId.'}
          </div>
        </main>
      </div>
    );
  }

  if (state.loadingDeck) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading deck...</div>
      </div>
    );
  }

  if (!state.deck) {
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
            {state.error ?? 'Deck not found.'}
          </div>
        </main>
      </div>
    );
  }

  const deck = state.deck;

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
    // ✅ 前端确保这些是 number，避免字符串导致奇怪的校验问题
    const difficulty =
      typeof values.difficulty === 'number'
        ? values.difficulty
        : Number(values.difficulty) || 2;
    const orderInDeck =
      typeof values.orderInDeck === 'number'
        ? values.orderInDeck
        : Number(values.orderInDeck) || 1;
    const result = await createCard({
      deckId: Number(deck.id),
      stableUid: values.stableUid,
      question: values.question.trim(),
      explanation: values.explanation?.trim() || undefined,
      realWorldUsage: values.realWorldUsage?.trim() || undefined,
      codeSnippet: values.codeSnippet || undefined,
      codeLanguage: values.codeLanguage || undefined,
      difficulty,
      orderInDeck,
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