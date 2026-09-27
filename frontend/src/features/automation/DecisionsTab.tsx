// src/features/automation/DecisionsTab.tsx
//
// The Decisions tab (A00 §16.1): every automatic decision with its state,
// reason and AI QA reviewer, filtered by deck, state and reason. `?draftId=`
// (the deep link of the exception email and the auto-accept webhook) opens the
// detail drawer above the list.
//
// The filters live in the URL (`?tab=decisions&state=human&open=1`), so the
// Overview's backlog can link to the open exceptions (B07 frontend-console-1).
// "Open only" keeps the decisions nobody has acted on yet; it filters the
// loaded pages on the client, since the list route has no such parameter yet.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { listAutomationDecisions, type AutomationDecision } from '../../api/automation';
import { CARD_CLASS, H2_CLASS, INPUT_CLASS, LABEL_CLASS } from '../../components/console/consoleStyles';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import {
  DECISION_REASONS,
  DECISION_STATES,
  automationErrorMessage,
  decisionFiltersFrom,
  decisionReasonLabel,
  decisionStateLabel,
  isOpenDecision,
  withDecisionFilters,
  type DecisionFilters,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';
import { DecisionDetail } from './DecisionDetail';
import { DecisionTable } from './DecisionTable';
import { DeckSelect } from './DeckSelect';

const PAGE_SIZE = 50;
const DECK_ID = 'automation-decisions-deck';
const STATE_ID = 'automation-decisions-state';
const REASON_ID = 'automation-decisions-reason';
const OPEN_ID = 'automation-decisions-open';

type ListState = { forKey: string | null; error: string | null; items: AutomationDecision[]; nextCursor: string | null };

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

function requestOf(filters: DecisionFilters) {
  return {
    deckId: filters.deckId ?? undefined,
    state: filters.state || undefined,
    reason: filters.reason || undefined,
    limit: PAGE_SIZE,
  };
}

export function DecisionsTab({
  draftId,
  focusOnOpen,
  onOpenDecision,
}: {
  draftId: number | null;
  focusOnOpen: boolean;
  onOpenDecision: (draftId: number) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = decisionFiltersFrom(searchParams);
  const { deckId, state, reason, openOnly } = filters;
  const [nonce, setNonce] = useState(0);
  const [list, setList] = useState<ListState>({ forKey: null, error: null, items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<{ forKey: string; text: string } | null>(null);

  // "Open only" is client-side, so it is not part of the request key.
  const key = `${deckId ?? ''}|${state}|${reason}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const forKey = `${deckId ?? ''}|${state}|${reason}|${nonce}`;
    async function run() {
      const res = await listAutomationDecisions(requestOf({ deckId, state, reason, openOnly: false }));
      if (cancelled) return;
      if (!res.success || !res.data) {
        setList({ forKey, error: errorText(res.error, 'Failed to load the decisions.'), items: [], nextCursor: null });
        return;
      }
      setList({ forKey, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deckId, state, reason, nonce]);

  function setFilters(patch: Partial<DecisionFilters>) {
    const next = withDecisionFilters(searchParams, { ...filters, ...patch });
    next.set('tab', 'decisions');
    setSearchParams(next);
  }

  const loading = list.forKey !== key;

  async function onLoadMore() {
    // The cursor belongs to the list on screen; while a new filter loads it is foreign.
    if (!list.nextCursor || loading) return;
    const startKey = key;
    setLoadingMore(true);
    setMoreError(null);
    const res = await listAutomationDecisions({ ...requestOf(filters), cursor: list.nextCursor });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setMoreError({ forKey: startKey, text: errorText(res.error, 'Failed to load more decisions.') });
      return;
    }
    const page = res.data;
    // Appended only to the list it was asked for: a filter changed meanwhile drops it.
    setList(prev =>
      prev.forKey === startKey ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev,
    );
  }

  const shown = openOnly ? list.items.filter(isOpenDecision) : list.items;
  const closeSearch = `?${withDecisionFilters(new URLSearchParams({ tab: 'decisions' }), filters).toString()}`;

  return (
    <div className="space-y-4">
      {draftId !== null ? (
        <DecisionDetail draftId={draftId} focusOnOpen={focusOnOpen} closeSearch={closeSearch} />
      ) : null}

      <section className={CARD_CLASS} aria-label="Decisions">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className={H2_CLASS}>Decisions</h2>
          <div>
            <label htmlFor={DECK_ID} className={LABEL_CLASS}>
              Deck
            </label>
            <DeckSelect
              id={DECK_ID}
              value={deckId === null ? '' : String(deckId)}
              onChange={value => setFilters({ deckId: value ? Number(value) : null })}
              emptyLabel="All decks"
            />
          </div>
          <div>
            <label htmlFor={STATE_ID} className={LABEL_CLASS}>
              State
            </label>
            <select
              id={STATE_ID}
              className={INPUT_CLASS}
              value={state}
              onChange={e => setFilters({ state: e.target.value })}
            >
              <option value="">All states</option>
              {DECISION_STATES.map(s => (
                <option key={s} value={s}>
                  {decisionStateLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={REASON_ID} className={LABEL_CLASS}>
              Reason
            </label>
            <select
              id={REASON_ID}
              className={INPUT_CLASS}
              value={reason}
              onChange={e => setFilters({ reason: e.target.value })}
            >
              <option value="">All reasons</option>
              {DECISION_REASONS.map(r => (
                <option key={r} value={r}>
                  {decisionReasonLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <input
              id={OPEN_ID}
              type="checkbox"
              checked={openOnly}
              onChange={e => setFilters({ openOnly: e.target.checked })}
            />
            <label htmlFor={OPEN_ID} className="text-xs font-medium text-slate-700">
              Open only (no person has decided)
            </label>
          </div>
          <Button variant="outline" size="xs" loading={loading} onClick={() => setNonce(n => n + 1)}>
            Refresh
          </Button>
        </div>

        <div className="mt-2">
          {list.error ? (
            <Callout tone="danger" role="alert">
              {list.error}
            </Callout>
          ) : loading && list.items.length === 0 ? (
            <p className="text-sm text-slate-600">Loading the decisions…</p>
          ) : (
            <DecisionTable items={shown} onOpenDecision={onOpenDecision} />
          )}
        </div>
        {openOnly && !list.error && list.items.length > shown.length ? (
          <p className="mt-1 text-xs text-slate-500">
            {list.items.length - shown.length} decided by a person are hidden on the loaded pages.
          </p>
        ) : null}

        {moreError && moreError.forKey === key ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {moreError.text}
            </Callout>
          </div>
        ) : null}
        {list.nextCursor && !loading ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMore} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
