// src/api/ledger.ts
// Automation Ledger API (R18 contract §9.4), served under /api/v1/admin/automation/.
// Every call returns an ApiResult and never throws, like src/api/admin.ts.
// Postgres `numeric` columns may arrive as numbers or numeric strings, so every
// numeric field is coerced here and the page only ever sees numbers.
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

export type LedgerGranularity = 'day' | 'week' | 'month';

/** One source's share of the headline: `live` is measured, `backfill` is inferred from history. */
export type LedgerSourceTotals = {
  runs: number;
  units: number;
  minutesSaved: number;
  hoursSaved: number;
};

export type LedgerTotals = {
  runs: number;
  units: number;
  baselineMinutes: number;
  actualMinutes: number;
  minutesSaved: number;
  hoursSaved: number;
  defectsCaught: number;
  qaFalsePositives: number;
  /** The live/backfill split of the headline; null when the server does not send it. */
  bySource: { live: LedgerSourceTotals; backfill: LedgerSourceTotals } | null;
  /** Minutes saved on measured versus seeded default baselines; null when the server does not send it. */
  byBaselineSource: { measured: number; default: number } | null;
};

/**
 * The AI drafting agent's own quality over the period (GET /ledger `agentDrafts`).
 * Rates are fractions in 0..1; `defectRejects` are drafts rejected for a defect
 * reason, which are the agent's defects, not defects caught before publish.
 */
export type LedgerAgentDrafts = {
  decided: number;
  accepted: number;
  editedAccepted: number;
  rejected: number;
  defectRejects: number;
  acceptanceRate: number;
  editedAcceptRate: number;
  defectRate: number;
  /** Null when no draft in the period recorded a review time. */
  avgReviewMinutes: number | null;
};

export type LedgerAutomationRow = {
  automation: string;
  unit: string;
  baselineMinutesPerUnit: number;
  baselineSource: string;
  runs: number;
  units: number;
  failures: number;
  failureRate: number;
  baselineMinutes: number;
  actualMinutes: number;
  minutesSaved: number;
  defectsCaught: number;
};

export type LedgerSeriesPoint = {
  periodStart: string;
  automation: string;
  runs: number;
  units: number;
  minutesSaved: number;
  defectsCaught: number;
};

export type LedgerReport = {
  from: string;
  to: string;
  granularity: LedgerGranularity;
  totals: LedgerTotals;
  automations: LedgerAutomationRow[];
  series: LedgerSeriesPoint[];
  /** Null when the server does not send the block. */
  agentDrafts: LedgerAgentDrafts | null;
};

/** POST /backfill's answer: rows inserted and skipped (already present) per automation. */
export type AutomationBackfillResult = {
  dryRun: boolean;
  inserted: Record<string, number>;
  skipped: Record<string, number>;
};

export type AutomationBaseline = {
  automation: string;
  unit: string;
  baselineMinutesPerUnit: number;
  baselineSource: string;
  note: string | null;
  updatedAt: string | null;
};

export type AutomationEventRow = {
  id: number;
  automation: string;
  occurredAt: string;
  units: number;
  outcome: string;
  actualMinutes: number | null;
  defectsCaught: number;
  deckId: number | null;
  ref: string | null;
  source: string;
  dedupeKey: string | null;
  details: unknown;
};

export type AutomationEventsPage = { items: AutomationEventRow[]; nextCursor: string | null };

export type BaselineUpdate = {
  baselineMinutesPerUnit: number;
  baselineSource: 'measured' | 'default';
  note?: string;
};

type Raw = Record<string, unknown>;

