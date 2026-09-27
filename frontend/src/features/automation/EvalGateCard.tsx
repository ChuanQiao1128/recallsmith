// src/features/automation/EvalGateCard.tsx
//
// The eval gate for auto-decision precision (A00 §15.4): the current gate, its
// history and, for a super_admin, recording a pasted gate report and revoking
// the current gate. The report is sent as pasted; the server hashes the raw
// bytes and recomputes every number.
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
import { automationErrorMessage, evalGateReportProblem, formatTimestamp, orDash } from '../../lib/automationRules';

type GateLoad = { forKey: string | null; error: string | null; data: EvalGateState | null };

const REPORT_ID = 'automation-gate-report';
const REPORT_PROBLEM_ID = 'automation-gate-report-problem';

function refusalText(error: ApiError | null, fallback: string): string {
  const text = automationErrorMessage(error?.code, error?.message ?? fallback);
  return error?.details ? `${text} ${error.details}` : text;
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
    if (found) return;
    setBusy(true);
    const res = await recordEvalGate(reportText);
    setBusy(false);
    if (!res.success || !res.data) {
      setRefusal(refusalText(res.error, 'The eval gate could not be recorded.'));
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

  return (
    <section className={CARD_CLASS} aria-label="Eval gate">
      <h2 className={H2_CLASS}>Eval gate</h2>
      {gate.error ? (
        <Callout tone="danger" role="alert">
          {gate.error}
        </Callout>
      ) : null}
      {loading && !gate.data ? <p className="text-sm text-slate-600">Loading the eval gate…</p> : null}

      {gate.data && !current ? (
        <p className="text-sm text-slate-700 mt-2">No passed eval gate is recorded, so live mode runs as a dry run.</p>
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
                  <dt className="text-xs text-slate-500">{name}</dt>
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
              </tr>
            </thead>
            <tbody>
              {history.map(g => (
                <tr key={g.gateId} className="border-t border-slate-100">
                  <td className={TD_CLASS}>{g.gateId}</td>
                  <td className={TD_CLASS}>{reviewerText(g)}</td>
                  <td className={TD_CLASS}>{g.passed ? 'yes' : 'no'}</td>
                  <td className={`${TD_CLASS} font-mono`}>{g.reportSha256.slice(0, 12)}</td>
                  <td className={TD_CLASS}>{formatTimestamp(g.createdAt)}</td>
                  <td className={TD_CLASS}>
                    {g.revokedAt ? <Badge tone="neutral">{formatTimestamp(g.revokedAt)}</Badge> : '—'}
                  </td>
                </tr>
              ))}
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
          <Button size="xs" disabled={busy} onClick={() => void onRecord()}>
            Record eval gate
          </Button>
        </div>
      ) : null}
    </section>
  );
}
