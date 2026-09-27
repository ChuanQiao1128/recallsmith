// src/features/automation/OverviewTab.tsx
//
// The Overview tab (A00 §16.1): the eval gate, the runners and the status
// counters of GET …/automation/status (§16.2). Everything here comes from that
// response and from the eval gate; the ledger holds the time-saved numbers.
import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { AutomationStatus } from '../../api/automation';
import { CARD_CLASS, H2_CLASS, TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  DECISION_REASONS,
  PUBLISH_STATES,
  decisionReasonLabel,
  decisionStateBars,
  formatAge,
  formatTimestamp,
  loginExpiryWarning,
  orDash,
  publishStateLabel,
  shadowAgreementText,
} from '../../lib/automationRules';
import { formatUsd } from '../../lib/qaReview';
import { EvalGateCard } from './EvalGateCard';

// Chart geometry, in CSS pixels.
const LABEL_WIDTH = 150;
const BAR_MAX = 220;
const ROW_HEIGHT = 22;
const BAR_HEIGHT = 14;
const COUNT_GAP = 6;
const CHART_WIDTH = LABEL_WIDTH + BAR_MAX + 60;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/** Reasons in contract order first, then any code the server added. */
function reasonRows(byReason: Record<string, number>): Array<[string, number]> {
  const known = DECISION_REASONS.filter(r => (byReason[r] ?? 0) > 0).map(r => [r, byReason[r]] as [string, number]);
  const extra = Object.entries(byReason).filter(
    ([r, n]) => n > 0 && !(DECISION_REASONS as readonly string[]).includes(r),
  );
  return [...known, ...extra];
}

