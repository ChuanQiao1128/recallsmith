import type { Card } from '../types/card';

// Pure filtering and sorting for the card list. No React here: the page owns the
// state and the memoisation, this module owns the rules, and the tests can drive
// the rules without mounting anything.

export type CardKindFilter = 'all' | 'mcq' | 'qa';
export type CardSortKey = 'order' | 'updated' | 'difficulty';

export interface CardListCriteria {
  query: string;
  kind: CardKindFilter;
  difficulty: 'all' | number;
  sort: CardSortKey;
}

export const DEFAULT_CARD_LIST_CRITERIA: CardListCriteria = {
  query: '',
  kind: 'all',
  difficulty: 'all',
  sort: 'order',
};

// One formatter for every date on the page, built once at module load rather
// than once per row per render, which is the whole point of moving this here.
const CARD_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * True when the criteria narrow the list. A sort on its own reorders the same
 * rows and so does not count: the "Showing N of M" line and the Clear button
 * only appear once the set of visible cards can actually differ from the deck.
 */
export function isCriteriaActive(c: CardListCriteria): boolean {
  return c.query.trim() !== '' || c.kind !== 'all' || c.difficulty !== 'all';
}

/**
 * Return a new array of the cards that match `criteria`, in the requested order.
 * Never mutates `cards`.
 */
export function filterAndSortCards(
  cards: readonly Card[],
  criteria: CardListCriteria,
): Card[] {
  const words = criteria.query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const filtered = cards.filter(card => {
    if (words.length > 0) {
      const haystack =
        `${card.stableUid} ${card.question} ${card.topic ?? ''} ${card.id}`.toLowerCase();
      if (!words.every(word => haystack.includes(word))) return false;
    }

    if (criteria.kind === 'mcq') {
      if (!(card.mcq != null && typeof card.mcq === 'object')) return false;
    } else if (criteria.kind === 'qa') {
      if (card.mcq != null && typeof card.mcq === 'object') return false;
    }

    if (criteria.difficulty !== 'all' && Number(card.difficulty) !== criteria.difficulty) {
      return false;
    }

    return true;
  });

  // Sort the copy filter() already made, so the caller's array is untouched.
  filtered.sort((a, b) => {
    switch (criteria.sort) {
      case 'updated': {
        const diff = updatedRank(b.updatedAt) - updatedRank(a.updatedAt);
        return diff !== 0 ? diff : a.id - b.id;
      }
      case 'difficulty': {
        const diff = a.difficulty - b.difficulty;
        return diff !== 0 ? diff : a.orderInDeck - b.orderInDeck;
      }
      case 'order':
      default: {
        const diff = a.orderInDeck - b.orderInDeck;
        return diff !== 0 ? diff : a.id - b.id;
      }
    }
  });

  return filtered;
}

// Invalid dates sort last under descending "recently updated": NaN would break
// the comparator, so an unparseable date becomes -Infinity, below every real
// timestamp.
function updatedRank(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Format a card timestamp, or `'—'` when it is missing or not a valid date. */
export function formatCardDate(value: string | null | undefined): string {
  if (value == null) return '—';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '—';
  return CARD_DATE_FORMAT.format(parsed);
}
