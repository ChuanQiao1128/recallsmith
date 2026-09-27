// src/pages/DeckQaPage.tsx
//
// The operator surface of the pre-publish AI QA gate (R18 contract §7).
// The publish preview of §7.10 is this page's first panel. The deck list's
// publish confirm dialog shows a summary of the same GET …/qa/status (loaded
// lazily after the Publish click) and links here for the detail.
//
// The page previews the gate (GET …/qa/status), starts a run with the card count
// and a cost estimate shown first, polls the run, shows findings grouped by card
// with Mark fixed / Dismiss, and lists past runs. It never starts a run on its
// own and offers no way to publish past the gate: AI_QA_ENABLED and
// AI_QA_REQUIRED are server flags the owner sets.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { fetchCardsByDeck, fetchDeckById, fetchDecks } from '../api/authoring';
import {
  fetchQaRun,
  fetchQaStatus,
  listQaRuns,
  resolveQaFinding,
  startQaRun,
} from '../api/qa';
import type { QaFinding, QaRun, QaRunDetail, QaScope, QaStatus } from '../api/qa';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import {
  CARD_CLASS,
  H1_CLASS,
  H2_CLASS,
  INPUT_CLASS,
} from '../components/console/consoleStyles';
import { CONSOLE_NAME } from '../lib/brand';
import { parseDeckId } from '../lib/parseDeckId';
import { qaPageHref } from '../lib/qaGate';
import {
  QA_CATEGORY_LABELS,
  QA_POLL_INTERVAL_MS,
  QA_POLL_MAX_FAILURES,
  estimateQaCostUsd,
  formatUsd,
  groupFindingsByCard,
  isQaRunActive,
  qaCapRemainingUsd,
  qaCardsToReview,
  qaItemErrorLabel,
  qaLimits,
  qaStartErrorMessage,
} from '../lib/qaReview';
import type { QaCardVerdict } from '../lib/qaReview';
import type { ApiError } from '../types/api';
import type { Card } from '../types/card';
import type { Deck } from '../types/deck';

type LoadError = { code: string; message: string };

// Each load remembers what it was loaded FOR, so "loading" is derived from a
// key mismatch rather than set synchronously inside an effect.
type DecksState = { loaded: boolean; error: LoadError | null; items: Deck[] };
type DeckState = { forDeckId: number | null; error: LoadError | null; deck: Deck | null };
type CardsState = { forDeckId: number | null; error: LoadError | null; cards: Card[] };
type StatusState = { forDeckId: number | null; error: LoadError | null; status: QaStatus | null };
type RunsState = { forDeckId: number | null; error: LoadError | null; items: QaRun[]; nextCursor: string | null };
type DetailState = { forRunId: string | null; error: LoadError | null; detail: QaRunDetail | null };
type PollState = { forKey: string | null; stopped: boolean };
type ResolveMessage = { tone: 'status' | 'alert'; text: string };

const SCOPE_OPTIONS: Array<{ value: QaScope; label: string }> = [
  { value: 'changed', label: 'Changed cards' },
  { value: 'all', label: 'All cards' },
  { value: 'cards', label: 'Selected cards' },
];
const RUNS_PAGE_SIZE = 20;
const NOTE_MAX = 500;

const VERDICT_BADGES: Record<QaCardVerdict, { tone: 'success' | 'danger' | 'neutral' | 'warning'; label: string }> = {
  passed: { tone: 'success', label: 'Passed' },
  flagged: { tone: 'danger', label: 'Flagged' },
  pending: { tone: 'neutral', label: 'Pending' },
  not_reviewed: { tone: 'warning', label: 'Not reviewed' },
};

function toLoadError(error: ApiError | null, fallback: string): LoadError {
  return { code: error?.code ?? 'UNKNOWN', message: error?.message ?? fallback };
}

function isNotReady(error: LoadError | null | undefined): boolean {
  return !!error && error.code.startsWith('SERVER_NOT_READY_');
}

function categoryLabel(category: string): string {
  return QA_CATEGORY_LABELS[category] ?? category;
}