export function OverviewTab({
  status,
  statusLoading,
  superAdmin,
  announce,
  onReload,
}: {
  status: AutomationStatus | null;
  statusLoading: boolean;
  superAdmin: boolean;
  announce: (text: string) => void;
  onReload: () => void;
}) {
  const [gateReload, setGateReload] = useState(0);

  function refresh() {
    setGateReload(n => n + 1);
    onReload();
  }

  const serverNow = status ? Date.parse(status.serverTime) : NaN;
  const age = (iso: string | null) => (Number.isFinite(serverNow) ? formatAge(iso, serverNow) : formatTimestamp(iso));
  const bars = status ? decisionStateBars(status.decisions24h.byState, BAR_MAX) : [];
  const reasons = status ? reasonRows(status.decisions24h.byReason) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="xs" loading={statusLoading} onClick={refresh}>
          Refresh
        </Button>
        <Link to="/ledger" className="text-sm text-indigo-700 underline">
          Time saved: the Automation ledger
        </Link>
      </div>

      <EvalGateCard superAdmin={superAdmin} reloadKey={gateReload} announce={announce} onChanged={onReload} />

      {status ? (
        <>
          <section className={CARD_CLASS} aria-label="Runners">
            <h2 className={H2_CLASS}>Runners</h2>
            {status.runners.length === 0 ? (
              <p className="text-sm text-slate-600 mt-2">No runner has sent a heartbeat yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={TH_CLASS}>Runner</th>
                      <th className={TH_CLASS}>Host</th>
                      <th className={TH_CLASS}>State</th>
                      <th className={TH_CLASS}>Heartbeat</th>
                      <th className={TH_CLASS}>Login expires in</th>
                      <th className={TH_CLASS}>Last run</th>
                      <th className={TH_CLASS}>Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.runners.map(r => (
                      <tr key={r.runnerId} className="border-t border-slate-100">
                        <td className={`${TD_CLASS} font-mono`}>{r.runnerId}</td>
                        <td className={TD_CLASS}>{orDash(r.host)}</td>
                        <td className={TD_CLASS}>{r.state}</td>
                        <td className={TD_CLASS}>
                          {age(r.lastHeartbeatAt)} {r.stale ? <Badge tone="danger">Stale</Badge> : null}
                        </td>
                        <td className={TD_CLASS}>
                          {r.loginExpiresInDays === null ? (
                            '—'
                          ) : loginExpiryWarning(r.loginExpiresInDays) ? (
                            <Badge tone="danger">{`${r.loginExpiresInDays.toFixed(1)} d`}</Badge>
                          ) : (
                            `${r.loginExpiresInDays.toFixed(1)} d`
                          )}
                        </td>
                        <td className={TD_CLASS}>{orDash(r.lastRunOutcome)}</td>
                        <td className={TD_CLASS}>{orDash(r.lastError)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className={CARD_CLASS} aria-label="Queue">
              <h2 className={H2_CLASS}>Queue</h2>
              <dl className="mt-2 grid grid-cols-3 gap-3">
                <Stat label="Queued" value={String(status.queue.queued)} />
                <Stat label="Due" value={String(status.queue.due)} />
                <Stat label="Claimed" value={String(status.queue.claimed)} />
                <Stat label="Failed" value={String(status.queue.failed)} />
                <Stat label="Done (7 days)" value={String(status.queue.doneLast7d)} />
              </dl>
            </section>

            <section className={CARD_CLASS} aria-label="Spend">
              <h2 className={H2_CLASS}>AI QA spend today</h2>
              <dl className="mt-2 grid grid-cols-2 gap-3">
                <Stat label="Total today" value={formatUsd(status.spend.todayUsd)} />
                <Stat label="Automation share" value={formatUsd(status.spend.automationTodayUsd)} />
                <Stat label="Reserved" value={formatUsd(status.spend.reservedUsd)} />
                <Stat label="Daily cap" value={formatUsd(status.spend.dailyCapUsd)} />
              </dl>
            </section>
          </div>

          <section className={CARD_CLASS} aria-label="Decisions in the last 24 hours">
            <h2 className={H2_CLASS}>Decisions (24 h)</h2>
            <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <table className="min-w-full text-sm">
                  <caption className="text-left text-xs text-slate-500 mb-1">By state</caption>
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={TH_CLASS}>State</th>
                      <th className={TH_CLASS}>Decisions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bars.map(b => (
                      <tr key={b.state} className="border-t border-slate-100">
                        <td className={TD_CLASS}>{b.label}</td>
                        <td className={TD_CLASS}>{b.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <svg
                  role="img"
                  aria-label="Decisions in the last 24 hours by state"
                  width={CHART_WIDTH}
                  height={bars.length * ROW_HEIGHT}
                  className="max-w-full"
                >
                  {bars.map((b, i) => (
                    <g key={b.state} transform={`translate(0 ${i * ROW_HEIGHT})`}>
                      <text x={0} y={BAR_HEIGHT - 2} fontSize={11} fill="#475569">
                        {b.label}
                      </text>
                      <rect x={LABEL_WIDTH} y={2} width={b.width} height={BAR_HEIGHT} fill="#6366f1" rx={2} />
                      <text x={LABEL_WIDTH + b.width + COUNT_GAP} y={BAR_HEIGHT - 2} fontSize={11} fill="#0f172a">
                        {b.count}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
              <table className="min-w-full text-sm self-start">
                <caption className="text-left text-xs text-slate-500 mb-1">By reason</caption>
                <thead className="bg-slate-50">
                  <tr>
                    <th className={TH_CLASS}>Reason</th>
                    <th className={TH_CLASS}>Decisions</th>
                  </tr>
                </thead>
                <tbody>
                  {reasons.length === 0 ? (
                    <tr className="border-t border-slate-100">
                      <td className={TD_CLASS} colSpan={2}>
                        No decision with a reason in the last 24 hours.
                      </td>
                    </tr>
                  ) : (
                    reasons.map(([reason, count]) => (
                      <tr key={reason} className="border-t border-slate-100">
                        <td className={TD_CLASS}>{decisionReasonLabel(reason)}</td>
                        <td className={TD_CLASS}>{count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className={CARD_CLASS} aria-label="Dry-run shadow agreement">
            <h2 className={H2_CLASS}>Dry-run shadow agreement (30 days)</h2>
            <p className="text-sm text-slate-700 mt-2">{shadowAgreementText(status.shadow)}</p>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className={CARD_CLASS} aria-label="Watch summary">
              <h2 className={H2_CLASS}>Watched sources</h2>
              <dl className="mt-2 grid grid-cols-2 gap-3">
                <Stat label="Targets" value={String(status.watch.targets)} />
                <Stat label="Active" value={String(status.watch.active)} />
                <Stat label="Failing" value={String(status.watch.failing)} />
                <Stat label="Changes (7 days)" value={String(status.watch.changes7d)} />
                <Stat label="Last checked" value={age(status.watch.lastCheckedAt)} />
              </dl>
            </section>

            <section className={CARD_CLASS} aria-label="Email summary">
              <h2 className={H2_CLASS}>Email</h2>
              <dl className="mt-2 grid grid-cols-2 gap-3">
                <Stat label="Sent (24 h)" value={String(status.notifications.sent24h)} />
                <Stat label="Failed (24 h)" value={String(status.notifications.failed24h)} />
                <Stat label="Queued" value={String(status.notifications.queued)} />
                <Stat label="Last sent" value={age(status.notifications.lastSentAt)} />
              </dl>
            </section>

            <section className={CARD_CLASS} aria-label="Publishes in the last 7 days">
              <h2 className={H2_CLASS}>Publishes (7 days)</h2>
              <dl className="mt-2 grid grid-cols-2 gap-3">
                {PUBLISH_STATES.map(state => (
                  <Stat
                    key={state}
                    label={publishStateLabel(state)}
                    value={String(status.publishes7d.byState[state] ?? 0)}
                  />
                ))}
              </dl>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
