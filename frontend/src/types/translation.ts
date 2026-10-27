import type { FrontHelpEntry } from '../lib/frontHelp';
// src/types/translation.ts
//
// The console's copy of a card's built-in translations (card translations
// contract §1): cards.translations in the database, `translations` on the API
// and in deck.json. English stays the source of truth: a translation carries
// only display text, keyed by the English option keys. Correct marks, option
// order, shuffle, code, topic and source never appear here.

/** v1 ships Simplified Chinese only. */
export type TranslationLocale = 'zh-CN';

export interface TranslatedOption {
  text: string;
  /** Non-null exactly when the English option has a why. */
  why: string | null;
}

export interface TranslatedMcq {
  /** Non-null exactly when the English qualifier is non-null; appears verbatim in the translated question. */
  qualifier: string | null;
  /** Keyed by the English option keys (a-f), never by display letter. */
  options: Record<string, TranslatedOption>;
}

export interface CardTranslation {
  v: 1;
  frontHelp?: FrontHelpEntry[] | null;
  question: string;
  /** Present when the English explanation is non-empty (always, for a valid card). */
  explanation?: string;
  /** Present exactly when the English realWorldUsage is non-empty. */
  realWorldUsage?: string;
  /** Present exactly when the card has an English mcq. */
  mcq?: TranslatedMcq | null;
}

export type CardTranslations = Partial<Record<TranslationLocale, CardTranslation>>;

/** Server verdict per locale: 'stale' when the English changed after the translation was written. */
export type TranslationStatus = Partial<Record<TranslationLocale, 'ok' | 'stale'>>;
