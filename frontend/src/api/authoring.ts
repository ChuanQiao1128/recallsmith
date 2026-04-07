// src/api/authoring.ts
import type { ApiResult } from '../types/api';
import type { Deck, DeckAvailability, DeckTier } from '../types/deck';
import type { Card } from '../types/card';
import axios from 'axios';
import { http } from './http';
import { dedupeRequest, DedupeKeys } from './dedupe';

function toApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;

    if (data && typeof data === 'object' && 'error' in data) {
      const errorData = data as { error?: { message?: string } };
      return errorData?.error?.message ?? `Request failed (HTTP ${status})`;
    }
    return `Request failed${status ? ` (HTTP ${status})` : ''}`;
  }
  return err instanceof Error ? err.message : 'Network error.';
}

function fail<T>(message: string, code = 'NETWORK_ERROR'): ApiResult<T> {
  return {
    success: false,
    data: null,
    error: { code, message },
    traceId: '',
  };
}

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

// 小工具：确保一定有 stableUid
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
      return fail<Deck[]>(toApiErrorMessage(err));
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
      return fail<Deck>('Deck not found', 'NOT_FOUND');
    }
    const normalized = normalizeDeck(list[0]);
    if (!normalized) {
      return fail<Deck>('Invalid deck data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalized };
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

export async function createDeck(params: { 
  title: string; 
  slug?: string; 
  description?: string;
  author?: string;
}): Promise<ApiResult<Deck>> {
  try {
    // 统一使用 JSON body，与 updateDeck 保持一致
    const body: Record<string, unknown> = { title: params.title };
    if (params.slug) body.slug = params.slug;
    if (params.description) body.description = params.description;
    if (params.author) body.author = params.author;

    const resp = await http.post<ApiResult<Deck>>('/api/v1/authoring/decks', body);
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const deck = raw.data;
    if (!deck) {
      return fail<Deck>('Create deck failed: no data returned', 'SERVER_ERROR');
    }
    const normalized = normalizeDeck(deck);
    if (!normalized) {
      return fail<Deck>('Invalid deck data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalized };
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

export async function updateDeck(
  id: number,
  params: {
    title?: string;
    slug?: string;
    description?: string;
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
      return fail<Deck>('Update deck failed: no data returned', 'SERVER_ERROR');
    }
    const normalized = normalizeDeck(deck);
    if (!normalized) {
      return fail<Deck>('Invalid deck data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalized };
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

export async function deleteDeck(id: number): Promise<ApiResult<null>> {
  try {
    // 统一使用 JSON body 传递参数
    const resp = await http.delete<ApiResult<null>>('/api/v1/authoring/decks', { data: { id } });
    return resp.data;
  } catch (err) {
    return fail<null>(toApiErrorMessage(err));
  }
}

// ---------------------- cards ----------------------

export async function fetchCardsByDeck(deckId: number): Promise<ApiResult<Card[]>> {
  return dedupeRequest(DedupeKeys.cards(deckId), async () => {
    try {
      const resp = await http.get<ApiResult<Card[]>>('/api/v1/authoring/cards', {
        params: { deckId },
      });
      const raw = resp.data;

      if (!raw.success) return raw;

      const list = raw.data ?? [];
      return { ...raw, data: list.map(normalizeCard) };
    } catch (err) {
      return fail<Card[]>(toApiErrorMessage(err));
    }
  });
}

export async function createCard(params: {
  deckId: number;
  question: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
  stableUid?: string;
  realWorldUsage?: string;
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
    body.stableUid = ensureStableUid(params.stableUid);

    // 统一使用单条记录返回格式
    const resp = await http.post<ApiResult<Card>>('/api/v1/authoring/cards', body);
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const card = raw.data;
    if (!card) {
      return fail<Card>('Create card failed: no data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalizeCard(card) };
  } catch (err) {
    return fail<Card>(toApiErrorMessage(err));
  }
}

export async function updateCard(params: {
  id: number;
  deckId: number;
  question?: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
  stableUid?: string;
  expectedVersion?: number;
}): Promise<ApiResult<Card>> {
  try {
    // Backend expects id and expectedVersion in JSON body, not query string
    const body: Record<string, unknown> = {
      id: params.id,
      expectedVersion: params.expectedVersion ?? 1,
    };
    if (params.question !== undefined) body.question = params.question;
    if (params.explanation !== undefined) body.explanation = params.explanation;
    if (params.codeSnippet !== undefined) body.codeSnippet = params.codeSnippet;
    if (params.codeLanguage !== undefined) body.codeLanguage = params.codeLanguage;
    if (params.difficulty !== undefined) body.difficulty = params.difficulty;
    if (params.orderInDeck !== undefined) body.orderInDeck = params.orderInDeck;
    if (params.stableUid !== undefined) body.stableUid = params.stableUid;
    if (params.deckId !== undefined) body.deckId = params.deckId;

    const resp = await http.put<ApiResult<Card>>('/api/v1/authoring/cards', body);
    const raw = resp.data;

    if (!raw.success) return { ...raw, data: null };

    const card = raw.data;
    if (!card) {
      return fail<Card>('Update card failed: no data returned', 'SERVER_ERROR');
    }
    return { ...raw, data: normalizeCard(card) };
  } catch (err) {
    return fail<Card>(toApiErrorMessage(err));
  }
}

export async function deleteCard(cardId: number): Promise<ApiResult<null>> {
  try {
    // Backend expects id in query string, not body
    const resp = await http.delete<ApiResult<null>>(`/api/v1/authoring/cards?id=${encodeURIComponent(cardId)}`);
    return resp.data;
  } catch (err) {
    return fail<null>(toApiErrorMessage(err));
  }
}

// ---------------------- permissions ----------------------

export async function fetchPermissions(): Promise<ApiResult<{ adminSub: string; deckId: number; canRead: boolean; canWrite: boolean }[]>> {
  try {
    const resp = await http.get<ApiResult<{ adminSub: string; deckId: number; canRead: boolean; canWrite: boolean }[]>>('/api/v1/admin/permissions');
    return resp.data;
  } catch (err) {
    return fail(toApiErrorMessage(err));
  }
}

export async function updatePermission(params: { adminSub: string; deckId: number; canRead?: boolean; canWrite?: boolean }): Promise<ApiResult<null>> {
  try {
    // 统一使用 JSON body 传递参数
    const body: Record<string, unknown> = {
      adminSub: params.adminSub,
      deckId: params.deckId,
    };
    if (params.canRead !== undefined) body.canRead = params.canRead;
    if (params.canWrite !== undefined) body.canWrite = params.canWrite;

    const resp = await http.put<ApiResult<null>>('/api/v1/admin/permissions', body);
    return resp.data;
  } catch (err) {
    return fail(toApiErrorMessage(err));
  }
}

export async function bulkUpdatePermissions(params: { adminSub: string; deckIds: number[]; canRead?: boolean; canWrite?: boolean }): Promise<ApiResult<null>> {
  try {
    const body: Record<string, unknown> = {
      adminSub: params.adminSub,
      deckIds: params.deckIds,
    };
    if (params.canRead !== undefined) body.canRead = params.canRead;
    if (params.canWrite !== undefined) body.canWrite = params.canWrite;

    const resp = await http.put<ApiResult<null>>('/api/v1/admin/permissions/bulk', body);
    return resp.data;
  } catch (err) {
    return fail(toApiErrorMessage(err));
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
    return fail(toApiErrorMessage(err));
  }
}

export async function checkPublishJobStatus(jobId: string): Promise<ApiResult<{ jobId: string; status: string; buildId?: string; s3Key?: string; errorMessage?: string }>> {
  try {
    const resp = await http.get<ApiResult<{ jobId: string; status: string; buildId?: string; s3Key?: string; errorMessage?: string }>>(`/api/v1/authoring/publish/status?jobId=${encodeURIComponent(jobId)}`);
    return resp.data;
  } catch (err) {
    return fail(toApiErrorMessage(err));
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
    return fail(toApiErrorMessage(err));
  }
}

// ---------------------- manifest ----------------------

export async function fetchAdminManifest(): Promise<ApiResult<Record<string, unknown>>> {
  return dedupeRequest(DedupeKeys.manifest(), async () => {
    try {
      const resp = await http.get<ApiResult<Record<string, unknown>>>('/api/v1/admin/manifest');
      return resp.data;
    } catch (err) {
      return fail<Record<string, unknown>>(toApiErrorMessage(err));
    }
  });
}

export async function rebuildManifest(): Promise<ApiResult<{ ok: boolean; generatedAtMs?: number; deckCount?: number }>> {
  try {
    const resp = await http.post<ApiResult<{ ok: boolean; generatedAtMs?: number; deckCount?: number }>>('/api/v1/admin/manifest/rebuild');
    return resp.data;
  } catch (err) {
    return fail(toApiErrorMessage(err));
  }
}

// ---------------------- dashboard (合并 API，减少请求次数) ----------------------

export interface DashboardData {
  decks: Deck[];
  manifest: {
    meta: {
      schemaVersion?: number;
      prefix?: string;
      generatedAtMs?: number;
      deckCount?: number;
    };
    decks: Array<{
      slug: string;
      title?: string;
      locale?: string;
      deckType?: number;
      tier?: string;
      availability?: string;
      version?: string;
      buildId?: string | null;
      totalCards?: number;
      path?: string | null;
      previewCards?: number | null;
      previewPath?: string | null;
    }>;
  };
}

export async function fetchDashboard(): Promise<ApiResult<DashboardData>> {
  try {
    const resp = await http.get<ApiResult<DashboardData>>('/api/v1/authoring/dashboard');
    const raw = resp.data;

    if (!raw.success) return raw;

    // Normalize decks (filter out nulls)
    const data = raw.data;
    if (data?.decks) {
      data.decks = data.decks.map(normalizeDeck).filter((d): d is Deck => d !== null);
    }

    return { ...raw, data };
  } catch (err) {
    return fail<DashboardData>(toApiErrorMessage(err));
  }
}
