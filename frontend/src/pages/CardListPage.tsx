import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDeck } from '../hooks/useDecks';
import { useCards, useDeleteCard } from '../hooks/useCards';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';
import { RarityBadge } from '../components/RarityBadge';
import { RarityDistribution } from '../components/RarityDistribution';
import { ErrorBannerList } from '../components/ui/ErrorBanner';
import { useConfirm } from '../components/ui/ConfirmDialogContext';
import {
  emptyErrorFeed,
  clearNotice,
  reportBusinessFailure,
  reportThrownFailure,
} from '../lib/errorFeed';
import type { ErrorNotice } from '../lib/errorFeed';

// One key for the delete action: a user who retries against a server that is
// still refusing gets the latest verdict, not a growing stack of copies.
const ERR_DELETE_CARD = 'card.delete';

/**
 * The page's one failure surface. Both the "no deckId in the URL" case and a
 * load that came back wrong land here, exactly as they did when a single
 * `state.error` string drove this block.
 */
function LoadFailureScreen({ message }: { message: string }) {
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
          <div className="text-sm">{message}</div>
        </div>
      </main>
    </div>
  );
}

export function CardListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const deckIdRaw = searchParams.get('deckId') ?? '';
  const deckId = Number(deckIdRaw);
  const invalidDeckId = !deckId || Number.isNaN(deckId);

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  // The read path. Both requests are keyed by deckId, which is what replaces
  // the two guards this page used to keep by hand — a `cancelled` flag captured
  // by the fetch effect, and a `state.deckId !== deckId` comparison — so a
  // response for a deck the user already left cannot repaint the current one.
  // tests/cardListPageRace.test.tsx is the same pair of assertions, written and
  // made green against the hand-guarded version before this rewrite.
  const deckQuery = useDeck(deckId);
  const cardsQuery = useCards(deckId);
  const deleteCardMutation = useDeleteCard();

  const [errors, setErrors] = useState<ErrorNotice[]>(emptyErrorFeed);
  const confirm = useConfirm();

  async function handleDelete(cardId: number) {
    if (!superAdmin) return;

    // The old string was 'Are you sure you want to delete this card?'. The
    // question mark was doing work that window.confirm could not: its buttons
    // are OK and Cancel, which name no action, so the sentence had to carry the
    // whole meaning. Here the button says "Delete card", so the question moves
    // to the title and the sentence is spent on the consequence instead.
    const ok = await confirm({
      title: 'Delete this card?',
      body: 'This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete card',
    });
    if (!ok) return;

    // Clearing up front is what makes a successful retry remove the banner,
    // instead of every success path having to remember to.
    setErrors(prev => clearNotice(prev, ERR_DELETE_CARD));

    try {
      // The mutation hands back the ApiResult rather than throwing on a
      // refusal, so the two failures stay distinguishable here: a server that
      // said no reaches the line below, a request that never came back reaches
      // the catch. They recommend opposite things.
      const { result } = await deleteCardMutation.mutateAsync({ cardId, deckId });
      if (!result.success) {
        setErrors(prev =>
          reportBusinessFailure(
            prev,
            ERR_DELETE_CARD,
            `Deleting card #${cardId} failed`,
            result.error?.message,
          ),
        );
        return;
      }
      // The deleted row leaves the screen because the mutation removed it from
      // the cards query's cache, not because this page filtered a local array.
    } catch (err: unknown) {
      setErrors(prev =>
        reportThrownFailure(prev, ERR_DELETE_CARD, `Deleting card #${cardId} failed`, err),
      );
    }
  }

  // This has to come before the pending check, not after it. In react-query v5
  // a disabled query reports status 'pending' forever — idle only shows up in
  // fetchStatus — so reading isPending first would leave a URL with no deckId
  // on "Loading cards..." for good, where today it says so immediately.
  if (invalidDeckId) {
    return <LoadFailureScreen message="Missing or invalid deckId." />;
  }

  if (deckQuery.isPending || cardsQuery.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading cards...</div>
      </div>
    );
  }

  const deck = deckQuery.data ?? null;

  // Same precedence as before: whatever went wrong with the deck is what the
  // user hears about, and a deck that came back empty is "not found" rather
  // than an error, because a successful response carrying no deck is exactly
  // what the old `!deckResult.data` branch treated as not found.
  const loadError =
    deckQuery.error instanceof Error
      ? deckQuery.error.message
      : deck === null
        ? 'Deck not found.'
        : cardsQuery.error instanceof Error
          ? cardsQuery.error.message
          : null;

  if (loadError !== null || deck === null) {
    return <LoadFailureScreen message={loadError ?? 'Unknown error'} />;
  }

  const cards = cardsQuery.data ?? [];

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
        {/* Failed deletes land here rather than in a modal dialog, so the row
            the user was working on stays visible and clickable. */}
        {errors.length > 0 && (
          <div className="mb-4">
            <ErrorBannerList
              notices={errors}
              onDismiss={key => setErrors(prev => clearNotice(prev, key))}
            />
          </div>
        )}
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