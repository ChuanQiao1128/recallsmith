import { parseFrontHelp, type FrontHelpEntry } from './frontHelp';
import { MCQ_KEYS, MCQ_MAX_OPTION_TEXT } from '../features/gacha/mcq/normalizeMcq';

/**
 * A card's built-in translation (card translations contract §1), read from
 * `cards[].translations` of the installed raw deck file. Pure: the shape check
 * only. Whether a translation is complete for the English card it sits on is
 * localizeCard.ts's call, and the deck file is read by installedDeckIndex.ts.
 *
 * English stays the source of truth: a translation carries text only. Correct
 * marks, option keys and order, shuffle, code, topic and the source quote all
 * come from the English card, so anything else in a translation — `correct`
 * above all — makes the whole locale entry invalid rather than being ignored.
 */

/** v1 ships one locale. */
export const CARD_TRANSLATION_LOCALE = 'zh-CN' as const;
export type CardTranslationLocale = typeof CARD_TRANSLATION_LOCALE;

export type McqOptionTranslation = { text: string; why: string | null };

export type CardTranslation = {
  v: 1;
  frontHelp?: FrontHelpEntry[] | null;
  question: string;
  /** Null when the entry has none. */
  explanation: string | null;
  realWorldUsage: string | null;
  /** Null when the entry has none; options are keyed by the English option key. */
  mcq: { qualifier: string | null; options: Readonly<Record<string, McqOptionTranslation>> } | null;
};

export type CardTranslations = Readonly<Partial<Record<CardTranslationLocale, CardTranslation>>>;

const ENTRY_KEYS = new Set(['v', 'question', 'explanation', 'realWorldUsage', 'mcq', 'frontHelp']);
const MCQ_ENTRY_KEYS = new Set(['qualifier', 'options']);
const OPTION_ENTRY_KEYS = new Set(['text', 'why']);
const OPTION_KEYS: ReadonlySet<string> = new Set(MCQ_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

/** string → trimmed ('' → null); null/undefined → null; anything else → undefined (invalid). */
function optionalText(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptions(raw: unknown): Record<string, McqOptionTranslation> | null {
  // Keyed by option key, never an array: order is the English card's business.
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;
  const options: Record<string, McqOptionTranslation> = {};
  for (const key of keys) {
    if (!OPTION_KEYS.has(key)) return null;
    const option = raw[key];
    if (!isRecord(option) || !hasOnlyKeys(option, OPTION_ENTRY_KEYS)) return null;
    if (typeof option.text !== 'string') return null;
    const text = option.text.trim();
    if (text.length < 1 || text.length > MCQ_MAX_OPTION_TEXT) return null;
    const why = optionalText(option.why);
    if (why === undefined) return null;
    options[key] = Object.freeze({ text, why });
  }
  return Object.freeze(options);
}

/**
 * One locale entry (`translations["zh-CN"]`). Null for anything that is not
 * exactly the contract §1 shape: an unknown key (`correct`, `shuffle`, `key`,
 * `source`, …) at any level, `v` other than 1, an empty question, a non-string
 * text field, options given as an array or under a key outside a–f, an empty or
 * over-long option text. Strings come back trimmed; an empty optional string
 * reads as absent. Never throws.
 */
export function parseRawCardTranslation(raw: unknown): CardTranslation | null {
  try {
    if (!isRecord(raw) || !hasOnlyKeys(raw, ENTRY_KEYS)) return null;
    if (raw.v !== 1) return null;

    if (typeof raw.question !== 'string') return null;
    const question = raw.question.trim();
    if (!question) return null;

    const explanation = optionalText(raw.explanation);
    const realWorldUsage = optionalText(raw.realWorldUsage);
    if (explanation === undefined || realWorldUsage === undefined) return null;

    const frontHelp = parseFrontHelp(raw.frontHelp);
    if (frontHelp === undefined) return null;

    let mcq: CardTranslation['mcq'] = null;
    if (raw.mcq !== null && raw.mcq !== undefined) {
      if (!isRecord(raw.mcq) || !hasOnlyKeys(raw.mcq, MCQ_ENTRY_KEYS)) return null;
      const qualifier = optionalText(raw.mcq.qualifier);
      if (qualifier === undefined) return null;
      const options = parseOptions(raw.mcq.options);
      if (!options) return null;
      mcq = Object.freeze({ qualifier, options });
    }

    return Object.freeze({ v: 1 as const, question, explanation, realWorldUsage, mcq, ...(frontHelp?.length ? { frontHelp } : {}) });
  } catch {
    return null;
  }
}

/**
 * A card's `translations` field: the valid entries of the supported locale(s),
 * or null when there is none. Locales this build does not know are skipped, so
 * a later locale never hides the zh-CN entry. Never throws.
 */
export function parseCardTranslations(raw: unknown): CardTranslations | null {
  try {
    if (!isRecord(raw)) return null;
    const zh = parseRawCardTranslation(raw[CARD_TRANSLATION_LOCALE]);
    return zh ? Object.freeze({ [CARD_TRANSLATION_LOCALE]: zh }) : null;
  } catch {
    return null;
  }
}
