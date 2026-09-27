// src/features/automation/EvalGateCard.tsx
//
// The eval gate for auto-decision precision (A00 §15.4): the current gate, its
// history and, for a super_admin, recording a pasted gate report and revoking
// the current gate. The report is sent as pasted; the server hashes the raw
// bytes and recomputes every number.
//
// K2 and L3: only the newest evaluation counts. A newest row that failed or was
// revoked blocks live, whatever an older row says, so the card names that row,
// and each history row says whether it is effective, blocking, revoked or
// superseded (C07 frontend-console-17). Metric keys read as words (-11).
//
// M4 (D07 frontend-console-23): a failed report is recorded too, after a
// confirm that says it blocks live. The server stores it even when it answers
// 400 EVAL_GATE_FAILED, so that answer reloads the gate and the status exactly
// like a success and names the gate it became.
//
// N1 (E05 frontend-console-31): the current gate always shows its author
// configuration id in full, the one the runbook's go-live check compares with
// the id the runner uses now, or says that none is recorded.
import { useEffect, useState } from 'react';

import { fetchEvalGate, recordEvalGate, revokeEvalGate, type EvalGate, type EvalGateState } from '../../api/automation';
import {
  CARD_CLASS,
  FIELD_ERROR_CLASS,
  H2_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  TD_CLASS,
  TH_CLASS,
} from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { useConfirm } from '../../components/ui/ConfirmDialogContext';
import type { ApiError } from '../../types/api';
import {
  EVAL_METRIC_LABELS,
  automationErrorMessage,
  codeLabel,
  EVAL_GATE_FAILED_CONFIRM,
  evalGateRecordErrorMessage,
  evalGateRecordedFailedText,
  evalGateReportFailed,
  evalGateReportProblem,
  evalGateRowStatus,
  evalGateSummary,
  evalGateSummaryText,
  formatTimestamp,
  newestGateId,
  orDash,
} from '../../lib/automationRules';

type GateLoad = { forKey: string | null; error: string | null; data: EvalGateState | null };

const REPORT_ID = 'automation-gate-report';
const REPORT_PROBLEM_ID = 'automation-gate-report-problem';

function refusalText(
  error: ApiError | null,
  fallback: string,
  map: (code: string | undefined, message: string) => string = automationErrorMessage,
): string {
  const text = map(error?.code, error?.message ?? fallback);
  return error?.details ? `${text} ${error.details}` : text;
}

function serverWords(error: ApiError | null): string {
  return [error?.message, error?.details].filter(Boolean).join(' ');
}

function metricText(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return null;
}

function reviewerText(gate: EvalGate): string {
  return `${gate.reviewer.provider} · ${gate.reviewer.model} · ${gate.reviewer.promptVersion}`;
}

