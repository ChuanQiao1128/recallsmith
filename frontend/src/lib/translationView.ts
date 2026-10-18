// src/lib/translationView.ts
//
// What the console pages show about a card's built-in translation: the
// Missing / Stale / OK verdict (EditCardPage chip, CardListPage filter) and
// the card face in one language (the DeckPreviewPage language toggle). Pure, no
// React. The face follows the app's rule (contract §5): a card whose
// translation is incomplete is shown wholly in English, never mixed.

import type { Card } from '../types/card';
import type { Deck } from '../types/deck';
import type { McqBlob } from '../types/mcq';
import type { TranslationLocale } from '../types/translation';
import { mcqOf } from './mcqRules';
import { translationsOf, validateTranslation, type TranslationEnglish, type TranslationIssue } from './translationRules';

export type TranslationState = 'missing' | 'stale' | 'ok';

export type DisplayLang = 'en' | TranslationLocale;

type TranslatableCard = Pick<Card, 'question' | 'explanation' | 'realWorldUsage' | 'translations' | 'translationStatus'>;

function englishOf(card: TranslatableCard): TranslationEnglish {
  return {
    question: card.question ?? '',
    explanation: card.explanation ?? '',
    realWorldUsage: card.realWorldUsage ?? null,
    mcq: mcqOf(card),
  };
}

/** The blocking issues of one locale's stored translation against the card's current English. */
export function translationIssues(card: TranslatableCard, locale: TranslationLocale = 'zh-CN'): TranslationIssue[] {
  const entry = translationsOf(card)?.[locale];
  if (entry === undefined || entry === null) return [];
  return validateTranslation({ translations: { [locale]: entry }, english: englishOf(card) });
}

/**
 * 'missing' without a translation for `locale`; 'stale' when the server says
 * the English moved on since it was written, or when it no longer fits the
 * current English (an option added, a usage removed: the publish gate refuses
 * both); 'ok' otherwise.
 */
export function translationState(card: TranslatableCard, locale: TranslationLocale = 'zh-CN'): TranslationState {
  const entry = translationsOf(card)?.[locale];
  if (entry === undefined || entry === null) return 'missing';
  if (card.translationStatus?.[locale] === 'stale') return 'stale';
  return translationIssues(card, locale).length > 0 ? 'stale' : 'ok';
}

/** True when the deck declares `locale` (decks.translation_locales), so every live card needs it to publish. */
export function deckDeclaresLocale(deck: Pick<Deck, 'translationLocales'>, locale: TranslationLocale = 'zh-CN'): boolean {
  return Array.isArray(deck.translationLocales) && deck.translationLocales.includes(locale);
}

/** True when translations are in play for this deck: declared, or carried by at least one card. */
export function deckUsesTranslations(
  deck: Pick<Deck, 'translationLocales'>,
  cards: readonly Pick<Card, 'translations'>[],
  locale: TranslationLocale = 'zh-CN',
): boolean {
  return deckDeclaresLocale(deck, locale) || cards.some((card) => translationsOf(card)?.[locale] != null);
}

export interface FaceOption {
  key: string;
  text: string;
  why: string | null;
  /** Always the English mark: a translation never says which option is right. */
  correct: boolean;
}

export interface CardFace {
  lang: DisplayLang;
  /** Chinese was asked for, but the card has no complete translation, so the face is English. */
  fellBack: boolean;
  question: string;
  explanation: string | null;
  realWorldUsage: string | null;
  qualifier: string | null;
  /** In stored English order; the app shuffles by key, so order never depends on the language. */
  options: FaceOption[];
}

/** The text of a card in one language. `english` is the card as stored; `translations` its wire map. */
export function cardFace(
  english: { question: string; explanation: string | null; realWorldUsage: string | null; mcq: McqBlob | null },
  translations: unknown,
  lang: DisplayLang,
): CardFace {
  const englishFace: CardFace = {
    lang: 'en',
    fellBack: false,
    question: english.question,
    explanation: english.explanation,
    realWorldUsage: english.realWorldUsage,
    qualifier: english.mcq?.qualifier ?? null,
    options: (english.mcq?.options ?? []).map((o) => ({ key: o.key, text: o.text, why: o.why, correct: o.correct })),
  };
  if (lang === 'en') return englishFace;

  const entry = translationsOf({ translations })?.[lang];
  const complete =
    entry !== undefined &&
    entry !== null &&
    validateTranslation({
      translations: { [lang]: entry },
      english: {
        question: english.question,
        explanation: english.explanation ?? '',
        realWorldUsage: english.realWorldUsage,
        mcq: english.mcq,
      },
    }).length === 0;
  if (!complete) return { ...englishFace, fellBack: true };

  // validateTranslation passed, so every field below has the shape it names.
  const zh = entry as {
    question: string;
    explanation?: string;
    realWorldUsage?: string;
    mcq?: { qualifier: string | null; options: Record<string, { text: string; why: string | null }> } | null;
  };
  return {
    lang,
    fellBack: false,
    question: zh.question,
    explanation: zh.explanation ?? null,
    realWorldUsage: zh.realWorldUsage ?? null,
    qualifier: zh.mcq?.qualifier ?? null,
    options: englishFace.options.map((o) => {
      const translated = zh.mcq?.options[o.key];
      return { key: o.key, text: translated?.text ?? o.text, why: translated?.why ?? null, correct: o.correct };
    }),
  };
}
