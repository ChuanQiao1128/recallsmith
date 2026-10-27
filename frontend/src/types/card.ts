import type { FrontHelpEntry } from '../lib/frontHelp';
import type { McqBlob } from './mcq';
import type { CardTranslations, TranslationStatus } from './translation';

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
  frontHelp?: FrontHelpEntry[] | null;

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
  /** Built-in translations (cards.translations). null = none on the server; absent = an older server without the column. */
  translations?: CardTranslations | null;
  /** Server verdict per translated locale ('stale' once the English changed after the translation); absent when there is none. */
  translationStatus?: TranslationStatus | null;
  revision?: number | null;

  version: number;
  isDeleted?: number;

  createdAt: string;
  updatedAt: string;

  // Gacha: a virtual field, derived from difficulty.
  rarity?: 'common' | 'rare' | 'epic';
}