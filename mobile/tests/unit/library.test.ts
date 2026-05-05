import { describe, expect, it } from 'vitest';
import { buildLibraryCardRows, buildLibraryVM } from '../../src/features/gacha/library/libraryMapper';

const NOW = new Date('2026-04-23T12:00:00.000Z');
const TODAY_MS = NOW.getTime();
const TOMORROW_MS = TODAY_MS + 24 * 60 * 60 * 1000;
const YESTERDAY_MS = TODAY_MS - 24 * 60 * 60 * 1000;

const sampleDeck = {
  Slug: 'csharp',
  Title: 'C# Interview',
  Locale: 'en-US',
  Version: '1',
  DeckType: 1,
  TotalCards: 4,
  Cards: [
    { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Revision: 1 },
    { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2', Revision: 2 },
    { StableUid: '3', OrderInDeck: 3, Difficulty: 3, Question: 'Q3', Revision: 1 },
    { StableUid: '4', OrderInDeck: 4, Difficulty: 2, Question: 'Q4', Revision: 1 },
  ],
} as any;

const sampleProgress = [
  { stableUid: '1', stage: 0, nextReviewAt: 0 },
  { stableUid: '2', stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: YESTERDAY_MS, lastSeenRevision: 1 },
  { stableUid: '3', stage: 4, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
  { stableUid: '4', stage: 0, nextReviewAt: 0 },
] as any;

describe('buildLibraryVM', () => {
  it('derives new / learning / mastered / updated counts for owned cards', () => {
    const library = buildLibraryVM({
      deck: sampleDeck,
      progress: sampleProgress,
      now: NOW,
      decks: [
        { slug: 'csharp', title: 'C# Interview' },
        { slug: 'aws', title: 'AWS Core' },
      ],
      selectedDeckSlug: 'aws',
    });

    expect(library.subtitle).toBe('Library · Owned cards');
    expect(library.decks).toEqual([
      { slug: 'csharp', title: 'C# Interview' },
      { slug: 'aws', title: 'AWS Core' },
    ]);
    expect(library.selectedDeckSlug).toBe('aws');
    expect(library.counts).toMatchObject({
      newCount: 2,
      learningCount: 1,
      masteredCount: 1,
      dueTodayCount: 1,
      updatedCount: 1,
    });
    expect(library.drawStatusLabel).toMatch(/due cards/i);
  });

  it('limits updated-card counting to the preview slice in trial mode', () => {
    const library = buildLibraryVM({
      deck: sampleDeck,
      progress: sampleProgress,
      now: NOW,
      isTrial: true,
      previewTotal: 2,
    });

    expect(library.subtitle).toBe('Library · Free trial slice');
    expect(library.counts.updatedCount).toBe(1);
  });

  it('builds per-card inventory rows with normalized statuses', () => {
    const rows = buildLibraryCardRows({ deck: sampleDeck, progress: sampleProgress, now: NOW });

    expect(rows.map((row) => row.status)).toEqual(['new', 'learning', 'mastered', 'new']);
    expect(rows.map((row) => row.badgeTone)).toEqual(['new', 'learning', 'mastered', 'new']);
    expect(rows[1].isDueToday).toBe(true);
    expect(rows[1].isUpdated).toBe(true);
  });

  it.each([
    { filter: 'all', expected: ['1', '2', '3', '4'] },
    { filter: 'owned', expected: ['2', '3'] },
    { filter: 'missing', expected: ['1', '4'] },
  ] as const)('filters cards by %s', ({ filter, expected }) => {
    const vm = buildLibraryVM({
      deck: sampleDeck,
      progress: sampleProgress,
      now: NOW,
      filter,
    });

    expect(vm.cards.map((item) => item.stableUid)).toEqual(expected);
  });
});
