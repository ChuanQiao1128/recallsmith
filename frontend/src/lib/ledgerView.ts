// src/lib/ledgerView.ts
//
// Pure view rules for the Automation Ledger console page (R18 contract §9):
// labels, input bounds, the per-period bar reduction, number formatting and the
// §9.1 definitions printed on the page. No runtime imports, so it can be tested
// in the node environment and never drags a dependency into the page chunk.

/** The six automations seeded in migration 028 (contract §3.3). */
export const LEDGER_AUTOMATIONS = [
  'publish_pipeline',
  'bulk_import',
  'ai_draft_review',
  'ai_qa_review',
  'webhook_notification',
  'publish_gate',
] as const;

/** Display names. An automation missing from here is shown by its key. */
export const LEDGER_AUTOMATION_LABELS: Record<string, string> = {
  publish_pipeline: 'Publish pipeline',
  bulk_import: 'Bulk import',
  ai_draft_review: 'AI draft review',
  ai_qa_review: 'AI QA review',
  webhook_notification: 'Webhook notifications',
  publish_gate: 'Publish gate',
};

/** How a seeded placeholder baseline is shown (§9.1). */
export const DEFAULT_BASELINE_LABEL = 'default — measure and replace';

export const LEDGER_MAX_RANGE_DAYS = 366;
export const BASELINE_MAX_MINUTES = 999999.99;
export const BASELINE_NOTE_MAX_LENGTH = 500;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds at UTC midnight for a real YYYY-MM-DD date, else null. */
function utcDay(value: string): number | null {
  if (!DATE_PATTERN.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return ms;
}

/**
 * Why a From/To pair cannot be sent, or null when it can. Both empty is fine:
 * the server then applies its own default window.
 */
export function ledgerRangeProblem(from: string, to: string): string | null {
  if (from === '' && to === '') return null;
  const start = utcDay(from);
  if (start === null) return 'From must be a real date in YYYY-MM-DD form.';
  const end = utcDay(to);
  if (end === null) return 'To must be a real date in YYYY-MM-DD form.';
  if (start > end) return 'From must be on or before To.';
  if ((end - start) / DAY_MS > LEDGER_MAX_RANGE_DAYS) {
    return `The range can span at most ${LEDGER_MAX_RANGE_DAYS} days.`;
  }
  return null;
}

/** Why a baseline edit cannot be sent, or null when it can. */
export function baselineProblem(input: { baselineMinutesPerUnit: number; note?: string | null }): string | null {
  const minutes = input.baselineMinutesPerUnit;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > BASELINE_MAX_MINUTES) {
    return `Minutes per unit must be a number between 0 and ${BASELINE_MAX_MINUTES}.`;
  }
  if ((input.note ?? '').length > BASELINE_NOTE_MAX_LENGTH) {
    return `The note can be at most ${BASELINE_NOTE_MAX_LENGTH} characters.`;
  }
  return null;
}

export type LedgerBar = {
  periodStart: string;
  runs: number;
  units: number;
  minutesSaved: number;
  defectsCaught: number;
};

/** Sums every automation into one bar per period, oldest period first. */
export function buildLedgerBars(
  series: ReadonlyArray<{ periodStart: string; runs: number; units: number; minutesSaved: number; defectsCaught: number }>,
): LedgerBar[] {
  const byPeriod = new Map<string, LedgerBar>();
  for (const point of series) {
    const bar = byPeriod.get(point.periodStart) ?? {
      periodStart: point.periodStart,
      runs: 0,
      units: 0,
      minutesSaved: 0,
      defectsCaught: 0,
    };
    bar.runs += point.runs;
    bar.units += point.units;
    bar.minutesSaved += point.minutesSaved;
    bar.defectsCaught += point.defectsCaught;
    byPeriod.set(point.periodStart, bar);
  }
  return [...byPeriod.values()].sort((a, b) =>
    a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0,
  );
}

export function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Contract §9.1, restated for the page. */
export const LEDGER_DEFINITIONS: ReadonlyArray<{ term: string; definition: string }> = [
  {
    term: 'Run',
    definition: 'One automation event with units greater than 0, or with outcome failure.',
  },
  {
    term: 'Units',
    definition: 'The units an event reports, such as cards published or rows imported.',
  },
  {
    term: 'Baseline minutes',
    definition:
      "Units × the automation's baseline minutes per unit. Baselines are read at query time, so editing a baseline recomputes history.",
  },
  {
    term: 'Actual minutes',
    definition: 'Measured human time, such as review time. It counts as 0 when it was not recorded.',
  },
  {
    term: 'Minutes saved',
    definition:
      'The sum over successful and partial runs of max(0, units × baseline − actual minutes). Failures save nothing. Hours are minutes ÷ 60.',
  },
  {
    term: 'Defects caught before publish',
    definition:
      'Exactly one of three things: (a) an AI QA blocker or major finding resolved as fixed; (b) an AI draft rejected as incorrect, ambiguous, duplicate or unsupported by its source; (c) a publish refused by the MCQ gate. Nothing else counts.',
  },
  {
    term: 'QA false positives',
    definition: 'AI QA findings that were dismissed. They are shown separately and are not defects.',
  },
  {
    term: 'Failure rate',
    definition: 'Failures ÷ runs, per automation.',
  },
  {
    term: 'Default baselines',
    definition: `Seeded placeholders, shown as "${DEFAULT_BASELINE_LABEL}". Time the work and save a measured value to replace them.`,
  },
];
