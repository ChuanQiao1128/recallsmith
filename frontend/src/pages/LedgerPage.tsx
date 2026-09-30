// src/pages/LedgerPage.tsx
//
// The Automation Ledger console (R18 contract §9): what the automations did and
// how much human time they saved, read from the J08 ledger routes. Every figure
// on the page comes from the API response; the definitions at the bottom are
// §9.1, so each number can be traced to a rule. Any console user may read; only
// a super_admin may change a baseline.
//
// R20 V08/V10: a baseline row the server can measure (≥ 5 recorded draft
// reviews) carries `suggestedMeasuredMinutes`, shown as "Suggested from N
// reviews". A super_admin's "Use as measured" only pre-fills the edit form with
// it; saving is still the existing PUT, so nothing changes until Save.
import { useEffect, useMemo, useState } from 'react';

import {
  fetchAutomationBaselines,
  fetchAutomationEvents,
  fetchAutomationLedger,
  runAutomationBackfill,
  updateAutomationBaseline,
  type AutomationBackfillResult,
  type AutomationBaseline,
  type AutomationEventRow,
  type LedgerGranularity,
  type LedgerReport,
} from '../api/ledger';
import { isSuperAdmin, readSessionUser } from '../auth/sessionUser';
import { ConsoleShell } from '../components/console/ConsoleShell';
import { consoleNav } from '../components/console/consoleNav';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import {
  CARD_CLASS,
  FIELD_ERROR_CLASS,
  H1_CLASS,
  H2_CLASS,
  INPUT_CLASS,
  INPUT_INVALID_CLASS,
  LABEL_CLASS,
  TD_CLASS,
  TH_CLASS,
} from '../components/console/consoleStyles';
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
  ledgerAxisLabel,
  ledgerBarHeight,
  ledgerLabelEvery,
  ledgerRangeProblem,
  orderedLedgerAutomations,
} from '../lib/ledgerView';
import type { ApiError } from '../types/api';

type LoadError = { code: string; message: string };

/** `forKey` is the request the data answers; a mismatch with the current key means a refetch is in flight. */
type LedgerState = { forKey: string | null; error: LoadError | null; data: LedgerReport | null };
type BaselinesState = { loading: boolean; error: LoadError | null; items: AutomationBaseline[] };
type EventsState = {
  loading: boolean;
  /** The automation filter the rows were loaded for; a mismatch means a refetch is on the way. */
  forAutomation: string | null;
  error: LoadError | null;
  items: AutomationEventRow[];
  nextCursor: string | null;
};

type AppliedRange = { from: string; to: string; granularity: LedgerGranularity };

type BackfillState = {
  running: 'dry' | 'apply' | null;
  /** The last dry run's counts; Apply is offered only after one. */
  preview: AutomationBackfillResult | null;
  applied: AutomationBackfillResult | null;
  error: string | null;
};

type Tile = { key: string; label: string; value: string; details?: string[] };

type BaselineForm = {
  automation: string;
  minutes: string;
  source: 'measured' | 'default';
  note: string;
};

const GRANULARITIES: LedgerGranularity[] = ['day', 'week', 'month'];
const EVENTS_PAGE_SIZE = 50;

// Chart geometry, in CSS pixels: the SVG is drawn at its natural size and the
// wrapper scrolls, so a long daily range is never scaled down to unreadable.
const BAR_SLOT = 40;
const BAR_WIDTH = 28;
const PLOT_HEIGHT = 160;
const AXIS_LABEL_HEIGHT = 20;
const AXIS_FONT_SIZE = 10;
// Axis labels are MM-DD (5 characters); the full date is in each bar's title
// and in the data table. labelEvery keeps neighbouring labels from overlapping.
const AXIS_LABEL_CHARS = 5;
const CHART_TABLE_ID = 'ledger-chart-data';

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

