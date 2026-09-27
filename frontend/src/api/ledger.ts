// src/api/ledger.ts
// Automation Ledger API (R18 contract §9.4), served under /api/v1/admin/automation/.
// Every call returns an ApiResult and never throws, like src/api/admin.ts.
// Postgres `numeric` columns may arrive as numbers or numeric strings, so every
// numeric field is coerced here and the page only ever sees numbers.
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

export type LedgerGranularity = 'day' | 'week' | 'month';

export type LedgerTotals = {
  runs: number;
  units: number;
  baselineMinutes: number;
  actualMinutes: number;
  minutesSaved: number;
  hoursSaved: number;
  defectsCaught: number;
  qaFalsePositives: number;
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
  };
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
