// mobile/src/features/cardReport/cardReportApi.ts
//
// V11 learner card reports (R20 contract §4). Both calls go through apiJson with a
// fresh access token; the routes live under /api/v1/user/ because API Gateway only
// lets mobile tokens through that prefix. The report POST itself is the server-side
// record: there is no queue and no analytics event.
//
// freshToken and authStore are loaded with a guarded dynamic import() inside the function:
// a static import would drag aws-amplify, zustand and the sync layer into every screen
// suite that renders CardDetail, SessionCard or More (same pattern as clientCapabilities).
//
// R28 ANONREPORT (user-perspective review U2): a learner who is not signed in can still report,
// when the remote flag features.cardReport.anonymous is on. That report goes to the public route
// POST /api/v1/public/card-reports with structured fields only — deck slug, card uid, reason code
// and app version: no note, no token, no account or device id. It is sent with the anonymous
// funnel's plain XHR (telemetry/funnel.ts), never apiClient: no Authorization, no x-dc-trace-id
// and no sentry-trace/baggage, so the report cannot be joined to any other request.
import { apiJson } from '../../api/apiClient';
import { classifyError, FRIENDLY_ERROR_COPY } from '../../api/errorKind';
import { getFeatureFlags } from '../../config/featureFlags';
import { resolveApiBase, resolveApiFallback } from '../../config/hosts';
import { createAnonymousXhrPost } from '../../telemetry/funnel';

export const CARD_REPORTS_PATH = '/api/v1/user/card-reports';
export const ANONYMOUS_CARD_REPORTS_PATH = '/api/v1/public/card-reports';
export const CARD_REPORT_NOTE_MAX = 500;
const REQUEST_TIMEOUT_MS = 15000;
const LIST_LIMIT = 50;

export type CardReportReason = 'wrong_answer' | 'outdated' | 'unclear' | 'typo' | 'other';
export type CardReportStatus = 'open' | 'resolved';
export type CardReportResolution = 'fixed' | 'wont_fix' | 'duplicate' | 'invalid';

/** Contract §4 reasons in display order, with plain-English labels. */
export const CARD_REPORT_REASONS: ReadonlyArray<{ value: CardReportReason; label: string }> = Object.freeze([
  { value: 'wrong_answer', label: 'The answer is wrong' },
  { value: 'outdated', label: 'It is out of date' },
  { value: 'unclear', label: 'It is hard to understand' },
  { value: 'typo', label: 'There is a typo' },
  { value: 'other', label: 'Something else' },
]);

export const CARD_REPORT_COPY = Object.freeze({
  entry: 'Report a problem',
  sessionEntry: 'Report',
  signedOut: 'Sign in to report a problem',
  anonymousHint: "You're not signed in, so only this card and the reason are sent — nothing about you. Sign in to add a note.",
  anonymousBusy: 'Too many reports right now. Please try again later.',
  success: 'Thanks — the author will review it',
  duplicate: 'You already reported this card',
  dailyLimit: "You have reached today's report limit",
  unavailable: 'Reporting is unavailable right now',
  notFound: "This card can't be reported right now",
  rejected: "We couldn't send this report. Please try again.",
});

export type SubmitCardReportInput = {
  deckSlug: string;
  stableUid: string;
  reason: CardReportReason;
  note?: string | null;
  clientVersion?: string | null;
};

export type SubmitCardReportResult = { reportId: number | string; status: CardReportStatus; duplicate: boolean };

