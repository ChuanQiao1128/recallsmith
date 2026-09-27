// src/pages/ReviewQueuePage.tsx
//
// The AI draft review queue (R18 contract §8.3): the human gate of the authoring
// agent. Every AI-authored DraftCard waits here until a person accepts it, edits
// and accepts it, or rejects it with a reason. The time from opening a draft to
// deciding it is sent as reviewMs, which feeds the Automation Ledger (§9.3
// ai_draft_review). The lint panel runs the importer's own rules through
// lib/draftReview.ts, the same set the MCP server's lint_card applies (§8.4).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { fetchDeckById, fetchDecks } from '../api/authoring';
import { acceptDraft, fetchDraft, listDrafts, rejectDraft } from '../api/drafts';
import { QueryKeys, useAppQueryClient } from '../api/queryClient';
import { CardForm } from '../components/CardForm';
import type { CardFormValues } from '../components/CardForm';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { useConfirm } from '../components/ui/ConfirmDialogContext';
import {
  CARD_CLASS,
  FIELD_ERROR_CLASS,
  H1_CLASS,
  H2_CLASS,
  INPUT_CLASS,
  INPUT_INVALID_CLASS,
  LABEL_CLASS,
} from '../components/console/consoleStyles';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { CONSOLE_NAME } from '../lib/brand';
import {
  DRAFT_NOTE_MAX_LENGTH,
  DRAFT_REJECT_REASONS,
  draftDecisionMessage,
  draftLintAdvice,
  draftListEmptyText,
  draftToFormValues,
  formValuesToDraftCard,
  lintDraftCard,
  reviewClockMs,
  setReviewClockVisible,
  sourceHostLabel,
  startReviewClock,
} from '../lib/draftReview';
import type { ReviewClock } from '../lib/draftReview';
import { parseDeckId } from '../lib/parseDeckId';
import { qaPageHref } from '../lib/qaGate';
import type { ApiError, ApiResult } from '../types/api';
import type { Deck } from '../types/deck';
import type { Draft, DraftRejectReason, DraftStatus, DraftSummary } from '../types/draft';

type LoadError = { code: string; message: string };
type StatusFilter = DraftStatus | 'all';

// Each load remembers what it was loaded FOR, so "loading" is derived from a
// key mismatch rather than set synchronously inside an effect.
type DecksState = { loaded: boolean; error: LoadError | null; items: Deck[] };
type DeckState = { forDeckId: number | null; error: LoadError | null; deck: Deck | null };
type ListState = {
  forKey: string | null;
  error: LoadError | null;
  items: DraftSummary[];
  nextCursor: string | null;
};
type DetailState = { forDraftId: number | null; error: LoadError | null; draft: Draft | null };
type Outcome = { kind: 'accepted'; cardId: number; deckId: number } | { kind: 'rejected' };

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];
const PAGE_SIZE = 50;


// A draft row is a selectable list item, not an action, so it keeps its own
// look; it takes the same focus-visible ring ui/Button carries.
const LIST_ITEM_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2';
function pageIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function toLoadError(error: ApiError | null, fallback: string): LoadError {
  return { code: error?.code ?? 'UNKNOWN', message: error?.message ?? fallback };
}

function isNotReady(error: LoadError | null): boolean {
  return !!error && error.code.startsWith('SERVER_NOT_READY_');
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}

