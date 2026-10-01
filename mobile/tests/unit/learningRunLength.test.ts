import { describe, expect, it } from 'vitest';
import type { CardProgress } from '../../src/review/model';
import { projectLearningChecks } from '../../src/features/gacha/study/learningRunLength';

// F02 s-correctness-3: the recall checks a planned run will add, so "Card X of Y" is right from
// the first card. One check per never-reviewed Q/A card the planner deals within the run's slots.

const NOW = new Date('2026-09-27T09:00:00.000Z');
const NOW_MS = NOW.getTime();
const qa = (order: number): any => ({ StableUid: `q${order}`, OrderInDeck: order, Difficulty: 1, Question: `Q${order}`, Revision: 1 });
const mcq = (order: number): any => ({
  ...qa(order),
  StableUid: `m${order}`,
  Mcq: {
    v: 1,
    options: [
      { key: 'a', why: 'No.', text: 'A', correct: false },
      { key: 'b', why: null, text: 'B', correct: true },
      { key: 'c', why: 'No.', text: 'C', correct: false },
      { key: 'd', why: 'No.', text: 'D', correct: false },
    ],
    shuffle: true,
  },
});
const deckOf = (cards: any[]): any => ({ Slug: 'aws', Title: 'AWS', Locale: 'en-US', Version: '1', DeckType: 1, TotalCards: cards.length, Cards: cards });
const fresh = (uid: string): CardProgress => ({ stableUid: uid, stage: 0, nextReviewAt: 0 });
const due = (uid: string): CardProgress => ({ stableUid: uid, stage: 2, lastReviewedAt: NOW_MS - 3 * 86_400_000, nextReviewAt: NOW_MS - 86_400_000, lastSeenRevision: 1 });
const flags = (maxPerRun: number, enabled = true): any => ({ mcq: { enabled, recallFirst: true, maxPerRun, answerTelemetry: false } });

describe('projectLearningChecks', () => {
  it('counts one check per new Q/A card in a first lesson', () => {
    const cards = [qa(1), qa(2), qa(3), qa(4), qa(5)];
    const progress = cards.map((c) => fresh(c.StableUid));
    expect(projectLearningChecks({ deck: deckOf(cards), progress, now: NOW, mode: 'learn-new', limit: 5, flags: flags(2) })).toBe(5);
  });

  it('stops at the run limit and when the planner runs out', () => {
    const cards = [qa(1), qa(2), qa(3)];
    const progress = cards.map((c) => fresh(c.StableUid));
    expect(projectLearningChecks({ deck: deckOf(cards), progress, now: NOW, mode: 'learn-new', limit: 2, flags: flags(2) })).toBe(2);
    expect(projectLearningChecks({ deck: deckOf(cards), progress, now: NOW, mode: 'learn-new', limit: 9, flags: flags(2) })).toBe(3);
  });

  it('adds no check for a learned card or an MCQ card', () => {
    const cards = [qa(1), qa(2), mcq(3)];
    const progress = [due('q1'), fresh('q2'), fresh('m3')];
    expect(projectLearningChecks({ deck: deckOf(cards), progress, now: NOW, mode: 'mixed', limit: 3, flags: flags(2) })).toBe(1);
    // With MCQ off the MCQ card is a Q/A card and gets its check.
    expect(projectLearningChecks({ deck: deckOf(cards), progress, now: NOW, mode: 'mixed', limit: 3, flags: flags(2, false) })).toBe(2);
  });

  it('respects the owned gate', () => {
    const cards = [qa(1), qa(2), qa(3)];
    const progress = cards.map((c) => fresh(c.StableUid));
    expect(
      projectLearningChecks({ deck: deckOf(cards), progress, now: NOW, mode: 'learn-new', limit: 3, ownedSet: new Set(['q2']), flags: flags(2) }),
    ).toBe(1);
  });
});