function toNumber(value: unknown): number;
function toNumber(value: unknown, nullable: true): number | null;
function toNumber(value: unknown, nullable = false): number | null {
  if (nullable && (value === null || value === undefined)) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return nullable ? null : 0;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function toNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asRecord(value: unknown): Raw {
  return value && typeof value === 'object' ? (value as Raw) : {};
}

function normalizeTotals(value: unknown): LedgerTotals {
  const raw = asRecord(value);
  return {
    runs: toNumber(raw.runs),
    units: toNumber(raw.units),
    baselineMinutes: toNumber(raw.baselineMinutes),
    actualMinutes: toNumber(raw.actualMinutes),
    minutesSaved: toNumber(raw.minutesSaved),
    hoursSaved: toNumber(raw.hoursSaved),
    defectsCaught: toNumber(raw.defectsCaught),
    qaFalsePositives: toNumber(raw.qaFalsePositives),
    bySource: normalizeBySource(raw.bySource),
    byBaselineSource: normalizeByBaselineSource(raw.byBaselineSource),
  };
}

function isRecord(value: unknown): value is Raw {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSourceTotals(value: unknown): LedgerSourceTotals {
  const raw = asRecord(value);
  return {
    runs: toNumber(raw.runs),
    units: toNumber(raw.units),
    minutesSaved: toNumber(raw.minutesSaved),
    hoursSaved: toNumber(raw.hoursSaved),
  };
}

function normalizeBySource(value: unknown): LedgerTotals['bySource'] {
  if (!isRecord(value) || !isRecord(value.live) || !isRecord(value.backfill)) return null;
  return { live: normalizeSourceTotals(value.live), backfill: normalizeSourceTotals(value.backfill) };
}

function normalizeByBaselineSource(value: unknown): LedgerTotals['byBaselineSource'] {
  if (!isRecord(value)) return null;
  return {
    measured: toNumber(asRecord(value.measured).minutesSaved),
    default: toNumber(asRecord(value.default).minutesSaved),
  };
}

function normalizeAgentDrafts(value: unknown): LedgerAgentDrafts | null {
  if (!isRecord(value)) return null;
  return {
    decided: toNumber(value.decided),
    accepted: toNumber(value.accepted),
    editedAccepted: toNumber(value.editedAccepted),
    rejected: toNumber(value.rejected),
    defectRejects: toNumber(value.defectRejects),
    acceptanceRate: toNumber(value.acceptanceRate),
    editedAcceptRate: toNumber(value.editedAcceptRate),
    defectRate: toNumber(value.defectRate),
    avgReviewMinutes: toNumber(value.avgReviewMinutes, true),
  };
}

function normalizeCounts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(asRecord(value))) out[key] = toNumber(n);
  return out;
}

function normalizeAutomationRow(value: unknown): LedgerAutomationRow {
  const raw = asRecord(value);
  return {
    automation: toText(raw.automation),
    unit: toText(raw.unit),
    baselineMinutesPerUnit: toNumber(raw.baselineMinutesPerUnit),
    baselineSource: toText(raw.baselineSource),
    runs: toNumber(raw.runs),
    units: toNumber(raw.units),
    failures: toNumber(raw.failures),
    failureRate: toNumber(raw.failureRate),
    baselineMinutes: toNumber(raw.baselineMinutes),
    actualMinutes: toNumber(raw.actualMinutes),
    minutesSaved: toNumber(raw.minutesSaved),
    defectsCaught: toNumber(raw.defectsCaught),
  };
}

function normalizeSeriesPoint(value: unknown): LedgerSeriesPoint {
  const raw = asRecord(value);
  return {
    periodStart: toText(raw.periodStart),
    automation: toText(raw.automation),
    runs: toNumber(raw.runs),
    units: toNumber(raw.units),
    minutesSaved: toNumber(raw.minutesSaved),
    defectsCaught: toNumber(raw.defectsCaught),
  };
}

function normalizeBaseline(value: unknown): AutomationBaseline {
  const raw = asRecord(value);
  return {
    automation: toText(raw.automation),
    unit: toText(raw.unit),
    baselineMinutesPerUnit: toNumber(raw.baselineMinutesPerUnit),
    baselineSource: toText(raw.baselineSource),
    note: toNullableText(raw.note),
    updatedAt: toNullableText(raw.updatedAt),
  };
}