function questionStart(question: string): string {
  const line = question.split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

function formatTime(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : value;
}

function cardEditHref(deckId: number, cardId: number): string {
  return `/decks/cards/edit?deckId=${deckId}&cardId=${cardId}`;
}

export function DeckQaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deckId = parseDeckId(searchParams.get('deckId'));
  const runIdParam = searchParams.get('runId') || null;


  const [statusNonce, setStatusNonce] = useState(0);
  const [runsNonce, setRunsNonce] = useState(0);
  const [detailNonce, setDetailNonce] = useState(0);

  const [decks, setDecks] = useState<DecksState>({ loaded: false, error: null, items: [] });
  const [deckState, setDeckState] = useState<DeckState>({ forDeckId: null, error: null, deck: null });
  const [cardsState, setCardsState] = useState<CardsState>({ forDeckId: null, error: null, cards: [] });
  const [statusState, setStatusState] = useState<StatusState>({ forDeckId: null, error: null, status: null });
  const [runsState, setRunsState] = useState<RunsState>({ forDeckId: null, error: null, items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailState, setDetailState] = useState<DetailState>({ forRunId: null, error: null, detail: null });
  const [poll, setPoll] = useState<PollState>({ forKey: null, stopped: false });

  const [scope, setScope] = useState<QaScope>('changed');
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [startError, setStartError] = useState<LoadError | null>(null);

  const [resolving, setResolving] = useState<ReadonlySet<number>>(() => new Set());
  const resolvingRef = useRef(new Set<number>());
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [resolveMessage, setResolveMessage] = useState<ResolveMessage | null>(null);

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
      const [deckRes, cardsRes] = await Promise.all([fetchDeckById(deckId as number), fetchCardsByDeck(deckId as number)]);
      if (cancelled) return;
      setDeckState(
        deckRes.success && deckRes.data
          ? { forDeckId: deckId, error: null, deck: deckRes.data }
          : { forDeckId: deckId, error: toLoadError(deckRes.error, 'Failed to load the deck.'), deck: null },
      );
      setCardsState(
        cardsRes.success && cardsRes.data
          ? { forDeckId: deckId, error: null, cards: cardsRes.data }
          : { forDeckId: deckId, error: toLoadError(cardsRes.error, 'Failed to load the cards.'), cards: [] },
      );
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
      const res = await fetchQaStatus(deckId as number);
      if (cancelled) return;
      setStatusState(
        res.success && res.data
          ? { forDeckId: deckId, error: null, status: res.data }
          : { forDeckId: deckId, error: toLoadError(res.error, 'Failed to load the publish gate.'), status: null },
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deckId, statusNonce]);

  useEffect(() => {
    if (deckId === null) return;
    let cancelled = false;
    async function run() {
      const res = await listQaRuns({ deckId: deckId as number, limit: RUNS_PAGE_SIZE });
      if (cancelled) return;
      setRunsState(
        res.success && res.data
          ? { forDeckId: deckId, error: null, items: res.data.items, nextCursor: res.data.nextCursor }
          : { forDeckId: deckId, error: toLoadError(res.error, 'Failed to load past runs.'), items: [], nextCursor: null },
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [deckId, runsNonce]);

  const runsReady = runsState.forDeckId !== null && runsState.forDeckId === deckId;
  const runs = runsReady ? runsState.items : [];
  // The run shown: the one named in the URL, else the newest (active or not).
  const shownRunId = deckId === null ? null : (runIdParam ?? runs[0]?.runId ?? null);
  const pollKey = shownRunId === null ? null : `${shownRunId}|${detailNonce}`;

  // Load the shown run, then keep polling it while it is active. One setTimeout
  // chain per (run, refresh); the cleanup clears the pending timer, so nothing
  // polls after unmount or after another run is chosen.
  useEffect(() => {
    if (shownRunId === null || pollKey === null) return;
    const runId = shownRunId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let sawActive = false;

    async function tick() {
      timer = null;
      const res = await fetchQaRun(runId);
      if (cancelled) return;
      if (!res.success || !res.data) {
        const error = toLoadError(res.error, 'Failed to load the run.');
        setDetailState(prev =>
          prev.forRunId === runId ? { ...prev, error } : { forRunId: runId, error, detail: null },
        );
        failures += 1;
        if (failures >= QA_POLL_MAX_FAILURES || isNotReady(error)) {
          setPoll({ forKey: pollKey, stopped: true });
          return;
        }
        timer = setTimeout(() => void tick(), QA_POLL_INTERVAL_MS);
        return;
      }
      failures = 0;
      const detail = res.data;
      setDetailState({ forRunId: runId, error: null, detail });
      if (isQaRunActive(detail.run)) {
        sawActive = true;
        timer = setTimeout(() => void tick(), QA_POLL_INTERVAL_MS);
        return;
      }
      if (sawActive) {
        // The run just turned terminal: refresh the gate and the list once.
        setStatusNonce(n => n + 1);
        setRunsNonce(n => n + 1);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [shownRunId, pollKey]);

  const deck = deckState.forDeckId === deckId ? deckState.deck : null;
  const deckError = deckState.forDeckId === deckId ? deckState.error : null;
  const cards = useMemo(
    () => (cardsState.forDeckId === deckId ? cardsState.cards : []),
    [cardsState, deckId],
  );
  const status = statusState.forDeckId === deckId ? statusState.status : null;
  const statusError = statusState.forDeckId === deckId ? statusState.error : null;
  const runsError = runsReady ? runsState.error : null;
  const detail = detailState.forRunId === shownRunId ? detailState.detail : null;
  const detailError = detailState.forRunId === shownRunId ? detailState.error : null;
  const shownRun = detail?.run ?? null;
  const shownRunActive = shownRun ? isQaRunActive(shownRun) : false;
  const pollStopped = poll.forKey !== null && poll.forKey === pollKey && poll.stopped;

  const groups = useMemo(
    () => (detail ? groupFindingsByCard(detail.findings, detail.items, cards) : []),
    [detail, cards],
  );

  const notReady =
    isNotReady(decks.error) ||
    isNotReady(statusError) ||
    isNotReady(runsError) ||
    isNotReady(detailError) ||
    isNotReady(startError);

  const cardCount =
    scope === 'changed' ? (status ? qaCardsToReview(status) : 0) : scope === 'all' ? cards.length : selected.size;
  const estimate = estimateQaCostUsd(cardCount);
  const limits = qaLimits(status);
  const capRemaining = qaCapRemainingUsd(limits);
  const startDisabled =
    !status?.enabled || cardCount === 0 || cardCount > limits.maxCards || starting || shownRunActive;

  function showRun(runId: string) {
    if (deckId === null) return;
    setResolveMessage(null);
    setSearchParams({ deckId: String(deckId), runId });
  }

  function toggleCard(cardId: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  async function onStart() {
    // The ref guard is what makes a double click send one request: the
    // disabled button follows a render later than the second click may arrive.
    if (startingRef.current || deckId === null || startDisabled) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    const res = await startQaRun(
      scope === 'cards' ? { deckId, scope, cardIds: [...selected] } : { deckId, scope },
    );
    if (res.success && res.data) {
      setRunsNonce(n => n + 1);
      showRun(res.data.runId);
    } else {
      const error = toLoadError(res.error, 'Failed to start AI QA.');
      setStartError(error);
      if (error.code === 'AI_QA_RUN_IN_PROGRESS') {
        const list = await listQaRuns({ deckId, limit: RUNS_PAGE_SIZE });
        if (list.success && list.data) {
          const page = list.data;
          setRunsState({ forDeckId: deckId, error: null, items: page.items, nextCursor: page.nextCursor });
          const active = page.items.find(isQaRunActive);
          if (active) showRun(active.runId);
        }
      }
    }
    startingRef.current = false;
    setStarting(false);
  }

  async function onLoadMore() {
    if (deckId === null || !runsState.nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await listQaRuns({ deckId, limit: RUNS_PAGE_SIZE, cursor: runsState.nextCursor });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setRunsState(prev => ({ ...prev, error: toLoadError(res.error, 'Failed to load more runs.') }));
      return;
    }
    const page = res.data;
    setRunsState(prev => ({ ...prev, error: null, items: [...prev.items, ...page.items], nextCursor: page.nextCursor }));
  }

  function refreshRunAndGate() {
    setDetailNonce(n => n + 1);
    setStatusNonce(n => n + 1);
  }

  async function onResolve(finding: QaFinding, resolution: 'fixed' | 'dismissed') {
    const id = finding.findingId;
    if (resolvingRef.current.has(id)) return;
    resolvingRef.current.add(id);
    setResolving(new Set(resolvingRef.current));
    setResolveMessage(null);
    const note = (notes[id] ?? '').trim();
    const res = await resolveQaFinding(id, note ? { resolution, note } : { resolution });
    resolvingRef.current.delete(id);
    setResolving(new Set(resolvingRef.current));
    if (res.success) {
      setNotes(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      refreshRunAndGate();
      return;
    }
    const code = res.error?.code ?? '';
    if (code === 'FINDING_ALREADY_RESOLVED') {
      setResolveMessage({ tone: 'status', text: 'This finding was already resolved elsewhere.' });
      refreshRunAndGate();
      return;
    }
    setResolveMessage({ tone: 'alert', text: res.error?.message ?? 'Failed to resolve the finding.' });
  }

  const qaHref = deckId === null ? '/decks/qa' : qaPageHref(deckId, runIdParam);

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Authoring · AI QA"
      {...consoleNav({ reviewHref: deckId === null ? '/review' : `/review?deckId=${deckId}`, qaHref })}
    >
      <div>
        <h1 className={H1_CLASS}>AI QA</h1>
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
        <Callout tone="warning" title="AI QA is not set up yet">
          <div data-testid="qa-not-ready">The server has not run the AI QA database migration.</div>
        </Callout>
      ) : null}

      {deckId === null ? (
        <section className={CARD_CLASS} aria-label="Decks">
          <p className="text-sm text-slate-700">Choose a deck to review with AI QA.</p>
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
                <Link to={qaPageHref(item.id)} className="text-sm text-indigo-600 hover:underline">
                  {item.title} <span className="font-mono text-xs text-slate-500">({item.slug})</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          {deckError ? (
            <Callout tone="danger" role="alert">
              {deckError.message}
            </Callout>
          ) : null}

          {/* ---------------- Publish gate ---------------- */}
          <section className={CARD_CLASS} aria-labelledby="qa-gate-heading">
            <h2 id="qa-gate-heading" className={H2_CLASS}>
              Publish gate
            </h2>
            <div data-testid="qa-gate-status" className="mt-2 space-y-2">
              {statusError && !isNotReady(statusError) ? (
                <Callout tone="danger" role="alert">
                  {statusError.message}
                </Callout>
              ) : null}
              {!status && !statusError ? <p className="text-sm text-slate-500">Loading the publish gate…</p> : null}
              {status ? (
                <>
                  {status.enabled ? (
                    <p className="text-sm text-slate-700">
                      {status.required
                        ? 'Publishing requires AI QA.'
                        : 'AI QA is advisory: publishing is not blocked by it.'}
                    </p>
                  ) : (
                    <Callout tone="info">
                      AI QA is switched off on the server. Runs cannot start until the owner enables it.
                    </Callout>
                  )}
                  <p className="text-sm text-slate-700">
                    {status.changedCards} changed card(s), {status.reviewedCurrent} reviewed at their current content.
                  </p>
                  {status.wouldBlock || status.missing.length > 0 || status.openBlockers.length > 0 ? (
                    <Callout
                      tone={status.wouldBlock ? 'danger' : 'warning'}
                      title={
                        status.wouldBlock
                          ? 'Publishing is blocked'
                          : status.openBlockers.length > 0
                            ? 'Open blockers (advisory — publishing is not blocked)'
                            : 'Not reviewed yet (advisory — publishing is not blocked)'
                      }
                    >
                      {status.missing.length > 0 ? (
                        <div>
                          <div className="font-medium">
                            Not reviewed at their current content ({qaCardsToReview(status)}):
                          </div>
                          <ul className="list-disc ml-5">
                            {status.missing.map(m => (
                              <li key={m.cardId} className="font-mono text-xs">
                                {m.stableUid}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {status.openBlockers.length > 0 ? (
                        <div className="mt-1">
                          <div className="font-medium">Open blockers ({status.openBlockers.length}):</div>
                          <ul className="list-disc ml-5">
                            {status.openBlockers.map(b => (
                              <li key={b.findingId}>
                                {b.stableUid}: {categoryLabel(b.category)} — {b.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </Callout>
                  ) : (
                    <Callout tone="success">Publishing is not blocked by AI QA.</Callout>
                  )}
                </>
              ) : null}
            </div>
          </section>

          {/* ---------------- Start a review ---------------- */}
          <section className={CARD_CLASS} aria-labelledby="qa-start-heading">
            <h2 id="qa-start-heading" className={H2_CLASS}>
              Start a review
            </h2>
            <div role="radiogroup" aria-label="Scope" className="mt-2 flex flex-wrap gap-4">
              {SCOPE_OPTIONS.map(option => (
                <label key={option.value} className="text-sm text-slate-700 inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name="qa-scope"
                    value={option.value}
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>

            {scope === 'cards' ? (
              <fieldset className="mt-2 max-h-64 overflow-y-auto border border-slate-200 rounded p-2">
                <legend className="text-xs text-slate-500 px-1">Cards to review</legend>
                {cardsState.forDeckId === deckId && cardsState.error ? (
                  <Callout tone="danger" role="alert">
                    {cardsState.error.message}
                  </Callout>
                ) : null}
                {cards.map(card => (
                  <label key={card.id} className="flex items-start gap-2 text-sm text-slate-700 py-0.5">
                    <input
                      type="checkbox"
                      checked={selected.has(card.id)}
                      onChange={() => toggleCard(card.id)}
                    />
                    <span>
                      <span className="font-mono text-xs">{card.stableUid}</span> {questionStart(card.question)}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}

            <p data-testid="qa-card-count" className="mt-2 text-sm text-slate-700">
              {cardCount} card(s) will be reviewed.
            </p>
            <p data-testid="qa-cost-estimate" className="text-sm text-slate-700">
              Estimated cost ≈ {formatUsd(estimate)} (estimate only; the provider bills separately).
            </p>

            {cardCount > limits.maxCards ? (
              <div className="mt-2">
                <Callout tone="warning">
                  One run reviews at most {limits.maxCards} cards. Narrow the scope.
                </Callout>
              </div>
            ) : null}
            {estimate > capRemaining ? (
              <div className="mt-2">
                <Callout tone="warning">
                  {limits.spentTodayUsd === null
                    ? `This estimate is above the daily AI QA cap of ${formatUsd(limits.dailyUsdCap)}.`
                    : `This estimate is above what is left of today's AI QA cap: ${formatUsd(capRemaining)} of ${formatUsd(limits.dailyUsdCap)}.`}
                </Callout>
              </div>
            ) : null}

            {startError && !isNotReady(startError) ? (
              <div className="mt-2">
                <Callout tone="danger" role="alert">
                  {qaStartErrorMessage(startError.code, startError.message, limits)}
                </Callout>
              </div>
            ) : null}

            <div className="mt-3">
              <Button variant="primary" size="xs" disabled={startDisabled} onClick={() => void onStart()}>
                Start AI QA
              </Button>
            </div>
          </section>

          {/* ---------------- Progress ---------------- */}
          <section className={CARD_CLASS} aria-labelledby="qa-progress-heading">
            <h2 id="qa-progress-heading" className={H2_CLASS}>
              Progress
            </h2>
            {shownRunId === null ? (
              <p className="mt-2 text-sm text-slate-500">
                {runsReady ? 'No AI QA run for this deck yet.' : 'Loading runs…'}
              </p>
            ) : null}
            {detailError && !isNotReady(detailError) && !pollStopped ? (
              <div className="mt-2">
                <Callout tone="danger" role="alert">
                  {detailError.message}
                </Callout>
              </div>
            ) : null}
            {pollStopped ? (
              <div data-testid="qa-poll-stopped" className="mt-2">
                <Callout tone="warning">
                  Progress is not refreshing.{' '}
                  <Button variant="outline" size="xs" onClick={() => setDetailNonce(n => n + 1)}>
                    Refresh progress
                  </Button>
                </Callout>
              </div>
            ) : null}
            {shownRun ? (
              <div data-testid="qa-run-progress" className="mt-2 space-y-2 text-sm text-slate-700">
                <div
                  role="progressbar"
                  aria-label="Cards reviewed"
                  aria-valuemin={0}
                  aria-valuenow={shownRun.cardsDone}
                  aria-valuemax={shownRun.cardCount}
                  className="h-2 w-full rounded bg-slate-200 overflow-hidden"
                >
                  <div
                    className="h-full bg-indigo-600"
                    style={{
                      width: `${shownRun.cardCount > 0 ? Math.min(100, (shownRun.cardsDone / shownRun.cardCount) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div>
                  Status: <span className="font-semibold">{shownRun.effectiveStatus}</span> · {shownRun.cardsDone}/
                  {shownRun.cardCount} cards
                </div>
                {shownRun.effectiveStatus === 'failed' && isQaRunActive({ effectiveStatus: shownRun.status }) ? (
                  <p>
                    This run stopped reporting and was marked failed.
                    {shownRun.errorCode ? ` (${shownRun.errorCode})` : null}
                  </p>
                ) : null}
                <div>
                  Blockers: {shownRun.blockerCount} · Majors: {shownRun.majorCount} · Minors: {shownRun.minorCount} ·
                  Errors: {shownRun.errorCount}
                </div>
                <div>
                  Tokens: {shownRun.inputTokens} in, {shownRun.outputTokens} out, {shownRun.cacheReadTokens} cache read ·
                  Cost {formatUsd(shownRun.estimatedCostUsd)}
                </div>
                {shownRun.provider || shownRun.model || shownRun.promptVersion ? (
                  <div className="text-xs text-slate-500">
                    {[shownRun.provider, shownRun.model, shownRun.promptVersion].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* ---------------- Findings ---------------- */}
          <section className={CARD_CLASS} aria-labelledby="qa-findings-heading">
            <h2 id="qa-findings-heading" className={H2_CLASS}>
              Findings
            </h2>
            {resolveMessage ? (
              <div role={resolveMessage.tone} className="mt-2 text-sm text-slate-800">
                {resolveMessage.text}
              </div>
            ) : null}
            {!detail ? <p className="mt-2 text-sm text-slate-500">No run to show.</p> : null}
            {detail && detail.findings.length === 0 && detail.run.effectiveStatus === 'done' ? (
              <p className="mt-2 text-sm text-slate-700">No findings: every reviewed card passed.</p>
            ) : null}
            <div className="mt-2 space-y-3">
              {groups.map(group => (
                <div key={group.cardId} data-testid={`qa-card-${group.cardId}`} className="border border-slate-200 rounded p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs text-slate-600">{group.stableUid}</div>
                      {group.question ? <div className="text-sm text-slate-900">{group.question}</div> : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={VERDICT_BADGES[group.verdict].tone}>{VERDICT_BADGES[group.verdict].label}</Badge>
                      <Link to={cardEditHref(deckId, group.cardId)} className="text-xs text-indigo-600 hover:underline">
                        Edit card
                      </Link>
                    </div>
                  </div>
                  {group.verdict === 'pending' ? (
                    <p className="mt-1 text-xs text-slate-600">Waiting for review.</p>
                  ) : null}
                  {group.itemStatus === 'error' || group.itemStatus === 'refused' || group.itemStatus === 'skipped' ? (
                    <p className="mt-1 text-xs text-amber-800">
                      {group.itemErrorCode ? qaItemErrorLabel(group.itemErrorCode) : `Review ${group.itemStatus}.`}
                    </p>
                  ) : null}
                  <ul className="mt-2 space-y-2">
                    {group.findings.map(finding => {
                      const busy = resolving.has(finding.findingId);
                      const noteId = `qa-note-${finding.findingId}`;
                      return (
                        <li key={finding.findingId} className="text-sm text-slate-800 border-t border-slate-100 pt-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={finding.severity === 'minor' ? 'warning' : 'danger'}>{finding.severity}</Badge>
                            <span className="font-medium">{categoryLabel(finding.category)}</span>
                            <span className="text-xs text-slate-500">Resolution: {finding.resolution}</span>
                          </div>
                          <p className="mt-1">{finding.message}</p>
                          {finding.suggestedFix ? (
                            <p className="mt-1 text-slate-600">Suggested fix: {finding.suggestedFix}</p>
                          ) : null}
                          {finding.resolution === 'open' ? (
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <div className="flex-1 min-w-[12rem]">
                                <label htmlFor={noteId} className="sr-only">
                                  Resolution note for finding {finding.findingId}
                                </label>
                                <input
                                  id={noteId}
                                  type="text"
                                  className={INPUT_CLASS}
                                  maxLength={NOTE_MAX}
                                  placeholder="Note (optional)"
                                  value={notes[finding.findingId] ?? ''}
                                  onChange={e =>
                                    setNotes(prev => ({ ...prev, [finding.findingId]: e.target.value.slice(0, NOTE_MAX) }))
                                  }
                                />
                              </div>
                              <Button
                                variant="outline"
                                size="xs"
                                aria-label={`Mark finding ${finding.findingId} fixed`}
                                disabled={busy}
                                onClick={() => void onResolve(finding, 'fixed')}
                              >
                                Mark fixed
                              </Button>
                              <Button
                                variant="outline"
                                size="xs"
                                aria-label={`Dismiss finding ${finding.findingId}`}
                                disabled={busy}
                                onClick={() => void onResolve(finding, 'dismissed')}
                              >
                                Dismiss
                              </Button>
                            </div>
                          ) : finding.resolutionNote ? (
                            <p className="mt-1 text-xs text-slate-500">Note: {finding.resolutionNote}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* ---------------- Past runs ---------------- */}
          <section className={CARD_CLASS} aria-labelledby="qa-runs-heading">
            <h2 id="qa-runs-heading" className={H2_CLASS}>
              Past runs
            </h2>
            {runsError && !isNotReady(runsError) ? (
              <div className="mt-2">
                <Callout tone="danger" role="alert">
                  {runsError.message}
                </Callout>
              </div>
            ) : null}
            {runsReady && runs.length === 0 && !runsError ? (
              <p className="mt-2 text-sm text-slate-500">No runs yet.</p>
            ) : null}
            {runs.length > 0 ? (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="py-1 pr-3">Created</th>
                      <th className="py-1 pr-3">Scope</th>
                      <th className="py-1 pr-3">Status</th>
                      <th className="py-1 pr-3">Cards</th>
                      <th className="py-1 pr-3">Blockers/Majors/Minors</th>
                      <th className="py-1 pr-3">Cost</th>
                      <th className="py-1">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(run => (
                      <tr key={run.runId} className={run.runId === shownRunId ? 'bg-indigo-50' : undefined}>
                        <td className="py-1 pr-3">{formatTime(run.createdAt)}</td>
                        <td className="py-1 pr-3">{run.scope}</td>
                        <td className="py-1 pr-3">{run.effectiveStatus}</td>
                        <td className="py-1 pr-3">
                          {run.cardsDone}/{run.cardCount}
                        </td>
                        <td className="py-1 pr-3">
                          {run.blockerCount}/{run.majorCount}/{run.minorCount}
                        </td>
                        <td className="py-1 pr-3">{formatUsd(run.estimatedCostUsd)}</td>
                        <td className="py-1">
                          <Button
                            variant="outline"
                            size="xs"
                            aria-label={`View run ${run.runId}`}
                            onClick={() => showRun(run.runId)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {runsState.nextCursor && runsReady ? (
              <div className="mt-2">
                <Button variant="outline" size="xs" disabled={loadingMore} onClick={() => void onLoadMore()}>
                  Load more
                </Button>
              </div>
            ) : null}
          </section>
        </>
      )}
    </ConsoleShell>
  );
}
