import { describe, expect, it } from 'vitest';

import { pickRelatedCards, RELATED_REVIEW_COUNT } from '../../src/features/gacha/mistakes/relatedReview';
import type { MistakeEntry } from '../../src/features/gacha/mistakes/mistakeBook';
import type { CardProgress } from '../../src/review/model';
import type { CardExport, DeckExport } from '../../src/types/deckExport';

const NOW = new Date(Date.UTC(2026, 8, 27, 9, 0, 0));
const T = NOW.getTime();
const DAY_MS = 86_400_000;
// Learned cards were last reviewed on an earlier local day: a card reviewed today is never dealt
// again as a related card (Y08 mobile-12), which the tests at the end cover.
const PREV_DAY = T - DAY_MS;

function card(uid: string, order: number, topic: string | null = null): CardExport {
  return { StableUid: uid, OrderInDeck: order, Difficulty: 1, Question: `Q ${uid}`, Topic: topic };
}

function deckOf(cards: CardExport[]): DeckExport {
  return {
    Slug: 'aws',
    Title: 'AWS',
    Locale: 'en-US',
    Version: '1',
    DeckType: 1,
    IsFreeStarter: true,
    TotalCards: cards.length,
    FreeCardCount: cards.length,
    Cards: cards,
  };
}

function learned(uid: string, stage = 2, lastReviewedAt = PREV_DAY - 1000): CardProgress {
  return { stableUid: uid, stage, lastReviewedAt, nextReviewAt: T + 86_400_000 };
}

function fresh(uid: string): CardProgress {
  return { stableUid: uid, stage: 0, nextReviewAt: 0 };
}

function mistake(uid: string, topic: string | null, lastWrongAt: number, deckSlug = 'aws'): MistakeEntry {
  return {
    deckSlug,
    stableUid: uid,
    topic,
    wrongCount: 1,
    firstWrongAt: lastWrongAt,
    lastWrongAt,
    lastOutcome: 'again',
    correctStreak: 0,
    resolvedAt: null,
  };
}

