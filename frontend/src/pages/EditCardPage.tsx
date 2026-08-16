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
    Number.isNaN(numericDeckId) ||
    numericDeckId <= 0 ||
    Number.isNaN(numericCardId) ||
    numericCardId <= 0;

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
        // ⚠️ 后端 id 可能是字符串，这里统一转成 number 再比较
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

  async function handleSubmit(
    values: CardFormValues,
  ): Promise<{ ok: boolean; error?: string }> {
    const difficulty =
      typeof values.difficulty === 'number'
        ? values.difficulty
        : Number(values.difficulty) || 2;
    const orderInDeck =
      typeof values.orderInDeck === 'number'
        ? values.orderInDeck
        : Number(values.orderInDeck) || 1;
    const result = await updateCard({
      id: Number(card.id),
      deckId: Number(card.deckId),
      question: values.question.trim(),
      explanation: values.explanation?.trim() || undefined,
      // Forwarded rather than omitted. updateCard has accepted this field all
      // along and drops undefined keys from the body, so leaving it out was not
      // data loss — it was an edit that silently did not happen. The markdown
      // importer compares realWorldUsage when deciding update vs unchanged, so
      // an edit that never lands also means the deck never stops re-planning.
      realWorldUsage: values.realWorldUsage ?? '',
      codeSnippet: values.codeSnippet || undefined,
      codeLanguage: values.codeLanguage || undefined,
      difficulty,
      orderInDeck,
      stableUid: card.stableUid,
      expectedVersion: card.version,
    });

    if (!result.success) {
      return {
        ok: false,
        error:
          result.error?.message ??
          'Update card failed (possible version conflict).',
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