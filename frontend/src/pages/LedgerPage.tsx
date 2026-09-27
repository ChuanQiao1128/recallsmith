// src/pages/LedgerPage.tsx
//
// The Automation Ledger console (R18 contract §9): what the automations did and
// how much human time they saved, read from the J08 ledger routes. Every figure
// on the page comes from the API response; the definitions at the bottom are
// §9.1, so each number can be traced to a rule. Any console user may read; only
// a super_admin may change a baseline.
import { useEffect, useMemo, useState } from 'react';

import {
  fetchAutomationBaselines,
  fetchAutomationEvents,
  fetchAutomationLedger,
  updateAutomationBaseline,
  type AutomationBaseline,
  type AutomationEventRow,
  type LedgerGranularity,
  type LedgerReport,
} from '../api/ledger';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { Badge } from '../components/ui/Badge';
import { Callout } from '../components/ui/Callout';
import { CONSOLE_NAME } from '../lib/brand';
import {
  DEFAULT_BASELINE_LABEL,
  LEDGER_AUTOMATIONS,
  LEDGER_AUTOMATION_LABELS,
  LEDGER_DEFINITIONS,
  baselineProblem,
  buildLedgerBars,
  formatHours,
  formatPercent,
  ledgerRangeProblem,
} from '../lib/ledgerView';
import type { ApiError } from '../types/api';

type LoadError = { code: string; message: string };

type LedgerState = { loading: boolean; error: LoadError | null; data: LedgerReport | null };
type BaselinesState = { loading: boolean; error: LoadError | null; items: AutomationBaseline[] };
type EventsState = {
  loading: boolean;
  error: LoadError | null;
  items: AutomationEventRow[];
  nextCursor: string | null;
};

type AppliedRange = { from: string; to: string; granularity: LedgerGranularity };

type BaselineForm = {
  automation: string;
  minutes: string;
  source: 'measured' | 'default';
  note: string;
};

const GRANULARITIES: LedgerGranularity[] = ['day', 'week', 'month'];
const EVENTS_PAGE_SIZE = 50;

const BUTTON_CLASS =
  'text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed';
const INPUT_CLASS = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';
const LABEL_CLASS = 'block text-xs font-medium text-slate-700 mb-1';
const CARD_CLASS = 'bg-white border border-slate-200 rounded-lg shadow-sm p-4';
const H2_CLASS = 'text-sm font-semibold text-slate-900';
const TH_CLASS = 'px-4 py-2 text-left font-semibold text-slate-600';
const TD_CLASS = 'px-4 py-2';

// Chart geometry, in viewBox units.
const BAR_SLOT = 40;
const BAR_WIDTH = 28;
const PLOT_HEIGHT = 160;
const AXIS_LABEL_HEIGHT = 20;

function toLoadError(error: ApiError | null, fallback: string): LoadError {
  return { code: error?.code ?? 'UNKNOWN', message: error?.message ?? fallback };
}

function isNotReady(error: LoadError | null): boolean {
  return !!error && error.code.startsWith('SERVER_NOT_READY_');
}