describe('pickRelatedCards', () => {
  it('defaults to three related cards', () => {
    expect(RELATED_REVIEW_COUNT).toBe(3);
  });

  it('ranks cards sharing the most recent mistake topic first', () => {
    const deck = deckOf([
      card('m-old', 1, 'iam'),
      card('m-new', 2, 's3'),
      card('iam-1', 30, 'iam'),
      card('s3-1', 40, 's3'),
      card('other', 50, 'ec2'),
      card('s3-2', 60, 's3'),
    ]);
    const progress = deck.Cards.map((c) => learned(c.StableUid));
    const result = pickRelatedCards({
      deck,
      progress,
      ownedSet: null,
      mistakes: [mistake('m-old', 'iam', T - 5000), mistake('m-new', 's3', T - 1000)],
      now: NOW,
      count: 4,
    });
    expect(result).toEqual(['s3-1', 's3-2', 'iam-1', 'other']);
  });

  it('prefers the lowest stage, then the oldest review, then deck order', () => {
    const deck = deckOf([
      card('m', 1, 'vpc'),
      card('a', 10, 'vpc'),
      card('b', 11, 'vpc'),
      card('c', 12, 'vpc'),
      card('d', 13, 'vpc'),
      card('e', 14, 'vpc'),
    ]);
    const progress = [
      learned('m'),
      learned('a', 4, PREV_DAY - 100),
      learned('b', 1, PREV_DAY - 100),
      learned('c', 2, PREV_DAY - 900),
      learned('d', 2, PREV_DAY - 100),
      learned('e', 2, PREV_DAY - 900),
    ];
    const result = pickRelatedCards({
      deck,
      progress,
      ownedSet: null,
      mistakes: [mistake('m', 'vpc', T)],
      now: NOW,
      count: 5,
    });
    // b: stage 1; c and e: stage 2 and oldest review (deck order breaks the tie); d: newer review; a: stage 4.
    expect(result).toEqual(['b', 'c', 'e', 'd', 'a']);
  });

  it('falls back to neighbours within 5 positions for an untagged mistake', () => {
    const deck = deckOf([
      card('near-before', 5),
      card('m', 10),
      card('near-after', 15),
      card('far', 16),
      card('far-before', 4),
    ]);
    const progress = deck.Cards.map((c) => learned(c.StableUid, c.StableUid.startsWith('far') ? 0 : 3));
    const result = pickRelatedCards({
      deck,
      progress,
      ownedSet: null,
      mistakes: [mistake('m', null, T), mistake('absent-from-deck', null, T + 1)],
      now: NOW,
      count: 4,
    });
    // Neighbours rank first even though the far cards have a lower stage.
    expect(result).toEqual(['near-before', 'near-after', 'far-before', 'far']);
  });

  it('never returns an active mistake, an unowned card or an unlearned card', () => {
    const deck = deckOf([
      card('m1', 1, 'sqs'),
      card('m2', 2, 'sqs'),
      card('unowned', 3, 'sqs'),
      card('unlearned', 4, 'sqs'),
      card('ok', 5, 'sqs'),
      card('no-progress', 6, 'sqs'),
      card('other-deck-mistake', 7, 'sqs'),
    ]);
    const progress = [
      learned('m1'),
      learned('m2'),
      learned('unowned'),
      fresh('unlearned'),
      learned('ok'),
      learned('other-deck-mistake'),
    ];
    const ownedSet = new Set(['m1', 'm2', 'unlearned', 'ok', 'no-progress', 'other-deck-mistake']);
    const result = pickRelatedCards({
      deck,
      progress,
      ownedSet,
      mistakes: [
        mistake('m1', 'sqs', T),
        mistake('m2', null, T - 1),
        mistake('other-deck-mistake', 'sqs', T, 'gcp'),
      ],
      now: NOW,
      count: 5,
    });
    // A mistake recorded under another deck's slug does not exclude this deck's card.
    expect(result).toEqual(['ok', 'other-deck-mistake']);
  });

  it('returns at most count uids and is deterministic', () => {
    const cards = Array.from({ length: 12 }, (_, i) => card(`c${String(i).padStart(2, '0')}`, i + 1, 'lambda'));
    const deck = deckOf(cards);
    const progress = cards.map((c) => learned(c.StableUid, 1, PREV_DAY - 500));
    const mistakes = [mistake('c00', 'lambda', T)];
    const deckSnapshot = JSON.stringify(deck);
    const progressSnapshot = JSON.stringify(progress);
    const mistakesSnapshot = JSON.stringify(mistakes);
    const input = { deck, progress, ownedSet: null, mistakes, now: NOW };

    expect(pickRelatedCards(input)).toEqual(['c01', 'c02', 'c03']);
    expect(pickRelatedCards(input)).toEqual(pickRelatedCards({ ...input }));
    expect(pickRelatedCards({ ...input, count: 2 })).toHaveLength(2);
    expect(pickRelatedCards({ ...input, count: 9 })).toHaveLength(5);
    expect(pickRelatedCards({ ...input, count: 0 })).toEqual([]);
    expect(pickRelatedCards({ ...input, count: -1 })).toEqual([]);
    expect(pickRelatedCards({ ...input, count: 1.5 })).toEqual([]);
    expect(pickRelatedCards({ ...input, progress: [...progress].reverse() })).toEqual(['c01', 'c02', 'c03']);
    expect(JSON.stringify(deck)).toBe(deckSnapshot);
    expect(JSON.stringify(progress)).toBe(progressSnapshot);
    expect(JSON.stringify(mistakes)).toBe(mistakesSnapshot);
  });

  it('leaves out a card already reviewed on the local day of now, by calendar day not elapsed hours', () => {
    // Local times: the rule is the device's calendar day, like the Mistake Book's.
    const now = new Date(2026, 8, 27, 8, 0, 0);
    const deck = deckOf([card('m', 1, 'sqs'), card('today-early', 2, 'sqs'), card('late-yesterday', 3, 'sqs'), card('older', 4, 'sqs')]);
    const progress = [
      learned('today-early', 1, new Date(2026, 8, 27, 0, 5, 0).getTime()),
      learned('late-yesterday', 1, new Date(2026, 8, 26, 23, 55, 0).getTime()),
      learned('older', 1, new Date(2026, 8, 20, 9, 0, 0).getTime()),
    ];
    const result = pickRelatedCards({
      deck,
      progress,
      ownedSet: null,
      mistakes: [mistake('m', 'sqs', now.getTime())],
      now,
      count: 5,
    });
    expect(result).toEqual(['older', 'late-yesterday']);
  });

  it('does not deal the same related cards again after they were rated earlier the same day', () => {
    const cards = [card('m', 1, 'ec2'), card('r1', 2, 'ec2'), card('r2', 3, 'ec2'), card('r3', 4, 'ec2')];
    const deck = deckOf(cards);
    const noon = new Date(2026, 8, 27, 12, 0, 0).getTime();
    const lastWeek = noon - 7 * DAY_MS;
    const before = [learned('r1', 1, lastWeek), learned('r2', 1, lastWeek), learned('r3', 1, lastWeek)];
    const input = { deck, ownedSet: null, mistakes: [mistake('m', 'ec2', noon - 1000)], count: 2 };

    const first = pickRelatedCards({ ...input, progress: before, now: new Date(noon) });
    expect(first).toEqual(['r1', 'r2']);
    // The first run rated r1 and r2 at noon; a second run a minute later only has r3 left.
    const after = before.map((row) => (first.includes(row.stableUid) ? { ...row, lastReviewedAt: noon } : row));
    expect(pickRelatedCards({ ...input, progress: after, now: new Date(noon + 60_000) })).toEqual(['r3']);
    // The next day they are eligible again.
    expect(pickRelatedCards({ ...input, progress: after, now: new Date(noon + DAY_MS) })).toEqual(['r3', 'r1']);
  });
});
