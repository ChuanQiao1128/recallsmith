// @vitest-environment node
//
// Unit coverage for the pure card-list module. No React and no DOM: these rules
// are ordinary functions, and driving them directly is what lets the page test
// stay about wiring instead of re-deriving the same table math.

import { describe, expect, it } from 'vitest';

import type { Card } from '../src/types/card';
import type { McqBlob } from '../src/types/mcq';
import {
  DEFAULT_CARD_LIST_CRITERIA,
  filterAndSortCards,
  formatCardDate,
  isCriteriaActive,
} from '../src/lib/cardListFilter';
import type { CardListCriteria } from '../src/lib/cardListFilter';

const MCQ: McqBlob = {
  v: 1,
  qualifier: null,
  shuffle: false,
  options: [
    { key: 'a', text: 'yes', why: null, correct: true },
    { key: 'b', text: 'no', why: null, correct: false },
  ],
};

function makeCard(overrides: Partial<Card>): Card {
  return {
    id: 1,
    deckId: 7,
    stableUid: 'cs-q-01',
    question: 'What does volatile guarantee?',
    difficulty: 2,
    orderInDeck: 1,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function criteria(overrides: Partial<CardListCriteria>): CardListCriteria {
  return { ...DEFAULT_CARD_LIST_CRITERIA, ...overrides };
}

describe('filterAndSortCards', () => {
  it('matches uid, question and topic case-insensitively', () => {
    const byUid = makeCard({ id: 1, stableUid: 'CS-Q-01', question: 'nothing here' });
    const byQuestion = makeCard({ id: 2, stableUid: 'zzz', question: 'The Volatile Keyword' });
    const byTopic = makeCard({ id: 3, stableUid: 'zzz', question: 'nope', topic: 'Memory Model' });
    const cards = [byUid, byQuestion, byTopic];

    expect(filterAndSortCards(cards, criteria({ query: 'cs-q-01' }))).toEqual([byUid]);
    expect(filterAndSortCards(cards, criteria({ query: 'VOLATILE' }))).toEqual([byQuestion]);
    expect(filterAndSortCards(cards, criteria({ query: 'memory' }))).toEqual([byTopic]);
  });

  it('requires every word of the query to match', () => {
    const both = makeCard({ id: 1, question: 'volatile keyword memory model' });
    const one = makeCard({ id: 2, question: 'volatile only' });
    const cards = [both, one];

    expect(filterAndSortCards(cards, criteria({ query: 'volatile memory' }))).toEqual([both]);
    // Extra whitespace between words must not create an empty word that matches
    // everything.
    expect(filterAndSortCards(cards, criteria({ query: '  volatile   memory  ' }))).toEqual([both]);
  });

  it('keeps only MCQ cards for the mcq filter and only plain cards for qa', () => {
    const mcqCard = makeCard({ id: 1, mcq: MCQ });
    const plainCard = makeCard({ id: 2, mcq: null });
    const undefinedMcq = makeCard({ id: 3, mcq: undefined });
    const cards = [mcqCard, plainCard, undefinedMcq];

    expect(filterAndSortCards(cards, criteria({ kind: 'mcq' }))).toEqual([mcqCard]);
    expect(filterAndSortCards(cards, criteria({ kind: 'qa' }))).toEqual([plainCard, undefinedMcq]);
  });

  it('filters by exact difficulty', () => {
    const easy = makeCard({ id: 1, difficulty: 1 });
    const mid = makeCard({ id: 2, difficulty: 2 });
    const hard = makeCard({ id: 3, difficulty: 3 });
    const cards = [easy, mid, hard];

    expect(filterAndSortCards(cards, criteria({ difficulty: 2 }))).toEqual([mid]);
    expect(filterAndSortCards(cards, criteria({ difficulty: 3 }))).toEqual([hard]);
  });

  it('sorts by deck order, recently updated and difficulty without mutating the input', () => {
    const a = makeCard({
      id: 30,
      orderInDeck: 3,
      difficulty: 1,
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    const b = makeCard({
      id: 20,
      orderInDeck: 1,
      difficulty: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const c = makeCard({
      id: 10,
      orderInDeck: 2,
      difficulty: 2,
      updatedAt: 'not-a-date',
    });
    const cards = [a, b, c];
    const snapshot = [...cards];

    // Deck order: orderInDeck ascending.
    expect(filterAndSortCards(cards, criteria({ sort: 'order' }))).toEqual([b, c, a]);
    // Recently updated: newest first, invalid date last.
    expect(filterAndSortCards(cards, criteria({ sort: 'updated' }))).toEqual([a, b, c]);
    // Difficulty ascending.
    expect(filterAndSortCards(cards, criteria({ sort: 'difficulty' }))).toEqual([a, c, b]);

    // The input array is untouched: same identity, same order.
    expect(cards).toEqual(snapshot);
    expect(cards[0]).toBe(a);
  });
});

describe('isCriteriaActive', () => {
  it('treats sort alone as inactive but any narrowing choice as active', () => {
    expect(isCriteriaActive(DEFAULT_CARD_LIST_CRITERIA)).toBe(false);
    expect(isCriteriaActive(criteria({ sort: 'updated' }))).toBe(false);
    expect(isCriteriaActive(criteria({ query: '   ' }))).toBe(false);
    expect(isCriteriaActive(criteria({ query: 'x' }))).toBe(true);
    expect(isCriteriaActive(criteria({ kind: 'mcq' }))).toBe(true);
    expect(isCriteriaActive(criteria({ difficulty: 2 }))).toBe(true);
  });
});

describe('formatCardDate', () => {
  it('formatCardDate shows a dash for a missing or invalid date', () => {
    expect(formatCardDate(null)).toBe('—');
    expect(formatCardDate(undefined)).toBe('—');
    expect(formatCardDate('')).toBe('—');
    expect(formatCardDate('not-a-date')).toBe('—');
    // A valid date renders as something other than the dash.
    expect(formatCardDate('2026-01-02T00:00:00.000Z')).not.toBe('—');
  });
});
