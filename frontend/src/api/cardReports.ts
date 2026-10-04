// src/api/cardReports.ts
// Learner card reports, console side (R20 contract §4): list and resolve, served
// under /api/v1/admin/card-reports. RequireAdmin and deck-scoped on the server.
// Every function returns an ApiResult and never throws. A report note is
// learner-written text: it is kept as a string, capped, and only ever rendered
// as text. R28 ANONREPORT: `anonymous` marks a report sent by a learner who was
// not signed in (no note, no account behind it); it never says who sent anything.
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

export const CARD_REPORT_REASONS = ['wrong_answer', 'outdated', 'unclear', 'typo', 'other'] as const;
export type CardReportReason = (typeof CARD_REPORT_REASONS)[number];

export const CARD_REPORT_RESOLUTIONS = ['fixed', 'wont_fix', 'duplicate', 'invalid'] as const;
export type CardReportResolution = (typeof CARD_REPORT_RESOLUTIONS)[number];

export type CardReportStatus = 'open' | 'resolved';
export type CardReportStatusFilter = CardReportStatus | 'all';

/** The server caps a report note and a resolution note at 500 characters; so does the console. */
export const CARD_REPORT_NOTE_MAX = 500;
/** The contract's page size. */
export const CARD_REPORTS_PAGE_SIZE = 50;

/** One report as the console keeps it. The server never returns a reporter, and neither is kept here. */
export type CardReport = {
  reportId: number;
  deckId: number | null;
  deckSlug: string;
  cardId: number | null;
  stableUid: string;
  question: string;
  reason: CardReportReason;
  note: string | null;
  status: CardReportStatus;
  resolution: CardReportResolution | null;
  resolutionNote: string | null;
  clientVersion: string | null;
  createdAt: string;
  resolvedAt: string | null;
  /** Sent from the public route by a learner who was not signed in (R28). */
  anonymous: boolean;
};

export type CardReportsPage = { items: CardReport[]; nextCursor: string | null };

export type CardReportsParams = {
  status: CardReportStatusFilter;
  deckId?: number | null;
  cursor?: string | null;
  limit?: number;
};

export type CardReportResolveInput = { resolution: CardReportResolution; note?: string | null };
export type CardReportResolveResult = { reportId: number; status: 'resolved'; resolution: CardReportResolution };

const BASE = '/api/v1/admin/card-reports';

function badResponse<T>(): ApiResult<T> {
  return failResult<T>('The server returned an unexpected card reports response.', 'BAD_RESPONSE');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function cappedNote(value: unknown): string | null {
  const text = nullableText(value);
  return text !== null && text.length > CARD_REPORT_NOTE_MAX ? text.slice(0, CARD_REPORT_NOTE_MAX) : text;
}

function isReason(value: unknown): value is CardReportReason {
  return typeof value === 'string' && (CARD_REPORT_REASONS as readonly string[]).includes(value);
}

function isResolution(value: unknown): value is CardReportResolution {
  return typeof value === 'string' && (CARD_REPORT_RESOLUTIONS as readonly string[]).includes(value);
}

function normalizeReport(value: unknown): CardReport | null {
  if (!isRecord(value)) return null;
  const reportId = idOf(value.reportId);
  if (reportId === null) return null;
  return {
    reportId,
    deckId: idOf(value.deckId),
    deckSlug: textOf(value.deckSlug),
    cardId: idOf(value.cardId),
    stableUid: textOf(value.stableUid),
    question: textOf(value.question),
    reason: isReason(value.reason) ? value.reason : 'other',
    note: cappedNote(value.note),
    status: value.status === 'resolved' ? 'resolved' : 'open',
    resolution: isResolution(value.resolution) ? value.resolution : null,
    resolutionNote: cappedNote(value.resolutionNote),
    clientVersion: nullableText(value.clientVersion),
    createdAt: textOf(value.createdAt),
    resolvedAt: nullableText(value.resolvedAt),
    anonymous: value.anonymous === true,
  };
}

/** GET /api/v1/admin/card-reports?status=&deckId=&limit=&cursor=, newest first. */
export async function listCardReports(params: CardReportsParams): Promise<ApiResult<CardReportsPage>> {
  const query: Record<string, string | number> = { status: params.status };
  if (params.deckId) query.deckId = params.deckId;
  if (params.cursor) query.cursor = params.cursor;
  query.limit = params.limit ?? CARD_REPORTS_PAGE_SIZE;
  try {
    const resp = await http.get<ApiResult<unknown>>(BASE, { params: query });
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    const data = res.data;
    if (!isRecord(data) || !Array.isArray(data.items)) return badResponse();
    return {
      ...res,
      data: {
        items: data.items.map(normalizeReport).filter((r): r is CardReport => r !== null),
        nextCursor: typeof data.nextCursor === 'string' && data.nextCursor !== '' ? data.nextCursor : null,
      },
    };
  } catch (err) {
    return apiResultFromError<CardReportsPage>(err);
  }
}

/** POST /api/v1/admin/card-reports/:reportId/resolve (deck write). A blank note is left out. */
export async function resolveCardReport(
  reportId: number,
  input: CardReportResolveInput,
): Promise<ApiResult<CardReportResolveResult>> {
  const note = (input.note ?? '').trim();
  const body: { resolution: CardReportResolution; note?: string } = { resolution: input.resolution };
  if (note !== '') body.note = note.slice(0, CARD_REPORT_NOTE_MAX);
  try {
    const resp = await http.post<ApiResult<unknown>>(`${BASE}/${reportId}/resolve`, body);
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    const data = res.data;
    if (!isRecord(data) || idOf(data.reportId) === null || !isResolution(data.resolution)) return badResponse();
    return { ...res, data: { reportId: data.reportId as number, status: 'resolved', resolution: data.resolution } };
  } catch (err) {
    return apiResultFromError<CardReportResolveResult>(err);
  }
}

/** The card editor's deep link for a report, or null when the card or deck is gone. */
export function cardReportEditorHref(report: Pick<CardReport, 'deckId' | 'cardId'>): string | null {
  if (report.deckId === null || report.cardId === null) return null;
  return `/decks/cards/edit?deckId=${report.deckId}&cardId=${report.cardId}`;
}
