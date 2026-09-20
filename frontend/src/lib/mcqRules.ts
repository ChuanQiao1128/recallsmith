// src/lib/mcqRules.ts
//
// Pure MCQ rules for the console importer (C00 §2.9.1, MCQ plan §4.5). No react,
// no DOM, and deliberately imports nothing from the seven-name shared card-rule
// module, whose export table a wiring test pins, so MCQ rules live on their own.
// deckImport.ts wires these into the lexer and the plan.

import type { McqBlob } from '../types/mcq';

/**
 * The 19 blocking MCQ issue codes of MCQ plan §4.5. MCQ_BAD_OPT_LINE and
 * MCQ_WHY_WITHOUT_OPTION are raised by the lexer (deckImport.ts) and are never
 * returned by validateMcq; they live here so ImportIssueCode can carry them.
 * MCQ_DUPLICATE_QUALIFIER is NOT in this list: it belongs to ImportIssueCode in
 * deckImport.ts because a repeated QUALIFIER: line is a lexer concern.
 */
export type McqIssueCode =
  | 'MCQ_BAD_OPT_LINE' | 'MCQ_QUALIFIER_EMPTY' | 'MCQ_QUALIFIER_IS_CHOOSE_N' | 'MCQ_TOO_FEW_OPTIONS' | 'MCQ_TOO_MANY_OPTIONS'
  | 'MCQ_KEY_SEQUENCE' | 'MCQ_DUPLICATE_OPTION_KEY' | 'MCQ_OPTION_EMPTY' | 'MCQ_OPTION_TEXT_DUPLICATE' | 'MCQ_NO_CORRECT'
  | 'MCQ_TOO_MANY_CORRECT' | 'MCQ_ALL_CORRECT' | 'MCQ_WHY_MISSING' | 'MCQ_WHY_WITHOUT_OPTION' | 'MCQ_FORBIDDEN_OPTION_TEXT'
  | 'MCQ_LETTER_REFERENCE' | 'MCQ_QUALIFIER_NOT_IN_STEM' | 'MCQ_CHOOSE_N_MISMATCH' | 'MCQ_DIFFICULTY_RANGE';

export const OPT_PAYLOAD = /^[ \t]*([A-Fa-f])[ \t]*(\*)?[ \t]*$/;
export const LETTER_REFERENCE = /\b(?:Option|Answer|Choice)\s+[A-F]\b|\b[A-F]\)\s/;
export const FORBIDDEN_OPTION_TEXT = /\b(all|none) of the above\b|\bboth [a-f] and [a-f]\b/i;
export const CHOOSE_N_STEM = /\(choose (two|three)\.?\)/i;
export const QUALIFIER_IS_CHOOSE_N = /choose (two|three)/i;
export const MCQ_MIN_OPTIONS = 3;
export const MCQ_MAX_OPTIONS = 6;
export const MCQ_MAX_CORRECT = 3;

export interface McqIssue { code: McqIssueCode; message: string }

/**
 * Total validator: never throws, returns the blocking issues in a fixed check
 * order (each code at most once per blob unless the code is inherently per-item:
 * MCQ_LETTER_REFERENCE once per offending why plus once for the explanation,
 * MCQ_DUPLICATE_OPTION_KEY / MCQ_OPTION_TEXT_DUPLICATE once per repeat, and the
 * per-option checks once per option). Messages are free-form English.
 */
