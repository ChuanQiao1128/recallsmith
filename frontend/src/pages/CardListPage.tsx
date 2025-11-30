// src/pages/CardListPage.tsx

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchDeckById, fetchCardsByDeck, deleteCard } from '../api/authoring';
import type { Deck } from '../types/deck';
import type { Card } from '../types/card';

interface CardListState {
  loading: boolean;
  error: string | null;
  deck: Deck | null;
  cards: Card[];
}

export function CardListPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();

  const numericDeckId = Number(deckId);

  const [state, setState] = useState<CardListState>(() => {
    if (!numericDeckId || Number.isNaN(numericDeckId)) {
      return {
        loading: false,
        error: 'Invalid deck id.',
        deck: null,
        cards: [],
      };
    }
    return {
      loading: true,
      error: null,
      deck: null,
      cards: [],
    };
  });

  useEffect(() => {
    if (!numericDeckId || Number.isNaN(numericDeckId)) {
      return;
    }

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
            error: deckResult.error?.message ?? 'Deck not found.',
            deck: null,
            cards: [],
          });
          return;
        }

        if (!cardsResult.success) {
          setState({
            loading: false,
            error: cardsResult.error?.message ?? 'Failed to load cards.',
            deck: deckResult.data,
            cards: [],
          });
          return;
        }

        setState({
          loading: false,
          error: null,
          deck: deckResult.data,
          cards: cardsResult.data ?? [],
        });
      } catch (err: unknown) {
        if (cancelled) return;

        setState({
          loading: false,
          error:
            err instanceof Error ? err.message : 'Network error.',
          deck: null,
          cards: [],
        });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [numericDeckId]);

  async function handleDelete(cardId: number) {
    const ok = window.confirm('Are you sure you want to delete this card?');
    if (!ok) return;

    try {
      const result = await deleteCard(cardId);
      if (!result.success) {
        alert(result.error?.message ?? 'Delete card failed.');
        return;
      }

      setState(prev => ({
        ...prev,
        cards: prev.cards.filter(c => c.id !== cardId),
      }));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Network error.';
      alert(message);
    }
  }

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading cards...</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-800">
              Deck Cards
            </h1>
            <Link
              to="/"
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              ← Back to Decks
            </Link>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            <div className="font-semibold mb-1">Failed to load cards</div>
            <div className="text-sm">{state.error}</div>
          </div>
        </main>
      </div>
    );
  }

  const deck = state.deck!;
  const cards = state.cards;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">
              Cards · <span className="font-mono text-base">{deck.slug}</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {deck.title} · {deck.locale} ·{' '}
              {deck.deckType === 1 ? 'Starter Deck' : 'Paid Deck'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-slate-600 hover:text-slate-800"
            >
              ← Back to Decks
            </Link>
            <button
              type="button"
              className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                         bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                         focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              onClick={() => navigate(`/decks/${deck.id}/cards/new`)}
            >
              + New Card
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Card List</h2>
            <span className="text-xs text-slate-500">
              {cards.length} cards (第一页)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Id
                  </th>
                  
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    StableUid
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Question
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Diff
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Created
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Updated
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Order
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {cards.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-slate-500 text-sm"
                    >
                      No cards yet. Click &quot;New Card&quot; to add the first one.
                    </td>
                  </tr>
                ) : (
                  cards.map(card => (
                    <tr
                      key={card.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                        <td className="px-3 py-2 text-slate-700 font-mono text-xs">
                        {card.id}
                      </td>
                      
                      <td className="px-3 py-2 text-slate-700 font-mono text-xs">
                        {card.stableUid}
                      </td>
                      <td className="px-3 py-2 text-slate-800">
                        {card.question}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {card.difficulty === 1
                          ? 'Easy'
                          : card.difficulty === 2
                          ? 'Medium'
                          : 'Hard'}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">
                        {new Date(card.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">
                        {new Date(card.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {card.orderInDeck}
                      </td>
                      <td className="px-3 py-2 text-slate-700 text-xs">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                            onClick={() =>
                              navigate(
                                `/decks/${deck.id}/cards/${card.id}/edit`,
                              )
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                            onClick={() => handleDelete(card.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}