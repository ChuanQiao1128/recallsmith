// src/api/qa.ts
// Pre-publish AI QA API (R18 contract §7.2, §7.3, §7.10), served under
// /api/v1/authoring/qa. Every call returns an ApiResult and never throws, like
// src/api/admin.ts.
// The contract does not fix whether the id keys are `id` or `runId`/`findingId`,
// so the client accepts both. Counters and costs are coerced with Number(),
// because a Postgres bigint or numeric may arrive as a string.
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

export type QaScope = 'changed' | 'all' | 'cards';
export type QaRunStatus = 'queued' | 'running' | 'done' | 'failed';
export type QaItemStatus = 'queued' | 'done' | 'error' | 'refused' | 'skipped';
export type QaSeverity = 'blocker' | 'major' | 'minor';
export type QaResolution = 'open' | 'fixed' | 'dismissed';

export type QaRun = {
  runId: string;
  deckId: number;
  scope: string;
  status: string;
  effectiveStatus: QaRunStatus;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  /** Who started the run; `automation` for the runs the automation starts (A00 §5.6, §9.6). */
  requestedBySub?: string | null;
  cardCount: number;
  chunkCount: number;
  cardsDone: number;
  errorCount: number;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string | null;
  finishedAt: string | null;
};

export type QaItem = {
  cardId: number;
  stableUid: string;
  contentSha256: string | null;
  status: QaItemStatus;
  errorCode: string | null;
  latencyMs: number | null;
  estimatedCostUsd: number;
};

