// src/lib/translationRules.ts
//
// Pure rules for a card's built-in translations (card translations contract
// §1-§2). The server (src_C/Vpc/Authoring/TranslationValidation.cs) runs the
// same checks and answers with the same codes, so a card that passes here is
// not refused at write time. No react, no DOM, type-only imports: the MCP
// server and lint-deck bundle this file through deckImport.ts for Node.
//
// The English card is the source of truth. A translation only carries display
// text keyed by the English option keys, so the correct marks, the option set,
// the shuffle flag and the code all come from the English card, and every rule
// below is a parity check against it.

import type { McqBlob } from '../types/mcq';

export const TRANSLATION_LOCALES = ['zh-CN'] as const;

/** Same ceiling as the English option text (McqValidation.cs step 9). */
export const TRANSLATION_OPTION_MAX_LENGTH = 600;

/**
 * A Han ideograph: CJK Unified Ideographs, Extension A, or the Compatibility
 * Ideographs block. CJK punctuation (fullwidth brackets, the ideographic full
 * stop) does not count, so a question that only gained Chinese brackets is
 * still "not translated". Every non-Latin character here is written as a
 * \u escape, like everything under src/ (tests/uiLanguage.test.ts).
 */
export const CJK_CHARACTER = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/**
 * The contract's Chinese choose-N marker: a fullwidth or ASCII bracket around
 * "select two / three items" with an optional full stop. Spelled out it is
 * U+FF08 or "(", optional spaces, U+9009 U+62E9 ("select", the second char
 * optional), the count (U+4E24 or U+4E8C = two, U+4E09 = three, or 2 / 3),
 * U+9879 ("item"), an optional U+3002 or ".", then U+FF09 or ")". Must agree
 * with the English correct count in both directions, like CHOOSE_N_STEM does
 * for "(Choose two.)".
 */
export const CHOOSE_N_STEM_ZH =
  /[\uFF08(]\s*\u9009\u62E9?\s*(\u4E24|\u4E8C|\u4E09|2|3)\s*\u9879\s*[\u3002.]?\s*[\uFF09)]/;
const ZH_THREE = '\u4E09';

/** Contract §2 codes, in the contract's order. */
export const TRANSLATION_ISSUE_CODES = [
  'TRANSLATION_BAD_SHAPE',
  'TRANSLATION_BAD_LOCALE',
  'TRANSLATION_QUESTION_EMPTY',
  'TRANSLATION_ANSWER_EMPTY',
  'TRANSLATION_FIELD_MISSING',
  'TRANSLATION_FIELD_EXTRA',
  'TRANSLATION_OPTION_KEYS_MISMATCH',
  'TRANSLATION_CORRECT_MARK',
  'TRANSLATION_OPTION_EMPTY',
  'TRANSLATION_OPTION_TOO_LONG',
  'TRANSLATION_OPTION_TEXT_DUPLICATE',
  'TRANSLATION_WHY_MISMATCH',
  'TRANSLATION_QUALIFIER_MISMATCH',
  'TRANSLATION_QUALIFIER_NOT_IN_STEM',
  'TRANSLATION_CHOOSE_N_MISMATCH',
  'TRANSLATION_NOT_TRANSLATED',
] as const;

export type TranslationIssueCode = (typeof TRANSLATION_ISSUE_CODES)[number];

export interface TranslationIssue {
  code: TranslationIssueCode;
  /** The locale key the issue belongs to; absent for a problem with the map itself. */
  locale?: string;
  message: string;
}

/** The effective English card a translation is checked against. */
export interface TranslationEnglish {
  question: string;
  explanation: string;
  realWorldUsage: string | null;
  mcq: McqBlob | null;
}

const ENTRY_KEYS = new Set(['v', 'question', 'explanation', 'realWorldUsage', 'mcq']);
const MCQ_KEYS = new Set(['qualifier', 'options']);
const OPTION_KEYS = new Set(['text', 'why']);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-blank text, trimmed; null for anything else (absent, null, blank, a wrong type). */
function presentText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/** A key named "correct" in any letter case: refused as TRANSLATION_CORRECT_MARK, never as an unknown key. */
function isCorrectKey(key: string): boolean {
  return key.toLowerCase() === 'correct';
}

/** True when a "correct" key appears anywhere inside `value`, at any depth (the server's HasCorrectKey). */
function hasCorrectKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCorrectKey);
  if (!isRecord(value)) return false;
  return Object.keys(value).some((key) => isCorrectKey(key) || hasCorrectKey(value[key]));
}

export function hasCjk(text: string): boolean {
  return CJK_CHARACTER.test(text);
}

export function isTranslationLocale(locale: string): locale is (typeof TRANSLATION_LOCALES)[number] {
  return (TRANSLATION_LOCALES as readonly string[]).includes(locale);
}