export type MyCardReport = {
  reportId: number | string;
  deckSlug: string;
  stableUid: string;
  question: string;
  reason: CardReportReason;
  status: CardReportStatus;
  resolution: CardReportResolution | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

/** Thrown before any request when there is no signed-in session. */
export class CardReportSignedOutError extends Error {
  constructor() {
    super('card_report_signed_out');
    this.name = 'CardReportSignedOutError';
  }
}

/**
 * Thrown before any request when the learner is signed in but no access token could be
 * read (fetchAuthSession threw: offline or a temporary failure). Tagged `offline` so
 * cardReportErrorMessage shows FRIENDLY_ERROR_COPY.offline, never the sign-in copy.
 */
export class CardReportTokenUnavailableError extends Error {
  readonly kind = 'offline' as const;
  constructor() {
    super('card_report_token_unavailable');
    this.name = 'CardReportTokenUnavailableError';
  }
}

export type CardReportAuth = { kind: 'token'; token: string } | { kind: 'signed_out' } | { kind: 'unavailable' };

// One shared import for every caller, so concurrent calls (a double tap) reuse it.
let freshTokenModule: Promise<typeof import('../../auth/freshToken')> | null = null;

function loadFreshToken(): Promise<typeof import('../../auth/freshToken')> {
  if (!freshTokenModule) {
    freshTokenModule = import('../../auth/freshToken');
    freshTokenModule.catch(() => {
      freshTokenModule = null;
    });
  }
  return freshTokenModule;
}

/**
 * The current access token, or why there is none. getFreshAccessToken returns null both
 * when signed out and when a signed-in refresh failed (fetchAuthSession threw); the auth
 * store tells them apart, and a refresh that finds the session really expired flips it
 * to anonymous first. If auth cannot load at all there is no session, so: signed out.
 */
export async function getCardReportAuth(): Promise<CardReportAuth> {
  try {
    const token = (await (await loadFreshToken()).getFreshAccessToken()) ?? null;
    if (token) return { kind: 'token', token };
    const { useAuthStore } = await import('../../auth/authStore');
    return useAuthStore.getState().status === 'signed_in' ? { kind: 'unavailable' } : { kind: 'signed_out' };
  } catch {
    return { kind: 'signed_out' };
  }
}

async function requireToken(): Promise<string> {
  const auth = await getCardReportAuth();
  if (auth.kind === 'signed_out') throw new CardReportSignedOutError();
  if (auth.kind === 'unavailable') throw new CardReportTokenUnavailableError();
  return auth.token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The API wraps payloads in `{ success, data, ... }`; accept a bare payload too.
function unwrap(resp: unknown): Record<string, unknown> | null {
  if (!isRecord(resp)) return null;
  return isRecord(resp.data) ? resp.data : resp;
}

/** Trimmed and capped at CARD_REPORT_NOTE_MAX; blank becomes null. */
export function normalizeReportNote(note: string | null | undefined): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim().slice(0, CARD_REPORT_NOTE_MAX).trim();
  return trimmed ? trimmed : null;
}

export async function submitCardReport(input: SubmitCardReportInput): Promise<SubmitCardReportResult> {
  const token = await requireToken();
  const body: Record<string, string> = {
    deckSlug: input.deckSlug,
    stableUid: input.stableUid,
    reason: input.reason,
  };
  const note = normalizeReportNote(input.note);
  if (note) body.note = note;
  if (typeof input.clientVersion === 'string' && input.clientVersion) body.clientVersion = input.clientVersion;

  const resp = await apiJson<unknown>(CARD_REPORTS_PATH, {
    method: 'POST',
    accessToken: token,
    body,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const data = unwrap(resp);
  const reportId = data?.reportId;
  return {
    reportId: typeof reportId === 'number' || typeof reportId === 'string' ? reportId : '',
    status: data?.status === 'resolved' ? 'resolved' : 'open',
    duplicate: data?.duplicate === true,
  };
}

const REASONS = new Set<string>(CARD_REPORT_REASONS.map((r) => r.value));
const RESOLUTIONS = new Set<string>(['fixed', 'wont_fix', 'duplicate', 'invalid']);

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toReport(raw: unknown): MyCardReport | null {
  if (!isRecord(raw)) return null;
  const { reportId } = raw;
  if (typeof reportId !== 'number' && typeof reportId !== 'string') return null;
  const deckSlug = str(raw.deckSlug);
  const stableUid = str(raw.stableUid);
  const reason = str(raw.reason);
  if (!deckSlug || !stableUid || !reason || !REASONS.has(reason)) return null;
  const resolution = str(raw.resolution);
  return {
    reportId,
    deckSlug,
    stableUid,
    question: str(raw.question) ?? '',
    reason: reason as CardReportReason,
    status: raw.status === 'resolved' ? 'resolved' : 'open',
    resolution: resolution && RESOLUTIONS.has(resolution) ? (resolution as CardReportResolution) : null,
    resolutionNote: str(raw.resolutionNote),
    createdAt: str(raw.createdAt) ?? '',
    resolvedAt: str(raw.resolvedAt),
  };
}

/** The signed-in learner's own reports, newest first (server order). */
export async function listMyCardReports(): Promise<MyCardReport[]> {
  const token = await requireToken();
  const resp = await apiJson<unknown>(`${CARD_REPORTS_PATH}?limit=${LIST_LIMIT}`, {
    method: 'GET',
    accessToken: token,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const items = unwrap(resp)?.items;
  if (!Array.isArray(items)) return [];
  return items.map(toReport).filter((item): item is MyCardReport => item !== null);
}

export type SubmitAnonymousCardReportInput = {
  deckSlug: string;
  stableUid: string;
  reason: CardReportReason;
  /** The store version (app.json expo.version), e.g. 2.0.0. */
  appVersion: string;
};

/** features.cardReport.anonymous: a signed-out learner may send the structured report. Read once per sheet. */
export function anonymousCardReportsEnabled(): boolean {
  return getFeatureFlags().cardReport?.anonymous === true;
}

/**
 * POST /api/v1/public/card-reports with exactly `{ deckSlug, stableUid, reason, appVersion }`.
 * Resolves on 202, which the server sends for a new report and for a repeat alike; rejects with
 * `{ status }` or `{ kind }` (see anonymousCardReportErrorMessage).
 */
export async function submitAnonymousCardReport(input: SubmitAnonymousCardReportInput): Promise<void> {
  const body = {
    deckSlug: input.deckSlug,
    stableUid: input.stableUid,
    reason: input.reason,
    appVersion: input.appVersion,
  };
  const post = createAnonymousXhrPost({
    createXhr: () => new XMLHttpRequest(),
    getBases: () => [resolveApiBase(), resolveApiFallback()],
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  await post(ANONYMOUS_CARD_REPORTS_PATH, body);
}

/** Fixed copy for a failed anonymous report: the server's caps are global, not this learner's. */
export function anonymousCardReportErrorMessage(error: unknown): string {
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : null;
  if (status === 429) return CARD_REPORT_COPY.anonymousBusy;
  // 401/403: the public route is not live yet (the path falls to a signed-in route at the gateway).
  if (status === 401 || status === 403) return CARD_REPORT_COPY.unavailable;
  if (status === 413) return CARD_REPORT_COPY.rejected;
  return cardReportErrorMessage(error);
}

/** Fixed, user-facing copy for any failure from the two calls above. */
export function cardReportErrorMessage(error: unknown): string {
  if (error instanceof CardReportSignedOutError) return CARD_REPORT_COPY.signedOut;
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : null;
  if (status === 429) return CARD_REPORT_COPY.dailyLimit;
  if (status === 503) return CARD_REPORT_COPY.unavailable;
  if (status === 404) return CARD_REPORT_COPY.notFound;
  if (status === 400 || status === 409 || status === 422) return CARD_REPORT_COPY.rejected;
  return FRIENDLY_ERROR_COPY[classifyError(error)];
}
