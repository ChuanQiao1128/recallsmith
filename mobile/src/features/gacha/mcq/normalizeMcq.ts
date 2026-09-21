import type { CardExport, McqExport, McqOption } from '../../../types/deckExport';
import type { FeatureFlags } from '../../../config/featureFlags';

export const MCQ_MIN_OPTIONS = 3;
export const MCQ_MAX_OPTIONS = 6;
export const MCQ_MAX_OPTION_TEXT = 600;   // chars after trim
export const MCQ_MAX_REQUIRED = 3;
export const MCQ_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export const QUALIFIER_IS_CHOOSE_N = /choose (two|three)/i;

/** "Plain object" = a non-null, non-array object. A Proxy of a plain object passes without invoking a
 *  trap; the first property read is what throws, and normalizeMcq's try/catch covers it. */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** why: string → trim (('' after trim) → null); null/undefined → null; anything else → undefined (invalid). */
function normalizeWhy(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Never throws. Any violation → null → the card renders as the Q/A card it already is on 1.5.0.
 *  Rules (C00 §2.9.1, plan §3.2) applied to the raw blob only — the stem is NOT consulted (D00 §6 #2):
 *   - raw is a plain object (not null, not an array); raw.v === 1;
 *   - raw.options is an array of 3..6 plain objects; option i has key === MCQ_KEYS[i] (lowercase,
 *     consecutive from 'a', hence unique); text is a string, non-empty after trim, ≤ 600 chars after trim;
 *     correct is a boolean; why is a string, null or undefined (undefined and '' after trim → null);
 *   - requiredCount = count(correct) ∈ {1,2,3} and < options.length;
 *   - every correct === false option has a non-empty why (after trim);
 *   - qualifier: null/undefined/'' (after trim) → null; a string is trimmed; any other type → null blob;
 *     a non-null qualifier must not match QUALIFIER_IS_CHOOSE_N;
 *   - shuffle: boolean → itself; anything else (absent, null, 1, 'no') → true.
 *  Returns a NEW frozen object { v: 1, qualifier, shuffle, options: [{ key, text, why, correct }] } with
 *  trimmed strings; the input is never mutated. Idempotent: normalizeMcq(normalizeMcq(x)) deep-equals normalizeMcq(x). */
export function normalizeMcq(raw: unknown): McqExport | null {
  try {
    if (!isPlainObject(raw)) return null;
    if (raw.v !== 1) return null;

    const rawOptions = raw.options;
    if (!Array.isArray(rawOptions)) return null;
    if (rawOptions.length < MCQ_MIN_OPTIONS || rawOptions.length > MCQ_MAX_OPTIONS) return null;

    const options: McqOption[] = [];
    let correctCount = 0;
    for (let i = 0; i < rawOptions.length; i += 1) {
      const opt = rawOptions[i];
      if (!isPlainObject(opt)) return null;

      if (opt.key !== MCQ_KEYS[i]) return null;

      if (typeof opt.text !== 'string') return null;
      const text = opt.text.trim();
      if (text.length < 1 || text.length > MCQ_MAX_OPTION_TEXT) return null;

      if (typeof opt.correct !== 'boolean') return null;
      const correct = opt.correct;

      const why = normalizeWhy(opt.why);
      if (why === undefined) return null;         // a non-string, non-null, non-undefined why is invalid
      if (correct === false && why === null) return null;   // wrong options must explain why not

      if (correct) correctCount += 1;

      options.push(Object.freeze({ key: MCQ_KEYS[i], text, why, correct }));
    }

    if (correctCount < 1 || correctCount > MCQ_MAX_REQUIRED) return null;
    if (correctCount >= options.length) return null;

    let qualifier: string | null;
    const rawQualifier = raw.qualifier;
    if (rawQualifier === null || rawQualifier === undefined) {
      qualifier = null;
    } else if (typeof rawQualifier === 'string') {
      const trimmed = rawQualifier.trim();
      qualifier = trimmed.length > 0 ? trimmed : null;
    } else {
      return null;
    }
    if (qualifier !== null && QUALIFIER_IS_CHOOSE_N.test(qualifier)) return null;

    const shuffle = typeof raw.shuffle === 'boolean' ? raw.shuffle : true;

    return Object.freeze({
      v: 1 as const,
      qualifier,
      shuffle,
      options: Object.freeze(options) as McqOption[],
    });
  } catch {
    return null;
  }
}

/** count(correct) of a normalised blob; 1..3. */
export function mcqRequiredCount(mcq: McqExport): number {
  return mcq.options.filter((o) => o.correct === true).length;
}

/** flags.mcq.enabled === false → null (kill switch, D00 §0); otherwise normalizeMcq(card.Mcq). Never throws. */
export function resolveMcq(
  card: Pick<CardExport, 'Mcq'>,
  flags: Pick<FeatureFlags, 'mcq'>,
): McqExport | null {
  try {
    if (flags?.mcq?.enabled === false) return null;
    return normalizeMcq(card?.Mcq);
  } catch {
    return null;
  }
}

/** resolveMcq(card, flags) !== null — the plan's isMcqCard(card, flags). */
export function isMcqCard(
  card: Pick<CardExport, 'Mcq'>,
  flags: Pick<FeatureFlags, 'mcq'>,
): boolean {
  return resolveMcq(card, flags) !== null;
}
