// src/api/authoring.ts
import type { ApiResult } from '../types/api';
import type { Deck, DeckAvailability, DeckTier } from '../types/deck';
import type { Card } from '../types/card';
import axios from 'axios';
import { http } from './http';

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

function normalizeDeck(d: Deck): Deck {
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

// 小工具：确保一定有 stableUid（后端现在要求必填）
function ensureStableUid(input?: string): string {
  const trimmed = (input ?? '').trim();
  if (trimmed) return trimmed;

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ==================== Decks ====================

export async function fetchDecks(): Promise<ApiResult<Deck[]>> {
  try {
    const resp = await http.get<ApiResult<Deck[]>>('/api/v1/authoring/decks');
    const raw = resp.data;

    if (!raw.success) return raw;

    const list = raw.data ?? [];
    const normalized = list.map(normalizeDeck);

    return { ...raw, data: normalized };
  } catch (err) {
    return fail<Deck[]>(toApiErrorMessage(err));
  }
}

// ✅ 单条 Deck：直接走后端 GET /authoring/decks?id=xx
export async function fetchDeckById(id: number): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.get<ApiResult<Deck[]>>('/api/v1/authoring/decks', {
      params: { id },
    });

    const raw = resp.data;
    if (!raw.success) {
      return {
        success: false,
        data: null,
        error: raw.error ?? { code: 'REQUEST_FAILED', message: 'Request failed.' },
        traceId: raw.traceId ?? '',
      };
    }

    const list = raw.data ?? [];
    const first = list[0] ?? null;

    if (!first) {
      return {
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Deck not found' },
        traceId: raw.traceId ?? '',
      };
    }

    return {
      success: true,
      data: normalizeDeck(first),
      error: null,
      traceId: raw.traceId ?? '',
    };
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

// ---------------------- 创建 Deck ----------------------

export interface CreateDeckParams {
  slug: string;
  title: string;
  author: string;
  description?: string;
  locale: string;
  deckType: number; // 1 = Starter, 2 = Paid

  // mobile/publish 相关（可选，后端暂时可以忽略）
  contentVersion?: string;
  isFreeStarter?: boolean;
  freeCardCount?: number;
}

export async function createDeck(params: CreateDeckParams): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.post<ApiResult<Deck>>('/api/v1/authoring/decks', {
      slug: params.slug,
      title: params.title,
      author: params.author,
      description: params.description,
      locale: params.locale,
      deckType: params.deckType,

      contentVersion: params.contentVersion,
      isFreeStarter: params.isFreeStarter,
      freeCardCount: params.freeCardCount,
    });

    const raw = resp.data;
    if (!raw.success || !raw.data) return raw;

    return { ...raw, data: normalizeDeck(raw.data) };
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

export interface UpdateDeckPayload {
  id: number;
  slug?: string;
  title?: string;
  author?: string;
  description?: string | null;
  locale?: string | null;
  deckType?: number | null;
  version?: number | null;

  // ✅ super_admin only：mobile/manifest 字段（需要后端 PUT 支持）
  tier?: DeckTier | null;
  availability?: DeckAvailability | null;
  eta?: string | null;
  manifestOrder?: number | null;
  totalCards?: number | null;
  previewCards?: number | null;
  retiredAtMs?: number | null;
}

export async function updateDeck(payload: UpdateDeckPayload): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.put<ApiResult<Deck>>('/api/v1/authoring/decks', payload);
    const raw = resp.data;
    if (!raw.success || !raw.data) return raw;
    return { ...raw, data: normalizeDeck(raw.data) };
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

// ✅ 删除 Deck（super_admin only）
export async function deleteDeck(id: number): Promise<ApiResult<null>> {
  try {
    const resp = await http.delete<ApiResult<null>>('/api/v1/authoring/decks', {
      params: { id },
    });
    return resp.data;
  } catch (err) {
    return fail<null>(toApiErrorMessage(err));
  }
}

// ==================== Cards ====================

export async function fetchCardsByDeck(deckId: number): Promise<ApiResult<Card[]>> {
  try {
    const resp = await http.get<ApiResult<Card[]>>('/api/v1/authoring/cards', {
      params: { deckId },
    });

    const raw = resp.data;
    if (!raw.success) return raw;

    const list = raw.data ?? [];
    const normalized = list.map(normalizeCard);
    return { ...raw, data: normalized };
  } catch (err) {
    return fail<Card[]>(toApiErrorMessage(err));
  }
}

export async function createCard(input: {
  deckId: number;
  question: string;
  explanation?: string;
  realWorldUsage?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
  stableUid?: string;
  revision?: number;
}): Promise<ApiResult<Card>> {
  try {
    const resp = await http.post<ApiResult<Card>>('/api/v1/authoring/cards', {
      deckId: input.deckId,
      stableUid: ensureStableUid(input.stableUid),
      question: input.question,
      explanation: input.explanation,
      realWorldUsage: input.realWorldUsage,
      codeSnippet: input.codeSnippet,
      codeLanguage: input.codeLanguage,
      difficulty: input.difficulty,
      orderInDeck: input.orderInDeck ?? 1,
      revision: input.revision,
    });

    const raw = resp.data;
    if (!raw.success || !raw.data) return raw;
    return { ...raw, data: normalizeCard(raw.data) };
  } catch (err) {
    return fail<Card>(toApiErrorMessage(err));
  }
}

export async function updateCard(input: {
  id: number;
  expectedVersion: number;
  question?: string;
  explanation?: string;
  realWorldUsage?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
  revision?: number;
}): Promise<ApiResult<Card>> {
  try {
    const resp = await http.put<ApiResult<Card>>('/api/v1/authoring/cards', {
      id: input.id,
      expectedVersion: input.expectedVersion,
      question: input.question,
      explanation: input.explanation,
      realWorldUsage: input.realWorldUsage,
      codeSnippet: input.codeSnippet,
      codeLanguage: input.codeLanguage,
      difficulty: input.difficulty,
      orderInDeck: input.orderInDeck,
      revision: input.revision,
    });

    const raw = resp.data;
    if (!raw.success || !raw.data) return raw;
    return { ...raw, data: normalizeCard(raw.data) };
  } catch (err) {
    return fail<Card>(toApiErrorMessage(err));
  }
}

export async function deleteCard(id: number): Promise<ApiResult<null>> {
  try {
    const resp = await http.delete<ApiResult<null>>('/api/v1/authoring/cards', {
      params: { id },
    });
    return resp.data;
  } catch (err) {
    return fail<null>(toApiErrorMessage(err));
  }
}

// ==================== Publish / Manifest ====================

export type PublishedTier = 'free' | 'premium';

export type DeckExportCard = {
  stableUid: string;
  orderInDeck: number;
  difficulty: number;
  question: string;
  explanation: string;
  codeLanguage: string | null;
  codeSnippet: string;
  realWorldUsage: string;
  revision: number;
};

export type DeckExport = {
  slug: string;
  title: string;
  locale: string;
  deckType: number;
  version: string;
  totalCards: number;
  cards: DeckExportCard[];
};

export type PublishDeckPreviewData = {
  mode: 'preview';
  deckId: number;
  deckSlug: string;
  tier: PublishedTier;
  cardCount: number;
  export: DeckExport;
};

export type PublishDeckOkData = {
  mode: 'publish';
  deckId: number;
  deckSlug: string;
  tier: PublishedTier;
  buildId: string;
  cardCount: number;
  bucket: string;
  key: string;
  preview: { previewBuildId: string; previewKey: string; previewCards: number } | null;
  manifestKey: string;
};

export type PublishDeckData = PublishDeckPreviewData | PublishDeckOkData;

export async function publishDeck(input: {
  deckId: number;
  note?: string;
  mode?: 'publish' | 'preview';
}): Promise<ApiResult<PublishDeckData>> {
  try {
    const mode = input.mode === 'preview' ? 'preview' : 'publish';

    const resp = await http.post<ApiResult<PublishDeckData>>(
      '/api/v1/authoring/publish',
      { deckId: input.deckId, note: input.note ?? null },
      mode === 'preview' ? { params: { mode: 'preview' } } : undefined,
    );

    return resp.data;
  } catch (err) {
    return fail<PublishDeckData>(toApiErrorMessage(err));
  }
}

export type RebuildManifestData = {
  ok: true;
  manifestKey: string;
  generatedAtMs: number;
  deckCount: number;
};

export async function rebuildManifest(): Promise<ApiResult<RebuildManifestData>> {
  try {
    const resp = await http.post<ApiResult<RebuildManifestData>>('/api/v1/admin/manifest/rebuild', null);
    return resp.data;
  } catch (err) {
    return fail<RebuildManifestData>(toApiErrorMessage(err));
  }
}