import type { CardExport, McqExport, McqOption } from '../types/deckExport';
import { CARD_TRANSLATION_LOCALE, type CardTranslation, type CardTranslations } from './cardTranslation';

/**
 * Card translations contract §5: the language a card is shown in is a display
 * concern only. localizeForDisplay swaps the text the learner reads — the
 * question, explanation and real-world usage, and each MCQ option's text and
 * why plus the qualifier, matched by option key — and nothing else. The stable
 * uid, revision, difficulty, topic, code, correct marks, keys, shuffle flag and
 * the shown order all stay the English card's, so grading, verdicts, picks,
 * scheduling and progress never see which language was on screen.
 *
 * A translation that does not cover every English text on the card shows the
 * whole card in English: a card is never half one language, half the other.
 */

/** What the learner chose to read; the device-wide preference (cardLangPrefs). */
export type CardDisplayLang = 'en' | typeof CARD_TRANSLATION_LOCALE;

export type LocalizedCardDisplay = {
  card: CardExport;
  /** The display MCQ (null for a Q/A card): same keys, correct marks and shuffle as the English one. */
  mcq: McqExport | null;
  /** The English shown order, entry for entry, with display text. */
  shownOrder: readonly McqOption[];
  /** The language actually on screen: 'en' unless a complete translation was applied. */
  lang: CardDisplayLang;
};

export type LocalizeInput = {
  card: CardExport;
  /** The resolved English MCQ (resolveMcq) or null — a card that renders as Q/A ignores any MCQ translation. */
  mcq: McqExport | null;
  shownOrder: readonly McqOption[];
  translation: CardTranslation | null | undefined;
  lang: CardDisplayLang;
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The deck's own locale is Chinese: there is nothing to switch to. No live deck is one since
 * aws-saa-fundamentals became en-US with a built-in zh-CN translation (2026-10-18 rewrite), but a
 * device can still have its old zh-CN deck file installed.
 */
export function isChineseDeckLocale(locale: unknown): boolean {
  return typeof locale === 'string' && locale.trim().toLowerCase() === CARD_TRANSLATION_LOCALE.toLowerCase();
}

/** The card's zh-CN entry, when its deck is not itself in Chinese. */
export function cardTranslationFor(
  translations: CardTranslations | null | undefined,
  deckLocale: unknown,
): CardTranslation | null {
  if (!translations || isChineseDeckLocale(deckLocale)) return null;
  return translations[CARD_TRANSLATION_LOCALE] ?? null;
}

/**
 * The display MCQ, or null when the translation misses something the English
 * MCQ shows: an option key (the key sets must match exactly), the why of an
 * option that has one, or the qualifier. Text the English MCQ does not carry
 * (a why on an option without one, a qualifier the card has none of) is not used.
 */
function localizeMcq(mcq: McqExport, translation: CardTranslation): McqExport | null {
  const zh = translation.mcq;
  if (!zh) return null;
  const zhKeys = Object.keys(zh.options);
  if (zhKeys.length !== mcq.options.length) return null;
  const options: McqOption[] = [];
  for (const option of mcq.options) {
    const entry = Object.prototype.hasOwnProperty.call(zh.options, option.key) ? zh.options[option.key] : undefined;
    if (!entry) return null;
    if (option.why !== null && entry.why === null) return null;
    options.push(
      Object.freeze({
        key: option.key,
        text: entry.text,
        why: option.why !== null ? entry.why : null,
        correct: option.correct,
      }),
    );
  }
  if (mcq.qualifier !== null && zh.qualifier === null) return null;
  return Object.freeze({
    v: mcq.v,
    qualifier: mcq.qualifier !== null ? zh.qualifier : null,
    shuffle: mcq.shuffle,
    options: Object.freeze(options) as McqOption[],
  });
}

/**
 * The card as it is shown. Pure; never throws. With lang 'en', no translation
 * or an incomplete one, the input card, mcq and shownOrder come back as the
 * same objects (lang 'en'), so English rendering is exactly what it was.
 */
export function localizeForDisplay(input: LocalizeInput): LocalizedCardDisplay {
  const english: LocalizedCardDisplay = {
    card: input.card,
    mcq: input.mcq,
    shownOrder: input.shownOrder,
    lang: 'en',
  };
  try {
    const { card, mcq, shownOrder, translation, lang } = input;
    if (lang !== CARD_TRANSLATION_LOCALE || !translation || !card) return english;
    if (!hasText(translation.question)) return english;
    if (hasText(card.Explanation) && !hasText(translation.explanation)) return english;
    if (hasText(card.RealWorldUsage) && !hasText(translation.realWorldUsage)) return english;

    if ((card.FrontHelp?.length ?? 0) !== (translation.frontHelp?.length ?? 0)) return english;

    let displayMcq: McqExport | null = null;
    let displayOrder: readonly McqOption[] = shownOrder;
    if (mcq) {
      displayMcq = localizeMcq(mcq, translation);
      if (!displayMcq) return english;
      const byKey = new Map(displayMcq.options.map((option) => [option.key, option]));
      const mapped: McqOption[] = [];
      for (const option of shownOrder) {
        const shown = byKey.get(option.key);
        if (!shown) return english;
        mapped.push(shown);
      }
      displayOrder = mapped;
    }

    return {
      card: {
        ...card,
        ...(card.FrontHelp?.length ? { FrontHelp: translation.frontHelp } : {}),
        Question: translation.question,
        Explanation: hasText(card.Explanation) ? translation.explanation : card.Explanation,
        RealWorldUsage: hasText(card.RealWorldUsage) ? (translation.realWorldUsage as string) : card.RealWorldUsage,
      },
      mcq: displayMcq,
      shownOrder: displayOrder,
      lang: CARD_TRANSLATION_LOCALE,
    };
  } catch {
    return english;
  }
}

/**
 * True when the translation covers every English text the card shows, i.e.
 * localizeForDisplay would switch it. Decides whether the language toggle is
 * offered for this card.
 */
export function hasCompleteTranslation(card: CardExport, mcq: McqExport | null, translation: CardTranslation | null | undefined): boolean {
  if (!translation) return false;
  const order = mcq ? mcq.options : [];
  return localizeForDisplay({ card, mcq, shownOrder: order, translation, lang: CARD_TRANSLATION_LOCALE }).lang === CARD_TRANSLATION_LOCALE;
}