/**
 * Total validator: never throws. `translations` is the whole map as it arrives
 * from a parser or the API; null, undefined and an empty map mean "no
 * translation" and are valid. Every issue blocks.
 *
 * The server stops at its first failure; this returns every issue, in the
 * server's check order (per locale: shape, correct marks, question, answer,
 * usage, mcq presence, qualifier, option shape, option keys, option text,
 * duplicates, whys, choose-N), so the first issue here is the code a write of
 * the same card would be refused with. Per-option codes repeat once per option.
 */
export function validateTranslation(input: {
  translations: unknown;
  english: TranslationEnglish;
  /** The deck's own locale; a translation into it is refused. Unknown when omitted. */
  deckLocale?: string | null;
}): TranslationIssue[] {
  const { translations, english, deckLocale } = input;
  if (translations === null || translations === undefined) return [];

  const issues: TranslationIssue[] = [];
  if (!isRecord(translations)) {
    issues.push({ code: 'TRANSLATION_BAD_SHAPE', message: 'translations must be an object keyed by locale, or null.' });
    return issues;
  }

  for (const locale of Object.keys(translations)) {
    if (!isTranslationLocale(locale)) {
      issues.push({
        code: 'TRANSLATION_BAD_LOCALE',
        locale,
        message: `"${locale}" is not a supported translation locale; v1 supports ${TRANSLATION_LOCALES.join(', ')} only.`,
      });
      continue;
    }
    if (deckLocale && deckLocale.trim().toLowerCase() === locale.toLowerCase()) {
      issues.push({
        code: 'TRANSLATION_BAD_LOCALE',
        locale,
        message: `The deck is already ${deckLocale.trim()}; a translation must be into another language.`,
      });
      continue;
    }
    validateEntry(locale, translations[locale], english, issues);
  }
  return issues;
}

function validateEntry(locale: string, raw: unknown, english: TranslationEnglish, issues: TranslationIssue[]): void {
  const push = (code: TranslationIssueCode, message: string) => issues.push({ code, locale, message });

  if (!isRecord(raw)) {
    push('TRANSLATION_BAD_SHAPE', `The ${locale} translation must be an object.`);
    return;
  }
  // Correct marks belong to the English card alone; one anywhere is its own code.
  if (hasCorrectKey(raw)) {
    push('TRANSLATION_CORRECT_MARK', `The ${locale} translation marks a correct option; correct answers are marked only on the English OPT: lines.`);
  }
  for (const key of Object.keys(raw)) {
    if (!isCorrectKey(key) && !ENTRY_KEYS.has(key)) {
      push('TRANSLATION_BAD_SHAPE', `The ${locale} translation has an unknown field "${key}".`);
    }
  }
  if (raw.v !== 1) push('TRANSLATION_BAD_SHAPE', `The ${locale} translation must have v: 1.`);

  if (!isOptionalString(raw.question)) push('TRANSLATION_BAD_SHAPE', `The ${locale} question must be a string.`);
  const question = presentText(raw.question);
  if (question === null) {
    push('TRANSLATION_QUESTION_EMPTY', `The ${locale} translation has no question.`);
  } else if (!hasCjk(question)) {
    push('TRANSLATION_NOT_TRANSLATED', `The ${locale} question contains no Chinese character; it looks untranslated.`);
  }

  if (!isOptionalString(raw.explanation)) push('TRANSLATION_BAD_SHAPE', `The ${locale} explanation must be a string.`);
  const englishExplanation = presentText(english.explanation);
  const explanation = presentText(raw.explanation);
  if (englishExplanation !== null && explanation === null) {
    push('TRANSLATION_ANSWER_EMPTY', `The ${locale} translation has no explanation.`);
  } else if (englishExplanation === null && explanation !== null) {
    push('TRANSLATION_FIELD_EXTRA', `The ${locale} translation has an explanation, but the English card has none.`);
  }

  if (!isOptionalString(raw.realWorldUsage)) push('TRANSLATION_BAD_SHAPE', `The ${locale} realWorldUsage must be a string.`);
  const englishUsage = presentText(english.realWorldUsage);
  const usage = presentText(raw.realWorldUsage);
  if (englishUsage !== null && usage === null) {
    push('TRANSLATION_FIELD_MISSING', `The English card has a realWorldUsage, but the ${locale} translation has none.`);
  } else if (englishUsage === null && usage !== null) {
    push('TRANSLATION_FIELD_EXTRA', `The ${locale} translation has a realWorldUsage, but the English card has none.`);
  }

  const hasMcq = raw.mcq !== undefined && raw.mcq !== null;
  if (english.mcq !== null && !hasMcq) {
    push('TRANSLATION_FIELD_MISSING', `The English card is multiple choice, but the ${locale} translation has no mcq block.`);
  } else if (english.mcq === null && hasMcq) {
    push('TRANSLATION_FIELD_EXTRA', `The ${locale} translation has an mcq block, but the English card is not multiple choice.`);
  } else if (english.mcq !== null && hasMcq) {
    validateMcqEntry(locale, raw.mcq, english.mcq, question ?? '', push);
  }
}

