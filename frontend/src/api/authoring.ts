// src/api/authoring.ts
import type { ApiResult } from '../types/api';
import type { Deck } from '../types/deck';
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
    const resp = await http.get<ApiResult<Deck[]>>('/api/authoring/decks');
    return resp.data;
  } catch (err) {
    return fail<Deck[]>(toApiErrorMessage(err));
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

  // ✅ mobile/publish 相关（可选，后端暂时可以忽略）
  contentVersion?: string;
  isFreeStarter?: boolean;
  freeCardCount?: number;
}

export async function createDeck(params: CreateDeckParams): Promise<ApiResult<Deck>> {
  try {
    // ✅ Lambda 后端从 JSON body 里读这些字段
    const resp = await http.post<ApiResult<Deck>>('/api/authoring/decks', {
      slug: params.slug,
      title: params.title,
      author: params.author,
      description: params.description,
      locale: params.locale,
      deckType: params.deckType,

      // 下面这些字段目前后端不会用，但保留不影响，将来你要扩展可以继续在后端读取
      contentVersion: params.contentVersion,
      isFreeStarter: params.isFreeStarter,
      freeCardCount: params.freeCardCount,
    });
    return resp.data;
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

export async function updateDeck(payload: {
  id: number;
  slug?: string;
  title?: string;
  author?: string;
  description?: string | null;
  locale?: string | null;
  deckType?: number | null;
  version?: number | null;
}): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.put<ApiResult<Deck>>('/api/authoring/decks', payload);
    return resp.data;
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

// ✅ 注意：后端始终返回 Deck[]，这里做了一层转换
export async function fetchDeckById(id: number): Promise<ApiResult<Deck>> {
  try {
    // 实际返回是 ApiResult<Deck[]>
    const resp = await http.get<ApiResult<Deck[]>>('/api/authoring/decks', {
      params: { id },
    });
    const raw = resp.data;

    if (!raw.success) {
      // 直接把错误透传出去（类型上强转一下）
      return raw as unknown as ApiResult<Deck>;
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
      data: first,
      error: null,
      traceId: raw.traceId ?? '',
    };
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

// ✅ 删除 Deck（super_admin only）
export async function deleteDeck(id: number): Promise<ApiResult<null>> {
  try {
    const resp = await http.delete<ApiResult<null>>('/api/authoring/decks', {
      params: { id },
    });
    return resp.data;
  } catch (err) {
    return fail<null>(toApiErrorMessage(err));
  }
}

// ==================== Cards ====================

// ============ 按 Deck 获取 Card 列表 ============

export async function fetchCardsByDeck(deckId: number): Promise<ApiResult<Card[]>> {
  try {
    const resp = await http.get<ApiResult<Card[]>>('/api/authoring/cards', {
      params: { deckId },
    });
    return resp.data;
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
    // ✅ Lambda 后端从 JSON body 里读：
    // deckId, stableUid, question, explanation, codeSnippet, codeLanguage,
    // realWorldUsage, difficulty, orderInDeck, revision, version
    const resp = await http.post<ApiResult<Card>>('/api/authoring/cards', {
      deckId: input.deckId,
      stableUid: ensureStableUid(input.stableUid),
      question: input.question,
      explanation: input.explanation,
      realWorldUsage: input.realWorldUsage,
      codeSnippet: input.codeSnippet,
      codeLanguage: input.codeLanguage,
      difficulty: input.difficulty,
      // 如果前端没传 orderInDeck，则默认 1，避免后端 “orderInDeck required” 报错
      orderInDeck: input.orderInDeck ?? 1,
      revision: input.revision,
      // version 不传 → 后端会默认 1
    });
    return resp.data;
  } catch (err) {
    return fail<Card>(toApiErrorMessage(err));
  }
}

export async function updateCard(input: {
  id: number;
  expectedVersion: number; // 这里就是乐观锁用的版本号
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
    const resp = await http.put<ApiResult<Card>>('/api/authoring/cards', {
      id: input.id,
      expectedVersion: input.expectedVersion, // ✅ 关键：发给后端
      question: input.question,
      explanation: input.explanation,
      realWorldUsage: input.realWorldUsage,
      codeSnippet: input.codeSnippet,
      codeLanguage: input.codeLanguage,
      difficulty: input.difficulty,
      orderInDeck: input.orderInDeck,
      revision: input.revision,
      // version 不再从前端设置，由后端在成功更新后统一 version = version + 1
    });
    return resp.data;
  } catch (err) {
    return fail<Card>(toApiErrorMessage(err));
  }
}

export async function deleteCard(id: number): Promise<ApiResult<null>> {
  try {
    const resp = await http.delete<ApiResult<null>>('/api/authoring/cards', {
      params: { id },
    });
    return resp.data;
  } catch (err) {
    return fail<null>(toApiErrorMessage(err));
  }
}

// ✅ 发布 Deck（super_admin only，占位：后端实现写 S3 + 更新 manifest）
export async function publishDeck(deckId: number): Promise<ApiResult<null>> {
  try {
    const resp = await http.post<ApiResult<null>>('/api/admin/publish', null, {
      params: { deckId },
    });
    return resp.data;
  } catch (err) {
    return fail<null>(toApiErrorMessage(err));
  }
}
