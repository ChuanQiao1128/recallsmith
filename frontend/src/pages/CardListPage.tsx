import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { deleteCard, fetchCardsByDeck, fetchDeckById } from '../api/authoring';
import type { Deck } from '../types/deck';
import type { Card } from '../types/card';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';
import { RarityBadge } from '../components/RarityBadge';
import { RarityDistribution } from '../components/RarityDistribution';

interface CardListState {
  deckId: number;
  loading: boolean;
  error: string | null;
  deck: Deck | null;
  cards: Card[];
}

export function CardListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const deckId = Number(deckIdRaw);
  const invalidDeckId = !deckId || Number.isNaN(deckId);

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  const [state, setState] = useState<CardListState>(() => ({
    deckId,
    loading: !invalidDeckId,
    error: invalidDeckId ? 'Missing or invalid deckId.' : null,
    deck: null,
    cards: [],
  }));

  useEffect(() => {
    if (invalidDeckId) return;

    let cancelled = false;

    (async () => {
      try {
        const [deckResult, cardsResult] = await Promise.all([
          fetchDeckById(deckId),
          fetchCardsByDeck(deckId),
        ]);
        if (cancelled) return;

        if (!deckResult.success || !deckResult.data) {
          setState({
            deckId,
            loading: false,
            error: deckResult.error?.message ?? 'Deck not found.',
            deck: null,
            cards: [],
          });
          return;
        }

        if (!cardsResult.success) {
          setState({
            deckId,
            loading: false,
            error: cardsResult.error?.message ?? 'Failed to load cards.',
            deck: deckResult.data,
            cards: [],
          });
          return;
        }

        setState({
          deckId,
          loading: false,
          error: null,
          deck: deckResult.data,
          cards: cardsResult.data ?? [],
        });
      } catch (err: unknown) {
        if (cancelled) return;

        setState({
          deckId,
          loading: false,
          error: err instanceof Error ? err.message : 'Network error.',
          deck: null,
          cards: [],
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deckId, invalidDeckId]);

  const effectiveLoading = state.loading || state.deckId !== deckId;

  async function handleDelete(cardId: number) {
    if (!superAdmin) return;

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
      alert(err instanceof Error ? err.message : 'Network error.');
    }
  }

  if (effectiveLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading cards...</div>
      </div>
    );
  }

  if (state.error || !state.deck) {
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-800">Deck Cards</h1>
            <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
              ← Back to Decks
            </Link>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            <div className="font-semibold mb-1">Failed to load cards</div>
            <div className="text-sm">{state.error ?? 'Unknown error'}</div>
          </div>
        </main>
      </div>
    );
  }

  const deck = state.deck;
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
              {deck.title} · {deck.locale} · {deck.deckType === 1 ? 'Starter Deck' : 'Paid Deck'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-slate-600 hover:text-slate-800">
              ← Back to Decks
            </Link>

            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => navigate(`/decks/preview?deckId=${deck.id}`)}
              title="Preview mobile DeckExport JSON"
            >
              Preview JSON
            </button>

            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => navigate(`/decks/cards/import?deckId=${deck.id}`)}
              title="Paste or load a markdown deck document and reconcile it against this deck"
            >
              Import Markdown
            </button>

            <button
              type="button"
              className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                         bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                         focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              onClick={() => navigate(`/decks/cards/new?deckId=${deck.id}`)}
            >
              + New Card
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <RarityDistribution cards={cards} />
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Card List</h2>
            <span className="text-xs text-slate-500">{cards.length} cards</span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Id</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">StableUid</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Question</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Rarity</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Created</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Updated</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Order</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>

              <tbody>
                {cards.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-500 text-sm">
                      No cards yet. Click &quot;New Card&quot; to add the first one.
                    </td>
                  </tr>
                ) : (
                  cards.map(card => (
                    <tr
                      key={card.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-2 text-slate-700 font-mono text-xs">{card.id}</td>
                      <td className="px-3 py-2 text-slate-700 font-mono text-xs">{card.stableUid}</td>
                      <td className="px-3 py-2 text-slate-800">{card.question}</td>
                      <td className="px-3 py-2">
                        <RarityBadge difficulty={card.difficulty} />
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{new Date(card.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{new Date(card.updatedAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-700">{card.orderInDeck}</td>

                      <td className="px-3 py-2 text-slate-700 text-xs">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
                            onClick={() => navigate(`/decks/cards/edit?deckId=${deck.id}&cardId=${card.id}`)}
                          >
                            Edit
                          </button>

                          {superAdmin ? (
                            <button
                              type="button"
                              className="px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                              onClick={() => void handleDelete(card.id)}
                              title="super_admin only"
                            >
                              Delete
                            </button>
                          ) : (
                            <span className="text-slate-400" title="Delete requires super_admin">
                              —
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!superAdmin ? (
            <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-100">
              Delete actions are restricted to <span className="font-mono">super_admin</span>.
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}