function validateMcqEntry(
  locale: string,
  raw: unknown,
  english: McqBlob,
  question: string,
  push: (code: TranslationIssueCode, message: string) => void,
): void {
  if (!isRecord(raw)) {
    push('TRANSLATION_BAD_SHAPE', `The ${locale} mcq must be an object.`);
    return;
  }
  for (const key of Object.keys(raw)) {
    if (!isCorrectKey(key) && !MCQ_KEYS.has(key)) {
      push('TRANSLATION_BAD_SHAPE', `The ${locale} mcq has an unknown field "${key}".`);
    }
  }

  // Qualifier parity, then the stem check on the translated question
  // (case-insensitive, like the English MCQ_QUALIFIER_NOT_IN_STEM).
  if (!isOptionalString(raw.qualifier)) push('TRANSLATION_BAD_SHAPE', `The ${locale} qualifier must be a string or null.`);
  const englishQualifier = presentText(english.qualifier);
  const qualifier = presentText(raw.qualifier);
  if ((englishQualifier !== null) !== (qualifier !== null)) {
    push(
      'TRANSLATION_QUALIFIER_MISMATCH',
      englishQualifier !== null
        ? `The English card has the qualifier "${englishQualifier}", but the ${locale} translation has none.`
        : `The ${locale} translation has a qualifier, but the English card has none.`,
    );
  } else if (qualifier !== null && !question.toLowerCase().includes(qualifier.toLowerCase())) {
    push('TRANSLATION_QUALIFIER_NOT_IN_STEM', `The ${locale} qualifier "${qualifier}" does not appear in the ${locale} question.`);
  }

  const options = raw.options;
  if (!isRecord(options)) {
    push('TRANSLATION_BAD_SHAPE', `The ${locale} mcq options must be an object keyed by the English option keys.`);
    return;
  }

  const englishKeys = english.options.map((o) => o.key);
  const keys = Object.keys(options);
  for (const key of keys) {
    const option = options[key];
    if (!isRecord(option)) {
      push('TRANSLATION_BAD_SHAPE', `The ${locale} option "${key}" must be an object with text and why.`);
      continue;
    }
    for (const field of Object.keys(option)) {
      if (!isCorrectKey(field) && !OPTION_KEYS.has(field)) {
        push('TRANSLATION_BAD_SHAPE', `The ${locale} option "${key}" has an unknown field "${field}".`);
      }
    }
    if (!isOptionalString(option.text)) push('TRANSLATION_BAD_SHAPE', `The ${locale} option "${key}" text must be a string.`);
    if (!isOptionalString(option.why)) push('TRANSLATION_BAD_SHAPE', `The ${locale} option "${key}" why must be a string or null.`);
  }

  const missing = englishKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !englishKeys.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      missing.length > 0 ? `missing ${missing.map((k) => `"${k}"`).join(', ')}` : null,
      extra.length > 0 ? `unknown ${extra.map((k) => `"${k}"`).join(', ')}` : null,
    ].filter((part): part is string => part !== null);
    push('TRANSLATION_OPTION_KEYS_MISMATCH', `The ${locale} options must use the English option keys exactly (${parts.join('; ')}).`);
  }

  // From here on, the English options this translation covers, in English order.
  const shared = english.options.filter((o) => keys.includes(o.key));
  const textOf = (key: string): string => {
    const option = options[key];
    return isRecord(option) ? (presentText(option.text) ?? '') : '';
  };

  for (const { key } of shared) {
    const text = textOf(key);
    if (text === '') {
      push('TRANSLATION_OPTION_EMPTY', `The ${locale} option "${key}" has no text.`);
    } else if (text.length > TRANSLATION_OPTION_MAX_LENGTH) {
      push('TRANSLATION_OPTION_TOO_LONG', `The ${locale} option "${key}" is ${text.length} characters; at most ${TRANSLATION_OPTION_MAX_LENGTH} are allowed.`);
    }
  }

  const seenText = new Set<string>();
  for (const { key } of shared) {
    const folded = textOf(key).toLowerCase();
    if (folded === '') continue;
    if (seenText.has(folded)) {
      push('TRANSLATION_OPTION_TEXT_DUPLICATE', `The ${locale} option "${key}" repeats the text of an earlier option.`);
    } else {
      seenText.add(folded);
    }
  }

  for (const englishOption of shared) {
    const option = options[englishOption.key];
    const englishWhy = presentText(englishOption.why);
    const why = isRecord(option) ? presentText(option.why) : null;
    if ((englishWhy !== null) !== (why !== null)) {
      push(
        'TRANSLATION_WHY_MISMATCH',
        englishWhy !== null
          ? `English option "${englishOption.key}" has a WHY:, but the ${locale} option has no why.`
          : `The ${locale} option "${englishOption.key}" has a why, but the English option has none.`,
      );
    }
  }

  // Choose-N parity against the English star count, both directions.
  const requiredCount = english.options.filter((o) => o.correct).length;
  const match = CHOOSE_N_STEM_ZH.exec(question);
  const stemN = match ? (match[1] === ZH_THREE || match[1] === '3' ? 3 : 2) : 1;
  if (stemN !== requiredCount) {
    push(
      'TRANSLATION_CHOOSE_N_MISMATCH',
      `The ${locale} question implies ${stemN} correct option(s) but the English card marks ${requiredCount}; the Chinese stem carries the choose-two / choose-three marker (FORMAT.md §1.7) exactly when the English stem says "(Choose two.)" / "(Choose three.)".`,
    );
  }
}

