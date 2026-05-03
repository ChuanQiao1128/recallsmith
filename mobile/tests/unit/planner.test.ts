import { describe, expect, it } from 'vitest';
import { buildChallengeRoute } from '../../src/features/gacha/planner/sessionBuilder';
import { countDueToday, pickNextCard, planChallengeRoute } from '../../src/features/gacha/planner/sessionPlanner';

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

describe('buildChallengeRoute / planChallengeRoute', () => {
  it('creates a boss-ending route for a real due backlog', () => {
    const challenge = buildChallengeRoute({
      slug: 'csharp',
      deckTitle: 'C# Interview',
      dueCount: 3,
      newCount: 2,
    });

    expect(challenge.minimumGoal).toBe(1);
    expect(challenge.limit).toBe(4);
    expect(challenge.nodes.at(-1)?.role).toBe('boss');
    expect(challenge.summary).toMatch(/keep momentum/i);
  });

  it('creates a one-node maintenance route when today is clear', () => {
    const challenge = buildChallengeRoute({
      slug: 'csharp',
      deckTitle: 'C# Interview',
      dueCount: 0,
      newCount: 0,
    });

    expect(challenge.limit).toBe(1);
    expect(challenge.nodes[0]?.role).toBe('warmup');
    expect(challenge.summary).toMatch(/maintenance run/i);
  });

  it('derives counts from deck progress', () => {
    const planned = planChallengeRoute({ deck: sampleDeck, progress: sampleProgress, now: NOW });

    expect(planned.dueCount).toBe(1);
    expect(planned.newCount).toBe(2);
    expect(planned.limit).toBe(2);
  });

  it('does not force a boss node when there is no high-pressure backlog', () => {
    const planned = planChallengeRoute({ deck: sampleDeck, progress: sampleProgress, now: NOW });
    expect(planned.nodes.some((node) => node.role === 'boss')).toBe(false);
  });
});

describe('countDueToday / pickNextCard', () => {
  it('counts overdue scheduled cards into today', () => {
    expect(countDueToday(sampleProgress, NOW)).toBe(1);
  });

  it('prefers due cards in review-due mode', () => {
    const next = pickNextCard({ deck: sampleDeck, progress: sampleProgress, now: NOW, mode: 'review-due' });
    expect(next?.card.StableUid).toBe('2');
  });

  it('prefers new cards in learn-new mode', () => {
    const next = pickNextCard({ deck: sampleDeck, progress: sampleProgress, now: NOW, mode: 'learn-new' });
    expect(next?.card.StableUid).toBe('1');
  });

  it('falls back to updated learned cards in mixed mode when no due cards exist', () => {
    const updatedOnlyDeck = {
      ...sampleDeck,
      Cards: [
        { StableUid: '1', OrderInDeck: 1, Difficulty: 1, Question: 'Q1', Revision: 1 },
        { StableUid: '2', OrderInDeck: 2, Difficulty: 2, Question: 'Q2', Revision: 2 },
      ],
    } as any;

    const updatedOnlyProgress = [
      { stableUid: '1', stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
      { stableUid: '2', stage: 2, lastReviewedAt: TODAY_MS - 1000, nextReviewAt: TOMORROW_MS, lastSeenRevision: 1 },
    ] as any;

    const next = pickNextCard({ deck: updatedOnlyDeck, progress: updatedOnlyProgress, now: NOW, mode: 'mixed' });
    expect(next?.card.StableUid).toBe('2');
  });

  it('reuses the avoided uid only when no better candidate exists', () => {
    const next = pickNextCard({
      deck: sampleDeck,
      progress: sampleProgress,
      now: NOW,
      mode: 'mixed',
      avoidUid: '2',
    });

    expect(next?.card.StableUid).toBe('2');
  });
});