export type QaFinding = {
  findingId: number;
  runId: string;
  cardId: number;
  severity: QaSeverity;
  category: string;
  message: string;
  suggestedFix: string | null;
  resolution: QaResolution;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

export type QaRunDetail = { run: QaRun; items: QaItem[]; findings: QaFinding[] };

export type QaRunsPage = { items: QaRun[]; nextCursor: string | null };

export type QaStatus = {
  enabled: boolean;
  required: boolean;
  changedCards: number;
  reviewedCurrent: number;
  missing: Array<{ cardId: number; stableUid: string }>;
  openBlockers: Array<{ findingId: number; cardId: number; stableUid: string; category: string; message: string }>;
  wouldBlock: boolean;
  /**
   * The server's run limits (AI_QA_MAX_CARDS, AI_QA_DAILY_USD_CAP), today's
   * spend and today's reserved (in-flight) spend, read from `data.limits`
   * (the r18y cross-wave contract) when the status response carries it; null
   * otherwise, and the page falls back to the labelled defaults in
   * src/lib/qaReview.ts.
   */
  maxCards: number | null;
  dailyUsdCap: number | null;
  spentTodayUsd: number | null;
  reservedTodayUsd: number | null;
  /** What the server reserves per card against the daily cap (data.limits.estUsdPerCard); null when not sent. */
  estUsdPerCard: number | null;
};

export type QaStartResult = { runId: string; status: string; cardCount: number; chunkCount: number };

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

/** A counter or cost: anything non-finite becomes 0. */
function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function toNullableText(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function toId(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

const RUN_STATUSES: readonly string[] = ['queued', 'running', 'done', 'failed'];
const ITEM_STATUSES: readonly string[] = ['queued', 'done', 'error', 'refused', 'skipped'];
const SEVERITIES: readonly string[] = ['blocker', 'major', 'minor'];
const RESOLUTIONS: readonly string[] = ['open', 'fixed', 'dismissed'];

function toRunStatus(value: unknown): QaRunStatus {
  return typeof value === 'string' && RUN_STATUSES.includes(value) ? (value as QaRunStatus) : 'failed';
}

export function normalizeQaRun(raw: unknown): QaRun | null {
  const r = asRecord(raw);
  if (!r) return null;
  const runId = toId(r.runId ?? r.id);
  if (runId === null) return null;
  return {
    runId,
    deckId: toCount(r.deckId),
    scope: toText(r.scope),
    status: toText(r.status),
    effectiveStatus: toRunStatus(r.effectiveStatus ?? r.status),
    provider: toNullableText(r.provider),
    model: toNullableText(r.model),
    promptVersion: toNullableText(r.promptVersion),
    requestedBySub: toNullableText(r.requestedBySub),
    cardCount: toCount(r.cardCount),
    chunkCount: toCount(r.chunkCount),
    cardsDone: toCount(r.cardsDone),
    errorCount: toCount(r.errorCount),
    blockerCount: toCount(r.blockerCount),
    majorCount: toCount(r.majorCount),
    minorCount: toCount(r.minorCount),
    inputTokens: toCount(r.inputTokens),
    outputTokens: toCount(r.outputTokens),
    cacheReadTokens: toCount(r.cacheReadTokens),
    estimatedCostUsd: toCount(r.estimatedCostUsd),
    errorCode: toNullableText(r.errorCode),
    createdAt: toText(r.createdAt),
    updatedAt: toNullableText(r.updatedAt),
    finishedAt: toNullableText(r.finishedAt),
  };
}

function normalizeQaItem(raw: unknown): QaItem | null {
  const r = asRecord(raw);
  if (!r) return null;
  const cardId = toNumberOrNull(r.cardId);
  if (cardId === null) return null;
  return {
    cardId,
    stableUid: toText(r.stableUid),
    contentSha256: toNullableText(r.contentSha256),
    status: typeof r.status === 'string' && ITEM_STATUSES.includes(r.status) ? (r.status as QaItemStatus) : 'queued',
    errorCode: toNullableText(r.errorCode),
    latencyMs: toNumberOrNull(r.latencyMs),
    estimatedCostUsd: toCount(r.estimatedCostUsd),
  };
}

export function normalizeQaFinding(raw: unknown): QaFinding | null {
  const r = asRecord(raw);
  if (!r) return null;
  const findingId = toNumberOrNull(r.findingId ?? r.id);
  const cardId = toNumberOrNull(r.cardId);
  if (findingId === null || cardId === null) return null;
  return {
    findingId,
    runId: toText(r.runId),
    cardId,
    severity: typeof r.severity === 'string' && SEVERITIES.includes(r.severity) ? (r.severity as QaSeverity) : 'minor',
    category: toText(r.category) || 'other',
    message: toText(r.message),
    suggestedFix: toNullableText(r.suggestedFix),
    resolution:
      typeof r.resolution === 'string' && RESOLUTIONS.includes(r.resolution) ? (r.resolution as QaResolution) : 'open',
    resolvedAt: toNullableText(r.resolvedAt),
    resolutionNote: toNullableText(r.resolutionNote),
    createdAt: toText(r.createdAt),
  };
}

function normalizeList<T>(value: unknown, normalize: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalize).filter((x): x is T => x !== null);
}

function normalizeRunDetail(data: unknown): QaRunDetail | null {
  const raw = asRecord(data);
  if (!raw) return null;
  const run = normalizeQaRun(raw.run);
  if (!run || !Array.isArray(raw.items) || !Array.isArray(raw.findings)) return null;
  return { run, items: normalizeList(raw.items, normalizeQaItem), findings: normalizeList(raw.findings, normalizeQaFinding) };
}

function toPositiveOrNull(value: unknown): number | null {
  const n = toNumberOrNull(value);
  return n !== null && n > 0 ? n : null;
}

function toNonNegativeOrNull(value: unknown): number | null {
  const n = toNumberOrNull(value);
  return n !== null && n >= 0 ? n : null;
}

function normalizeStatus(data: unknown): QaStatus | null {
  const raw = asRecord(data);
  if (!raw || typeof raw.enabled !== 'boolean') return null;
  const missing = normalizeList(raw.missing, value => {
    const r = asRecord(value);
    const cardId = r ? toNumberOrNull(r.cardId) : null;
    return r && cardId !== null ? { cardId, stableUid: toText(r.stableUid) } : null;
  });
  const openBlockers = normalizeList(raw.openBlockers, value => {
    const r = asRecord(value);
    if (!r) return null;
    const findingId = toNumberOrNull(r.findingId ?? r.id);
    const cardId = toNumberOrNull(r.cardId);
    if (findingId === null || cardId === null) return null;
    return {
      findingId,
      cardId,
      stableUid: toText(r.stableUid),
      category: toText(r.category) || 'other',
      message: toText(r.message),
    };
  });
  // GET …/qa/status carries the limits under data.limits. A server from before
  // that contract sends none, so every limit is null and the page falls back.
  const limits = asRecord(raw.limits) ?? {};
  return {
    enabled: raw.enabled,
    required: raw.required === true,
    changedCards: toCount(raw.changedCards),
    reviewedCurrent: toCount(raw.reviewedCurrent),
    missing,
    openBlockers,
    wouldBlock: raw.wouldBlock === true,
    maxCards: toPositiveOrNull(limits.maxCards),
    dailyUsdCap: toPositiveOrNull(limits.dailyUsdCap),
    spentTodayUsd: toNonNegativeOrNull(limits.spentTodayUsd),
    reservedTodayUsd: toNonNegativeOrNull(limits.reservedTodayUsd),
    estUsdPerCard: toPositiveOrNull(limits.estUsdPerCard),
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
  if (data === null) return failResult<T>('The server sent an unexpected AI QA response.', 'BAD_RESPONSE');
  return { ...res, data };
}

export async function startQaRun(input: {
  deckId: number;
  scope: QaScope;
  cardIds?: number[];
}): Promise<ApiResult<QaStartResult>> {
  const body =
    input.scope === 'cards'
      ? { deckId: input.deckId, scope: input.scope, cardIds: input.cardIds ?? [] }
      : { deckId: input.deckId, scope: input.scope };
  try {
    const resp = await http.post<ApiResult<unknown>>('/api/v1/authoring/qa/runs', body);
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      const runId = raw ? toId(raw.runId ?? raw.id) : null;
      if (!raw || runId === null) return null;
      return {
        runId,
        status: toText(raw.status) || 'queued',
        cardCount: toCount(raw.cardCount),
        chunkCount: toCount(raw.chunkCount),
      };
    });
  } catch (err) {
    return apiResultFromError<QaStartResult>(err);
  }
}

export async function listQaRuns(params: {
  deckId: number;
  limit?: number;
  cursor?: string | null;
}): Promise<ApiResult<QaRunsPage>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/authoring/qa/runs', { params: setKeys(params) });
    return mapSuccess(resp.data, data => {
      const raw = asRecord(data);
      if (!raw || !Array.isArray(raw.items)) return null;
      return {
        items: normalizeList(raw.items, normalizeQaRun),
        nextCursor: typeof raw.nextCursor === 'string' && raw.nextCursor !== '' ? raw.nextCursor : null,
      };
    });
  } catch (err) {
    return apiResultFromError<QaRunsPage>(err);
  }
}

