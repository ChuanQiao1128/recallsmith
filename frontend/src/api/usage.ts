// src/api/usage.ts
// Learner usage analytics and publish freshness, console side (R20 contract §7):
//   GET /api/v1/admin/analytics/usage?days=30
//   GET /api/v1/admin/automation/freshness?days=30
// and the anonymous install funnel (R24 contract §3.2, §3.5):
//   GET /api/v1/admin/analytics/funnel?days=90
// All are RequireAdmin and read-only. Every function returns an ApiResult and
// never throws. Postgres int and numeric columns may arrive as numeric strings,
// so every number is coerced here; a figure the server has not computed yet
// (a column added by migration 040, or a retention that has not matured) stays
// null and the page shows "—".
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

/** The contract's default window, in days. */
export const USAGE_DAYS = 30;

/** One complete UTC day of learner activity. */
export type UsageDay = {
  /** YYYY-MM-DD (UTC). */
  day: string;
  dau: number | null;
  wau: number | null;
  mau: number | null;
  reviews: number | null;
  newUsers: number | null;
  cardsLearned: number | null;
  /** Share (0..1) of that day's new users active exactly 1 day later; null until matured. */
  d1Retention: number | null;
  /** Share (0..1) of that day's new users active exactly 7 days later; null until matured. */
  d7Retention: number | null;
};

export type UsageDeck = {
  deckSlug: string;
  activeUsers30d: number | null;
  reviews30d: number | null;
  newLearners30d: number | null;
};

export type UsageReport = {
  days: UsageDay[];
  decks: UsageDeck[];
  excludedSubsCount: number;
  lastComputedAt: string | null;
};

export type FreshnessKind = 'page' | 'feed';

/** One detected source change followed through queue, draft, decision and publish. */
export type FreshnessItem = {
  kind: FreshnessKind;
  refId: string;
  title: string | null;
  detectedAt: string | null;
  queuedAt: string | null;
  draftedAt: string | null;
  decidedAt: string | null;
  publishedAt: string | null;
};

export type FreshnessReport = {
  items: FreshnessItem[];
  medians: { minutesToDraft: number | null; minutesToDecision: number | null; minutesToPublish: number | null };
  n: number;
};

/** The funnel's default window, in days (R24 contract §3.2). */
export const FUNNEL_DAYS = 90;

/** The anonymous funnel events in funnel order (R24 contract §3.1). */
export const FUNNEL_EVENTS = [
  'first_open',
  'goal_chosen',
  'starter_started',
  'starter_completed',
  'first_pack_opened',
  'returned_day_1',
  'returned_day_7',
  'signup_started',
  'signup_completed',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** The events that carry a deckSlug, counted per deck by the server. */
export const FUNNEL_DECK_EVENTS = ['goal_chosen', 'starter_started', 'starter_completed', 'first_pack_opened'] as const;

export type FunnelDeckEvent = (typeof FUNNEL_DECK_EVENTS)[number];

/** Installs that reached each event; null where the server sent no figure. */
export type FunnelCounts = Record<FunnelEvent, number | null>;

export type FunnelDeckCounts = Record<FunnelDeckEvent, number | null>;

/** One ISO cohort week: installs whose first open fell in the week starting that Monday. */
export type FunnelWeek = {
  /** YYYY-MM-DD, the Monday the cohort week starts. */
  weekStart: string;
  counts: FunnelCounts;
};

export type FunnelDeck = { deckSlug: string; counts: FunnelDeckCounts };

export type FunnelReport = {
  days: number;
  overall: FunnelCounts;
  weeks: FunnelWeek[];
  decks: FunnelDeck[];
};

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Raw {
  return isRecord(value) ? value : {};
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function badResponse<T>(what: string): ApiResult<T> {
  return failResult<T>(`The server returned an unexpected ${what} response.`, 'BAD_RESPONSE');
}

function normalizeDay(value: unknown): UsageDay | null {
  if (!isRecord(value)) return null;
  const day = nullableText(value.day);
  if (day === null) return null;
  return {
    day,
    dau: nullableNumber(value.dau),
    wau: nullableNumber(value.wau),
    mau: nullableNumber(value.mau),
    reviews: nullableNumber(value.reviews),
    newUsers: nullableNumber(value.newUsers),
    cardsLearned: nullableNumber(value.cardsLearned),
    d1Retention: nullableNumber(value.d1Retention),
    d7Retention: nullableNumber(value.d7Retention),
  };
}

function normalizeDeck(value: unknown): UsageDeck | null {
  if (!isRecord(value)) return null;
  const deckSlug = nullableText(value.deckSlug);
  if (deckSlug === null) return null;
  return {
    deckSlug,
    activeUsers30d: nullableNumber(value.activeUsers30d),
    reviews30d: nullableNumber(value.reviews30d),
    newLearners30d: nullableNumber(value.newLearners30d),
  };
}

function normalizeFreshnessItem(value: unknown): FreshnessItem | null {
  if (!isRecord(value)) return null;
  const refId = value.refId === null || value.refId === undefined ? '' : String(value.refId);
  if (refId === '') return null;
  return {
    kind: value.kind === 'feed' ? 'feed' : 'page',
    refId,
    title: nullableText(value.title),
    detectedAt: nullableText(value.detectedAt),
    queuedAt: nullableText(value.queuedAt),
    draftedAt: nullableText(value.draftedAt),
    decidedAt: nullableText(value.decidedAt),
    publishedAt: nullableText(value.publishedAt),
  };
}

/**
 * The counts of `events` from `value.counts`, keyed by the snake_case event
 * name. The server always sends every event (0 when none), so a missing
 * `counts` object or a missing key means a shape this client does not know:
 * null, which the caller turns into BAD_RESPONSE rather than an empty funnel.
 */
function readCounts<E extends string>(value: unknown, events: readonly E[]): Record<E, number | null> | null {
  if (!isRecord(value) || !isRecord(value.counts)) return null;
  const source = value.counts;
  const out = {} as Record<E, number | null>;
  for (const event of events) {
    if (!(event in source)) return null;
    out[event] = nullableNumber(source[event]);
  }
  return out;
}

function normalizeFunnelWeek(value: unknown): FunnelWeek | null {
  if (!isRecord(value)) return null;
  const weekStart = nullableText(value.weekStart);
  const counts = readCounts(value, FUNNEL_EVENTS);
  return weekStart === null || counts === null ? null : { weekStart, counts };
}

/** The server leaves out events without a deck slug, so a row without one is a shape error. */
function normalizeFunnelDeck(value: unknown): FunnelDeck | null {
  if (!isRecord(value)) return null;
  const deckSlug = nullableText(value.deckSlug);
  const counts = readCounts(value, FUNNEL_DECK_EVENTS);
  return deckSlug === null || counts === null ? null : { deckSlug, counts };
}

/** GET /api/v1/admin/analytics/usage?days=. `503 NOT_READY` passes through as the error code. */
export async function fetchUsage(days: number = USAGE_DAYS): Promise<ApiResult<UsageReport>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/analytics/usage', { params: { days } });
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    const data = res.data;
    if (!isRecord(data) || !Array.isArray(data.days)) return badResponse('usage');
    return {
      ...res,
      data: {
        days: data.days.map(normalizeDay).filter((d): d is UsageDay => d !== null),
        decks: Array.isArray(data.decks) ? data.decks.map(normalizeDeck).filter((d): d is UsageDeck => d !== null) : [],
        excludedSubsCount: nullableNumber(data.excludedSubsCount) ?? 0,
        lastComputedAt: nullableText(data.lastComputedAt),
      },
    };
  } catch (err) {
    return apiResultFromError<UsageReport>(err);
  }
}

