import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDeck } from '../hooks/useDecks';
import { useCards, useDeleteCard } from '../hooks/useCards';
import { ApiFailureError, NOT_FOUND } from '../api/errors';
import { parseDeckId } from '../lib/parseDeckId';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';
import { CONSOLE_NAME } from '../lib/brand';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { RarityBadge } from '../components/RarityBadge';
import { RarityDistribution } from '../components/RarityDistribution';
import { ErrorBannerList } from '../components/ui/ErrorBanner';
import { useConfirm } from '../components/ui/ConfirmDialogContext';
import {
  DEFAULT_CARD_LIST_CRITERIA,
  filterAndSortCards,
  formatCardDate,
  isCriteriaActive,
} from '../lib/cardListFilter';
import type { CardListCriteria } from '../lib/cardListFilter';
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
 *
 * The two optional props are what the failure's `code` and `traceId` buy, and
 * they are the reason those fields are carried instead of being flattened into
 * a sentence:
 *
 *   onRetry  is offered for a failure that MIGHT come out differently, and
 *            withheld for one that cannot. A deck that is not there is not
 *            going to be there on the second press, and a button that re-asks
 *            an answered question teaches people to press it at every failure.
 *   traceId  is the only string on this screen that a server log can be
 *            searched for. It is printed rather than swallowed because the
 *            alternative -- asking someone to reproduce the failure while
 *            somebody watches the logs -- is what its absence costs.
 */