export function EvalGateCard({
  superAdmin,
  reloadKey,
  announce,
  onChanged,
}: {
  superAdmin: boolean;
  reloadKey: number;
  announce: (text: string) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [nonce, setNonce] = useState(0);
  const [gate, setGate] = useState<GateLoad>({ forKey: null, error: null, data: null });
  const [reportText, setReportText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when the server recorded a failed report (400 EVAL_GATE_FAILED): its words, shown with the new gate's id.
  const [recordedFailed, setRecordedFailed] = useState<string | null>(null);

  const key = `${reloadKey}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    const forKey = `${reloadKey}|${nonce}`;
    async function run() {
      const res = await fetchEvalGate();
      if (cancelled) return;
      if (!res.success || !res.data) {
        setGate({
          forKey,
          error: automationErrorMessage(res.error?.code, res.error?.message ?? 'Failed to load the eval gate.'),
          data: null,
        });
        return;
      }
      setGate({ forKey, error: null, data: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, nonce]);

  async function onRecord() {
    const found = evalGateReportProblem(reportText);
    setProblem(found);
    setRefusal(null);
    setRecordedFailed(null);
    if (found) return;
    if (evalGateReportFailed(reportText)) {
      const yes = await confirm({
        title: 'Record a failed report?',
        body: EVAL_GATE_FAILED_CONFIRM,
        destructive: true,
        confirmLabel: 'Record the failed report',
      });
      if (!yes) return;
    }
    setBusy(true);
    const res = await recordEvalGate(reportText);
    setBusy(false);
    if (!res.success && res.error?.code === 'EVAL_GATE_FAILED') {
      // L3: the row is inserted before the 400, so the newest evaluation now blocks live.
      setReportText('');
      setRecordedFailed(serverWords(res.error));
      setNonce(n => n + 1);
      onChanged();
      return;
    }
    if (!res.success || !res.data) {
      setRefusal(refusalText(res.error, 'The eval gate could not be recorded.', evalGateRecordErrorMessage));
      return;
    }
    setReportText('');
    announce(`Eval gate ${res.data.gateId} recorded.`);
    setNonce(n => n + 1);
    onChanged();
  }

  async function onRevoke(gateId: number) {
    const yes = await confirm({
      title: 'Revoke this eval gate?',
      body: 'Live mode falls back to dry run on the next request.',
      destructive: true,
      confirmLabel: 'Revoke this gate',
    });
    if (!yes) return;
    setRefusal(null);
    setRecordedFailed(null);
    setBusy(true);
    const res = await revokeEvalGate(gateId);
    setBusy(false);
    if (!res.success) {
      setRefusal(refusalText(res.error, 'The eval gate could not be revoked.'));
      return;
    }
    announce(`Eval gate ${gateId} revoked.`);
    setNonce(n => n + 1);
    onChanged();
  }

  const current = gate.data?.current ?? null;
  const history = (gate.data?.history ?? []).slice(0, 20);
  const loading = gate.forKey !== key;
  const summary = gate.data ? evalGateSummary(gate.data) : null;

  return (
    <section className={CARD_CLASS} aria-label="Eval gate">
      <h2 className={H2_CLASS}>Eval gate</h2>
      <p className="text-xs text-slate-600 mt-1">
        Only the newest evaluation counts: if it failed or is revoked, live mode runs as a dry run, and revoking the
        effective gate stops live at once.
      </p>
      {gate.error ? (
        <Callout tone="danger" role="alert">
          {gate.error}
        </Callout>
      ) : null}
      {loading && !gate.data ? <p className="text-sm text-slate-600">Loading the eval gate…</p> : null}

      {summary && summary.kind === 'failed' ? (
        <div className="mt-2" data-testid="automation-gate-summary">
          <Callout tone="warning">{evalGateSummaryText(summary)}</Callout>
        </div>
      ) : summary && summary.kind !== 'effective' ? (
        <p className="text-sm text-slate-700 mt-2" data-testid="automation-gate-summary">
          {evalGateSummaryText(summary)}
        </p>
      ) : null}

      {current ? (
        <div className="mt-2 space-y-2 text-sm text-slate-700" data-testid="automation-gate-current">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <dt className="text-xs text-slate-500">Reviewer</dt>
              <dd>{reviewerText(current)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Report SHA-256</dt>
              <dd className="font-mono">{current.reportSha256.slice(0, 12)}</dd>
            </div>
            {/* N1: always shown, so a gate without a recorded author reads as such instead of the row missing. */}
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Author configuration</dt>
              <dd className="font-mono break-all" data-testid="automation-gate-author">
                {current.authorConfigId ?? 'Not recorded (a gate recorded before migration 036, or an older server)'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Recorded</dt>
              <dd>
                {formatTimestamp(current.createdAt)} by {orDash(current.createdBySub)}
              </dd>
            </div>
            {Object.entries(current.metrics).map(([name, value]) => {
              const text = metricText(value);
              return text === null ? null : (
                <div key={name}>
                  <dt className="text-xs text-slate-500">{codeLabel(EVAL_METRIC_LABELS, name)}</dt>
                  <dd>{text}</dd>
                </div>
              );
            })}
          </dl>
          {superAdmin ? (
            <Button variant="danger" size="xs" disabled={busy} onClick={() => void onRevoke(current.gateId)}>
              Revoke gate
            </Button>
          ) : null}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="text-left text-xs text-slate-500 mb-1">Gate history (latest 20)</caption>
            <thead className="bg-slate-50">
              <tr>
                <th className={TH_CLASS}>Gate</th>
                <th className={TH_CLASS}>Reviewer</th>
                <th className={TH_CLASS}>Passed</th>
                <th className={TH_CLASS}>Report</th>
                <th className={TH_CLASS}>Recorded</th>
                <th className={TH_CLASS}>Revoked</th>
                <th className={TH_CLASS}>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map(g => {
                const standing = evalGateRowStatus(g, gate.data?.history ?? [], current?.gateId ?? null);
                return (
                  <tr key={g.gateId} className="border-t border-slate-100">
                    <td className={TD_CLASS}>{g.gateId}</td>
                    <td className={TD_CLASS}>{reviewerText(g)}</td>
                    <td className={TD_CLASS}>{g.passed ? 'yes' : 'no'}</td>
                    <td className={`${TD_CLASS} font-mono`}>{g.reportSha256.slice(0, 12)}</td>
                    <td className={TD_CLASS}>{formatTimestamp(g.createdAt)}</td>
                    <td className={TD_CLASS}>
                      {g.revokedAt ? <Badge tone="neutral">{formatTimestamp(g.revokedAt)}</Badge> : '—'}
                    </td>
                    <td className={TD_CLASS}>
                      <Badge tone={standing.tone}>{standing.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {superAdmin ? (
        <div className="mt-4 space-y-2">
          <label htmlFor={REPORT_ID} className={LABEL_CLASS}>
            Gate report JSON
          </label>
          <textarea
            id={REPORT_ID}
            className={`${INPUT_CLASS} font-mono`}
            rows={6}
            value={reportText}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? REPORT_PROBLEM_ID : undefined}
            onChange={e => setReportText(e.target.value)}
          />
          {problem ? (
            <p id={REPORT_PROBLEM_ID} className={FIELD_ERROR_CLASS} role="alert">
              {problem}
            </p>
          ) : null}
          {refusal ? (
            <Callout tone="danger" role="alert">
              {refusal}
            </Callout>
          ) : null}
          <div role="status" data-testid="automation-gate-recorded-failed">
            {recordedFailed !== null && !loading ? (
              <Callout tone="warning">
                {evalGateRecordedFailedText(newestGateId(gate.data?.history ?? []))}
                {recordedFailed ? ` ${recordedFailed}` : ''}
              </Callout>
            ) : null}
          </div>
          <Button size="xs" disabled={busy} onClick={() => void onRecord()}>
            Record eval gate
          </Button>
        </div>
      ) : null}
    </section>
  );
}
