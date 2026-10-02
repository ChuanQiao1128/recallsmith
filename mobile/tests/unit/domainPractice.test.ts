import { describe, expect, it } from 'vitest';
import type { CardProgress } from '../../src/review/model';
import type { MistakeEntry } from '../../src/features/gacha/mistakes/mistakeBook';
import { DOMAIN_PRACTICE_LIMIT, pickDomainPracticeUids } from '../../src/features/domains/domainPractice';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const DAY = 86_400_000;

function learned(uid: string, stage: number, reviewedDaysAgo: number, dueInDays: number): CardProgress {
  return {
    stableUid: uid,
    stage,
    lastReviewedAt: NOW.getTime() - reviewedDaysAgo * DAY,
    nextReviewAt: NOW.getTime() + dueInDays * DAY,
  };
}
function mistake(deckSlug: string, uid: string): MistakeEntry {
  return {
    deckSlug,
    stableUid: uid,
    topic: null,
    wrongCount: 1,
    firstWrongAt: NOW.getTime() - DAY,
    lastWrongAt: NOW.getTime() - DAY,
    lastOutcome: 'again',
    correctStreak: 0,
    resolvedAt: null,
  };
}

describe('pickDomainPracticeUids', () => {
  it('orders active mistakes, then due, then lowest stage, then longest since review', () => {
    const uids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const progress = [
      learned('a', 1, 1, 5), // stage 1, recent
      learned('b', 1, 3, 5), // stage 1, older review -> before a
      learned('c', 4, 2, -1), // due
      learned('d', 0, 1, 5), // lowest stage
      learned('e', 5, 1, 9), // active mistake
      learned('f', 3, 1, 9),
    ];
    const picked = pickDomainPracticeUids({
      slug: 'aws',
      uids,
      progress,
      owned: null,
      activeMistakes: [mistake('aws', 'e'), mistake('other', 'f')],
      now: NOW,
    });
    expect(picked).toEqual(['e', 'c', 'd', 'b', 'a', 'f']);
  });

  it('keeps only owned, learned cards of the domain', () => {
    const progress = [
      learned('a', 1, 1, 5),
      { stableUid: 'b', stage: 0, nextReviewAt: 0 }, // never learned
      learned('c', 1, 1, 5), // not owned
      learned('z', 1, 1, 5), // not in the domain
    ];
    const picked = pickDomainPracticeUids({
      slug: 'aws',
      uids: ['a', 'b', 'c'],
      progress,
      owned: new Set(['a', 'b', 'z']),
      activeMistakes: [mistake('aws', 'b')],
      now: NOW,
    });
    expect(picked).toEqual(['a']);
  });

  it('caps the session at 15 cards and returns none when nothing qualifies', () => {
    const uids = Array.from({ length: 20 }, (_, i) => `u${i}`);
    const progress = uids.map((uid, i) => learned(uid, 1, 20 - i, 5));
    const picked = pickDomainPracticeUids({ slug: 'aws', uids, progress, owned: null, activeMistakes: [], now: NOW });
    expect(DOMAIN_PRACTICE_LIMIT).toBe(15);
    expect(picked).toHaveLength(15);
    expect(picked[0]).toBe('u0');

    expect(
      pickDomainPracticeUids({ slug: 'aws', uids, progress: [], owned: null, activeMistakes: [], now: NOW }),
    ).toEqual([]);
  });
});
