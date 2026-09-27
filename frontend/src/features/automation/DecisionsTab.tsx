// src/features/automation/DecisionsTab.tsx
//
// The Decisions tab (A00 §16.1): every automatic decision with its state,
// reason and AI QA reviewer, filtered by deck, state and reason. `?draftId=`
// (the deep link of the exception email and the auto-accept webhook) opens the
// detail drawer above the list.
//
// The filters live in the URL (`?tab=decisions&state=human&open=1`), so the
// Overview's backlog can link to the open exceptions (B07 frontend-console-1).
// "Open only" asks the server for the open exceptions (`open=true`, L4): the
// same predicate and keyset order as the backlog count, so the oldest open
// item is reachable however many handled ones are newer (C07 frontend-console-13).
// The client check stays only for an older server that ignores the parameter.
//
// Closing the detail returns focus to the row's Details button, or to the
// Decisions heading when that row is not loaded (C07 frontend-console-18).
//
// The checkbox says what the server filter is: routed to a person and still
// pending (D07 frontend-console-27). A state or reason filter shows every
// row's verdict (the filter names it), so those rows are recorded as seen and
// a later decision on them is not counted as blind (frontend-console-25,
// generalised beyond would_accept by E05 frontend-console-30). The open
// exceptions view (state=human&open=1) is such a list, and stays as it is. So
// is the checkbox alone (`open=1`): it lists routed rows only (F04
// frontend-console-36).
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { listAutomationDecisions, type AutomationDecision } from '../../api/automation';
import { markVerdictSeen } from '../../lib/automationVerdictSeen';
import { CARD_CLASS, H2_CLASS, INPUT_CLASS, LABEL_CLASS } from '../../components/console/consoleStyles';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import {
  DECISION_REASONS,
  DECISION_STATES,
  automationErrorMessage,
  decisionFiltersFrom,
  decisionListShowsVerdict,
  decisionReasonLabel,
  decisionStateLabel,
  decisionVerdictHidden,
  hiddenDecidedText,
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
    open: filters.openOnly ? true : undefined,
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
  // The list key a Load more is running for; another key's Load more is not busy.
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<{ forKey: string; text: string } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openedRef = useRef<number | null>(draftId);

  const key = `${deckId ?? ''}|${state}|${reason}|${openOnly}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const forKey = `${deckId ?? ''}|${state}|${reason}|${openOnly}|${nonce}`;
    async function run() {
      const res = await listAutomationDecisions(requestOf({ deckId, state, reason, openOnly }));
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
  }, [deckId, state, reason, openOnly, nonce]);

  useEffect(() => {
    const closed = openedRef.current;
    openedRef.current = draftId;
    if (closed === null || draftId !== null) return;
    const row = sectionRef.current?.querySelector<HTMLElement>(`button[aria-label="Details of draft ${closed}"]`);
    (row ?? headingRef.current)?.focus();
  }, [draftId]);

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
    setLoadingMoreKey(startKey);
    setMoreError(null);
    const res = await listAutomationDecisions({ ...requestOf(filters), cursor: list.nextCursor });
    setLoadingMoreKey(k => (k === startKey ? null : k));
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
  // The state, reason or open-only filter itself tells the verdict of every row it lists.
  const verdictFiltered = decisionListShowsVerdict({ state, reason, openOnly });

  useEffect(() => {
    // Only the list loaded for these filters: a list still loading for another key is not on screen as filtered.
    if (!verdictFiltered || list.forKey !== key) return;
    // Only the rows on screen: the open-only list drops any row that is not open.
    const onScreen = openOnly ? list.items.filter(isOpenDecision) : list.items;
    const ids = onScreen.filter(decisionVerdictHidden).map(d => d.draftId);
    if (ids.length > 0) markVerdictSeen(...ids);
  }, [verdictFiltered, openOnly, list.forKey, list.items, key]);
  const closeSearch = `?${withDecisionFilters(new URLSearchParams({ tab: 'decisions' }), filters).toString()}`;

  return (
    <div className="space-y-4">
      {draftId !== null ? (
        <DecisionDetail draftId={draftId} focusOnOpen={focusOnOpen} closeSearch={closeSearch} />
      ) : null}

      <section ref={sectionRef} className={CARD_CLASS} aria-label="Decisions">
        <div className="flex flex-wrap items-end gap-3">
          <h2 ref={headingRef} tabIndex={-1} className={`${H2_CLASS} focus:outline-none`}>
            Decisions
          </h2>
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
              Open exceptions only (routed to you, still pending)
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
            // While another filter's list loads, the rows on screen are not the filtered ones: they keep hiding.
            <DecisionTable items={shown} onOpenDecision={onOpenDecision} revealAll={verdictFiltered && !loading} />
          )}
        </div>
        {verdictFiltered ? (
          <p className="mt-1 text-xs text-slate-600" data-testid="automation-decisions-verdict-filter">
            This filter shows the verdict: a later decision on these drafts counts as not blind.
          </p>
        ) : null}
        {openOnly && !list.error && list.items.length > shown.length ? (
          <p className="mt-1 text-xs text-slate-600">{hiddenDecidedText(list.items.length - shown.length)}</p>
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
            <Button variant="outline" size="xs" loading={loadingMoreKey === key} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