function labelFor(automation: string): string {
  return LEDGER_AUTOMATION_LABELS[automation] ?? automation;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function sourceBadge(source: string) {
  return source === 'default' ? (
    <Badge tone="warning">{DEFAULT_BASELINE_LABEL}</Badge>
  ) : (
    <Badge tone="success">measured</Badge>
  );
}

function orDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export function LedgerPage() {
  const sessionUser = useMemo(() => readSessionUser(), []);
  const superAdmin = useMemo(() => isSuperAdmin(sessionUser), [sessionUser]);

  // Filter inputs, and the range last applied. Only Apply copies one to the other.
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [granularityInput, setGranularityInput] = useState<LedgerGranularity>('week');
  const [applied, setApplied] = useState<AppliedRange>({ from: '', to: '', granularity: 'week' });
  const [rangeProblem, setRangeProblem] = useState<string | null>(null);

  // Bumped by Apply (reloads everything) and by a saved baseline (ledger and
  // baselines only: baselines are read at query time, so history changes too).
  const [applyNonce, setApplyNonce] = useState(0);
  const [baselineNonce, setBaselineNonce] = useState(0);

  const [ledger, setLedger] = useState<LedgerState>({ loading: true, error: null, data: null });
  const [baselines, setBaselines] = useState<BaselinesState>({ loading: true, error: null, items: [] });
  const [events, setEvents] = useState<EventsState>({ loading: true, error: null, items: [], nextCursor: null });
  const [eventsAutomation, setEventsAutomation] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const [editing, setEditing] = useState<BaselineForm | null>(null);
  const [editProblem, setEditProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchAutomationLedger({
        from: applied.from || undefined,
        to: applied.to || undefined,
        granularity: applied.granularity,
      });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setLedger({ loading: false, error: toLoadError(res.error, 'Failed to load the automation ledger.'), data: null });
        return;
      }
      setLedger({ loading: false, error: null, data: res.data });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [applied, applyNonce, baselineNonce]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchAutomationBaselines();
      if (cancelled) return;
      if (!res.success || !res.data) {
        setBaselines({ loading: false, error: toLoadError(res.error, 'Failed to load baselines.'), items: [] });
        return;
      }
      setBaselines({ loading: false, error: null, items: res.data.items });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [applyNonce, baselineNonce]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetchAutomationEvents({
        automation: eventsAutomation || undefined,
        limit: EVENTS_PAGE_SIZE,
      });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setEvents({
          loading: false,
          error: toLoadError(res.error, 'Failed to load automation events.'),
          items: [],
          nextCursor: null,
        });
        return;
      }
      setEvents({ loading: false, error: null, items: res.data.items, nextCursor: res.data.nextCursor });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [eventsAutomation, applyNonce]);

  function onApply() {
    const problem = ledgerRangeProblem(fromInput, toInput);
    setRangeProblem(problem);
    if (problem) return;
    setApplied({ from: fromInput, to: toInput, granularity: granularityInput });
    setApplyNonce(n => n + 1);
  }

  async function onLoadMore() {
    if (!events.nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchAutomationEvents({
      automation: eventsAutomation || undefined,
      limit: EVENTS_PAGE_SIZE,
      cursor: events.nextCursor,
    });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setEvents(prev => ({ ...prev, error: toLoadError(res.error, 'Failed to load more events.') }));
      return;
    }
    const page = res.data;
    setEvents(prev => ({ ...prev, error: null, items: [...prev.items, ...page.items], nextCursor: page.nextCursor }));
  }

  function beginEdit(row: AutomationBaseline) {
    setEditProblem(null);
    setEditing({
      automation: row.automation,
      minutes: String(row.baselineMinutesPerUnit),
      source: row.baselineSource === 'default' ? 'default' : 'measured',
      note: row.note ?? '',
    });
  }

  async function onSaveBaseline() {
    if (!editing || saving) return;
    const minutes = editing.minutes.trim() === '' ? Number.NaN : Number(editing.minutes);
    const problem = baselineProblem({ baselineMinutesPerUnit: minutes, note: editing.note });
    setEditProblem(problem);
    if (problem) return;
    setSaving(true);
    const res = await updateAutomationBaseline(editing.automation, {
      baselineMinutesPerUnit: minutes,
      baselineSource: editing.source,
      note: editing.note,
    });
    setSaving(false);
    if (!res.success) {
      setEditProblem(res.error?.message ?? 'Failed to save the baseline.');
      return;
    }
    setEditing(null);
    setBaselineNonce(n => n + 1);
  }

  const report = ledger.data;
  const bars = useMemo(() => buildLedgerBars(report?.series ?? []), [report]);
  const maxSaved = bars.reduce((max, bar) => Math.max(max, bar.minutesSaved), 0);
  const labelEvery = bars.length <= 12 ? 1 : 4;
  const chartWidth = Math.max(bars.length * BAR_SLOT, BAR_SLOT);

  const notReady = isNotReady(ledger.error) || isNotReady(baselines.error) || isNotReady(events.error);
  const validationError = ledger.error?.code === 'VALIDATION_ERROR' ? ledger.error : null;
  const otherLedgerError = ledger.error && !isNotReady(ledger.error) && !validationError ? ledger.error : null;

  const totals = report?.totals;
  const tiles: Array<{ key: string; label: string; value: string }> = totals
    ? [
        { key: 'hoursSaved', label: 'Hours saved', value: formatHours(totals.minutesSaved) },
        { key: 'runs', label: 'Runs', value: formatNumber(totals.runs) },
        { key: 'units', label: 'Units', value: formatNumber(totals.units) },
        { key: 'defectsCaught', label: 'Defects caught before publish', value: formatNumber(totals.defectsCaught) },
        { key: 'qaFalsePositives', label: 'QA false positives', value: formatNumber(totals.qaFalsePositives) },
        { key: 'actualMinutes', label: 'Actual minutes', value: formatNumber(totals.actualMinutes) },
      ]
    : [];

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Automation · Ledger"
      decksHref="/"
      contentIntelligenceHref="/content-intelligence"
      webhooksHref={superAdmin ? '/admin/webhooks' : undefined}
      ledgerHref="/ledger"
      reviewHref="/review"
      qaHref="/decks/qa"
      adminUsersHref={superAdmin ? '/admin/users' : undefined}
    >
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Automation ledger</h1>
        {report ? (
          <p className="text-xs text-slate-500 mt-0.5" data-testid="ledger-range">
            {report.from} – {report.to}, by {report.granularity}
          </p>
        ) : null}
      </div>

      <section className={CARD_CLASS} aria-label="Filters">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={LABEL_CLASS} htmlFor="ledger-from">
              From
            </label>
            <input
              id="ledger-from"
              type="date"
              className={INPUT_CLASS}
              value={fromInput}
              onChange={e => setFromInput(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="ledger-to">
              To
            </label>
            <input
              id="ledger-to"
              type="date"
              className={INPUT_CLASS}
              value={toInput}
              onChange={e => setToInput(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="ledger-granularity">
              Granularity
            </label>
            <select
              id="ledger-granularity"
              className={INPUT_CLASS}
              value={granularityInput}
              onChange={e => setGranularityInput(e.target.value as LedgerGranularity)}
            >
              {GRANULARITIES.map(g => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={BUTTON_CLASS} onClick={onApply}>
            Apply
          </button>
        </div>
        {rangeProblem ? (
          <p className="mt-2 text-sm text-red-800" data-testid="ledger-range-problem">
            {rangeProblem}
          </p>
        ) : null}
        {validationError ? (
          <p className="mt-2 text-sm text-red-800" data-testid="ledger-validation-error">
            {validationError.message}
          </p>
        ) : null}
      </section>

      {notReady ? (
        <div data-testid="ledger-not-ready">
          <Callout tone="warning" title="The automation ledger is not set up yet">
            The server has not run the ledger database migration.
          </Callout>
        </div>
      ) : null}

      {otherLedgerError ? (
        <Callout tone="danger" title="Could not load the ledger">
          {otherLedgerError.message}
        </Callout>
      ) : null}

      <section className={CARD_CLASS}>
        <h2 className={H2_CLASS}>Totals</h2>
        {ledger.loading ? (
          <p className="mt-3 text-sm text-slate-600">Loading…</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            {tiles.map(tile => (
              <div key={tile.key} className="border border-slate-200 rounded-lg p-3" data-testid={`ledger-total-${tile.key}`}>
                <div className="text-xs text-slate-500">{tile.label}</div>
                <div className="text-lg font-semibold text-slate-900">{tile.value}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={CARD_CLASS}>
        <h2 className={H2_CLASS}>By automation</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="ledger-automations-table">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH_CLASS}>Automation</th>
                <th className={TH_CLASS}>Unit</th>
                <th className={TH_CLASS}>Baseline (min/unit)</th>
                <th className={TH_CLASS}>Source</th>
                <th className={TH_CLASS}>Runs</th>
                <th className={TH_CLASS}>Units</th>
                <th className={TH_CLASS}>Failures</th>
                <th className={TH_CLASS}>Failure rate</th>
                <th className={TH_CLASS}>Baseline minutes</th>
                <th className={TH_CLASS}>Actual minutes</th>
                <th className={TH_CLASS}>Minutes saved</th>
                <th className={TH_CLASS}>Defects caught</th>
              </tr>
            </thead>
            <tbody>
              {(report?.automations ?? []).map(row => (
                <tr key={row.automation} className="border-t border-slate-100">
                  <td className={TD_CLASS}>{labelFor(row.automation)}</td>
                  <td className={TD_CLASS}>{row.unit}</td>
                  <td className={TD_CLASS}>{formatNumber(row.baselineMinutesPerUnit)}</td>
                  <td className={TD_CLASS}>{sourceBadge(row.baselineSource)}</td>
                  <td className={TD_CLASS}>{formatNumber(row.runs)}</td>
                  <td className={TD_CLASS}>{formatNumber(row.units)}</td>
                  <td className={TD_CLASS}>{formatNumber(row.failures)}</td>
                  <td className={TD_CLASS}>{formatPercent(row.failureRate)}</td>
                  <td className={TD_CLASS}>{formatNumber(row.baselineMinutes)}</td>
                  <td className={TD_CLASS}>{formatNumber(row.actualMinutes)}</td>
                  <td className={TD_CLASS}>{formatNumber(row.minutesSaved)}</td>
                  <td className={TD_CLASS}>{formatNumber(row.defectsCaught)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={CARD_CLASS}>
        <h2 className={H2_CLASS}>Minutes saved per period</h2>
        {ledger.loading ? (
          <p className="mt-3 text-sm text-slate-600">Loading…</p>
        ) : bars.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No automation runs in this range.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <svg
              role="img"
              aria-label="Minutes saved per period"
              viewBox={`0 0 ${chartWidth} ${PLOT_HEIGHT + AXIS_LABEL_HEIGHT}`}
              className="w-full text-slate-500"
              style={{ minWidth: `${Math.min(chartWidth, 960)}px`, maxHeight: '240px' }}
            >
              <line x1={0} y1={PLOT_HEIGHT} x2={chartWidth} y2={PLOT_HEIGHT} stroke="currentColor" strokeWidth={1} />
              {bars.map((bar, i) => {
                const height = maxSaved > 0 ? (bar.minutesSaved / maxSaved) * PLOT_HEIGHT : 0;
                const x = i * BAR_SLOT + (BAR_SLOT - BAR_WIDTH) / 2;
                return (
                  <g key={bar.periodStart}>
                    <rect
                      data-testid="ledger-bar"
                      x={x}
                      y={PLOT_HEIGHT - height}
                      width={BAR_WIDTH}
                      height={height}
                      className="text-indigo-600"
                      fill="currentColor"
                    >
                      <title>{`${bar.periodStart}: ${formatHours(bar.minutesSaved)} saved, ${bar.defectsCaught} defects`}</title>
                    </rect>
                    {i % labelEvery === 0 ? (
                      <text
                        x={i * BAR_SLOT + BAR_SLOT / 2}
                        y={PLOT_HEIGHT + 14}
                        textAnchor="middle"
                        fontSize={8}
                        fill="currentColor"
                      >
                        {bar.periodStart}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </section>

      <section className={CARD_CLASS}>
        <h2 className={H2_CLASS}>Baselines</h2>
        {!superAdmin ? <p className="mt-2 text-sm text-slate-600">Only a super_admin can change baselines.</p> : null}
        {baselines.error && !isNotReady(baselines.error) ? (
          <div className="mt-3">
            <Callout tone="danger" title="Could not load baselines">
              {baselines.error.message}
            </Callout>
          </div>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="ledger-baselines-table">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH_CLASS}>Automation</th>
                <th className={TH_CLASS}>Unit</th>
                <th className={TH_CLASS}>Minutes per unit</th>
                <th className={TH_CLASS}>Source</th>
                <th className={TH_CLASS}>Note</th>
                <th className={TH_CLASS}>Updated</th>
                {superAdmin ? <th className={TH_CLASS}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {baselines.items.map(row => (
                <tr key={row.automation} className="border-t border-slate-100">
                  <td className={TD_CLASS}>{labelFor(row.automation)}</td>
                  <td className={TD_CLASS}>{row.unit}</td>
                  <td className={TD_CLASS}>{formatNumber(row.baselineMinutesPerUnit)}</td>
                  <td className={TD_CLASS}>{sourceBadge(row.baselineSource)}</td>
                  <td className={TD_CLASS}>{orDash(row.note)}</td>
                  <td className={TD_CLASS}>{orDash(row.updatedAt)}</td>
                  {superAdmin ? (
                    <td className={TD_CLASS}>
                      <button
                        type="button"
                        className={BUTTON_CLASS}
                        aria-label={`Edit baseline ${labelFor(row.automation)}`}
                        disabled={saving}
                        onClick={() => beginEdit(row)}
                      >
                        Edit
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {superAdmin && editing ? (
          <form
            className="mt-4 border border-slate-200 rounded-lg p-3 space-y-3"
            aria-label={`Baseline for ${labelFor(editing.automation)}`}
            onSubmit={e => {
              e.preventDefault();
              void onSaveBaseline();
            }}
          >
            <div className="text-sm font-semibold text-slate-900">{labelFor(editing.automation)}</div>
            <div>
              <label className={LABEL_CLASS} htmlFor="ledger-baseline-minutes">
                Minutes per unit
              </label>
              <input
                id="ledger-baseline-minutes"
                type="number"
                step="0.01"
                min={0}
                className={INPUT_CLASS}
                value={editing.minutes}
                onChange={e => setEditing({ ...editing, minutes: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="ledger-baseline-source">
                Source
              </label>
              <select
                id="ledger-baseline-source"
                className={INPUT_CLASS}
                value={editing.source}
                onChange={e => setEditing({ ...editing, source: e.target.value === 'default' ? 'default' : 'measured' })}
              >
                <option value="measured">measured</option>
                <option value="default">default</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLASS} htmlFor="ledger-baseline-note">
                Note
              </label>
              <textarea
                id="ledger-baseline-note"
                className={INPUT_CLASS}
                value={editing.note}
                onChange={e => setEditing({ ...editing, note: e.target.value })}
              />
            </div>
            {editProblem ? (
              <p className="text-sm text-red-800" data-testid="ledger-baseline-problem">
                {editProblem}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <button type="submit" className={BUTTON_CLASS} disabled={saving}>
                Save baseline
              </button>
              <button
                type="button"
                className={BUTTON_CLASS}
                disabled={saving}
                onClick={() => {
                  setEditing(null);
                  setEditProblem(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className={CARD_CLASS}>
        <h2 className={H2_CLASS}>Recent events</h2>
        <div className="mt-3 max-w-xs">
          <label className={LABEL_CLASS} htmlFor="ledger-events-automation">
            Automation
          </label>
          <select
            id="ledger-events-automation"
            className={INPUT_CLASS}
            value={eventsAutomation}
            onChange={e => setEventsAutomation(e.target.value)}
          >
            <option value="">All automations</option>
            {LEDGER_AUTOMATIONS.map(a => (
              <option key={a} value={a}>
                {labelFor(a)}
              </option>
            ))}
          </select>
        </div>
        {events.error && !isNotReady(events.error) ? (
          <div className="mt-3">
            <Callout tone="danger" title="Could not load events">
              {events.error.message}
            </Callout>
          </div>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="ledger-events-table">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH_CLASS}>When</th>
                <th className={TH_CLASS}>Automation</th>
                <th className={TH_CLASS}>Units</th>
                <th className={TH_CLASS}>Outcome</th>
                <th className={TH_CLASS}>Defects</th>
                <th className={TH_CLASS}>Actual minutes</th>
                <th className={TH_CLASS}>Deck</th>
                <th className={TH_CLASS}>Ref</th>
                <th className={TH_CLASS}>Source</th>
              </tr>
            </thead>
            <tbody>
              {events.loading ? (
                <tr>
                  <td className="px-4 py-6 text-slate-600" colSpan={9}>
                    Loading…
                  </td>
                </tr>
              ) : events.items.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={9}>
                    No events yet.
                  </td>
                </tr>
              ) : (
                events.items.map(ev => (
                  <tr key={ev.id} className="border-t border-slate-100">
                    <td className={TD_CLASS}>{ev.occurredAt}</td>
                    <td className={TD_CLASS}>{labelFor(ev.automation)}</td>
                    <td className={TD_CLASS}>{formatNumber(ev.units)}</td>
                    <td className={TD_CLASS}>{ev.outcome}</td>
                    <td className={TD_CLASS}>{formatNumber(ev.defectsCaught)}</td>
                    <td className={TD_CLASS}>{ev.actualMinutes === null ? '—' : formatNumber(ev.actualMinutes)}</td>
                    <td className={TD_CLASS}>{orDash(ev.deckId)}</td>
                    <td className={TD_CLASS}>{orDash(ev.ref)}</td>
                    <td className={TD_CLASS}>{ev.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {events.nextCursor ? (
          <div className="mt-3">
            <button type="button" className={BUTTON_CLASS} disabled={loadingMore} onClick={() => void onLoadMore()}>
              Load more
            </button>
          </div>
        ) : null}
      </section>

      <section className={CARD_CLASS}>
        <h2 className={H2_CLASS}>How these numbers are computed</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {LEDGER_DEFINITIONS.map(item => (
            <div key={item.term}>
              <dt className="font-semibold text-slate-900">{item.term}</dt>
              <dd className="text-slate-700">{item.definition}</dd>
            </div>
          ))}
        </dl>
      </section>
    </ConsoleShell>
  );
}