function backfillCounts(result: AutomationBackfillResult, key: 'inserted' | 'skipped'): string {
  return LEDGER_AUTOMATIONS.filter(a => a in result[key])
    .map(a => `${labelFor(a)} ${formatNumber(result[key][a])}`)
    .join(', ');
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

  const [ledger, setLedger] = useState<LedgerState>({ forKey: null, error: null, data: null });
  const [backfill, setBackfill] = useState<BackfillState>({ running: null, preview: null, applied: null, error: null });
  const [baselines, setBaselines] = useState<BaselinesState>({ loading: true, error: null, items: [] });
  const [events, setEvents] = useState<EventsState>({
    loading: true,
    forAutomation: null,
    error: null,
    items: [],
    nextCursor: null,
  });
  // The page's one persistent live region (a region mounted with its text is
  // not announced).
  const [announcement, setAnnouncement] = useState('');
  const [eventsAutomation, setEventsAutomation] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const [editing, setEditing] = useState<BaselineForm | null>(null);
  const [editProblem, setEditProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The request the ledger on screen should answer. Apply and a saved baseline
  // change it, so the old totals are marked busy until the new ones land.
  const ledgerKey = `${applied.from}|${applied.to}|${applied.granularity}|${applyNonce}|${baselineNonce}`;

  useEffect(() => {
    let cancelled = false;
    const key = `${applied.from}|${applied.to}|${applied.granularity}|${applyNonce}|${baselineNonce}`;
    async function run() {
      const res = await fetchAutomationLedger({
        from: applied.from || undefined,
        to: applied.to || undefined,
        granularity: applied.granularity,
      });
      if (cancelled) return;
      if (!res.success || !res.data) {
        setLedger({ forKey: key, error: toLoadError(res.error, 'Failed to load the automation ledger.'), data: null });
        return;
      }
      setLedger({ forKey: key, error: null, data: res.data });
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
          forAutomation: eventsAutomation,
          error: toLoadError(res.error, 'Failed to load automation events.'),
          items: [],
          nextCursor: null,
        });
        return;
      }
      setEvents({
        loading: false,
        forAutomation: eventsAutomation,
        error: null,
        items: res.data.items,
        nextCursor: res.data.nextCursor,
      });
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

  // The rows on screen belong to the previous automation filter while its refetch is in flight.
  const eventsRefetching = !events.loading && events.forAutomation !== eventsAutomation;

  async function onLoadMore() {
    if (!events.nextCursor || loadingMore || eventsRefetching) return;
    // The page belongs to the filter it was asked for: a result that lands
    // after the filter changed is dropped rather than appended to other rows.
    const automationAtClick = eventsAutomation;
    setLoadingMore(true);
    const res = await fetchAutomationEvents({
      automation: eventsAutomation || undefined,
      limit: EVENTS_PAGE_SIZE,
      cursor: events.nextCursor,
    });
    setLoadingMore(false);
    if (!res.success || !res.data) {
      setEvents(prev =>
        prev.forAutomation !== automationAtClick
          ? prev
          : { ...prev, error: toLoadError(res.error, 'Failed to load more events.') },
      );
      return;
    }
    const page = res.data;
    setEvents(prev =>
      prev.forAutomation !== automationAtClick
        ? prev
        : { ...prev, error: null, items: [...prev.items, ...page.items], nextCursor: page.nextCursor },
    );
  }

  async function onBackfill(dryRun: boolean) {
    if (backfill.running) return;
    setBackfill(prev => ({ ...prev, running: dryRun ? 'dry' : 'apply', error: null }));
    const res = await runAutomationBackfill(dryRun);
    if (!res.success || !res.data) {
      const message = res.error?.message ?? 'The backfill failed.';
      setBackfill(prev => ({ ...prev, running: null, error: message }));
      setAnnouncement(`Backfill failed: ${message}`);
      return;
    }
    const result = res.data;
    if (dryRun) {
      setBackfill({ running: null, preview: result, applied: null, error: null });
      setAnnouncement(`Dry run: would insert ${backfillCounts(result, 'inserted')}.`);
      return;
    }
    // Applied: the preview is spent, and the ledger now holds the inferred rows.
    setBackfill({ running: null, preview: null, applied: result, error: null });
    setAnnouncement(`Backfill applied: inserted ${backfillCounts(result, 'inserted')}.`);
    setApplyNonce(n => n + 1);
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

  /**
   * Pre-fills the edit form with the server's suggestion, marked measured; Save sends it.
   * Rounded to 2 decimals: the suggestion is median(review_ms)/60000, and the input's
   * step="0.01" would otherwise refuse to submit it.
   */
  function applySuggestion(row: AutomationBaseline) {
    const minutes = row.suggestedMeasuredMinutes;
    if (typeof minutes !== 'number') return;
    setEditProblem(null);
    setEditing({
      automation: row.automation,
      minutes: String(Math.round(minutes * 100) / 100),
      source: 'measured',
      note: row.note ?? '',
    });
    setAnnouncement(`Suggested baseline for ${labelFor(row.automation)} copied into the form. Save to apply it.`);
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
    setAnnouncement(`Baseline saved for ${labelFor(editing.automation)}.`);
    setEditing(null);
    setBaselineNonce(n => n + 1);
  }

  const report = ledger.data;
  const bars = useMemo(() => buildLedgerBars(report?.series ?? []), [report]);
  const maxSaved = bars.reduce((max, bar) => Math.max(max, bar.minutesSaved), 0);
  const labelEvery = ledgerLabelEvery(BAR_SLOT, AXIS_LABEL_CHARS, AXIS_FONT_SIZE);
  const chartWidth = Math.max(bars.length * BAR_SLOT, BAR_SLOT);

  const notReady = isNotReady(ledger.error) || isNotReady(baselines.error) || isNotReady(events.error);
  const validationError = ledger.error?.code === 'VALIDATION_ERROR' ? ledger.error : null;
  const otherLedgerError = ledger.error && !isNotReady(ledger.error) && !validationError ? ledger.error : null;

  const ledgerLoading = ledger.forKey === null;
  // Old figures stay on screen, dimmed and busy, while a new range loads.
  const ledgerRefetching = !ledgerLoading && ledger.forKey !== ledgerKey;

  const totals = report?.totals;
  const hoursDetails: string[] = [];
  if (totals?.bySource) {
    // Two disjoint parts of the headline, side by side; "measured" is kept for
    // the baseline source on the next line (frontend-console-26).
    hoursDetails.push(
      `Live: ${formatHours(totals.bySource.live.minutesSaved)} · Inferred from history: ${formatHours(totals.bySource.backfill.minutesSaved)}`,
    );
  }
  if (totals?.byBaselineSource) {
    hoursDetails.push(
      `On measured baselines: ${formatHours(totals.byBaselineSource.measured)} · on default baselines: ${formatHours(totals.byBaselineSource.default)}`,
    );
  }
  const agent = report?.agentDrafts ?? null;
  const agentTile: Tile | null = agent
    ? agent.decided === 0
      ? { key: 'agentDrafts', label: 'AI draft quality', value: '—', details: ['No AI drafts decided in this range.'] }
      : {
          key: 'agentDrafts',
          label: 'AI draft quality',
          value: `${formatPercent(agent.acceptanceRate)} accepted`,
          details: [
            `${formatNumber(agent.decided)} decided: ${formatNumber(agent.accepted)} accepted, ${formatNumber(agent.rejected)} rejected`,
            `Edited-accept rate: ${formatPercent(agent.editedAcceptRate)}`,
            `Defect rate: ${formatPercent(agent.defectRate)} (${formatNumber(agent.defectRejects)} rejected for a defect)`,
            `Average review: ${agent.avgReviewMinutes === null ? '—' : `${formatNumber(agent.avgReviewMinutes)} min`}`,
            // automation-16: how much of the figure rests on unmeasured reviews.
            ...(agent.reviewNotMeasured
              ? [`${formatNumber(agent.reviewNotMeasured)} decision(s) without measured review time`]
              : []),
          ],
        }
    : null;
  const tiles: Tile[] = totals
    ? [
        { key: 'hoursSaved', label: 'Hours saved', value: formatHours(totals.minutesSaved), details: hoursDetails },
        { key: 'runs', label: 'Runs', value: formatNumber(totals.runs) },
        { key: 'units', label: 'Units', value: formatNumber(totals.units) },
        { key: 'defectsCaught', label: 'Defects caught before publish', value: formatNumber(totals.defectsCaught) },
        { key: 'qaFalsePositives', label: 'QA false positives', value: formatNumber(totals.qaFalsePositives) },
        { key: 'actualMinutes', label: 'Actual minutes', value: formatNumber(totals.actualMinutes) },
        ...(agentTile ? [agentTile] : []),
      ]
    : [];

  return (
    <ConsoleShell
      title={CONSOLE_NAME}
      subtitle="Automation · Ledger"
      {...consoleNav()}
    >
      <div>
        <h1 className={H1_CLASS}>Automation ledger</h1>
        {report ? (
          <p className="text-xs text-slate-600 mt-0.5" data-testid="ledger-range">
            {report.from} – {report.to}, by {report.granularity}
          </p>
        ) : null}
      </div>

      <div role="status" aria-live="polite" className="sr-only" data-testid="ledger-live">
        {announcement}
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
              className={rangeProblem ? INPUT_INVALID_CLASS : INPUT_CLASS}
              aria-invalid={rangeProblem ? true : undefined}
              aria-describedby={rangeProblem ? 'ledger-range-problem' : undefined}
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
              className={rangeProblem ? INPUT_INVALID_CLASS : INPUT_CLASS}
              aria-invalid={rangeProblem ? true : undefined}
              aria-describedby={rangeProblem ? 'ledger-range-problem' : undefined}
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
          <Button variant="primary" size="xs" onClick={onApply}>
            Apply
          </Button>
        </div>
        {rangeProblem ? (
          <p id="ledger-range-problem" role="alert" className={`mt-2 ${FIELD_ERROR_CLASS}`} data-testid="ledger-range-problem">
            {rangeProblem}
          </p>
        ) : null}
        {validationError ? (
          <p role="alert" className={`mt-2 ${FIELD_ERROR_CLASS}`} data-testid="ledger-validation-error">
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
        <Callout tone="danger" title="Could not load the ledger" role="alert">
          {otherLedgerError.message}
        </Callout>
      ) : null}

      <section className={CARD_CLASS} aria-busy={ledgerRefetching ? true : undefined} data-testid="ledger-totals">
        <h2 className={H2_CLASS}>Totals</h2>
        {ledgerRefetching ? (
          <p className="mt-2 text-sm text-slate-500" data-testid="ledger-refetching">
            Loading the new range…
          </p>
        ) : null}
        {ledgerLoading ? (
          <p className="mt-3 text-sm text-slate-600">Loading…</p>
        ) : (
          <div className={`mt-3 grid grid-cols-2 md:grid-cols-3 gap-3 ${ledgerRefetching ? 'opacity-50' : ''}`}>
            {tiles.map(tile => (
              <div key={tile.key} className="border border-slate-200 rounded-lg p-3" data-testid={`ledger-total-${tile.key}`}>
                <div className="text-xs text-slate-500">{tile.label}</div>
                <div className="text-lg font-semibold text-slate-900">{tile.value}</div>
                {tile.details?.map(line => (
                  <div key={line} className="text-xs text-slate-600">
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section
        className={`${CARD_CLASS} ${ledgerRefetching ? 'opacity-50' : ''}`}
        aria-busy={ledgerRefetching ? true : undefined}
      >
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

      <section
        className={`${CARD_CLASS} ${ledgerRefetching ? 'opacity-50' : ''}`}
        aria-busy={ledgerRefetching ? true : undefined}
        data-testid="ledger-chart-section"
      >
        <h2 className={H2_CLASS}>Minutes saved per period</h2>
        {ledgerLoading ? (
          <p className="mt-3 text-sm text-slate-600">Loading…</p>
        ) : bars.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No automation runs in this range.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto" data-testid="ledger-chart-scroll">
              <svg
                role="img"
                aria-label="Minutes saved per period"
                aria-describedby={CHART_TABLE_ID}
                width={chartWidth}
                height={PLOT_HEIGHT + AXIS_LABEL_HEIGHT}
                viewBox={`0 0 ${chartWidth} ${PLOT_HEIGHT + AXIS_LABEL_HEIGHT}`}
                className="block max-w-none text-slate-500"
              >
                <line x1={0} y1={PLOT_HEIGHT} x2={chartWidth} y2={PLOT_HEIGHT} stroke="currentColor" strokeWidth={1} />
                {bars.map((bar, i) => {
                  const height = ledgerBarHeight(bar.minutesSaved, maxSaved, PLOT_HEIGHT);
                  const net = bar.netMinutes === bar.minutesSaved ? '' : ` (net ${formatHours(bar.netMinutes)})`;
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
                        <title>{`${bar.periodStart}: ${formatHours(bar.minutesSaved)} saved${net}, ${bar.defectsCaught} defects`}</title>
                      </rect>
                      {i % labelEvery === 0 ? (
                        <text
                          x={i * BAR_SLOT + BAR_SLOT / 2}
                          y={PLOT_HEIGHT + 14}
                          textAnchor="middle"
                          fontSize={AXIS_FONT_SIZE}
                          fill="currentColor"
                        >
                          {ledgerAxisLabel(bar.periodStart)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            </div>
            {/* The text alternative: every value the bars show, reachable by
                keyboard and screen reader (the <title>s are hover-only). */}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-slate-600">Show the chart data as a table</summary>
              <table id={CHART_TABLE_ID} className="mt-2 min-w-full text-sm" data-testid="ledger-chart-table">
                <caption className="sr-only">Minutes saved, net minutes and defects caught per period</caption>
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className={TH_CLASS}>Period start</th>
                    <th scope="col" className={TH_CLASS}>Time saved</th>
                    <th scope="col" className={TH_CLASS}>Minutes saved</th>
                    <th scope="col" className={TH_CLASS}>Net minutes</th>
                    <th scope="col" className={TH_CLASS}>Defects caught</th>
                  </tr>
                </thead>
                <tbody>
                  {bars.map(bar => (
                    <tr key={bar.periodStart} className="border-t border-slate-100">
                      <th scope="row" className={`${TD_CLASS} text-left font-normal`}>{bar.periodStart}</th>
                      <td className={TD_CLASS}>{formatHours(bar.minutesSaved)}</td>
                      <td className={TD_CLASS}>{formatNumber(bar.minutesSaved)}</td>
                      <td className={TD_CLASS}>{formatNumber(bar.netMinutes)}</td>
                      <td className={TD_CLASS}>{formatNumber(bar.defectsCaught)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>

      <section className={CARD_CLASS}>
        <h2 className={H2_CLASS}>Baselines</h2>
        {!superAdmin ? <p className="mt-2 text-sm text-slate-600">Only a super_admin can change baselines.</p> : null}
        {baselines.error && !isNotReady(baselines.error) ? (
          <div className="mt-3">
            <Callout tone="danger" title="Could not load baselines" role="alert">
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
                  <td className={TD_CLASS}>
                    {formatNumber(row.baselineMinutesPerUnit)}
                    {typeof row.suggestedMeasuredMinutes === 'number' ? (
                      <div className="mt-1 text-xs text-slate-600" data-testid={`ledger-baseline-suggestion-${row.automation}`}>
                        Suggested from {row.suggestedFromN ?? 0} reviews: {formatNumber(row.suggestedMeasuredMinutes)} min
                        {superAdmin ? (
                          <div className="mt-1">
                            <Button
                              variant="outline"
                              size="xs"
                              aria-label={`Use as measured: ${labelFor(row.automation)}`}
                              disabled={saving}
                              onClick={() => applySuggestion(row)}
                            >
                              Use as measured
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className={TD_CLASS}>{sourceBadge(row.baselineSource)}</td>
                  <td className={TD_CLASS}>{orDash(row.note)}</td>
                  <td className={TD_CLASS}>{orDash(row.updatedAt)}</td>
                  {superAdmin ? (
                    <td className={TD_CLASS}>
                      <Button
                        variant="outline"
                        size="xs"
                        aria-label={`Edit baseline ${labelFor(row.automation)}`}
                        disabled={saving}
                        onClick={() => beginEdit(row)}
                      >
                        Edit
                      </Button>
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
                className={editProblem ? INPUT_INVALID_CLASS : INPUT_CLASS}
                aria-invalid={editProblem ? true : undefined}
                aria-describedby={editProblem ? 'ledger-baseline-problem' : undefined}
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
              <p id="ledger-baseline-problem" role="alert" className={FIELD_ERROR_CLASS} data-testid="ledger-baseline-problem">
                {editProblem}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" size="xs" disabled={saving}>
                Save baseline
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={saving}
                onClick={() => {
                  setEditing(null);
                  setEditProblem(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {superAdmin ? (
          <div className="mt-6 border-t border-slate-200 pt-4 space-y-2" data-testid="ledger-backfill">
            <h3 className="text-sm font-semibold text-slate-900">Backfill history</h3>
            <p className="text-sm text-slate-600">
              Infers ledger rows from past publishes and bulk imports (runs of 5 or more cards created in the same
              minute). The rows are marked as inferred from history and shown apart from live data. Run a dry run
              first; applying inserts only what the dry run counted as new, and running it again skips rows already
              present. The runbook is docs/delivery/r18-issues/X01-ledger-runbook.md.
            </p>
            {backfill.error ? (
              <Callout tone="danger" title="Backfill failed" role="alert">
                {backfill.error}
              </Callout>
            ) : null}
            {backfill.preview ? (
              <p className="text-sm text-slate-700" data-testid="ledger-backfill-preview">
                Dry run: would insert {backfillCounts(backfill.preview, 'inserted')}; already present{' '}
                {backfillCounts(backfill.preview, 'skipped')}.
              </p>
            ) : null}
            {backfill.applied ? (
              <p className="text-sm text-slate-700" data-testid="ledger-backfill-applied">
                Applied: inserted {backfillCounts(backfill.applied, 'inserted')}; skipped{' '}
                {backfillCounts(backfill.applied, 'skipped')}.
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                disabled={backfill.running !== null}
                onClick={() => void onBackfill(true)}
              >
                {backfill.running === 'dry' ? 'Counting…' : 'Dry run'}
              </Button>
              <Button
                variant="primary"
                size="xs"
                disabled={backfill.running !== null || backfill.preview === null}
                title={backfill.preview === null ? 'Run a dry run first.' : undefined}
                onClick={() => void onBackfill(false)}
              >
                {backfill.running === 'apply' ? 'Applying…' : 'Apply backfill'}
              </Button>
            </div>
          </div>
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
            {orderedLedgerAutomations([
              ...baselines.items.map(b => b.automation),
              ...(report?.automations ?? []).map(r => r.automation),
            ]).map(a => (
              <option key={a} value={a}>
                {labelFor(a)}
              </option>
            ))}
          </select>
        </div>
        {events.error && !isNotReady(events.error) ? (
          <div className="mt-3">
            <Callout tone="danger" title="Could not load events" role="alert">
              {events.error.message}
            </Callout>
          </div>
        ) : null}
        {eventsRefetching ? (
          <p className="mt-3 text-sm text-slate-500" data-testid="ledger-events-refetching">
            Loading events for the new filter…
          </p>
        ) : null}
        <div className={`mt-3 overflow-x-auto ${eventsRefetching ? 'opacity-50' : ''}`}>
          <table
            className="min-w-full text-sm"
            data-testid="ledger-events-table"
            aria-busy={eventsRefetching ? true : undefined}
          >
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
            <Button
              variant="outline"
              size="xs"
              disabled={loadingMore || eventsRefetching}
              onClick={() => void onLoadMore()}
            >
              Load more
            </Button>
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