/**
 * Canonical compare string. A server null, an older server that dropped the
 * key, and a file with no _ZH section all normalize to '', so a re-import of
 * an untouched file stays unchanged. Locales and option keys are sorted, text
 * is trimmed, a blank why or usage collapses to null and `v` is dropped, the
 * same way normalizeMcqForCompare treats the English blob.
 */
export function normalizeTranslationsForCompare(translations: unknown): string {
  if (!isRecord(translations)) return '';
  const locales = Object.keys(translations).sort();
  if (locales.length === 0) return '';
  return JSON.stringify(locales.map((locale) => [locale, canonicalEntry(translations[locale])]));
}

function canonicalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalEntry(raw: unknown): unknown {
  if (!isRecord(raw)) return raw ?? null;
  return {
    question: canonicalText(raw.question),
    explanation: canonicalText(raw.explanation),
    realWorldUsage: presentText(raw.realWorldUsage),
    mcq: canonicalMcq(raw.mcq),
  };
}

function canonicalMcq(raw: unknown): unknown {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return raw;
  const options = raw.options;
  return {
    qualifier: presentText(raw.qualifier),
    options: isRecord(options)
      ? Object.keys(options)
          .sort()
          .map((key) => {
            const option = options[key];
            return isRecord(option)
              ? [key, canonicalText(option.text), presentText(option.why)]
              : [key, option ?? null];
          })
      : (options ?? null),
  };
}

/**
 * Reads the wire `translations` key off a server row without trusting its
 * type, like mcqOf does for `mcq`: an object comes back as is, anything else
 * (null, absent on an older server, a wrong type) as null.
 */
export function translationsOf(row: object | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const value = (row as { translations?: unknown }).translations;
  return isRecord(value) ? value : null;
}

// ---------------------- warnings (non-blocking) ----------------------

export type TranslationWarningCode = 'ZH_WARN_CORRECT_LONGEST' | 'ZH_WARN_MAYBE_STALE' | 'ZH_WARN_STALE_MARKED_CURRENT';
export type TranslationWarning = { code: TranslationWarningCode; message: string };

/** Same ratio as MCQ_WARN_CORRECT_LONGEST, measured on the Chinese option text. */
export const ZH_WARN_LONGEST_RATIO = 1.4;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Total: never throws, also runs on a translation the blocking rules refuse.
 * Correctness comes from the English options; the lengths from the translation.
 */
export function warnTranslation(input: { translations: unknown; mcq: McqBlob | null }): TranslationWarning[] {
  const warnings: TranslationWarning[] = [];
  if (!isRecord(input.translations) || input.mcq === null) return warnings;
  for (const locale of Object.keys(input.translations)) {
    const entry = input.translations[locale];
    if (!isRecord(entry) || !isRecord(entry.mcq) || !isRecord(entry.mcq.options)) continue;
    const options = entry.mcq.options;
    const lengthOf = (key: string): number => {
      const option = options[key];
      return isRecord(option) && typeof option.text === 'string' ? option.text.trim().length : 0;
    };
    const wrong = input.mcq.options.filter((o) => !o.correct);
    if (wrong.length === 0) continue;
    const wrongMedian = median(wrong.map((o) => lengthOf(o.key)));
    if (wrongMedian <= 0) continue;
    const giveaway = input.mcq.options.find((o) => o.correct && lengthOf(o.key) >= ZH_WARN_LONGEST_RATIO * wrongMedian);
    if (giveaway) {
      warnings.push({
        code: 'ZH_WARN_CORRECT_LONGEST',
        message: `The ${locale} text of correct option "${giveaway.key}" is ${lengthOf(giveaway.key)} characters, at least 1.4x the median wrong option (${wrongMedian}); the longest answer gives itself away.`,
      });
    }
  }
  return warnings;
}