function normalizeEvent(value: unknown): AutomationEventRow {
  const raw = asRecord(value);
  return {
    id: toNumber(raw.id),
    automation: toText(raw.automation),
    occurredAt: toText(raw.occurredAt),
    units: toNumber(raw.units),
    outcome: toText(raw.outcome),
    actualMinutes: toNumber(raw.actualMinutes, true),
    defectsCaught: toNumber(raw.defectsCaught),
    deckId: toNumber(raw.deckId, true),
    ref: toNullableText(raw.ref),
    source: toText(raw.source),
    dedupeKey: toNullableText(raw.dedupeKey),
    details: raw.details ?? null,
  };
}

/** Only the keys whose value is set, so an unset filter never reaches the query string. */
function setKeys<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(params) as Array<keyof T>) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

/** Re-shapes a success through `normalize`; a failure passes through unchanged. */
function mapSuccess<T>(res: ApiResult<unknown>, normalize: (data: unknown) => T | null): ApiResult<T> {
  if (!res.success) return { ...res, data: null };
  const data = normalize(res.data);
  if (data === null) return failResult<T>('The server sent an unexpected ledger response.', 'BAD_RESPONSE');
  return { ...res, data };
}

export async function fetchAutomationLedger(
  params: { from?: string; to?: string; granularity?: LedgerGranularity } = {},
): Promise<ApiResult<LedgerReport>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/ledger', { params: setKeys(params) });
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      if (!Array.isArray(raw.automations) || !Array.isArray(raw.series)) return null;
      return {
        from: toText(raw.from),
        to: toText(raw.to),
        granularity: toText(raw.granularity) as LedgerGranularity,
        totals: normalizeTotals(raw.totals),
        automations: raw.automations.map(normalizeAutomationRow),
        series: raw.series.map(normalizeSeriesPoint),
        agentDrafts: normalizeAgentDrafts(raw.agentDrafts),
      };
    });
  } catch (err) {
    return apiResultFromError<LedgerReport>(err);
  }
}

export async function fetchAutomationEvents(
  params: { automation?: string; limit?: number; cursor?: string | null } = {},
): Promise<ApiResult<AutomationEventsPage>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/events', { params: setKeys(params) });
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      if (!Array.isArray(raw.items)) return null;
      return {
        items: raw.items.map(normalizeEvent),
        nextCursor: typeof raw.nextCursor === 'string' && raw.nextCursor !== '' ? raw.nextCursor : null,
      };
    });
  } catch (err) {
    return apiResultFromError<AutomationEventsPage>(err);
  }
}

export async function fetchAutomationBaselines(): Promise<ApiResult<{ items: AutomationBaseline[] }>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/baselines');
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      if (!Array.isArray(raw.items)) return null;
      return { items: raw.items.map(normalizeBaseline) };
    });
  } catch (err) {
    return apiResultFromError<{ items: AutomationBaseline[] }>(err);
  }
}

export async function updateAutomationBaseline(
  automation: string,
  input: BaselineUpdate,
): Promise<ApiResult<AutomationBaseline>> {
  try {
    const resp = await http.put<ApiResult<unknown>>(
      `/api/v1/admin/automation/baselines/${encodeURIComponent(automation)}`,
      input,
    );
    return mapSuccess(resp.data, data => (data && typeof data === 'object' ? normalizeBaseline(data) : null));
  } catch (err) {
    return apiResultFromError<AutomationBaseline>(err);
  }
}

/**
 * POST /api/v1/admin/automation/backfill (super_admin): infers ledger rows from
 * publish and import history. `dryRun: true` only counts what would be
 * inserted; rows already present are skipped, so applying twice is harmless.
 */
export async function runAutomationBackfill(dryRun: boolean): Promise<ApiResult<AutomationBackfillResult>> {
  try {
    const resp = await http.post<ApiResult<unknown>>('/api/v1/admin/automation/backfill', { dryRun });
    return mapSuccess(resp.data, data => {
      if (!isRecord(data) || typeof data.dryRun !== 'boolean') return null;
      return { dryRun: data.dryRun, inserted: normalizeCounts(data.inserted), skipped: normalizeCounts(data.skipped) };
    });
  } catch (err) {
    return apiResultFromError<AutomationBackfillResult>(err);
  }
}
