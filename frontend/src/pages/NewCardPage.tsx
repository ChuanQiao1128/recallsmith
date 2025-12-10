// src/pages/NewCardPage.tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createCard, fetchDeckById } from '../api/authoring';
import type { Deck } from '../types/deck';
import { CardForm, type CardFormValues } from '../components/CardForm';

interface PageState {
  loadingDeck: boolean;
  deck: Deck | null;
  error: string | null;
}

export function NewCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const numericDeckId = Number(deckIdRaw);
  const invalidDeckId = !numericDeckId || Number.isNaN(numericDeckId);

  const [state, setState] = useState<PageState>({
    loadingDeck: !invalidDeckId,
    deck: null,
    error: invalidDeckId ? 'Missing or invalid deckId.' : null,
  });

  useEffect(() => {
    if (invalidDeckId) return;

    let cancelled = false;

    async function loadDeck() {
      try {
        setState(prev => ({ ...prev, loadingDeck: true, error: null }));

        const result = await fetchDeckById(numericDeckId);
        if (cancelled) return;

        if (!result.success || !result.data) {
          setState({
            loadingDeck: false,
            deck: null,
            error: result.error?.message ?? 'Deck not found.',
          });
          return;
        }

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
    orderInDeck: 10,
    revision: 1,
  };

  async function handleSubmit(values: CardFormValues): Promise<{ ok: boolean; error?: string }> {
    const result = await createCard({
      deckId: deck.id,
      stableUid: values.stableUid,
      question: values.question,
      explanation: values.explanation,
      realWorldUsage: values.realWorldUsage,
      codeSnippet: values.codeSnippet,
      codeLanguage: values.codeLanguage,
      difficulty: values.difficulty,
      orderInDeck: values.orderInDeck,
    });

    if (!result.success) {
      return { ok: false, error: result.error?.message ?? 'Create card failed.' };
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