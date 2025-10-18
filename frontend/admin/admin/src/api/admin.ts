import { http } from './client';
import { mock } from './mock';
import type { Card, CardDifficulty, Deck, PublishInfo } from '../types';

export type CreateDeckRequest = { slug: string; title: string; locale?: string };
export type CreateDeckResponse = { deckId: string };

export type CreateDraftCardRequest = {
  stableUid: string;
  frontMd: string;
  backMd: string;
  keyPoint: string;
  tags: string[];
  difficulty?: CardDifficulty;
};
export type CreateDraftCardResponse = { cardId: string; stableUid: string };

export type PublishDeckRequest = { version: string; changelog?: string };
export type PublishDeckResponse = PublishInfo;

const USE_MOCK = http.MOCK;

export async function listDecks(): Promise<Deck[]> {
  if (USE_MOCK) return Promise.resolve(mock.listDecks());
  // 没有后端列表接口时自动降级
  try {
    // 如果后端未来提供 GET /api/admin/v1/decks 列表，这里换成 http.request
    return mock.listDecks();
  } catch {
    return mock.listDecks();
  }
}

export async function getDeck(deckId: string): Promise<Deck | undefined> {
  if (USE_MOCK) return Promise.resolve(mock.getDeck(deckId));
  try {
    return mock.getDeck(deckId);
  } catch {
    return mock.getDeck(deckId);
  }
}

export async function createDeck(body: CreateDeckRequest): Promise<CreateDeckResponse> {
  if (USE_MOCK) {
    const res = mock.createDeck(body);
    localStorage.setItem('lastDeckId', res.deckId);
    return res;
  }
  try {
    const res = await http.request<CreateDeckResponse>('/api/admin/v1/decks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    localStorage.setItem('lastDeckId', res.deckId);
    return res;
  } catch {
    // 降级到 mock
    const res = mock.createDeck(body);
    localStorage.setItem('lastDeckId', res.deckId);
    return res;
  }
}

export async function updateDeckMeta(deckId: string, patch: Partial<Deck>): Promise<Deck | undefined> {
  // 先用 mock，未来接上后端 PATCH 即可
  return Promise.resolve(mock.updateDeck(deckId, patch));
}

export async function listCards(deckId: string): Promise<Card[]> {
  if (USE_MOCK) return Promise.resolve(mock.listCards(deckId));
  try {
    return mock.listCards(deckId);
  } catch {
    return mock.listCards(deckId);
  }
}

export async function createDraftCard(deckId: string, body: CreateDraftCardRequest): Promise<CreateDraftCardResponse> {
  if (USE_MOCK) return Promise.resolve(mock.upsertCard({ deckId, ...body }));
  try {
    const res = await http.request<CreateDraftCardResponse>(`/api/admin/v1/decks/${deckId}/cards`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    // 同步到本地 mock，方便列表立即看到
    mock.upsertCard({ deckId, ...body, id: res.cardId });
    return res;
  } catch {
    return mock.upsertCard({ deckId, ...body });
  }
}

export async function deleteCard(deckId: string, cardId: string) {
  // 后端暂时没有删除接口，先用 mock
  mock.deleteCard(deckId, cardId);
}

export async function publishDeck(deckId: string, body: PublishDeckRequest): Promise<PublishDeckResponse> {
  if (USE_MOCK) return Promise.resolve(mock.publish(deckId, body.version));
  try {
    const res = await http.request<PublishDeckResponse>(`/api/admin/v1/decks/${deckId}/publish`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    mock.publish(deckId, res.version); // 记录本地历史
    return res;
  } catch {
    return mock.publish(deckId, body.version);
  }
}

export async function listPublishes(deckId: string): Promise<PublishInfo[]> {
  return Promise.resolve(mock.listPublishes(deckId));
}