function LoadFailureScreen({
  message,
  traceId,
  onRetry,
}: {
  message: string;
  traceId?: string;
  onRetry?: () => void;
}) {
  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · Cards"
      decksHref="/"
      contentIntelligenceHref="/content-intelligence"
      adminUsersHref={isSuperAdmin(readSessionUser()) ? '/admin/users' : undefined}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Deck Cards</h1>
        <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">
          ← Back to Decks
        </Link>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          <div className="font-semibold mb-1">Failed to load cards</div>
          <div className="text-sm">{message}</div>

          {traceId ? (
            <div className="text-xs mt-2 font-mono text-red-700">Trace {traceId}</div>
          ) : null}

          {onRetry ? (
            <button
              type="button"
              className="mt-3 text-sm px-3 py-1.5 rounded-md border border-red-200 text-red-800 hover:bg-red-100"
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </ConsoleShell>
  );
}

export function CardListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // The rule this page used to spell out inline now lives in one place, because
  // NewCardPage and EditCardPage each had their own and the three disagreed.
  // The semantics are unchanged HERE -- it is the other two that move. NaN
  // stands in for "no id" when handing the value to the hooks, which keep the
  // same predicate for callers that have not parsed anything.
  const deckId = parseDeckId(searchParams.get('deckId'));
  const numericDeckId = deckId ?? Number.NaN;

  const user = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(user), [user]);

  // The read path. Both requests are keyed by deckId, which is what replaces
  // the two guards this page used to keep by hand — a `cancelled` flag captured
  // by the fetch effect, and a `state.deckId !== deckId` comparison — so a
  // response for a deck the user already left cannot repaint the current one.
  // tests/cardListPageRace.test.tsx is the same pair of assertions, written and
  // made green against the hand-guarded version before this rewrite.
  const deckQuery = useDeck(numericDeckId);
  const cardsQuery = useCards(numericDeckId);
  const deleteCardMutation = useDeleteCard();

  const [errors, setErrors] = useState<ErrorNotice[]>(emptyErrorFeed);
  const confirm = useConfirm();

  // Filter/sort state lives in the component only — no URL, no persistence. The
  // search term is deferred so a fast typist never waits on a 441-row re-filter,
  // and the visible list is memoised on exactly what filterAndSortCards reads,
  // so a keystroke that does not change the result does not rebuild the table.
  // These sit above every early return with the other hooks: the rules of hooks
  // do not survive a filter bar that only exists once the cards have loaded.
  const [criteria, setCriteria] = useState<CardListCriteria>(DEFAULT_CARD_LIST_CRITERIA);
  const deferredQuery = useDeferredValue(criteria.query);
  const visibleCards = useMemo(
    () =>
      filterAndSortCards(cardsQuery.data ?? [], {
        query: deferredQuery,
        kind: criteria.kind,
        difficulty: criteria.difficulty,
        sort: criteria.sort,
      }),
    [cardsQuery.data, deferredQuery, criteria.kind, criteria.difficulty, criteria.sort],
  );

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
      const { result } = await deleteCardMutation.mutateAsync({
        cardId,
        deckId: numericDeckId,
      });
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
  if (deckId === null) {
    return <LoadFailureScreen message="Missing or invalid deckId." />;
  }

  if (deckQuery.isPending || cardsQuery.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-600 text-lg">Loading cards...</div>
      </div>
    );
  }

  // Same precedence as before: whatever went wrong with the deck is what the
  // user hears about, and only if the deck is fine does a cards failure get to
  // speak.
  //
  // What is gone is the middle rung that precedence used to have. A deck that
  // came back empty was reported by testing `deck === null` after a query that
  // had not errored -- reasoning backwards from a missing value to a verdict,
  // in a page that cannot see whether the value is missing because the deck
  // does not exist or because something else went quiet. useDeck now throws
  // that case as an ApiFailureError carrying NOT_FOUND, so there is one failure
  // channel and the branch reads the code instead of inferring it.
  if (deckQuery.isError || cardsQuery.isError) {
    const failure = deckQuery.error ?? cardsQuery.error;
    const known = failure instanceof ApiFailureError ? failure : null;

    return (
      <LoadFailureScreen
        message={failure instanceof Error ? failure.message : 'Unknown error'}
        traceId={known?.traceId ? known.traceId : undefined}
        onRetry={
          known?.code === NOT_FOUND
            ? undefined
            : () => {
                void deckQuery.refetch();
                void cardsQuery.refetch();
              }
        }
      />
    );
  }

  const deck = deckQuery.data;
  const cards = cardsQuery.data;

  // One option per difficulty actually present in the deck, ascending. Building
  // it from the full `cards` (not the filtered set) keeps every choice reachable
  // no matter what the current filter has narrowed the table down to.
  const difficulties = Array.from(new Set(cards.map(card => card.difficulty))).sort(
    (a, b) => a - b,
  );
  const filtersActive = isCriteriaActive(criteria);

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · Cards"
      decksHref="/"
      contentIntelligenceHref="/content-intelligence"
      adminUsersHref={isSuperAdmin(readSessionUser()) ? '/admin/users' : undefined}
    >
      <div className="flex items-center justify-between">
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

      <div className="max-w-4xl mx-auto px-4 py-6">
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
            <div className="flex items-center gap-3">
              {filtersActive ? (
                <span data-testid="card-list-visible-count" className="text-xs text-slate-500">
                  Showing {visibleCards.length} of {cards.length} cards
                </span>
              ) : null}
              <span className="text-xs text-slate-500">{cards.length} cards</span>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label="Search cards"
              placeholder="Search uid, question or topic"
              value={criteria.query}
              onChange={e => setCriteria(prev => ({ ...prev, query: e.target.value }))}
              className="flex-1 min-w-[12rem] text-sm px-3 py-1.5 rounded-md border border-slate-300
                         focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <select
              aria-label="Card type"
              value={criteria.kind}
              onChange={e =>
                setCriteria(prev => ({ ...prev, kind: e.target.value as CardListCriteria['kind'] }))
              }
              className="text-sm px-2 py-1.5 rounded-md border border-slate-300 text-slate-700"
            >
              <option value="all">All types</option>
              <option value="mcq">MCQ</option>
              <option value="qa">Q&amp;A</option>
            </select>

            <select
              aria-label="Difficulty"
              value={criteria.difficulty === 'all' ? 'all' : String(criteria.difficulty)}
              onChange={e =>
                setCriteria(prev => ({
                  ...prev,
                  difficulty: e.target.value === 'all' ? 'all' : Number(e.target.value),
                }))
              }
              className="text-sm px-2 py-1.5 rounded-md border border-slate-300 text-slate-700"
            >
              <option value="all">All difficulties</option>
              {difficulties.map(difficulty => (
                <option key={difficulty} value={String(difficulty)}>
                  {difficulty}
                </option>
              ))}
            </select>

            <select
              aria-label="Sort cards"
              value={criteria.sort}
              onChange={e =>
                setCriteria(prev => ({ ...prev, sort: e.target.value as CardListCriteria['sort'] }))
              }
              className="text-sm px-2 py-1.5 rounded-md border border-slate-300 text-slate-700"
            >
              <option value="order">Deck order</option>
              <option value="updated">Recently updated</option>
              <option value="difficulty">Difficulty</option>
            </select>

            {filtersActive ? (
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => setCriteria(DEFAULT_CARD_LIST_CRITERIA)}
              >
                Clear filters
              </button>
            ) : null}
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
                ) : visibleCards.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-500 text-sm">
                      No cards match these filters.
                    </td>
                  </tr>
                ) : (
                  visibleCards.map(card => (
                    <tr
                      key={card.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 py-2 text-slate-700 font-mono text-xs">{card.id}</td>
                      <td className="px-3 py-2 text-slate-700 font-mono text-xs">{card.stableUid}</td>
                      <td className="px-3 py-2 text-slate-800">{card.question}</td>
                      <td className="px-3 py-2">
                        <RarityBadge difficulty={card.difficulty} />
                        {card.mcq ? <span data-testid="card-mcq-badge" className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-slate-100 text-slate-700 border-slate-200">MCQ</span> : null}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{formatCardDate(card.createdAt)}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{formatCardDate(card.updatedAt)}</td>
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
      </div>
    </ConsoleShell>
  );
}