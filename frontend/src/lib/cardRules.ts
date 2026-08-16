// src/lib/cardRules.ts
//
// The rules both card doors agree on, in one place.
//
// A card can enter this console two ways: pasted as markdown through
// deckImport.ts, or typed by hand through CardForm.tsx. Those two doors have
// never asked the same questions, and the owner of this project uses the second
// one daily, so the gap is not academic — it is reachable by typing.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY *NOT* HERE
// ---------------------------------------------------------------------------
// This module holds predicates only. Four things stayed behind on purpose:
//
//   message text      The importer's messages carry line numbers and address a
//                     deck author ("Stable uid ... must be lowercase
//                     kebab-case, for example ..."); the form's address a
//                     person mid-keystroke. tests/deckImport.test.ts asserts
//                     the importer's wording literally. Sharing the strings
//                     would make one of those two audiences read the other's.
//
//   uid uniqueness    Uniqueness is a property of a SET. The importer holds the
//                     whole document and can answer it locally; the form holds
//                     exactly one card and would have to make a network call.
//                     That is a behaviour change, not an extraction.
//
//   validateCards     It is shaped like the importer: it needs sourceLine, it
//                     emits ImportIssueCode values that are mostly lexer codes,
//                     and it depends on sortIssues for deterministic ordering.
//
//   orderInDeck /     Only the form has an opinion about these, and the
//   revision          importer computes orderInDeck itself. A shared home for a
//                     rule with one caller is just a longer import path.
//
// Putting any of those here would have produced an export with zero call sites,
// which is the exact failure this refactor exists to stop repeating.
//
// ---------------------------------------------------------------------------
// ZERO IMPORTS, ON PURPOSE
// ---------------------------------------------------------------------------
// Nothing is imported here, so this module can never take part in a cycle with
// deckImport.ts, and it costs nothing to pull into a bundle. tests/
// cardRulesWiring.test.ts asserts the import count is 0 rather than trusting a
// reader to notice one creeping in.
//
// ---------------------------------------------------------------------------
// THE CONSUMER SETS ARE UNEVEN, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
// hasContent has two production callers. isValidStableUid, isValidDifficulty,
// MAX_UID_LENGTH and UID_PATTERN have exactly one: the importer. That asymmetry
// IS the divergence, recorded in tests/cardRuleDivergence.test.tsx and left for
// a human to rule on. It is not an unfinished wiring job — see the note at the
// top of tests/cardRulesWiring.test.ts before "finishing" it.

/** Longest stable uid the importer will accept. */
export const MAX_UID_LENGTH = 128;

/**
 * Shape the importer accepts for a stable uid.
 *
 * Note the character class: this admits `_` as well as `-`, so `a_b` passes.
 * It is NOT the "lowercase kebab-case" its error message claims — the pattern
 * was widened on purpose to let the `card_<ts>_<rand>` uid that
 * api/authoring.ts ensureStableUid falls back to survive an export/import round
 * trip. The importer's message text is stale about this; that wording is not
 * changed here, and this comment exists so the inaccuracy is not copied forward.
 */
export const UID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** Lowest difficulty the importer accepts. */
export const MIN_DIFFICULTY = 0;

/** Highest difficulty the importer accepts. */
export const MAX_DIFFICULTY = 4;

/** A uid that is present, short enough, and shaped like UID_PATTERN. */
export function isValidStableUid(uid: string): boolean {
  return Boolean(uid) && uid.length <= MAX_UID_LENGTH && UID_PATTERN.test(uid);
}

/** A difficulty that is a whole number inside the accepted range. */
export function isValidDifficulty(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DIFFICULTY && value <= MAX_DIFFICULTY;
}

/** Text that is more than whitespace. */
export function hasContent(text: string): boolean {
  return Boolean(text.trim());
}
