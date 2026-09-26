// src/api/authoring.ts
import type { ApiResult } from '../types/api';
import type { Deck, DeckAvailability, DeckTier } from '../types/deck';
import type { Card } from '../types/card';
import type { McqBlob } from '../types/mcq';
import axios from 'axios';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';
import { dedupeRequest, DedupeKeys } from './dedupe';

// ---------------------- normalization helpers ----------------------

type UnknownRecord = Record<string, unknown>;

function toInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toOptionalInt(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeDeck(d: Deck | null | undefined): Deck | null {
  if (!d) return null;
  const o = d as unknown as UnknownRecord;

  return {
    ...d,
    id: toInt(o.id, d.id),
    deckType: toInt(o.deckType, d.deckType),
    version: toInt(o.version, d.version),

    isDeleted: o.isDeleted === undefined ? d.isDeleted : toInt(o.isDeleted, d.isDeleted ?? 0),

    manifestOrder:
      o.manifestOrder === undefined ? d.manifestOrder : (toOptionalInt(o.manifestOrder) ?? null),

    totalCards:
      o.totalCards === undefined ? d.totalCards : (toOptionalInt(o.totalCards) ?? null),

    previewCards:
      o.previewCards === undefined ? d.previewCards : (toOptionalInt(o.previewCards) ?? null),

    retiredAtMs:
      o.retiredAtMs === undefined ? d.retiredAtMs : (toOptionalInt(o.retiredAtMs) ?? null),

    tier: (o.tier === undefined ? d.tier : (o.tier as DeckTier | null)) ?? null,
    availability: (o.availability === undefined ? d.availability : (o.availability as DeckAvailability | null)) ?? null,
    eta: (o.eta === undefined ? d.eta : (o.eta as string | null)) ?? null,
  };
}

function normalizeCard(c: Card): Card {
  const o = c as unknown as UnknownRecord;

  return {
    ...c,
    id: toInt(o.id, c.id),
    deckId: toInt(o.deckId, c.deckId),
    difficulty: toInt(o.difficulty, c.difficulty),
    orderInDeck: toInt(o.orderInDeck, c.orderInDeck),
    revision: o.revision === undefined ? c.revision : (toOptionalInt(o.revision) ?? null),
    version: toInt(o.version, c.version),
    isDeleted: o.isDeleted === undefined ? c.isDeleted : toInt(o.isDeleted, c.isDeleted ?? 0),
  };
}

// Small helper: guarantees a stableUid is present.
function ensureStableUid(input?: string): string {
  const v = (input ?? '').trim();
  if (v) return v;
  return `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------- decks ----------------------

export async function fetchDecks(): Promise<ApiResult<Deck[]>> {
  return dedupeRequest(DedupeKeys.decks(), async () => {
    try {
      const resp = await http.get<ApiResult<Deck[]>>('/api/v1/authoring/decks');
      const raw = resp.data;

      if (!raw.success) return raw;

      const list = raw.data ?? [];
      const normalized = list.map(normalizeDeck).filter((d): d is Deck => d !== null);

      return { ...raw, data: normalized };
    } catch (err) {
      return apiResultFromError<Deck[]>(err);
    }
  });
}

export async function fetchDeckById(id: number): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.get<ApiResult<Deck[]>>('/api/v1/authoring/decks', {
      params: { id },
    });
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const list = raw.data ?? [];
    if (list.length === 0) {
      return failResult<Deck>('Deck not found', 'NOT_FOUND');
    }
    const normalized = normalizeDeck(list[0]);
    if (!normalized) {
      return failResult<Deck>('Invalid deck data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalized };
  } catch (err) {
    return apiResultFromError<Deck>(err);
  }
}

export async function fetchDeckBySlug(slug: string): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.get<ApiResult<Deck[]>>('/api/v1/authoring/decks', {
      params: { slug },
    });
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const list = raw.data ?? [];
    if (list.length === 0) {
      return failResult<Deck>('Deck not found', 'NOT_FOUND');
    }
    const normalized = normalizeDeck(list[0]);
    if (!normalized) {
      return failResult<Deck>('Invalid deck data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalized };
  } catch (err) {
    return apiResultFromError<Deck>(err);
  }
}

export async function createDeck(params: {
  title: string;
  slug?: string;
  description?: string;
  author?: string;
  locale?: string;
  deckType?: number;
  version?: number;
}): Promise<ApiResult<Deck>> {
  try {
    // A JSON body throughout, matching updateDeck.
    //
    // Forwarded on `!== undefined` rather than on truthiness: a cleared
    // description is '' and must be sent, and deckType/version of a Starter deck
    // are the meaningful values 1, which truthiness would keep but 0 would not.
    const body: Record<string, unknown> = { title: params.title };
    if (params.slug !== undefined) body.slug = params.slug;
    if (params.description !== undefined) body.description = params.description;
    if (params.author !== undefined) body.author = params.author;
    if (params.locale !== undefined) body.locale = params.locale;
    if (params.deckType !== undefined) body.deckType = params.deckType;
    if (params.version !== undefined) body.version = params.version;

    const resp = await http.post<ApiResult<Deck>>('/api/v1/authoring/decks', body);
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const deck = raw.data;
    if (!deck) {
      return failResult<Deck>('Create deck failed: no data returned', 'SERVER_ERROR');
    }
    const normalized = normalizeDeck(deck);
    if (!normalized) {
      return failResult<Deck>('Invalid deck data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalized };
  } catch (err) {
    return apiResultFromError<Deck>(err);
  }
}

export async function updateDeck(
  id: number,
  params: {
    title?: string;
    slug?: string;
    description?: string;
    author?: string;
    locale?: string;
    deckType?: number;
    version?: number;
    manifestOrder?: number | null;
    availability?: DeckAvailability | null;
    tier?: DeckTier | null;
    eta?: string | null;
    retiredAtMs?: number | null;
    totalCards?: number | null;
    previewCards?: number | null;
  }
): Promise<ApiResult<Deck>> {
  try {
    // Backend expects JSON body for PUT, not query string
    const body: Record<string, unknown> = { id };
    if (params.title !== undefined) body.title = params.title;
    if (params.slug !== undefined) body.slug = params.slug;
    if (params.description !== undefined) body.description = params.description;
    if (params.author !== undefined) body.author = params.author;
    if (params.locale !== undefined) body.locale = params.locale;
    if (params.deckType !== undefined) body.deckType = params.deckType;
    if (params.version !== undefined) body.version = params.version;
    if (params.manifestOrder !== undefined) body.manifestOrder = params.manifestOrder;
    if (params.availability !== undefined) body.availability = params.availability;
    if (params.tier !== undefined) body.tier = params.tier;
    if (params.eta !== undefined) body.eta = params.eta;
    if (params.retiredAtMs !== undefined) body.retiredAtMs = params.retiredAtMs;
    if (params.totalCards !== undefined) body.totalCards = params.totalCards;
    if (params.previewCards !== undefined) body.previewCards = params.previewCards;

    // Backend returns single deck object, not array
    const resp = await http.put<ApiResult<Deck>>('/api/v1/authoring/decks', body);
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const deck = raw.data;
    if (!deck) {
      return failResult<Deck>('Update deck failed: no data returned', 'SERVER_ERROR');
    }
    const normalized = normalizeDeck(deck);
    if (!normalized) {
      return failResult<Deck>('Invalid deck data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalized };
  } catch (err) {
    return apiResultFromError<Deck>(err);
  }
}

export async function deleteDeck(id: number): Promise<ApiResult<null>> {
  try {
    // Backend reads id from the query string only (same as deleteCard);
    // a JSON body is ignored by the DELETE handler.
    const resp = await http.delete<ApiResult<null>>(
      `/api/v1/authoring/decks?id=${encodeURIComponent(id)}`,
    );
    return resp.data;
  } catch (err) {
    return apiResultFromError<null>(err);
  }
}

// ---------------------- admin decks (keyset-paginated) ----------------------

/** error.code returned when GET /api/v1/admin/decks is not deployed (HTTP 404). */
export const ADMIN_DECKS_ENDPOINT_MISSING = 'ENDPOINT_NOT_FOUND';

export interface AdminDeckListItem {
  slug: string;
  title: string;
  /** Numeric deck id if the server includes it (not guaranteed by the contract). */
  id?: number | null;
  /** Present only if the server includes it; UI falls back to `tier`. */
  deckType?: number | null;
  tier?: string | null;
  availability?: string | null;
  totalCards?: number | null;
  version?: number | null;
  updatedAtMs?: number | null;
  latestBuildId?: string | null;
}

export interface AdminDecksPage {
  items: AdminDeckListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

function normalizeAdminDeckItem(v: unknown): AdminDeckListItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as UnknownRecord;

  const slug = typeof o.slug === 'string' ? o.slug.trim() : '';
  if (!slug) return null;

  return {
    slug,
    title: typeof o.title === 'string' ? o.title : '',
    id: toOptionalInt(o.id) ?? null,
    deckType: toOptionalInt(o.deckType) ?? null,
    tier: typeof o.tier === 'string' && o.tier ? o.tier : null,
    availability: typeof o.availability === 'string' && o.availability ? o.availability : null,
    totalCards: toOptionalInt(o.totalCards) ?? null,
    version: toOptionalInt(o.version) ?? null,
    updatedAtMs: toOptionalInt(o.updatedAtMs) ?? null,
    latestBuildId:
      typeof o.latestBuildId === 'string' && o.latestBuildId.trim()
        ? o.latestBuildId.trim()
        : null,
  };
}

function normalizeAdminDecksPage(raw: unknown): AdminDecksPage {
  const o = (raw && typeof raw === 'object' ? raw : {}) as UnknownRecord;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items = itemsRaw
    .map(normalizeAdminDeckItem)
    .filter((i): i is AdminDeckListItem => i !== null);
  const nextCursor = typeof o.nextCursor === 'string' && o.nextCursor ? o.nextCursor : null;
  return { items, nextCursor, hasMore: o.hasMore === true };
}

/**
 * GET /api/v1/admin/decks?limit=&cursor=&q= — keyset-paginated deck list.
 * Returns error.code ADMIN_DECKS_ENDPOINT_MISSING on HTTP 404 so callers can
 * feature-detect and fall back to the legacy full-list load.
 */
export async function fetchAdminDecksPage(
  params: { limit?: number; cursor?: string | null; q?: string } = {},
): Promise<ApiResult<AdminDecksPage>> {
  try {
    const query: Record<string, string | number> = {};
    if (params.limit !== undefined) query.limit = params.limit;
    if (params.cursor) query.cursor = params.cursor;
    const q = params.q?.trim();
    if (q) query.q = q;

    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/decks', { params: query });
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };
    return { ...raw, data: normalizeAdminDecksPage(raw.data) };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return failResult<AdminDecksPage>(
        'Paginated decks endpoint is not available (HTTP 404).',
        ADMIN_DECKS_ENDPOINT_MISSING,
      );
    }
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      // Keep the converted message/traceId/httpStatus, but force FORBIDDEN so a
      // gateway 403 without an envelope still trips the legacy fallback.
      const result = apiResultFromError<AdminDecksPage>(err);
      if (result.error) result.error.code = 'FORBIDDEN';
      return result;
    }
    return apiResultFromError<AdminDecksPage>(err);
  }
}

// ---------------------- cards ----------------------

// The server's MaxLimit on GET /api/v1/authoring/cards/page (CardsPage.cs). One
// page never carries more than this, so fetchCardsByDeck asks for exactly it and
// walks the cursor until the server says there is no more.
export const CARDS_PAGE_LIMIT = 200;

// A ceiling on the number of pages walked, so a server that keeps handing back a
// cursor can never spin this loop forever. At CARDS_PAGE_LIMIT per page this is
// 20 000 cards, well past any real deck; reaching it is a bug, not a big deck.
const CARDS_PAGE_MAX_PAGES = 100;

/** One page of the keyset-paginated cards route: `{ items, nextCursor, hasMore }`. */
interface CardsPageEnvelope {
  items?: Card[] | null;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export async function fetchCardsByDeck(deckId: number): Promise<ApiResult<Card[]>> {
  return dedupeRequest(DedupeKeys.cards(deckId), async () => {
    try {
      const allCards: Card[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < CARDS_PAGE_MAX_PAGES; page++) {
        // The first request carries no cursor; every request after it passes the
        // one the previous page handed back.
        const params: Record<string, unknown> =
          cursor === null
            ? { deckId, limit: CARDS_PAGE_LIMIT }
            : { deckId, limit: CARDS_PAGE_LIMIT, cursor };

        const resp = await http.get<ApiResult<CardsPageEnvelope>>(
          '/api/v1/authoring/cards/page',
          { params },
        );
        const raw = resp.data;

        // A refused page is the whole answer. Returning what came before it would
        // be a partial list wearing a success envelope, which is worse than a
        // clean failure the caller can retry.
        if (!raw.success) return { ...raw, data: null };

        for (const item of raw.data?.items ?? []) allCards.push(normalizeCard(item));

        const nextCursor = raw.data?.nextCursor;
        if (raw.data?.hasMore !== true || !nextCursor) {
          return { ...raw, data: allCards };
        }
        cursor = nextCursor;
      }

      // The loop only falls through here if the server kept setting hasMore past
      // CARDS_PAGE_MAX_PAGES, which no honest deck can.
      return failResult<Card[]>('The card list did not finish paging.', 'PAGING_ERROR');
    } catch (err) {
      return apiResultFromError<Card[]>(err);
    }
  });
}

/**
 * One card, read through `GET /api/v1/authoring/cards?id=`.
 *
 * The route answers with an array (the same handler the full list uses, filtered
 * by id), so an empty array is a card that is not there rather than an error.
 */
export async function fetchCardById(id: number): Promise<ApiResult<Card>> {
  try {
    const resp = await http.get<ApiResult<Card[]>>('/api/v1/authoring/cards', {
      params: { id },
    });
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const list = raw.data ?? [];
    if (list.length === 0) {
      return failResult<Card>('Card not found.', 'NOT_FOUND');
    }
    return { ...raw, data: normalizeCard(list[0]) };
  } catch (err) {
    return apiResultFromError<Card>(err);
  }
}

export async function createCard(params: {
  deckId: number;
  question: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
  // See the note on updateCard: the backend has parsed this since Cards.cs was
  // written, and the form has always collected it.
  revision?: number;
  stableUid?: string;
  realWorldUsage?: string;
  topic?: string;
  // The MCQ blob travels whole or not at all. An explicit `null` is a clear:
  // the server drops absent body keys (Helpers.cs:58 skips a field the body has
  // no own property for), so the only way to erase a stored blob is to send the
  // key with value null. `undefined` means "leave alone".
  mcq?: McqBlob | null;
}): Promise<ApiResult<Card>> {
  try {
    const body: Record<string, unknown> = {
      deckId: params.deckId,
      question: params.question,
    };
    if (params.explanation !== undefined) body.explanation = params.explanation;
    if (params.codeSnippet !== undefined) body.codeSnippet = params.codeSnippet;
    if (params.codeLanguage !== undefined) body.codeLanguage = params.codeLanguage;
    if (params.difficulty !== undefined) body.difficulty = params.difficulty;
    if (params.orderInDeck !== undefined) body.orderInDeck = params.orderInDeck;
    if (params.realWorldUsage !== undefined) body.realWorldUsage = params.realWorldUsage;
    if (params.topic !== undefined) body.topic = params.topic;
    if (params.mcq !== undefined) body.mcq = params.mcq;
    if (params.revision !== undefined) body.revision = params.revision;
    body.stableUid = ensureStableUid(params.stableUid);

    // One single-record response shape throughout.
    const resp = await http.post<ApiResult<Card>>('/api/v1/authoring/cards', body);
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const card = raw.data;
    if (!card) {
      return failResult<Card>('Create card failed: no data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalizeCard(card) };
  } catch (err) {
    return apiResultFromError<Card>(err);
  }
}

export async function updateCard(params: {
  id: number;
  deckId: number;
  question?: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  // The PUT handler has always accepted realWorldUsage (Vpc/Authoring/Cards.cs
  // update spec); this client just never forwarded it, so the field could be
  // written on create and never changed again. The markdown importer compares
  // it when deciding update vs unchanged, so leaving it out here would make a
  // USAGE edit replan forever and break the "re-import is a no-op" promise.
  realWorldUsage?: string;
  topic?: string;
  difficulty?: number;
  orderInDeck?: number;
  // Distinct from expectedVersion. That one is the optimistic-concurrency
  // token the server compares; this one is an author-controlled content
  // revision the backend has parsed since Cards.cs was written. The form
  // collected it and validated it and no client ever forwarded it.
  revision?: number;
  stableUid?: string;
  expectedVersion?: number;
  mcq?: McqBlob | null;
}): Promise<ApiResult<Card>> {
  try {
    // Backend expects id and expectedVersion in JSON body, not query string.
    //
    // expectedVersion is omitted when the caller did not supply one, rather
    // than defaulted to 1. A default cannot be right here: it is the
    // optimistic-concurrency token the server compares against the row, so on
    // any card that has been edited once — version 2 or higher — sending 1
    // manufactures a VERSION_CONFLICT out of an edit that had no conflict in
    // it, and does so silently, for a caller whose only mistake was forgetting
    // a field. Leaving the key out gives the server the chance to answer for
    // itself. Both callers today pass it explicitly and neither can pass
    // undefined: EditCardPage forwards card.version (required on Card) and
    // deckImportRunner forwards the plan's expectedVersion (required on
    // ImportUpdate).
    const body: Record<string, unknown> = { id: params.id };
    if (params.expectedVersion !== undefined) body.expectedVersion = params.expectedVersion;
    if (params.question !== undefined) body.question = params.question;
    if (params.explanation !== undefined) body.explanation = params.explanation;
    if (params.codeSnippet !== undefined) body.codeSnippet = params.codeSnippet;
    if (params.codeLanguage !== undefined) body.codeLanguage = params.codeLanguage;
    if (params.realWorldUsage !== undefined) body.realWorldUsage = params.realWorldUsage;
    if (params.topic !== undefined) body.topic = params.topic;
    if (params.mcq !== undefined) body.mcq = params.mcq;
    if (params.difficulty !== undefined) body.difficulty = params.difficulty;
    if (params.orderInDeck !== undefined) body.orderInDeck = params.orderInDeck;
    if (params.revision !== undefined) body.revision = params.revision;
    if (params.stableUid !== undefined) body.stableUid = params.stableUid;
    if (params.deckId !== undefined) body.deckId = params.deckId;

    const resp = await http.put<ApiResult<Card>>('/api/v1/authoring/cards', body);
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const card = raw.data;
    if (!card) {
      return failResult<Card>('Update card failed: no data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalizeCard(card) };
  } catch (err) {
    return apiResultFromError<Card>(err);
  }
}

export async function deleteCard(cardId: number): Promise<ApiResult<null>> {
  try {
    // Backend expects id in query string, not body
    const resp = await http.delete<ApiResult<null>>(`/api/v1/authoring/cards?id=${encodeURIComponent(cardId)}`);
    return resp.data;
  } catch (err) {
    return apiResultFromError<null>(err);
  }
}

// ---------------------- publish ----------------------

export async function publishDeck(
  deckId: number, 
  note?: string
): Promise<ApiResult<{ mode: string; jobId?: string }>> {
  try {
    const resp = await http.post<ApiResult<{ mode: string; jobId?: string }>>('/api/v1/authoring/publish', {
      deckId,
      note: note ?? '',
    });
    return resp.data;
  } catch (err) {
    return apiResultFromError<{ mode: string; jobId?: string }>(err);
  }
}

export interface PublishJob {
  jobId: string;
  deckSlug: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  note?: string;
  errorMessage?: string;
  createdAt: number;
}

export async function fetchPublishJobs(): Promise<ApiResult<PublishJob[]>> {
  try {
    const resp = await http.get<ApiResult<PublishJob[]>>('/api/v1/authoring/publish/jobs');
    return resp.data;
  } catch (err) {
    return apiResultFromError<PublishJob[]>(err);
  }
}

// ---------------------- manifest ----------------------

export async function fetchAdminManifest(): Promise<ApiResult<Record<string, unknown>>> {
  return dedupeRequest(DedupeKeys.manifest(), async () => {
    try {
      const resp = await http.get<ApiResult<Record<string, unknown>>>('/api/v1/admin/manifest');
      return resp.data;
    } catch (err) {
      return apiResultFromError<Record<string, unknown>>(err);
    }
  });
}

// ---------------------- Content Intelligence ----------------------

export interface ContentIntelligenceCard {
  deckSlug: string;
  deckTitle: string;
  cardStableUid: string;
  cardQuestion: string;
  revision: number;
  statedDifficulty: number;
  reviewCount: number;
  uniqueUserCount: number;
  firstReviewCount: number;
  observedDifficultyRaw: number | null;
  expectedDifficulty: number | null;
  difficultyGap: number | null;
  difficultyGapZ: number | null;
  easyRate: number | null;
  goodRate: number | null;
  hardRate: number | null;
  againRate: number | null;
  struggleRate: number | null;
  failureRate: number | null;
  firstReviewEasyRate: number | null;
  repeatFailureRate: number | null;
  medianDwellTimeMs: number | null;
  expectedDwellTimeMs: number | null;
  dwellTimeGapZ: number | null;
  highLevelUserFailureRate: number | null;
  reviewCountToMastery: number | null;
  postCardDropoutRate: number | null;
  difficultyCalibrationStatus:
    | 'Correctly Calibrated'
    | 'Difficulty Overstated'
    | 'Difficulty Understated'
    | 'Needs More Data';
  contentQualityStatus:
    | 'Healthy'
    | 'Productive Challenge'
    | 'Too Shallow'
    | 'Possibly Unclear'
    | 'Possible Prerequisite Gap'
    | 'Needs More Data';
  confidenceLevel: 'Low' | 'Medium' | 'High';
  fixPriorityScore: number | null;
}

export interface ContentIntelligenceData {
  generatedAtMs: number;
  windowDays: number;
  deckSlug?: string | null;
  cards: ContentIntelligenceCard[];
  summary: {
    cardCount: number;
    needsMoreData: number;
    possiblyUnclear: number;
    tooShallow: number;
    productiveChallenge: number;
    difficultyUnderstated: number;
    difficultyOverstated: number;
    mcqCardCount?: number;
  };
}

export async function fetchContentIntelligence(params?: {
  deckSlug?: string | null;
  days?: number;
  limit?: number;
}): Promise<ApiResult<ContentIntelligenceData>> {
  try {
    const qs = new URLSearchParams();
    if (params?.deckSlug) qs.set('deckSlug', params.deckSlug);
    if (params?.days) qs.set('days', String(params.days));
    if (params?.limit) qs.set('limit', String(params.limit));

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const resp = await http.get<ApiResult<ContentIntelligenceData>>(`/api/v1/authoring/content-intelligence${suffix}`);
    return resp.data;
  } catch (err) {
    return apiResultFromError<ContentIntelligenceData>(err);
  }
}
