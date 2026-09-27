// src/features/automation/RunsTab.tsx
//
// The Runs tab (A00 §16.1): one row per claimed queue item, with its decision
// counts and publish outcomes. A run's Decisions opens `?tab=runs&runId=`, the
// deep link of the batch-summary email and webhook, and lists that run's
// decisions below the table.
import { useEffect, useState } from 'react';

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
  RUN_STATUSES,
  automationErrorMessage,
  formatTimestamp,
  orDash,
  publishReasonLabel,
  publishStateLabel,
  shortId,
  urlLabel,
} from '../../lib/automationRules';
import type { ApiError } from '../../types/api';
import { DecisionTable } from './DecisionTable';

const PAGE_SIZE = 50;
const STATUS_ID = 'automation-runs-status';

type ListState<T> = { forKey: string | null; error: string | null; items: T[]; nextCursor: string | null };

function errorText(error: ApiError | null, fallback: string): string {
  return automationErrorMessage(error?.code, error?.message ?? fallback);
}

export function RunsTab({
  runId,
  onOpenRun,
  onOpenDecision,
}: {
  runId: string | null;
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

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

  async function onLoadMore() {
    if (!runs.nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    const res = await listAutomationRuns({ status: status || undefined, limit: PAGE_SIZE, cursor: runs.nextCursor });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setMoreError(errorText(res.error, 'Failed to load more runs.'));
      return;
    }
    const page = res.data;
    setRuns(prev => ({ ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor }));
  }

  const loading = runs.forKey !== runsKey;
  const decisionsLoading = decisions.forKey !== decisionsKey;

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
                  {s}
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
                  <th className={TH_CLASS}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.items.map(r => (
                  <tr
                    key={r.runId}
                    className={`border-t border-slate-100 align-top${r.runId === runId ? ' bg-indigo-50' : ''}`}
                    aria-current={r.runId === runId ? 'true' : undefined}
                  >
                    <td className={`${TD_CLASS} font-mono`}>{shortId(r.runId)}</td>
                    <td className={TD_CLASS}>{r.kind}</td>
                    <td className={TD_CLASS}>
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
                        {urlLabel(r.url)}
                      </a>
                    </td>
                    <td className={TD_CLASS}>{orDash(r.deckSlug)}</td>
                    <td className={TD_CLASS}>{r.runnerId}</td>
                    <td className={TD_CLASS}>{r.status}</td>
                    <td className={TD_CLASS}>{orDash(r.outcome)}</td>
                    <td className={TD_CLASS}>{formatTimestamp(r.startedAt)}</td>
                    <td className={TD_CLASS}>
                      {`${r.counts.submitted} / ${r.counts.autoAccepted} / ${r.counts.wouldAccept} / ${r.counts.human} / ${r.counts.superseded}`}
                    </td>
                    <td className={TD_CLASS}>{r.counts.qaPending + r.counts.qaQueued}</td>
                    <td className={TD_CLASS}>
                      {r.publishes.length === 0 ? (
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
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {moreError ? (
          <div className="mt-2">
            <Callout tone="danger" role="alert">
              {moreError}
            </Callout>
          </div>
        ) : null}
        {runs.nextCursor ? (
          <div className="mt-2">
            <Button variant="outline" size="xs" loading={loadingMore} onClick={() => void onLoadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </section>

      {runId ? (
        <section className={CARD_CLASS} aria-label="Run decisions">
          <h2 className={H2_CLASS}>
            Decisions of run <span className="font-mono">{shortId(runId)}</span>
          </h2>
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
        </section>
      ) : null}
    </div>
  );
}
