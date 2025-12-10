// src/pages/EditCardPage.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchDeckById, fetchCardsByDeck, updateCard } from '../api/authoring';
import type { Deck } from '../types/deck';
import type { Card } from '../types/card';
import { CardForm, type CardFormValues } from '../components/CardForm';

interface PageState {
  loading: boolean;
  deck: Deck | null;
  card: Card | null;
  error: string | null;
}

export function EditCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const cardIdRaw = searchParams.get('cardId') ?? '';

  const numericDeckId = Number(deckIdRaw);
  const numericCardId = Number(cardIdRaw);

  const invalidId =
    !numericDeckId ||
    Number.isNaN(numericDeckId) ||
    !numericCardId ||
    Number.isNaN(numericCardId);

  const [state, setState] = useState<PageState>({
    loading: !invalidId,
    deck: null,
    card: null,
    error: invalidId ? 'Missing or invalid deckId/cardId.' : null,
  });

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
        const target = cards.find(c => c.id === numericCardId);

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
    realWorldUsage: (card as unknown as { realWorldUsage?: string | null }).realWorldUsage ?? '',
    codeSnippet: card.codeSnippet ?? '',
    codeLanguage: card.codeLanguage ?? '',
    difficulty: card.difficulty,
    orderInDeck: card.orderInDeck,
    revision: (card as unknown as { revision?: number | null }).revision ?? 1,
  };

  async function handleSubmit(values: CardFormValues): Promise<{ ok: boolean; error?: string }> {
    const result = await updateCard({
      id: card.id,
      expectedVersion: card.version,
      question: values.question,
      explanation: values.explanation,
      codeSnippet: values.codeSnippet,
      codeLanguage: values.codeLanguage,
      difficulty: values.difficulty,
      orderInDeck: values.orderInDeck,
    });

    if (!result.success) {
      return {
        ok: false,
        error: result.error?.message ?? 'Update card failed (possible version conflict).',
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
        />
      </main>
    </div>
  );
}