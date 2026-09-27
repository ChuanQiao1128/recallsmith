// src/features/automation/OverviewTab.tsx
//
// The Overview tab (A00 §16.1): the eval gate, the runners and the status
// counters of GET …/automation/status (§16.2). Everything here comes from that
// response and from the eval gate; the ledger holds the time-saved numbers.
//
// "Open exceptions" is the backlog (K7): what still needs a person, whenever it
// was routed. The 24-hour counts mix handled and open decisions, so their
// `human` row says "Routed to a person" and links the Decisions tab filtered to
// that state (B07 frontend-console-1, automation-10). The drafts link opens the
// server-side open list (L4); the publishes waiting for a person are listed by
// deck and reason (humanPublishItems, L4), each linked to its deck's AI QA page,
// and the count links the Runs tab, where each run lists its publishes
// (C07 frontend-console-15). The Email card shows the K6 unconfirmed count (L5).
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { HUMAN_PUBLISH_ITEMS_MAX, type AutomationStatus } from '../../api/automation';
import { CARD_CLASS, H2_CLASS, TD_CLASS, TH_CLASS } from '../../components/console/consoleStyles';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  DECISION_REASONS,
  OPEN_EXCEPTIONS_SEARCH,
  PUBLISH_STATES,
  QUEUED_EMAIL_SEARCH,
  RUNNER_STATE_LABELS,
  RUN_OUTCOME_LABELS,
  backlogLinkLabel,
  codeLabel,
  decisionReasonLabel,
  decisionStateBars,
  formatAge,
  formatTimestamp,
  loginExpiryWarning,
  orDash,
  publishReasonLabel,
  publishStateLabel,
  runnerStateTone,
  shadowAgreementText,
} from '../../lib/automationRules';
import { qaPageHref } from '../../lib/qaGate';
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

/** The 24-hour row of state `human` counts handled and open decisions alike. */
const ROUTED_TO_PERSON = 'Routed to a person';

function barLabel(state: string, label: string): string {
  return state === 'human' ? ROUTED_TO_PERSON : label;
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
          <section className={CARD_CLASS} aria-label="Open exceptions">
            <h2 className={H2_CLASS}>Open exceptions</h2>
            {status.backlog ? (
              <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <dt className="text-xs text-slate-500">Drafts waiting for you</dt>
                  <dd className="text-sm font-medium text-slate-900">
                    <Link
                      to={{ search: OPEN_EXCEPTIONS_SEARCH }}
                      className="text-indigo-700 underline"
                      aria-label={backlogLinkLabel(status.backlog.humanPending)}
                      data-testid="automation-backlog-human-pending"
                    >
                      {status.backlog.humanPending}
                    </Link>
                  </dd>
                </div>
                <Stat label="Oldest waiting since" value={age(status.backlog.oldestHumanPendingAt)} />
                <div>
                  <dt className="text-xs text-slate-500">Publishes waiting for you</dt>
                  <dd className="text-sm font-medium text-slate-900">
                    {status.backlog.humanPublishes > 0 ? (
                      <Link
                        to={{ search: '?tab=runs' }}
                        className="text-indigo-700 underline"
                        aria-label={`${status.backlog.humanPublishes} ${status.backlog.humanPublishes === 1 ? 'publish' : 'publishes'} waiting for you: show the runs`}
                        data-testid="automation-backlog-human-publishes"
                      >
                        {status.backlog.humanPublishes}
                      </Link>
                    ) : (
                      '0'
                    )}
                  </dd>
                </div>
              </dl>
            ) : null}
            {status.backlog && status.backlog.humanPublishes > 0 ? (
              status.backlog.humanPublishItems && status.backlog.humanPublishItems.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-slate-700" aria-label="Publishes waiting for you">
                  {status.backlog.humanPublishItems.slice(0, HUMAN_PUBLISH_ITEMS_MAX).map((p, i) => (
                    <li key={`${p.deckId}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-slate-900">{p.deckSlug ?? `Deck ${p.deckId}`}</span>
                      <span>{p.reason ? publishReasonLabel(p.reason) : 'Needs you'}</span>
                      <span className="text-xs text-slate-600">since {formatTimestamp(p.since)}</span>
                      <Link to={qaPageHref(p.deckId)} className="text-indigo-700 underline">
                        {`AI QA of ${p.deckSlug ?? `deck ${p.deckId}`}`}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-600">
                  This server does not list the decks yet: on the Runs tab, the Publishes column shows each deck
                  marked Needs you and why.
                </p>
              )
            ) : null}
            {status.backlog ? null : (
              <p className="text-sm text-slate-600 mt-2">
                This server does not report the open backlog yet. The review queue lists the drafts still pending.
              </p>
            )}
          </section>

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
                        <td className={TD_CLASS}>
                          <Badge tone={runnerStateTone(r.state)}>{codeLabel(RUNNER_STATE_LABELS, r.state)}</Badge>
                        </td>
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
                        <td className={TD_CLASS}>{codeLabel(RUN_OUTCOME_LABELS, r.lastRunOutcome)}</td>
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
                        <td className={TD_CLASS}>
                          {b.state === 'human' ? (
                            <Link to={{ search: '?tab=decisions&state=human' }} className="text-indigo-700 underline">
                              {ROUTED_TO_PERSON}
                            </Link>
                          ) : (
                            b.label
                          )}
                        </td>
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
                        {barLabel(b.state, b.label)}
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
                <div>
                  <dt className="text-xs text-slate-500">Unconfirmed (sent, no delivery report after 1 h)</dt>
                  <dd className="text-sm font-medium text-slate-900" data-testid="automation-email-unconfirmed">
                    {status.notifications.unconfirmed > 0 ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="warning">{String(status.notifications.unconfirmed)}</Badge>
                        <Link to={{ search: QUEUED_EMAIL_SEARCH }} className="text-indigo-700 underline">
                          Check the queued emails
                        </Link>
                      </span>
                    ) : (
                      '0'
                    )}
                  </dd>
                </div>
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