/** GET /api/v1/admin/automation/freshness?days=. */
export async function fetchFreshness(days: number = USAGE_DAYS): Promise<ApiResult<FreshnessReport>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/automation/freshness', { params: { days } });
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    const data = res.data;
    if (!isRecord(data) || !Array.isArray(data.items)) return badResponse('freshness');
    const medians = asRecord(data.medians);
    return {
      ...res,
      data: {
        items: data.items.map(normalizeFreshnessItem).filter((i): i is FreshnessItem => i !== null),
        medians: {
          minutesToDraft: nullableNumber(medians.minutesToDraft),
          minutesToDecision: nullableNumber(medians.minutesToDecision),
          minutesToPublish: nullableNumber(medians.minutesToPublish),
        },
        n: nullableNumber(data.n) ?? 0,
      },
    };
  } catch (err) {
    return apiResultFromError<FreshnessReport>(err);
  }
}

/**
 * GET /api/v1/admin/analytics/funnel?days=. The server (AnonFunnel.HandleFunnel)
 * sends { days, fromCohortDay, events, overall: { counts, conversion },
 * weeks: [{ weekStart, counts, conversion }], byDeck: [{ deckSlug, counts }] }
 * with counts keyed by the snake_case event names; the page derives the
 * conversions. Anything else (a missing overall, weeks or byDeck, or any row
 * in another shape) is BAD_RESPONSE, never an empty funnel. A refusal such as
 * `503 NOT_READY` passes through with its error code.
 */
export async function fetchFunnel(days: number = FUNNEL_DAYS): Promise<ApiResult<FunnelReport>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/analytics/funnel', { params: { days } });
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    const data = res.data;
    if (!isRecord(data) || !Array.isArray(data.weeks) || !Array.isArray(data.byDeck)) return badResponse('funnel');
    const overall = readCounts(data.overall, FUNNEL_EVENTS);
    const weeks = data.weeks.map(normalizeFunnelWeek);
    const decks = data.byDeck.map(normalizeFunnelDeck);
    if (overall === null || weeks.includes(null) || decks.includes(null)) return badResponse('funnel');
    return {
      ...res,
      data: {
        days: nullableNumber(data.days) ?? days,
        overall,
        weeks: weeks.filter((w): w is FunnelWeek => w !== null),
        decks: decks.filter((d): d is FunnelDeck => d !== null),
      },
    };
  } catch (err) {
    return apiResultFromError<FunnelReport>(err);
  }
}

/** The latest day in the report (the server sends complete UTC days only), or null when there is none. */
export function latestUsageDay(days: UsageDay[]): UsageDay | null {
  let latest: UsageDay | null = null;
  for (const d of days) if (latest === null || d.day > latest.day) latest = d;
  return latest;
}
