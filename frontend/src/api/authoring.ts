// src/api/authoring.ts

import type { ApiResult } from '../types/api';
import type { Deck } from '../types/deck';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

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