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

/**
 * What the Edit Card form says when an edit would leave a stored translation
 * out of step with the English. The form never sends translations, but the
 * server re-validates the stored one against the edited English on every PUT
 * (Cards.cs), so adding or removing a section the translation must mirror is
 * refused with a 400 (TRANSLATION_FIELD_MISSING / TRANSLATION_FIELD_EXTRA, or
 * TRANSLATION_ANSWER_EMPTY). The Chinese can only change through the Markdown
 * import, so that is where the author is sent.
 */
export const USAGE_NEEDS_MARKDOWN =
  'This card has a Chinese translation, so Real-world usage cannot be added or removed here: the server refuses ' +
  'a save that leaves its USAGE_ZH: out of step. Edit USAGE: and USAGE_ZH: in the deck Markdown and re-import it.';

export const EXPLANATION_NEEDS_MARKDOWN =
  'This card has a Chinese translation, so the Explanation cannot be added or cleared here: the server refuses ' +
  'a save that leaves its A_ZH: out of step. Edit A: and A_ZH: in the deck Markdown and re-import it.';

/** The server codes a form save answers with when the stored translation no longer mirrors the edit. */
export const FORM_TRANSLATION_MIRROR_CODES: readonly string[] = [
  'TRANSLATION_FIELD_MISSING',
  'TRANSLATION_FIELD_EXTRA',
  'TRANSLATION_ANSWER_EMPTY',
];

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Null when the form's English can be saved over the card's stored zh-CN
 * translation, else the message to show instead of sending the PUT. Mirrors
 * the server's presence rules: Real-world usage and the explanation must each
 * be present in the English exactly when the stored translation has them.
 * Changing their wording is allowed (the server then marks the translation
 * stale); only adding or removing one is refused.
 */
export function formTranslationConflict(
  card: Pick<Card, 'translations'>,
  values: { explanation: string; realWorldUsage: string },
  locale: TranslationLocale = 'zh-CN',
): string | null {
  const entry = translationsOf(card)?.[locale];
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const zh = entry as { explanation?: unknown; realWorldUsage?: unknown };
  if (hasText(values.realWorldUsage) !== hasText(zh.realWorldUsage)) return USAGE_NEEDS_MARKDOWN;
  if (hasText(values.explanation) !== hasText(zh.explanation)) return EXPLANATION_NEEDS_MARKDOWN;
  return null;
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
