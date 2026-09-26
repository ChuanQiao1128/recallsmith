// src/lib/authoringBodies.ts
//
// One place that turns what a form collected into the request body the api
// layer sends. Both deck forms and both card forms build from here, so the rule
// for a cleared optional field — send '' rather than drop the key — lives in a
// single function instead of being re-derived, and mis-derived, on four pages.
//
// The rule is the same one deckImportRunner already documents: the server treats
// an absent key as "leave it alone", so clearing a field only reaches the row if
// the empty value is actually sent. See src/lib/deckImportRunner.ts.
//
// No React and no runtime imports: this is pure data-shaping so it can be tested
// as a node module and reused from anywhere.

export const DEFAULT_DECK_LOCALE = 'en-US';

export const DRAFT_VERSION_ERROR = 'Draft version must be a whole number of 1 or more.';

/**
 * The integer a Draft Version box holds, or null if what was typed is not a
 * whole number of 1 or more. `decks.version` is an int column, so a semver or a
 * fraction has nowhere to go; the caller turns null into DRAFT_VERSION_ERROR.
 */
export function parseDraftVersion(input: string | number): number | null {
  const s = String(input).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export interface DeckBodyInput {
  slug: string;
  title: string;
  author: string;
  description: string;
  locale: string;
  deckType: number;
  version: number;
}

export interface DeckBody {
  slug: string;
  title: string;
  author: string;
  description: string;
  locale: string;
  deckType: number;
  version: number;
}

export function buildDeckBody(input: DeckBodyInput): DeckBody {
  const locale = input.locale.trim();
  return {
    slug: input.slug.trim(),
    title: input.title.trim(),
    author: input.author.trim(),
    // An empty description stays '': it is present, because that is what clears
    // the column. Dropping it would leave the old text in the row.
    description: input.description.trim(),
    // decks.locale is NOT NULL, so a blank locale falls back rather than clears.
    locale: locale || DEFAULT_DECK_LOCALE,
    deckType: input.deckType,
    version: input.version,
  };
}

export interface CardBodyInput {
  question: string;
  explanation: string;
  realWorldUsage: string;
  codeSnippet: string;
  codeLanguage: string;
  difficulty: number | string;
  orderInDeck: number | string;
  revision: number | string;
}

export interface CardBody {
  question: string;
  explanation: string;
  realWorldUsage: string;
  codeSnippet: string;
  codeLanguage: string;
  difficulty: number;
  orderInDeck: number;
  revision: number;
}

export function buildCardBody(input: CardBodyInput): CardBody {
  const revision = Number(input.revision);
  return {
    question: input.question.trim(),
    // Trimmed, so a cleared field becomes '' and the column is actually cleared.
    explanation: input.explanation.trim(),
    realWorldUsage: input.realWorldUsage.trim(),
    // Indentation is content, so a non-blank snippet keeps its exact whitespace;
    // only a snippet that is whitespace-only collapses to ''.
    codeSnippet: input.codeSnippet.trim() === '' ? '' : input.codeSnippet,
    codeLanguage: input.codeLanguage.trim(),
    difficulty: Number(input.difficulty) || 2,
    orderInDeck: Number(input.orderInDeck) || 1,
    revision: Number.isFinite(revision) ? revision : 1,
  };
}
