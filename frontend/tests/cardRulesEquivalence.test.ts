// The extraction into src/lib/cardRules.ts was byte-identical for the two
// constants, but the four call sites in validateCards were rewritten by De
// Morgan:
//
//   !a || b > MAX || !p.test(x)   ->   !(Boolean(a) && b <= MAX && p.test(x))
//   !isInt(d) || d < 0 || d > 4   ->   !(isInt(d) && d >= 0 && d <= 4)
//   !x.trim()                     ->   !Boolean(x.trim())
//
// A sha256 comparison cannot check that kind of move, so this file checks it the
// only other way available: the ORIGINAL expressions are copied in verbatim
// below and asserted to agree with the new predicates pointwise.
//
// The copies are frozen on purpose. They are not maintained alongside the real
// code — they are the pre-extraction text, and their only job is to disagree if
// the extraction changed meaning. Editing them to match a future rule change
// would destroy the only evidence that this step was behaviour-preserving.
//
// Negation matters here. `!expr` is what validateCards actually evaluates, and
// two expressions can agree on truthiness while disagreeing on value (the old
// content check returned a boolean from `!`, the new one from `Boolean()`), so
// the assertions compare the negated forms exactly as the call sites use them.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MAX_UID_LENGTH,
  UID_PATTERN,
  hasContent,
  isValidDifficulty,
  isValidStableUid,
} from '../src/lib/cardRules';

// --------------------------------------------------------------------------
// Verbatim copies of the pre-extraction expressions (deckImport.ts :460/:481/
// :489/:496 at sha256 44f09617…f54a). Do not "improve" these.
// --------------------------------------------------------------------------

function legacyUidExpr(stableUid: string): boolean {
  return !stableUid || stableUid.length > MAX_UID_LENGTH || !UID_PATTERN.test(stableUid);
}

function legacyDifficultyExpr(difficulty: number): boolean {
  return !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 4;
}

function legacyContentExpr(text: string): boolean {
  return !text.trim();
}

/**
 * A hand-listed corpus alongside the generated one. fast-check explores far
 * more strings than this, but it is unlikely to spend a draw on exactly 128 vs
 * 129 characters, and the boundary is where an off-by-one in an extraction
 * actually lives.
 */
const UID_CORPUS: readonly string[] = [
  '',
  ' ',
  'a',
  'a'.repeat(MAX_UID_LENGTH - 1),
  'a'.repeat(MAX_UID_LENGTH),
  'a'.repeat(MAX_UID_LENGTH + 1),
  'A',
  'a--b',
  '-a',
  'a-',
  'a_b',
  'a-b-c',
  'cs-async-001',
  'card_1699_x7q2ab',
  '0',
  'a b',
  'a.b',
  'á',
];

const DIFFICULTY_CORPUS: readonly number[] = [
  NaN,
  Infinity,
  -Infinity,
  -0,
  0,
  1,
  2,
  3,
  4,
  5,
  -1,
  1.5,
  0.1,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
];

describe('the uid predicate', () => {
  it('agrees with the pre-extraction expression on the hand-listed boundary corpus', () => {
    for (const uid of UID_CORPUS) {
      expect({ uid, refused: !isValidStableUid(uid) }).toEqual({
        uid,
        refused: legacyUidExpr(uid),
      });
    }
  });

  it('agrees with the pre-extraction expression on generated strings', () => {
    fc.assert(
      fc.property(fc.string(), uid => {
        expect(!isValidStableUid(uid)).toBe(legacyUidExpr(uid));
      }),
      { seed: 20260816, numRuns: 2000 },
    );
  });

  it('agrees on generated strings drawn from the uid alphabet', () => {
    // fc.string() almost never produces something UID_PATTERN accepts, so a
    // second generator biased at the alphabet keeps the accepting branch
    // covered rather than only the refusing one.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9_-]{0,140}$/),
        uid => {
          expect(!isValidStableUid(uid)).toBe(legacyUidExpr(uid));
        },
      ),
      { seed: 20260816, numRuns: 2000 },
    );
  });
});

describe('the difficulty predicate', () => {
  it('agrees with the pre-extraction expression on the hand-listed corpus', () => {
    for (const value of DIFFICULTY_CORPUS) {
      expect({ value, refused: !isValidDifficulty(value) }).toEqual({
        value,
        refused: legacyDifficultyExpr(value),
      });
    }
  });

  it('agrees with the pre-extraction expression on generated numbers', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.double(),
          fc.constantFrom(NaN, Infinity, -Infinity, -0, -1, 0, 4, 5, 1.5),
        ),
        value => {
          expect(!isValidDifficulty(value)).toBe(legacyDifficultyExpr(value));
        },
      ),
      { seed: 20260816, numRuns: 2000 },
    );
  });
});

describe('the content predicate', () => {
  it('agrees with the pre-extraction expression on generated strings', () => {
    fc.assert(
      fc.property(fc.string(), text => {
        expect(!hasContent(text)).toBe(legacyContentExpr(text));
      }),
      { seed: 20260816, numRuns: 2000 },
    );
  });

  it('agrees on whitespace-only strings, which is the case that matters', () => {
    for (const text of ['', ' ', '\t', '\n', '  \t\n ', ' ', 'x', ' x ']) {
      expect(!hasContent(text)).toBe(legacyContentExpr(text));
    }
  });
});
