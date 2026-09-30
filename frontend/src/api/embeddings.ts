// src/api/embeddings.ts
// Card embeddings and semantic duplicates, console side (R20 contract §5):
//   GET /api/v1/admin/card-embeddings/status?deckId=
//   GET /api/v1/admin/decks/:deckId/semantic-duplicates?minCosine=&limit=
// Both are RequireAdmin (the duplicates route also needs deck read). The
// vectors are pushed by the owner's local `dc-evals embed-cards --push`; the
// console only reads. A server whose database has no `vector` extension or no
// card_embeddings table answers 503 VECTOR_NOT_READY, which passes through as
// the error code. Every function returns an ApiResult and never throws.
import type { ApiResult } from '../types/api';
import { http } from './http';
import { apiResultFromError, failResult } from './httpFailure';

/** The contract's default similarity floor and page size. */
export const SEMANTIC_DUPLICATE_MIN_COSINE = 0.9;
export const SEMANTIC_DUPLICATES_LIMIT = 50;

export type EmbeddingsStatus = {
  engine: 'vector' | 'none';
  model: string | null;
  cards: number;
  embedded: number;
  stale: number;
};

export type SemanticDuplicateCard = { cardId: number; stableUid: string; question: string };

export type SemanticDuplicatePair = { cosine: number; a: SemanticDuplicateCard; b: SemanticDuplicateCard };

export type SemanticDuplicates = { engine: 'vector'; minCosine: number; pairs: SemanticDuplicatePair[] };

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCount(value: unknown): number {
  const n = Number(value);
  return value !== null && value !== '' && typeof value !== 'boolean' && Number.isFinite(n) && n >= 0 ? n : 0;
}

function idOf(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

function badResponse<T>(): ApiResult<T> {
  return failResult<T>('The server returned an unexpected embeddings response.', 'BAD_RESPONSE');
}

function normalizeCard(value: unknown): SemanticDuplicateCard | null {
  if (!isRecord(value)) return null;
  const cardId = idOf(value.cardId);
  if (cardId === null) return null;
  return {
    cardId,
    stableUid: typeof value.stableUid === 'string' ? value.stableUid : '',
    question: typeof value.question === 'string' ? value.question : '',
  };
}

function normalizePair(value: unknown): SemanticDuplicatePair | null {
  if (!isRecord(value)) return null;
  const cosine = Number(value.cosine);
  const a = normalizeCard(value.a);
  const b = normalizeCard(value.b);
  if (!Number.isFinite(cosine) || value.cosine === null || a === null || b === null) return null;
  return { cosine, a, b };
}

/** GET /api/v1/admin/card-embeddings/status, for one deck when `deckId` is set. */
export async function fetchEmbeddingsStatus(deckId?: number | null): Promise<ApiResult<EmbeddingsStatus>> {
  try {
    const resp = await http.get<ApiResult<unknown>>('/api/v1/admin/card-embeddings/status', {
      params: deckId ? { deckId } : {},
    });
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    const data = res.data;
    if (!isRecord(data)) return badResponse();
    return {
      ...res,
      data: {
        engine: data.engine === 'vector' ? 'vector' : 'none',
        model: typeof data.model === 'string' && data.model !== '' ? data.model : null,
        cards: toCount(data.cards),
        embedded: toCount(data.embedded),
        stale: toCount(data.stale),
      },
    };
  } catch (err) {
    return apiResultFromError<EmbeddingsStatus>(err);
  }
}

/** GET /api/v1/admin/decks/:deckId/semantic-duplicates, highest cosine first as the server sends them. */
export async function fetchSemanticDuplicates(
  deckId: number,
  params: { minCosine?: number; limit?: number } = {},
): Promise<ApiResult<SemanticDuplicates>> {
  try {
    const resp = await http.get<ApiResult<unknown>>(`/api/v1/admin/decks/${deckId}/semantic-duplicates`, {
      params: {
        minCosine: params.minCosine ?? SEMANTIC_DUPLICATE_MIN_COSINE,
        limit: params.limit ?? SEMANTIC_DUPLICATES_LIMIT,
      },
    });
    const res = resp.data;
    if (!res.success) return { ...res, data: null };
    const data = res.data;
    if (!isRecord(data) || !Array.isArray(data.pairs)) return badResponse();
    const minCosine = Number(data.minCosine);
    return {
      ...res,
      data: {
        engine: 'vector',
        minCosine: Number.isFinite(minCosine) && data.minCosine !== null ? minCosine : SEMANTIC_DUPLICATE_MIN_COSINE,
        pairs: data.pairs.map(normalizePair).filter((p): p is SemanticDuplicatePair => p !== null),
      },
    };
  } catch (err) {
    return apiResultFromError<SemanticDuplicates>(err);
  }
}
