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
  auto_accept: 'Auto-accept',
  auto_publish: 'Auto-publish',
  source_watch: 'Source watch',
};

/**
 * The six seeded automations, then every other non-empty name the server
 * returned, de-duplicated in first-seen order (the release 1.8A automations
 * are not seeded by migration 028).
 */
export function orderedLedgerAutomations(seen: readonly string[]): string[] {
  const out: string[] = [...LEDGER_AUTOMATIONS];
  for (const name of seen) {
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

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
  /** Never negative: each series point is clamped per (period, automation, source) by the server. */
  minutesSaved: number;
  /** Signed: negative when the period's review cost exceeds its savings. */
  netMinutes: number;
  defectsCaught: number;
};

/** Sums every automation into one bar per period, oldest period first. */
export function buildLedgerBars(
  series: ReadonlyArray<{
    periodStart: string;
    runs: number;
    units: number;
    minutesSaved: number;
    netMinutes: number;
    defectsCaught: number;
  }>,
): LedgerBar[] {
  const byPeriod = new Map<string, LedgerBar>();
  for (const point of series) {
    const bar = byPeriod.get(point.periodStart) ?? {
      periodStart: point.periodStart,
      runs: 0,
      units: 0,
      minutesSaved: 0,
      netMinutes: 0,
      defectsCaught: 0,
    };
    bar.runs += point.runs;
    bar.units += point.units;
    bar.minutesSaved += point.minutesSaved;
    bar.netMinutes += point.netMinutes;
    bar.defectsCaught += point.defectsCaught;
    byPeriod.set(point.periodStart, bar);
  }
  return [...byPeriod.values()].sort((a, b) =>
    a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0,
  );
}

/**
 * A bar's SVG height in px: its minutes saved as a share of the tallest bar,
 * within [0, plotHeight]. Never negative (SVG drops a rect with a negative
 * height), even if a server sends a negative minutesSaved.
 */
export function ledgerBarHeight(minutesSaved: number, maxSaved: number, plotHeight: number): number {
  if (!(maxSaved > 0) || !(minutesSaved > 0)) return 0;
  return Math.min(plotHeight, (minutesSaved / maxSaved) * plotHeight);
}

export function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * The axis label under a bar: `MM-DD`, short enough for its slot. The full
 * period start stays in the bar's title and in the data table.
 */
export function ledgerAxisLabel(periodStart: string): string {
  return DATE_PATTERN.test(periodStart) ? periodStart.slice(5) : periodStart;
}

/**
 * Label every n-th bar so that no two labels overlap: a label of
 * `labelChars` characters at `fontSize` px is about 0.6 × fontSize px per
 * character, plus a small gap, and one bar owns `slot` px.
 */
export function ledgerLabelEvery(slot: number, labelChars: number, fontSize: number): number {
  const labelWidth = labelChars * fontSize * 0.6 + 4;
  return Math.max(1, Math.ceil(labelWidth / slot));
}

/**
 * How the Automation Ledger computes its numbers, restated for the page. It
 * follows what GET /api/v1/admin/automation/ledger computes
 * (src_C/Vpc/Ledger/LedgerRoutes.cs, after the X01 and Z01 fixes), not the
 * first draft of contract §9.1: the headline is clamped once per automation
 * and source over the whole range, each chart bar per automation and source
 * within its period, and a rejected AI draft is a review cost, never a defect
 * caught.
 */
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
    definition:
      'Measured human time, such as review time. It counts as 0 when it was not recorded. It includes the review time spent on every rejected AI draft. Draft review time counts only while the review tab is visible and is capped at 30 minutes per draft.',
  },
  {
    term: 'Minutes saved',
    definition:
      "Per automation and source (live or inferred from history): max(0, Σ units × baseline − Σ actual minutes) over successful and partial events, where actual minutes include review time on rejected drafts. Failures save nothing. The total and the per-automation table apply this once over the whole selected range, whatever the granularity, and add up the groups. Each chart bar applies it within its period and adds up that period's groups, so a bar is never negative and the bars can add up to more than the total. A period's net minutes are the same sums without the max(0, …), so they are negative when actual minutes exceeded baseline minutes in that period. Hours are minutes ÷ 60.",
  },
  {
    term: 'Live and inferred from history',
    definition:
      'Live events are recorded as the automations run. Inferred events come from the super_admin backfill, which reads past publishes and bulk imports; they carry no actual minutes, so live review time never offsets them. The headline shows how much of the total is inferred.',
  },
  {
    term: 'Defects caught before publish',
    definition:
      'Exactly one of two things: (a) an AI QA blocker or major finding resolved as fixed; (b) a publish refused by the MCQ gate (one per refused card version). A rejected AI draft is not a defect caught: it counts in the AI draft defect rate instead. Nothing else counts.',
  },
  {
    term: 'QA false positives',
    definition: 'AI QA findings that were dismissed. They are shown separately and are not defects.',
  },
  {
    term: 'AI draft quality',
    definition:
      'From the review decisions on AI drafts in the range. Acceptance rate: accepted (with or without edits) ÷ decided. Edited-accept rate: accepted with edits ÷ accepted. Defect rate: rejected as incorrect, ambiguous, duplicate or unsupported by its source ÷ decided. Average review minutes: the mean recorded review time per decision.',
  },
  {
    term: 'Failure rate',
    definition: 'Failures ÷ runs, per automation.',
  },
  {
    term: 'Default baselines',
    definition: `Seeded placeholders, shown as "${DEFAULT_BASELINE_LABEL}". Time the work and save a measured value to replace them. The headline shows how much of the total rests on them.`,
  },
];
