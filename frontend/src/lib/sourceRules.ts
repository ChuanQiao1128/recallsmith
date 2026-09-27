// src/lib/sourceRules.ts
//
// The per-card citation rules (contract §5.1): source = { url, quote }. The deck
// importer (deckImport.ts), the hand-entry card form (CardForm.tsx) and the MCP
// server's lint_card share these rules, so a card that passes one passes all of
// them. The server's Helpers.NormalizeSource (J01) enforces the same limits.
//
// Pure, with a type-only import: lint_card bundles this file for Node, so it must
// not pull in cardRules, React or the DOM.

import type { CardSource } from '../types/card';

/** An https URL with no whitespace anywhere, checked on the trimmed value. */
export const SOURCE_URL_PATTERN = /^https:\/\/\S+$/;

/** Longest accepted URL, measured after trimming. */
export const SOURCE_URL_MAX_LENGTH = 2048;

/** Longest accepted quote, measured after trimming. */
export const SOURCE_QUOTE_MAX_LENGTH = 1000;

export function isValidSourceUrl(url: string): boolean {
  const t = url.trim();
  return t.length > 0 && t.length <= SOURCE_URL_MAX_LENGTH && SOURCE_URL_PATTERN.test(t);
}

/**
 * The string the import planner compares. A server null, a missing key on an
 * older server and a card without SOURCE: all map to '', and a blank quote
 * equals a null one, so a re-import of an untouched file stays a no-op.
 */
export function normalizeSourceForCompare(source: CardSource | null | undefined): string {
  if (source === null || source === undefined) return '';
  return JSON.stringify([source.url.trim(), source.quote?.trim() || null]);
}
