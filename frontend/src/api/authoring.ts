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

  // ✅ 可选：为了和 mobile/publish 对齐（后端暂时没实现也没关系）
  contentVersion?: string;
  isFreeStarter?: boolean;
  freeCardCount?: number;
}

export async function createDeck(params: CreateDeckParams): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.post<ApiResult<Deck>>('/api/authoring/decks', null, {
      params: {
        slug: params.slug,
        title: params.title,
        author: params.author,
        description: params.description,
        locale: params.locale,
        deckType: params.deckType,

        contentVersion: params.contentVersion,
        isFreeStarter: params.isFreeStarter,
        freeCardCount: params.freeCardCount,
      },
    });
    return resp.data;
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

// ============ 根据 id 获取单个 Deck ============

export async function fetchDeckById(id: number): Promise<ApiResult<Deck>> {
  try {
    const resp = await http.get<ApiResult<Deck>>('/api/authoring/decks', {
      params: { id },
    });
    return resp.data;
  } catch (err) {
    return fail<Deck>(toApiErrorMessage(err));
  }
}

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
    const resp = await http.post<ApiResult<Card>>('/api/authoring/cards', null, {
      params: {
        deckId: input.deckId,
        question: input.question,
        explanation: input.explanation,
        realWorldUsage: input.realWorldUsage,
        codeSnippet: input.codeSnippet,
        codeLanguage: input.codeLanguage,
        difficulty: input.difficulty,
        orderInDeck: input.orderInDeck,
        stableUid: input.stableUid,
        revision: input.revision,
      },
    });
    return resp.data;
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
    const resp = await http.put<ApiResult<Card>>('/api/authoring/cards', null, {
      params: {
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
      },
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