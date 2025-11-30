// src/types/deck.ts

export interface Deck {
  id: number;
  slug: string;
  title: string;
  author: string;
  description?: string | null;
  locale: string;
  deckType: number;   // 1 = Starter, 2 = Paid
  isDeleted: number;  // 0 / 1
  version: number;
  createdAt: number;  // epoch ms
  updatedAt: number;
}