function cardHref(deckId: number, cardId: number): string {
  return `/decks/cards/edit?deckId=${deckId}&cardId=${cardId}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-sm text-slate-900 whitespace-pre-wrap">{children}</div>
    </div>
  );
}

export function ReviewQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deckId = parseDeckId(searchParams.get('deckId'));
  const draftIdParam = parseDeckId(searchParams.get('draftId'));
  const queryClient = useAppQueryClient();
  const confirm = useConfirm();

  const [status, setStatus] = useState<StatusFilter>('pending');
  const [listNonce, setListNonce] = useState(0);
  const [draftNonce, setDraftNonce] = useState(0);

  const [decks, setDecks] = useState<DecksState>({ loaded: false, error: null, items: [] });
  const [deckState, setDeckState] = useState<DeckState>({ forDeckId: null, error: null, deck: null });
  const [list, setList] = useState<ListState>({ forKey: null, error: null, items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ forDraftId: null, error: null, draft: null });

  // Per-draft UI, keyed by draft id so opening another draft resets it without an effect.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState<DraftRejectReason | ''>('');
  const [note, setNote] = useState('');
  const [rejectProblem, setRejectProblem] = useState<string | null>(null);

  const [deciding, setDeciding] = useState(false);
  const decidingRef = useRef(false);
  // Review time counts only while the tab is visible (see ReviewClock).
  const clockRef = useRef<ReviewClock>(startReviewClock(0, false));
  // Whether the open edit form holds unaccepted edits. The ref is read inside
  // handlers that run before a re-render; the state drives the page-wide guard
  // (header links, Back, reload), which covers every way out of the page.
  const editDirtyRef = useRef(false);
  const [editDirty, setEditDirty] = useState(false);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const listKey = deckId === null ? null : `${deckId}|${status}`;

  // No deck: the picker's list.
  useEffect(() => {
    if (deckId !== null) return;
    let cancelled = false;
    async function run() {
      const res = await fetchDecks();
      if (cancelled) return;
      if (!res.success || !res.data) {
        setDecks({ loaded: true, error: toLoadError(res.error, 'Failed to load decks.'), items: [] });
        return;
      }
      setDecks({ loaded: true, error: null, items: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  useEffect(() => {
    if (deckId === null) return;
    let cancelled = false;
    async function run() {
      const res = await fetchDeckById(deckId as number);
      if (cancelled) return;
      if (!res.success || !res.data) {
        setDeckState({ forDeckId: deckId, error: toLoadError(res.error, 'Failed to load the deck.'), deck: null });
        return;
      }
      setDeckState({ forDeckId: deckId, error: null, deck: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  useEffect(() => {
    if (deckId === null || listKey === null) return;
    let cancelled = false;
    async function run() {
      const res = await listDrafts({ deckId: deckId as number, status, limit: PAGE_SIZE });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setList({ forKey: listKey, error: toLoadError(res.error, 'Failed to load drafts.'), items: [], nextCursor: null });
        return;
      }
      setList({ forKey: listKey, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deckId, status, listKey, listNonce]);

  const listReady = list.forKey !== null && list.forKey === listKey;
  const listItems = listReady ? list.items : [];
  const firstPending = listItems.find(item => item.status === 'pending') ?? null;
  const selectedId = deckId === null ? null : (draftIdParam ?? firstPending?.draftId ?? null);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    async function run() {
      const res = await fetchDraft(selectedId as number);
      if (cancelled) return;
      if (!res.success || !res.data) {
        setDetail({ forDraftId: selectedId, error: toLoadError(res.error, 'Failed to load the draft.'), draft: null });
        return;
      }
      clockRef.current = startReviewClock(Date.now(), pageIsVisible());
      setDetail({ forDraftId: selectedId, error: null, draft: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedId, draftNonce]);

  useEffect(() => {
    function onVisibilityChange() {
      clockRef.current = setReviewClockVisible(clockRef.current, pageIsVisible(), Date.now());
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // After a decision the decision panel unmounts while the next draft loads,
  // which would drop keyboard focus to <body>. Move it to the outcome instead.
  useEffect(() => {
    if (outcome) outcomeRef.current?.focus();
  }, [outcome]);

  const onEditDirtyChange = useCallback((dirty: boolean) => {
    editDirtyRef.current = dirty;
    setEditDirty(dirty);
  }, []);

  function clearEditDirty() {
    editDirtyRef.current = false;
    setEditDirty(false);
  }

  const guard = useUnsavedChangesGuard(editingId !== null && editDirty);

  const deck = deckState.forDeckId === deckId ? deckState.deck : null;
  const deckError = deckState.forDeckId === deckId ? deckState.error : null;
  const draft = detail.forDraftId === selectedId ? detail.draft : null;
  const detailError = detail.forDraftId === selectedId ? detail.error : null;

  const lint = useMemo(() => (deck && draft ? lintDraftCard(deck.slug, draft.card) : null), [deck, draft]);

  const notReady =
    isNotReady(decks.error) ||
    isNotReady(deckError) ||
    isNotReady(listReady ? list.error : null) ||
    isNotReady(detailError);

  async function openDraft(id: number) {
    if (deckId === null) return;
    const switching = id !== selectedId;
    if (switching && editingId !== null && editDirtyRef.current) {
      const discard = await confirm({
        title: 'Discard your edits?',
        body: 'The draft you are editing has changes that have not been accepted. Opening another draft discards them.',
        confirmLabel: 'Discard edits',
        destructive: true,
      });
      if (!discard) return;
    }
    if (switching) {
      clearEditDirty();
      setEditingId(null);
    }
    setOutcome(null);
    setDecisionError(null);
    // Any discard was confirmed above, and reopening the draft being edited
    // keeps the form: either way the page-wide guard must not ask again.
    guard.allowNextNavigation();
    setSearchParams({ deckId: String(deckId), draftId: String(id) });
  }

  async function onStatusChange(next: StatusFilter) {
    // With no draftId in the URL the open draft is the filter's first pending
    // one, so changing the filter can swap it out from under an edit.
    if (next !== status && draftIdParam === null && editingId !== null && editDirtyRef.current) {
      const discard = await confirm({
        title: 'Discard your edits?',
        body: 'The draft you are editing has changes that have not been accepted. Changing the filter can close it and discard them.',
        confirmLabel: 'Discard edits',
        destructive: true,
      });
      if (!discard) return;
      clearEditDirty();
      setEditingId(null);
    }
    setStatus(next);
  }

  async function onLoadMore() {
    if (deckId === null || !list.nextCursor || loadingMore) return;
    // The page belongs to the filter it was asked for. If the filter changed
    // while it was in flight, the list now holds another filter's first page,
    // and appending (or following its cursor) would mix the two.
    const keyAtClick = listKey;
    setLoadingMore(true);
    const res = await listDrafts({ deckId, status, limit: PAGE_SIZE, cursor: list.nextCursor });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setList(prev =>
        prev.forKey !== keyAtClick ? prev : { ...prev, error: toLoadError(res.error, 'Failed to load more drafts.') },
      );
      return;
    }
    const page = res.data;
    setList(prev =>
      prev.forKey !== keyAtClick
        ? prev
        : { ...prev, error: null, items: [...prev.items, ...page.items], nextCursor: page.nextCursor },
    );
  }

  /**
   * Sends one decision. The ref guard is what makes a double click send one
   * request: the disabled buttons follow a render later than the second click
   * may arrive.
   */
  async function decide<T>(
    id: number,
    send: (reviewMs: number) => Promise<ApiResult<T>>,
    onDone: (data: T) => Outcome,
    decided: DraftStatus,
  ): Promise<string | null> {
    if (decidingRef.current || deckId === null) return 'A decision is already being sent.';
    decidingRef.current = true;
    setDeciding(true);
    setOutcome(null);
    setDecisionError(null);
    const reviewMs = reviewClockMs(clockRef.current, Date.now());
    const res = await send(reviewMs);
    decidingRef.current = false;
    setDeciding(false);

    if (!res.success || !res.data) {
      const code = res.error?.code;
      const message = draftDecisionMessage(code, res.error?.message ?? 'The decision failed.');
      setDecisionError(message);
      if (code === 'DRAFT_NOT_PENDING') {
        setListNonce(n => n + 1);
        setDraftNonce(n => n + 1);
      }
      return message;
    }

    const done = onDone(res.data);
    if (done.kind === 'accepted') {
      // Accepting creates a card: the deck's card list and its card count are
      // now stale in the query cache (staleTime 30 s), so drop them.
      void queryClient.invalidateQueries({ queryKey: QueryKeys.cards(done.deckId) });
      void queryClient.invalidateQueries({ queryKey: QueryKeys.decks() });
    }
    setOutcome(done);
    editDirtyRef.current = false;
    setEditDirty(false);
    setEditingId(null);
    setRejectingId(null);
    // Mark it decided locally so the next pending draft opens at once, then
    // refresh the list from the server.
    setList(prev => ({
      ...prev,
      items: prev.items.map(item => (item.draftId === id ? { ...item, status: decided } : item)),
    }));
    // The edit was just accepted, so this navigation discards nothing. Only arm
    // the allowance when the URL carries a draftId, i.e. when the navigation
    // actually moves; on the auto-selected draft it stays put (frontend-console-19).
    if (draftIdParam !== null) guard.allowNextNavigation();
    setSearchParams({ deckId: String(deckId) });
    setListNonce(n => n + 1);
    return null;
  }

  function onAccept(current: Draft) {
    void decide(
      current.draftId,
      reviewMs => acceptDraft(current.draftId, { reviewMs }),
      data => ({ kind: 'accepted', cardId: data.cardId, deckId: current.deckId || (deckId ?? 0) }),
      'accepted',
    );
  }

  async function onAcceptEdited(current: Draft, values: CardFormValues): Promise<{ ok: boolean; error?: string }> {
    if (!deck) return { ok: false, error: 'The deck is not loaded.' };
    const edited = formValuesToDraftCard(values, current.card);
    const editedLint = lintDraftCard(deck.slug, edited);
    if (!editedLint.ok) return { ok: false, error: editedLint.issues[0]?.message ?? 'The card has lint issues.' };
    const problem = await decide(
      current.draftId,
      reviewMs => acceptDraft(current.draftId, { card: edited, reviewMs }),
      data => ({ kind: 'accepted', cardId: data.cardId, deckId: current.deckId || (deckId ?? 0) }),
      'accepted',
    );
    return problem === null ? { ok: true } : { ok: false, error: problem };
  }

  function onConfirmReject(current: Draft) {
    if (!reason) {
      setRejectProblem('Choose a reason.');
      return;
    }
    if (note.length > DRAFT_NOTE_MAX_LENGTH) {
      setRejectProblem(`The note is too long (max ${DRAFT_NOTE_MAX_LENGTH} characters).`);
      return;
    }
    setRejectProblem(null);
    const trimmedNote = note.trim();
    void decide(
      current.draftId,
      reviewMs =>
        rejectDraft(current.draftId, trimmedNote ? { reason, note: trimmedNote, reviewMs } : { reason, reviewMs }),
      () => ({ kind: 'rejected' }),
      'rejected',
    );
  }

  function beginReject(id: number) {
    setRejectingId(id);
    setReason('');
    setNote('');
    setRejectProblem(null);
  }

  const reviewHref = deckId === null ? '/review' : `/review?deckId=${deckId}`;

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · Review queue"
      {...consoleNav({ reviewHref, qaHref: deckId === null ? '/decks/qa' : qaPageHref(deckId) })}
    >
      <div>
        <h1 className={H1_CLASS}>Review queue</h1>
        {deck ? (
          <div className="text-xs text-slate-500 mt-0.5">
            {deck.title} · <span className="font-mono">{deck.slug}</span> ·{' '}
            <Link to={`/decks/cards?deckId=${deck.id}`} className="text-indigo-600 hover:underline">
              Cards
            </Link>
          </div>
        ) : null}
      </div>

      {notReady ? (
        <Callout tone="warning" title="The review queue is not set up yet">
          <div data-testid="review-not-ready">The server has not run the review queue database migration.</div>
        </Callout>
      ) : null}

      {deckId === null ? (
        <section className={CARD_CLASS} aria-label="Decks">
          <p className="text-sm text-slate-700">Choose a deck to review its AI drafts.</p>
          {decks.error && !isNotReady(decks.error) ? (
            <div className="mt-2">
              <Callout tone="danger" role="alert">
                {decks.error.message}
              </Callout>
            </div>
          ) : null}
          {!decks.loaded ? <p className="text-sm text-slate-500 mt-2">Loading decks…</p> : null}
          <ul className="mt-2 space-y-1">
            {decks.items.map(item => (
              <li key={item.id}>
                <Link to={`/review?deckId=${item.id}`} className="text-sm text-indigo-600 hover:underline">
                  {item.title} <span className="font-mono text-xs text-slate-500">({item.slug})</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          {deckError && !isNotReady(deckError) ? (
            <Callout tone="danger" role="alert">
              {deckError.message}
            </Callout>
          ) : null}

          {outcome ? (
            <div role="status" ref={outcomeRef} tabIndex={-1} data-testid="review-outcome" className="focus:outline-none">
              <Callout tone="success">
                {outcome.kind === 'accepted' ? (
                  <>
                    Accepted as card #{outcome.cardId}{' '}
                    <Link to={cardHref(outcome.deckId, outcome.cardId)} className="underline">
                      Open card
                    </Link>
                  </>
                ) : (
                  'Rejected'
                )}
              </Callout>
            </div>
          ) : null}

          {decisionError ? (
            <Callout tone="danger" role="alert">
              {decisionError}
            </Callout>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <section className={`${CARD_CLASS} space-y-3`} aria-label="Drafts">
              <div>
                <label htmlFor="review-status" className={LABEL_CLASS}>
                  Status
                </label>
                <select
                  id="review-status"
                  className={INPUT_CLASS}
                  value={status}
                  onChange={e => void onStatusChange(e.target.value as StatusFilter)}
                >
                  {STATUS_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {!listReady ? <p className="text-sm text-slate-500">Loading drafts…</p> : null}
              {listReady && list.error && !isNotReady(list.error) ? (
                <Callout tone="danger" role="alert">
                  {list.error.message}
                </Callout>
              ) : null}
              {listReady && !list.error && listItems.length === 0 ? (
                <p className="text-sm text-slate-500">{draftListEmptyText(status)}</p>
              ) : null}

              <ul className="space-y-1">
                {listItems.map(item => (
                  <li key={item.draftId}>
                    <button
                      type="button"
                      onClick={() => void openDraft(item.draftId)}
                      aria-current={item.draftId === selectedId ? 'true' : undefined}
                      className={`w-full text-left rounded border px-3 py-2 text-sm hover:bg-slate-50 ${LIST_ITEM_FOCUS} ${
                        item.draftId === selectedId ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'
                      }`}
                    >
                      <div className="font-mono text-xs text-slate-600">{item.stableUid}</div>
                      <div className="text-slate-900">{firstLine(item.question)}</div>
                      {item.likelyDuplicate ? <Badge tone="warning">Likely duplicate</Badge> : null}
                    </button>
                  </li>
                ))}
              </ul>

              {listReady && list.nextCursor ? (
                <Button variant="outline" size="xs" disabled={loadingMore} onClick={() => void onLoadMore()}>
                  Load more
                </Button>
              ) : null}
            </section>

            <div className="space-y-4">
              {detailError && !isNotReady(detailError) ? (
                <Callout tone="danger" role="alert">
                  {detailError.message}
                </Callout>
              ) : null}

              {selectedId !== null && !draft && !detailError ? (
                <p className="text-sm text-slate-500">Loading draft…</p>
              ) : null}

              {draft && deck && lint ? (
                <>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {editingId === draft.draftId && draft.status === 'pending' ? (
                      <CardForm
                        mode="create"
                        deck={deck}
                        initialValues={draftToFormValues(draft.card)}
                        mcq={draft.card.mcq ?? null}
                        variant="draft"
                        onDirtyChange={onEditDirtyChange}
                        submitLabel="Accept with edits"
                        onSubmit={values => onAcceptEdited(draft, values)}
                        onCancel={() => {
                          clearEditDirty();
                          setEditingId(null);
                        }}
                      />
                    ) : (
                      <section className={`${CARD_CLASS} space-y-3`} aria-label="Draft card">
                        <h2 className={H2_CLASS}>Draft card</h2>
                        <Field label="Stable uid">
                          <span className="font-mono">{draft.card.stableUid}</span>
                        </Field>
                        <Field label="Difficulty">d{draft.card.difficulty}</Field>
                        {draft.card.topic ? <Field label="Topic">{draft.card.topic}</Field> : null}
                        <Field label="Question">{draft.card.question}</Field>
                        {draft.card.mcq ? (
                          <div>
                            <div className="text-xs font-medium text-slate-500">
                              Options{draft.card.mcq.qualifier ? ` · ${draft.card.mcq.qualifier}` : ''}
                            </div>
                            <ol className="space-y-1 mt-1">
                              {draft.card.mcq.options.map(option => (
                                <li key={option.key} className="text-sm text-slate-900">
                                  <span className="font-mono">{option.key}.</span> {option.text}
                                  {option.correct ? <strong className="ml-2 text-emerald-700">Correct</strong> : null}
                                  {option.why ? <div className="text-xs text-slate-500">{option.why}</div> : null}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}
                        <Field label="Answer">{draft.card.explanation}</Field>
                        {draft.card.codeSnippet ? (
                          <Field label={draft.card.codeLanguage ? `Code (${draft.card.codeLanguage})` : 'Code'}>
                            <pre className="font-mono text-xs bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">
                              {draft.card.codeSnippet}
                            </pre>
                          </Field>
                        ) : null}
                        {draft.card.realWorldUsage ? <Field label="Usage">{draft.card.realWorldUsage}</Field> : null}
                        {draft.agent && (draft.agent.name || draft.agent.model || draft.agent.skillVersion) ? (
                          <Field label="Agent">
                            {[draft.agent.name, draft.agent.model, draft.agent.skillVersion].filter(Boolean).join(' · ')}
                          </Field>
                        ) : null}
                      </section>
                    )}

                    <div className="space-y-4">
                      <section className={`${CARD_CLASS} space-y-2`} aria-label="Source">
                        <h2 className={H2_CLASS}>Source</h2>
                        <SourceLink url={draft.card.source.url} />
                        <blockquote className="border-l-4 border-amber-300 pl-3 text-sm text-slate-800">
                          <mark data-testid="review-source-quote">{draft.card.source.quote}</mark>
                        </blockquote>
                        {draft.card.source.grounding ? (
                          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2" data-testid="review-grounding">
                            {draft.card.source.grounding.matched ? (
                              <Badge tone="success">Quote found in the source</Badge>
                            ) : (
                              <Badge tone="warning">Quote not found in the source</Badge>
                            )}
                            <span>
                              Chunk <span className="font-mono">{draft.card.source.grounding.chunkId}</span> of source{' '}
                              <span className="font-mono">{draft.card.source.grounding.sourceId}</span> ·{' '}
                              {draft.card.source.grounding.quoteChars} characters quoted
                            </span>
                          </div>
                        ) : null}
                      </section>

                      <section className={`${CARD_CLASS} space-y-2`} aria-label="Similar cards">
                        <h2 className={H2_CLASS}>Similar cards</h2>
                        {draft.similar.length === 0 ? (
                          <p className="text-sm text-slate-500">No similar cards found.</p>
                        ) : (
                          <ul className="space-y-2">
                            {draft.similar.map(match => (
                              <li key={match.cardId} className="text-sm border-t border-slate-100 pt-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-xs">{match.stableUid}</span>
                                  <span className="text-xs text-slate-500">{match.deckSlug}</span>
                                  <span className="text-xs text-slate-700">{Math.round(match.similarity * 100)}%</span>
                                  {match.likelyDuplicate ? <Badge tone="warning">Likely duplicate</Badge> : null}
                                </div>
                                <div className="text-slate-900">{match.question}</div>
                                <Link
                                  to={cardHref(match.deckId, match.cardId)}
                                  className="text-xs text-indigo-600 hover:underline"
                                >
                                  Open card
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>
                  </div>

                  <section className={`${CARD_CLASS} space-y-2`} aria-label="Lint">
                    <h2 className={H2_CLASS}>Lint</h2>
                    {lint.ok ? <p className="text-sm text-emerald-700">No lint issues.</p> : null}
                    {lint.issues.length > 0 ? (
                      <ul className="text-sm text-red-800 space-y-1">
                        {lint.issues.map((issue, i) => (
                          <li key={`i-${i}`}>
                            {issue.code}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {lint.warnings.length > 0 ? (
                      <ul className="text-sm text-amber-900 space-y-1">
                        {lint.warnings.map((warning, i) => (
                          <li key={`w-${i}`}>
                            {warning.code}: {warning.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>

                  {draft.status === 'pending' ? (
                    editingId === draft.draftId ? null : (
                      <section className={`${CARD_CLASS} space-y-3`} aria-label="Decision">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            variant="primary"
                            size="xs"
                            disabled={deciding || !lint.ok}
                            onClick={() => onAccept(draft)}
                          >
                            Accept
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={deciding}
                            onClick={() => setEditingId(draft.draftId)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={deciding}
                            onClick={() => beginReject(draft.draftId)}
                          >
                            Reject
                          </Button>
                        </div>
                        {!lint.ok ? (
                          <p className="text-sm text-slate-600" data-testid="review-lint-advice">
                            {draftLintAdvice(lint.issues)}
                          </p>
                        ) : null}

                        {rejectingId === draft.draftId ? (
                          <div className="space-y-2 border-t border-slate-100 pt-3">
                            <div>
                              <label htmlFor="review-reject-reason" className={LABEL_CLASS}>
                                Reason
                              </label>
                              <select
                                id="review-reject-reason"
                                className={rejectProblem ? INPUT_INVALID_CLASS : INPUT_CLASS}
                                required
                                aria-invalid={rejectProblem ? true : undefined}
                                aria-describedby={rejectProblem ? 'review-reject-problem' : undefined}
                                value={reason}
                                onChange={e => setReason(e.target.value as DraftRejectReason | '')}
                              >
                                <option value="" disabled>
                                  Choose a reason
                                </option>
                                {DRAFT_REJECT_REASONS.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label htmlFor="review-reject-note" className={LABEL_CLASS}>
                                Note (optional)
                              </label>
                              <textarea
                                id="review-reject-note"
                                className={INPUT_CLASS}
                                maxLength={DRAFT_NOTE_MAX_LENGTH}
                                rows={3}
                                value={note}
                                onChange={e => setNote(e.target.value)}
                              />
                            </div>
                            {rejectProblem ? (
                              <p id="review-reject-problem" role="alert" className={FIELD_ERROR_CLASS}>
                                {rejectProblem}
                              </p>
                            ) : null}
                            <div className="flex items-center gap-2">
                              <Button
                                variant="primary"
                                size="xs"
                                disabled={deciding || !reason}
                                onClick={() => onConfirmReject(draft)}
                              >
                                Confirm reject
                              </Button>
                              <Button
                                variant="outline"
                                size="xs"
                                disabled={deciding}
                                onClick={() => setRejectingId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </section>
                    )
                  ) : (
                    <section className={`${CARD_CLASS} space-y-2`} aria-label="Decision">
                      <p className="text-sm text-slate-800">
                        {draft.status === 'accepted' ? 'Accepted' : 'Rejected'}
                        {draft.decidedAt ? ` · ${draft.decidedAt}` : ''}
                        {draft.acceptedCardId !== null ? (
                          <>
                            {' · '}
                            <Link
                              to={cardHref(draft.deckId || (deckId ?? 0), draft.acceptedCardId)}
                              className="text-indigo-600 hover:underline"
                            >
                              Open card
                            </Link>
                          </>
                        ) : null}
                      </p>
                      {draft.events.length > 0 ? (
                        <ol className="text-xs text-slate-600 space-y-1">
                          {draft.events.map(event => (
                            <li key={event.id}>
                              {event.createdAt} · {event.action}
                              {event.reason ? ` · ${event.reason}` : ''}
                              {event.note ? ` · ${event.note}` : ''}
                              {event.reviewMs !== null ? ` · ${Math.round(event.reviewMs / 1000)}s` : ''}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </section>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </ConsoleShell>
  );
}

function SourceLink({ url }: { url: string }) {
  const host = sourceHostLabel(url);
  if (host === null) return <p className="text-sm text-slate-700 break-all">{url}</p>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline">
      {host}
    </a>
  );
}