export async function fetchQaRun(runId: string): Promise<ApiResult<QaRunDetail>> {
  try {
    const resp = await http.get<ApiResult<unknown>>(`/api/v1/authoring/qa/runs/${encodeURIComponent(runId)}`);
    return mapSuccess(resp.data, normalizeRunDetail);
  } catch (err) {
    return apiResultFromError<QaRunDetail>(err);
  }
}

export async function fetchQaStatus(deckId: number): Promise<ApiResult<QaStatus>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/authoring/qa/status', { params: { deckId } });
    return mapSuccess(resp.data, normalizeStatus);
  } catch (err) {
    return apiResultFromError<QaStatus>(err);
  }
}

/**
 * `reviewMs` is the person's triage time for this finding (automation-16):
 * visible time only, capped at REVIEW_MS_CAP like a draft decision; the server
 * charges it to the ai_qa_review ledger row. Omitted, the row reads "not measured".
 */
export async function resolveQaFinding(
  findingId: number,
  body: { resolution: 'fixed' | 'dismissed'; note?: string; reviewMs?: number },
): Promise<ApiResult<QaFinding | null>> {
  try {
    const resp = await http.post<ApiResult<unknown>>(`/api/v1/authoring/qa/findings/${findingId}/resolve`, body);
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    return { ...res, data: normalizeQaFinding(res.data) };
  } catch (err) {
    return apiResultFromError<QaFinding | null>(err);
  }
}
