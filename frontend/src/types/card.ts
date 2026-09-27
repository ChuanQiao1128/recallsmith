import type { McqBlob } from './mcq';

/** Per-card citation (server column cards.source): the https page and the passage copied from it. */
export interface CardSource {
  url: string;
  quote: string | null;
}

export interface Card {
  id: number;
  deckId: number;
  stableUid: string;
  question: string;

  difficulty: number;
  orderInDeck: number;

  explanation?: string | null;
  realWorldUsage?: string | null;
  codeSnippet?: string | null;
  codeLanguage?: string | null;
  topic?: string | null;
  mcq?: McqBlob | null;
  /** null = no source on the server; absent = an older server without the column. */
  source?: CardSource | null;
  revision?: number | null;

  version: number;
  isDeleted?: number;

  createdAt: string;
  updatedAt: string;

  // Gacha: a virtual field, derived from difficulty.
  rarity?: 'common' | 'rare' | 'epic';
}