// src/pages/DeckListPage.tsx

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDecks } from '../api/authoring';
import type { Deck } from '../types/deck';

interface DeckListState {
  loading: boolean;
  error: string | null;
  decks: Deck[];
}

export function DeckListPage() {
  const [state, setState] = useState<DeckListState>({
    loading: true,
    error: null,
    decks: [],
  });

  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }));

        const result = await fetchDecks();

        if (cancelled) return;

        if (!result.success) {
          setState({
            loading: false,
            error: result.error?.message ?? 'Unknown error',
            decks: [],
          });
          return;
        }

        setState({
          loading: false,
          error: null,
          decks: result.data ?? [],
        });
      } catch (err: unknown) {
        if (cancelled) return;

        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Network error',
          decks: [],
        });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading decks...</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded shadow-sm">
          <div className="font-semibold mb-1">Failed to load decks</div>
          <div className="text-sm">{state.error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">
            RecallSmith Authoring Console
          </h1>
          <span className="text-xs text-slate-500">
            P3-mini · Deck 列表
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Decks</h2>
            <button
              type="button"
              className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium
                         bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800
                         focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                         onClick={() => navigate('/decks/new')}
            >
              + New Deck
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">ID</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Slug</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Title</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Locale</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Type</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Created</th>
                </tr>
              </thead>
              <tbody>
                {state.decks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-slate-500 text-sm"
                    >
                      No decks found. You can create the first JS Starter deck later.
                    </td>
                  </tr>
                ) : (
                  state.decks.map(deck => (
                    <tr
                      key={deck.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-2 text-slate-700">{deck.id}</td>
                      <td className="px-4 py-2 text-slate-700 font-mono text-xs">
                        {deck.slug}
                      </td>
                      <td className="px-4 py-2 text-slate-800">{deck.title}</td>
                      <td className="px-4 py-2 text-slate-600">{deck.locale}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {deck.deckType === 1 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            Starter
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800">
                            Paid
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {new Date(deck.createdAt).toLocaleString()}
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