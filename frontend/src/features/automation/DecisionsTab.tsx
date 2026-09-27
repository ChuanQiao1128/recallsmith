// src/features/automation/DecisionsTab.tsx
//
// The Decisions tab (A00 §16.1): every automatic decision with its state,
// reason and AI QA reviewer, filtered by deck, state and reason. `?draftId=`
// (the deep link of the exception email and the auto-accept webhook) opens the
// detail drawer above the list.
import { useEffect, useState } from 'react';

import { listAutomationDecisions, type AutomationDecision } from '../../api/automation';
import { fetchDecks } from '../../api/authoring';
import { CARD_CLASS, H2_CLASS, INPUT_CLASS, LABEL_CLASS } from '../../components/console/consoleStyles';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import {
  DECISION_REASONS,
  DECISION_STATES,
  automationErrorMessage,
  decisionReasonLabel,
  decisionStateLabel,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';
import type { Deck } from '../../types/deck';
import { DecisionDetail } from './DecisionDetail';
import { DecisionTable } from './DecisionTable';

const PAGE_SIZE = 50;
const DECK_ID = 'automation-decisions-deck';
const STATE_ID = 'automation-decisions-state';
const REASON_ID = 'automation-decisions-reason';

type ListState = { forKey: string | null; error: string | null; items: AutomationDecision[]; nextCursor: string | null };

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

export function DecisionsTab({
  draftId,
  onOpenDecision,
}: {
  draftId: number | null;
  onOpenDecision: (draftId: number) => void;
}) {
  const [deckId, setDeckId] = useState('');
  const [state, setState] = useState('');
  const [reason, setReason] = useState('');
  const [nonce, setNonce] = useState(0);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [list, setList] = useState<ListState>({ forKey: null, error: null, items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const key = `${deckId}|${state}|${reason}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchDecks();
      if (cancelled || !res.success || !res.data) return;
      setDecks(res.data);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const forKey = `${deckId}|${state}|${reason}|${nonce}`;
    async function run() {
      const res = await listAutomationDecisions({
        deckId: deckId ? Number(deckId) : undefined,
        state: state || undefined,
        reason: reason || undefined,
        limit: PAGE_SIZE,
      });
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

  async function onLoadMore() {
    if (!list.nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    const res = await listAutomationDecisions({
      deckId: deckId ? Number(deckId) : undefined,
      state: state || undefined,
      reason: reason || undefined,
      limit: PAGE_SIZE,
      cursor: list.nextCursor,
    });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setMoreError(errorText(res.error, 'Failed to load more decisions.'));
      return;
    }
    const page = res.data;
    setList(prev => ({ ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor }));
  }

  const loading = list.forKey !== key;

  return (
    <div className="space-y-4">
      {draftId !== null ? <DecisionDetail draftId={draftId} /> : null}

      <section className={CARD_CLASS} aria-label="Decisions">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className={H2_CLASS}>Decisions</h2>
          <div>
            <label htmlFor={DECK_ID} className={LABEL_CLASS}>
              Deck
            </label>
            <select id={DECK_ID} className={INPUT_CLASS} value={deckId} onChange={e => setDeckId(e.target.value)}>
              <option value="">All decks</option>
              {decks.map(d => (
                <option key={d.id} value={String(d.id)}>
                  {d.slug}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={STATE_ID} className={LABEL_CLASS}>
              State
            </label>
            <select id={STATE_ID} className={INPUT_CLASS} value={state} onChange={e => setState(e.target.value)}>
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
            <select id={REASON_ID} className={INPUT_CLASS} value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">All reasons</option>
              {DECISION_REASONS.map(r => (
                <option key={r} value={r}>
                  {decisionReasonLabel(r)}
                </option>
              ))}
            </select>
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
            <DecisionTable items={list.items} onOpenDecision={onOpenDecision} />
          )}
        </div>

        {moreError ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {moreError}
            </Callout>
          </div>
        ) : null}
        {list.nextCursor ? (
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
