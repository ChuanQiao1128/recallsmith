// src/features/automation/RunsTab.tsx
//
// The Runs tab (A00 §16.1): one row per claimed queue item, with its decision
// counts and publish outcomes. A run's Decisions opens `?tab=runs&runId=`, the
// deep link of the batch-summary email and webhook, and lists that run's
// decisions below the table; opened from the table, that section's heading
// takes focus and scrolls into view (B07 frontend-console-4).
//
// Each run shows the agent's notes (K3 `summary`): the runner's final-message
// notes, the channel the agent uses to report an existing card that looks
// wrong. They render as plain text, never as markup.
//
// A failed run shows its error under the Outcome (D07 frontend-console-24),
// clipped in the table and in full in the run's Decisions section, where the
// runner_run_failed email's `?runId=` deep link lands. A run's decisions page
// with Load more like the Decisions tab (frontend-console-28).
//
// A run's split by state tells its drafts' verdicts by elimination, so while
// the effective mode is not live the table shows only the submitted total
// until none of the run's drafts can be pending (E05 frontend-console-30, N5;
// runSplitShown). The Publishes cell is under the same guard (O2, F04
// frontend-console-35): a run has a publish row only when a draft would be
// accepted, so the batch email hides the outcome too. The run's decision rows
// hide their verdicts like the Decisions tab.
import { useEffect, useRef, useState } from 'react';

