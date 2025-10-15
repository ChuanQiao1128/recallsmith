import { api } from './client';
import type {
  CreateDeckRequest, CreateDeckResponse,
  CreateDraftCardRequest, CreateDraftCardResponse,
  PublishDeckRequest, PublishDeckResponse
} from '../types/dto';

export async function createDeck(req: CreateDeckRequest) {
  return api.post('api/admin/v1/decks', { json: req }).json<CreateDeckResponse>();
}

export async function createDraftCard(deckId: string, req: CreateDraftCardRequest) {
  return api.post(`api/admin/v1/decks/${deckId}/cards`, { json: req }).json<CreateDraftCardResponse>();
}

export async function publishDeck(deckId: string, req: PublishDeckRequest) {
  return api.post(`api/admin/v1/decks/${deckId}/publish`, { json: req }).json<PublishDeckResponse>();
}