// src/api/authoring.ts

import type { ApiResult } from '../types/api';
import type { Deck } from '../types/deck';
import type { Card } from '../types/card';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? 'http://localhost:5071',
});

if (!API_BASE_URL) {
  console.warn('VITE_API_BASE_URL is not set. Please check your .env.development file.');
}

export async function fetchDecks(): Promise<ApiResult<Deck[]>> {
  const url = `${API_BASE_URL}/api/authoring/decks`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    return {
      success: false,
      data: null,
      error: {
        code: `HTTP_${res.status}`,
        message: `Request failed with status ${res.status}: ${text}`,
      },
      traceId: '',
    };
  }

  const json = await res.json();
  return json as ApiResult<Deck[]>;
}

// ---------------------- 新增：创建 Deck ----------------------

export interface CreateDeckParams {
  slug: string;
  title: string;
  author: string;
  description?: string;
  locale: string;
  deckType: number; // 1 = Starter, 2 = Paid
}

/**
 * 创建一个新的 Deck。
 * 对应后端：POST /api/authoring/decks?slug=...&title=...&author=...&...
 */
export async function createDeck(params: CreateDeckParams): Promise<ApiResult<Deck>> {
  const qs = new URLSearchParams();

  qs.append('slug', params.slug);
  qs.append('title', params.title);
  qs.append('author', params.author);
  qs.append('locale', params.locale);
  qs.append('deckType', String(params.deckType));

  if (params.description && params.description.trim().length > 0) {
    qs.append('description', params.description.trim());
  }

  const url = `${API_BASE_URL}/api/authoring/decks?${qs.toString()}`;

  const res = await fetch(url, {
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      success: false,
      data: null,
      error: {
        code: `HTTP_${res.status}`,
        message: `Request failed with status ${res.status}: ${text}`,
      },
      traceId: '',
    };
  }

  const json = await res.json();
  return json as ApiResult<Deck>;
}

// ============ 1) 根据 id 获取单个 Deck ============

export async function fetchDeckById(id: number): Promise<ApiResult<Deck>> {
  const url = `${API_BASE_URL}/api/authoring/decks?id=${id}`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    return {
      success: false,
      data: null,
      error: {
        code: `HTTP_${res.status}`,
        message: `Request failed with status ${res.status}: ${text}`,
      },
      traceId: '',
    };
  }

  const json = await res.json();
  return json as ApiResult<Deck>;
}

// ============ 2) 按 Deck 获取 Card 列表 ============

export async function fetchCardsByDeck(
  deckId: number,
): Promise<ApiResult<Card[]>> {
  const resp = await client.get<ApiResult<Card[]>>(
    '/api/authoring/cards',
    {
      params: { deckId },
    },
  );
  return resp.data;
}

export async function createCard(input: {
  deckId: number;
  question: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
  stableUid?: string;
}): Promise<ApiResult<Card>> {
  const params: Record<string, unknown> = {
    deckId: input.deckId,
    question: input.question,
  };

  if (input.explanation !== undefined) params.explanation = input.explanation;
  if (input.codeSnippet !== undefined) params.codeSnippet = input.codeSnippet;
  if (input.codeLanguage !== undefined) params.codeLanguage = input.codeLanguage;
  if (input.difficulty !== undefined) params.difficulty = input.difficulty;
  if (input.orderInDeck !== undefined) params.orderInDeck = input.orderInDeck;
  if (input.stableUid !== undefined) params.stableUid = input.stableUid;

  const resp = await client.post<ApiResult<Card>>(
    '/api/authoring/cards',
    null,
    { params },
  );
  return resp.data;
}

export async function updateCard(input: {
  id: number;
  expectedVersion: number;
  question?: string;
  explanation?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  difficulty?: number;
  orderInDeck?: number;
}): Promise<ApiResult<Card>> {
  const params: Record<string, unknown> = {
    id: input.id,
    expectedVersion: input.expectedVersion,
  };

  if (input.question !== undefined) params.question = input.question;
  if (input.explanation !== undefined) params.explanation = input.explanation;
  if (input.codeSnippet !== undefined) params.codeSnippet = input.codeSnippet;
  if (input.codeLanguage !== undefined) params.codeLanguage = input.codeLanguage;
  if (input.difficulty !== undefined) params.difficulty = input.difficulty;
  if (input.orderInDeck !== undefined) params.orderInDeck = input.orderInDeck;

  const resp = await client.put<ApiResult<Card>>(
    '/api/authoring/cards',
    null,
    { params },
  );
  return resp.data;
}

export async function deleteCard(id: number): Promise<ApiResult<null>> {
  const resp = await client.delete<ApiResult<null>>(
    '/api/authoring/cards',
    {
      params: { id },
    },
  );
  return resp.data;
}