import {
  listAutomationDecisions,
  listAutomationRuns,
  type AutomationDecision,
  type AutomationRun,
} from '../../api/automation';
import { CARD_CLASS, H2_CLASS, INPUT_CLASS, LABEL_CLASS, TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import {
  QUEUE_ITEM_KIND_LABELS,
  RUN_OUTCOME_LABELS,
  RUN_PUBLISH_HIDDEN_TEXT,
  RUN_SPLIT_HIDDEN_TEXT,
  RUN_STATUSES,
  RUN_STATUS_LABELS,
  automationErrorMessage,
  codeLabel,
  formatTimestamp,
  orDash,
  publishReasonLabel,
  publishStateLabel,
  runSplitShown,
  shortId,
  urlLabel,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';
import { DecisionTable } from './DecisionTable';

const PAGE_SIZE = 50;
/** The run error shown in a table cell; the run's Decisions section shows it in full. */
const RUN_ERROR_CELL_MAX = 200;

function clipError(text: string): string {
  return text.length > RUN_ERROR_CELL_MAX ? `${text.slice(0, RUN_ERROR_CELL_MAX - 1)}…` : text;
}
const STATUS_ID = 'automation-runs-status';

type ListState<T> = { forKey: string | null; error: string | null; items: T[]; nextCursor: string | null };

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

export function RunsTab({
  runId,
  effectiveMode,
  focusOnOpen,
  onOpenRun,
  onOpenDecision,
}: {
  runId: string | null;
  /** The status's effective mode; null while the status is not loaded, which counts as not live. */
  effectiveMode: string | null;
  focusOnOpen: boolean;
  onOpenRun: (runId: string) => void;
  onOpenDecision: (draftId: number) => void;
}) {
  const [status, setStatus] = useState('');
  const [nonce, setNonce] = useState(0);
  const [runs, setRuns] = useState<ListState<AutomationRun>>({ forKey: null, error: null, items: [], nextCursor: null });
  const [decisions, setDecisions] = useState<ListState<AutomationDecision>>({
    forKey: null,
    error: null,
    items: [],
    nextCursor: null,
  });
  // The list key a Load more is running for; another key's Load more is not busy.
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<{ forKey: string; text: string } | null>(null);
  const [decisionsMoreKey, setDecisionsMoreKey] = useState<string | null>(null);
  const [decisionsMoreError, setDecisionsMoreError] = useState<{ forKey: string; text: string } | null>(null);
  const decisionsHeadingRef = useRef<HTMLHeadingElement>(null);

  const runsKey = `${status}|${nonce}`;
  const decisionsKey = `${runId ?? ''}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const forKey = `${status}|${nonce}`;
    async function run() {
      const res = await listAutomationRuns({ status: status || undefined, limit: PAGE_SIZE });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setRuns({ forKey, error: errorText(res.error, 'Failed to load the runs.'), items: [], nextCursor: null });
        return;
      }
      setRuns({ forKey, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [status, nonce]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const forKey = `${runId}|${nonce}`;
    async function run() {
      const res = await listAutomationDecisions({ runId: runId ?? undefined, limit: PAGE_SIZE });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setDecisions({
          forKey,
          error: errorText(res.error, "Failed to load the run's decisions."),
          items: [],
          nextCursor: null,
        });
        return;
      }
      setDecisions({ forKey, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [runId, nonce]);

  useEffect(() => {
    if (!runId || !focusOnOpen) return;
    const heading = decisionsHeadingRef.current;
    if (!heading) return;
    heading.focus();
    heading.scrollIntoView?.({ block: 'start' });
  }, [runId, focusOnOpen]);

  const loading = runs.forKey !== runsKey;

  async function onLoadMore() {
    // The cursor belongs to the list on screen; while a new filter loads it is foreign.
    if (!runs.nextCursor || loading) return;
    const startKey = runsKey;
    setLoadingMoreKey(startKey);
    setMoreError(null);
    const res = await listAutomationRuns({ status: status || undefined, limit: PAGE_SIZE, cursor: runs.nextCursor });
    setLoadingMoreKey(k => (k === startKey ? null : k));
    if (!res.success || !res.data) {
      setMoreError({ forKey: startKey, text: errorText(res.error, 'Failed to load more runs.') });
      return;
    }
    const page = res.data;
    // Appended only to the list it was asked for: a filter changed meanwhile drops it.
    setRuns(prev =>
      prev.forKey === startKey ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev,
    );
  }

  const decisionsLoading = decisions.forKey !== decisionsKey;

  async function onLoadMoreDecisions() {
    if (!runId || !decisions.nextCursor || decisionsLoading) return;
    const startKey = decisionsKey;
    setDecisionsMoreKey(startKey);
    setDecisionsMoreError(null);
    const res = await listAutomationDecisions({ runId, limit: PAGE_SIZE, cursor: decisions.nextCursor });
    setDecisionsMoreKey(k => (k === startKey ? null : k));
    if (!res.success || !res.data) {
      setDecisionsMoreError({ forKey: startKey, text: errorText(res.error, "Failed to load more of the run's decisions.") });
      return;
    }
    const page = res.data;
    // Appended only to the run it was asked for: opening another run meanwhile drops it.
    setDecisions(prev =>
      prev.forKey === startKey ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev,
    );
  }

  const openRun = runId ? (runs.items.find(r => r.runId === runId) ?? null) : null;
  // The open run's decisions, when every one of them is loaded, settle whether its split may show.
  const openRunDecisions =
    runId && !decisionsLoading && !decisions.error
      ? { items: decisions.items, complete: decisions.nextCursor === null }
      : null;

  return (
    <div className="space-y-4">
      <section className={CARD_CLASS} aria-label="Runs">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className={H2_CLASS}>Runs</h2>
          <div>
            <label htmlFor={STATUS_ID} className={LABEL_CLASS}>
              Status
            </label>
            <select id={STATUS_ID} className={INPUT_CLASS} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option>
              {RUN_STATUSES.map(s => (
                <option key={s} value={s}>
                  {codeLabel(RUN_STATUS_LABELS, s)}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" size="xs" loading={loading} onClick={() => setNonce(n => n + 1)}>
            Refresh
          </Button>
        </div>

        {runs.error ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {runs.error}
            </Callout>
          </div>
        ) : null}

        {!runs.error && !loading && runs.items.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">No run yet.</p>
        ) : null}

        {runs.items.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH_CLASS}>Run</th>
                  <th className={TH_CLASS}>Kind</th>
                  <th className={TH_CLASS}>URL</th>
                  <th className={TH_CLASS}>Deck</th>
                  <th className={TH_CLASS}>Runner</th>
                  <th className={TH_CLASS}>Status</th>
                  <th className={TH_CLASS}>Outcome</th>
                  <th className={TH_CLASS}>Started</th>
                  <th className={TH_CLASS}>Submitted / auto-accepted / would accept / need you / superseded</th>
                  <th className={TH_CLASS}>In QA</th>
                  <th className={TH_CLASS}>Publishes</th>
                  <th className={TH_CLASS}>Agent notes</th>
                  <th className={TH_CLASS}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.items.map(r => {
                  const splitShown = runSplitShown(r.counts, effectiveMode, r.runId === runId ? openRunDecisions : null);
                  return (
                    <tr
                      key={r.runId}
                      className={`border-t border-slate-100 align-top${r.runId === runId ? ' bg-indigo-50' : ''}`}
                      aria-current={r.runId === runId ? 'true' : undefined}
                    >
                      <td className={`${TD_CLASS} font-mono`}>{shortId(r.runId)}</td>
                      <td className={TD_CLASS}>{codeLabel(QUEUE_ITEM_KIND_LABELS, r.kind)}</td>
                      <td className={TD_CLASS}>
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                          {urlLabel(r.url)}
                        </a>
                      </td>
                      <td className={TD_CLASS}>{orDash(r.deckSlug)}</td>
                      <td className={TD_CLASS}>{r.runnerId}</td>
                      <td className={TD_CLASS}>{codeLabel(RUN_STATUS_LABELS, r.status)}</td>
                      <td className={TD_CLASS}>
                        {codeLabel(RUN_OUTCOME_LABELS, r.outcome)}
                        {r.error ? (
                          <div
                            className="max-w-xs text-xs text-slate-600 break-words"
                            data-testid={`automation-run-error-${r.runId}`}
                          >
                            {clipError(r.error)}
                          </div>
                        ) : null}
                      </td>
                      <td className={TD_CLASS}>{formatTimestamp(r.startedAt)}</td>
                      {splitShown ? (
                        <>
                          <td className={TD_CLASS} data-testid={`automation-run-counts-${r.runId}`}>
                            {`${r.counts.submitted} / ${r.counts.autoAccepted} / ${r.counts.wouldAccept} / ${r.counts.human} / ${r.counts.superseded}`}
                          </td>
                          <td className={TD_CLASS}>{r.counts.qaPending + r.counts.qaQueued}</td>
                        </>
                      ) : (
                        <>
                          <td className={TD_CLASS} data-testid={`automation-run-counts-${r.runId}`}>
                            {`${r.counts.submitted} submitted`}
                            <div className="text-xs text-slate-500">{RUN_SPLIT_HIDDEN_TEXT}</div>
                          </td>
                          <td className={TD_CLASS}>—</td>
                        </>
                      )}
                      <td className={TD_CLASS} data-testid={`automation-run-publishes-${r.runId}`}>
                        {!splitShown ? (
                          <span className="text-xs text-slate-500">{RUN_PUBLISH_HIDDEN_TEXT}</span>
                        ) : r.publishes.length === 0 ? (
                          '—'
                        ) : (
                          <ul className="space-y-0.5">
                            {r.publishes.map(p => (
                              <li key={p.publishId}>
                                {`${orDash(p.deckSlug)}: ${publishStateLabel(p.state)}`}
                                {p.reason ? ` — ${publishReasonLabel(p.reason)}` : ''}
                                {p.buildId ? ` (build ${p.buildId})` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className={TD_CLASS}>
                        {r.summary ? (
                          <p
                            className="max-w-md whitespace-pre-wrap break-words text-xs text-slate-800"
                            data-testid={`automation-run-notes-${r.runId}`}
                          >
                            {r.summary}
                          </p>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={TD_CLASS}>
                        <Button
                          variant="outline"
                          size="xs"
                          aria-label={`Decisions of run ${shortId(r.runId)}`}
                          onClick={() => onOpenRun(r.runId)}
                        >
                          Decisions
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {moreError && moreError.forKey === runsKey ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {moreError.text}
            </Callout>
          </div>
        ) : null}
        {runs.nextCursor && !loading ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMoreKey === runsKey} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      {runId ? (
        <section className={CARD_CLASS} aria-label="Run decisions">
          <h2 ref={decisionsHeadingRef} tabIndex={-1} className={`${H2_CLASS} focus:outline-none`}>
            Decisions of run <span className="font-mono">{shortId(runId)}</span>
          </h2>
          {openRun?.error ? (
            <div className="mt-2" data-testid="automation-run-error-full">
              <Callout tone="danger" title="Why this run failed">
                <span className="whitespace-pre-wrap break-words">{openRun.error}</span>
              </Callout>
            </div>
          ) : null}
          <div className="mt-2">
            {decisions.error ? (
              <Callout tone="danger" role="alert">
                {decisions.error}
              </Callout>
            ) : decisionsLoading ? (
              <p className="text-sm text-slate-600">Loading the decisions…</p>
            ) : (
              <DecisionTable items={decisions.items} onOpenDecision={onOpenDecision} />
            )}
          </div>
          {decisionsMoreError && decisionsMoreError.forKey === decisionsKey ? (
            <div className="mt-2">
              <Callout tone="danger" role="alert">
                {decisionsMoreError.text}
              </Callout>
            </div>
          ) : null}
          {decisions.nextCursor && !decisionsLoading && !decisions.error ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-600">{`${decisions.items.length} shown; this run has more.`}</span>
              <Button
                variant="outline"
                size="xs"
                loading={decisionsMoreKey === decisionsKey}
                onClick={() => void onLoadMoreDecisions()}
              >
                Load more decisions
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