export function validateMcq(input: { question: string; explanation: string; difficulty: number; mcq: McqBlob }): Array<{ code: McqIssueCode; message: string }> {
  const issues: Array<{ code: McqIssueCode; message: string }> = [];
  const { question, explanation, difficulty, mcq } = input;
  const options = mcq.options;

  // 1. difficulty range (MCQ cards are 1..3, narrower than a Q/A card's 0..4).
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) {
    issues.push({ code: 'MCQ_DIFFICULTY_RANGE', message: `An MCQ card needs difficulty 1, 2, or 3, got ${difficulty}.` });
  }

  // 2. option count.
  if (options.length < MCQ_MIN_OPTIONS) {
    issues.push({ code: 'MCQ_TOO_FEW_OPTIONS', message: `An MCQ card needs at least ${MCQ_MIN_OPTIONS} options, got ${options.length}.` });
  }
  if (options.length > MCQ_MAX_OPTIONS) {
    issues.push({ code: 'MCQ_TOO_MANY_OPTIONS', message: `An MCQ card allows at most ${MCQ_MAX_OPTIONS} options, got ${options.length}.` });
  }

  // 3. duplicate key (once per repeat); the key-sequence check only makes sense
  //    when the keys are unique.
  const seenKeys = new Set<string>();
  let hasDuplicateKey = false;
  for (const option of options) {
    if (seenKeys.has(option.key)) {
      hasDuplicateKey = true;
      issues.push({ code: 'MCQ_DUPLICATE_OPTION_KEY', message: `Option key "${option.key}" is used by more than one OPT: line.` });
    } else {
      seenKeys.add(option.key);
    }
  }
  if (!hasDuplicateKey) {
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].key !== String.fromCharCode(97 + i)) {
        issues.push({ code: 'MCQ_KEY_SEQUENCE', message: `Option keys must run a, b, c… in order; option ${i + 1} has key "${options[i].key}".` });
        break;
      }
    }
  }

  // 4. per option, in stored order.
  for (const option of options) {
    if (option.text.trim() === '') {
      issues.push({ code: 'MCQ_OPTION_EMPTY', message: `Option "${option.key}" has no text.` });
    }
    if (FORBIDDEN_OPTION_TEXT.test(option.text)) {
      issues.push({ code: 'MCQ_FORBIDDEN_OPTION_TEXT', message: `Option "${option.key}" uses a phrase like "all of the above" that breaks once options are shuffled.` });
    }
    if (!option.correct && (option.why === null || option.why.trim() === '')) {
      issues.push({ code: 'MCQ_WHY_MISSING', message: `Wrong option "${option.key}" needs a WHY: explanation.` });
    }
    if (option.why !== null && LETTER_REFERENCE.test(option.why)) {
      issues.push({ code: 'MCQ_LETTER_REFERENCE', message: `Option "${option.key}" WHY: names a letter (e.g. "Option B"); options are shuffled, so refer to the choice by its content.` });
    }
  }

  // 5. duplicate option text (once per repeat).
  const seenText = new Set<string>();
  for (const option of options) {
    const normalized = option.text.trim().toLowerCase();
    if (seenText.has(normalized)) {
      issues.push({ code: 'MCQ_OPTION_TEXT_DUPLICATE', message: `Option "${option.key}" repeats the text of an earlier option.` });
    } else {
      seenText.add(normalized);
    }
  }

  // 6. count of correct options.
  const requiredCount = options.filter((o) => o.correct).length;
  if (requiredCount === 0) {
    issues.push({ code: 'MCQ_NO_CORRECT', message: 'No option is marked correct; mark one with "OPT: <key> *".' });
  }
  if (requiredCount > MCQ_MAX_CORRECT) {
    issues.push({ code: 'MCQ_TOO_MANY_CORRECT', message: `An MCQ card allows at most ${MCQ_MAX_CORRECT} correct options, got ${requiredCount}.` });
  }
  if (requiredCount === options.length && options.length > 0) {
    issues.push({ code: 'MCQ_ALL_CORRECT', message: 'Every option is marked correct; at least one must be wrong.' });
  }

  // 7. letter reference in the explanation.
  if (LETTER_REFERENCE.test(explanation)) {
    issues.push({ code: 'MCQ_LETTER_REFERENCE', message: 'The A: explanation names a letter (e.g. "Option B"); options are shuffled, so refer to each choice by its content.' });
  }

  // 8. qualifier, when present.
  if (mcq.qualifier !== null) {
    if (mcq.qualifier.trim() === '') {
      issues.push({ code: 'MCQ_QUALIFIER_EMPTY', message: 'The QUALIFIER: line is empty.' });
    } else if (QUALIFIER_IS_CHOOSE_N.test(mcq.qualifier)) {
      issues.push({ code: 'MCQ_QUALIFIER_IS_CHOOSE_N', message: 'QUALIFIER: must not say "choose two/three"; that count is derived from the star markers.' });
    } else if (!question.toLowerCase().includes(mcq.qualifier.trim().toLowerCase())) {
      issues.push({ code: 'MCQ_QUALIFIER_NOT_IN_STEM', message: `The qualifier "${mcq.qualifier.trim()}" does not appear in the question stem.` });
    }
  }

  // 9. choose-N shape must match the star count in both directions.
  const stemMatch = CHOOSE_N_STEM.exec(question);
  const stemN = stemMatch ? (stemMatch[1].toLowerCase() === 'two' ? 2 : 3) : 1;
  if ((requiredCount === 1 || requiredCount === 2 || requiredCount === 3) && requiredCount !== stemN) {
    issues.push({ code: 'MCQ_CHOOSE_N_MISMATCH', message: `The question implies ${stemN} correct option(s) but ${requiredCount} are marked with a star.` });
  }

  return issues;
}

/**
 * Canonical compare string. A server null, an old server that dropped the key,
 * and a file with no MCQ all normalize to '', so a re-import of an untouched
 * file stays unchanged. Options are copied (never mutated) and sorted by key;
 * `v` is dropped; a why of '' collapses to null; whitespace is trimmed.
 */
export function normalizeMcqForCompare(mcq: McqBlob | null | undefined): string {
  if (mcq === null || mcq === undefined) return '';
  const options = [...mcq.options]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((o) => ({
      correct: o.correct,
      key: o.key,
      text: o.text.trim(),
      why: o.why === null || o.why.trim() === '' ? null : o.why.trim(),
    }));
  const qualifier = mcq.qualifier === null ? null : mcq.qualifier.trim();
  return JSON.stringify({ options, qualifier, shuffle: mcq.shuffle });
}

/**
 * Reads the wire `mcq` key off a server row without a typed Card.mcq (C12 types
 * it). MCQ plan §3.6 pins the deployed echo as a non-null object, so a plain
 * structural read is enough and no defensive parsing of a canonical echo is
 * wanted. The parameter is `object | null | undefined`, not `{ mcq?: unknown }`,
 * because the latter is a TS2559 weak-type error for a Card argument.
 */
export function mcqOf(row: object | null | undefined): McqBlob | null {
  if (!row) return null;
  const value = (row as { mcq?: unknown }).mcq;
  return typeof value === 'object' && value !== null ? (value as McqBlob) : null;
}
