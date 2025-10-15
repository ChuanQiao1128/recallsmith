import { http } from './client';
import type {
  CreateDeckRequest, CreateDeckResponse,
  CreateDraftCardRequest, CreateDraftCardResponse,
  PublishDeckRequest, PublishDeckResponse
} from '../types/dto';

// POST /api/admin/v1/decks
export const createDeck = (body: CreateDeckRequest) =>
  http<CreateDeckResponse>('/api/admin/v1/decks', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// POST /api/admin/v1/decks/{deckId}/cards
export const createDraftCard = (deckId: string, body: CreateDraftCardRequest) =>
  http<CreateDraftCardResponse>(`/api/admin/v1/decks/${deckId}/cards`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// POST /api/admin/v1/decks/{deckId}/publish
export const publishDeck = (deckId: string, body: PublishDeckRequest) =>
  http<PublishDeckResponse>(`/api/admin/v1/decks/${deckId}/publish`, {
    method: 'POST',
    body: JSON.stringify(body),
  });