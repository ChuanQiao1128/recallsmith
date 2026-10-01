import { beforeEach, describe, expect, it, vi } from 'vitest';

const { asyncStore } = vi.hoisted(() => ({ asyncStore: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (asyncStore.has(k) ? asyncStore.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStore.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      asyncStore.delete(k);
    }),
  },
}));

import {
  STUDY_GOAL_KEY,
  capNextReviewToExam,
  clearStudyGoal,
  daysUntilExam,
  examReviewCapMs,
  getStudyGoal,
  localDayStartMs,
  setStudyGoal,
} from '../../src/features/goal/studyGoal';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();

describe('study goal storage', () => {
  beforeEach(() => asyncStore.clear());

  it('round-trips a goal and clears it', async () => {
    expect(await getStudyGoal()).toBeNull();
    await setStudyGoal({ deckSlug: 'aws-saa-c03', examDate: '2026-11-15' });
    expect(await getStudyGoal()).toEqual({ deckSlug: 'aws-saa-c03', examDate: '2026-11-15' });
    await setStudyGoal({ deckSlug: 'claude-ccdv-f', examDate: null });
    expect(await getStudyGoal()).toEqual({ deckSlug: 'claude-ccdv-f', examDate: null });
    await clearStudyGoal();
    expect(await getStudyGoal()).toBeNull();
  });

  it('rejects an invalid slug or date instead of storing it', async () => {
    await expect(setStudyGoal({ deckSlug: 'AWS SAA', examDate: null })).rejects.toThrow();
    await expect(setStudyGoal({ deckSlug: 'aws-saa-c03', examDate: '2026-02-30' })).rejects.toThrow();
    expect(asyncStore.has(STUDY_GOAL_KEY)).toBe(false);
  });

  it('reads corrupt storage as no goal, and drops a corrupt date but keeps the deck', async () => {
    asyncStore.set(STUDY_GOAL_KEY, '{not json');
    expect(await getStudyGoal()).toBeNull();
    asyncStore.set(STUDY_GOAL_KEY, JSON.stringify({ deckSlug: 'aws-saa-c03', examDate: 'soon' }));
    expect(await getStudyGoal()).toEqual({ deckSlug: 'aws-saa-c03', examDate: null });
  });
});

describe('exam date arithmetic (local calendar days)', () => {
  it('parses only real calendar days', () => {
    expect(localDayStartMs('2026-11-15')).toBe(new Date(2026, 10, 15).getTime());
    expect(localDayStartMs('2026-13-01')).toBeNull();
    expect(localDayStartMs('15/11/2026')).toBeNull();
  });

  it('counts whole days until the exam, 0 on the day, null after it or when unset', () => {
    expect(daysUntilExam('2026-11-15', at(2026, 11, 1, 23))).toBe(14);
    expect(daysUntilExam('2026-11-15', at(2026, 11, 15, 8))).toBe(0);
    expect(daysUntilExam('2026-11-15', at(2026, 11, 16))).toBeNull();
    expect(daysUntilExam(null, at(2026, 11, 1))).toBeNull();
  });

  it('caps at the start of the day before the exam, and not at all when that moment has passed', () => {
    expect(examReviewCapMs('2026-11-15', at(2026, 10, 1))).toBe(new Date(2026, 10, 14).getTime());
    expect(examReviewCapMs('2026-11-15', at(2026, 11, 14, 9))).toBeNull(); // exam tomorrow
    expect(examReviewCapMs('2026-11-15', at(2026, 11, 15))).toBeNull(); // exam today
    expect(examReviewCapMs(null, at(2026, 10, 1))).toBeNull();
  });

  it('pulls a later review back to the cap and leaves an earlier one alone', () => {
    const now = at(2026, 11, 1);
    const cap = new Date(2026, 10, 14).getTime();
    const late = { stage: 5, nextReviewAt: at(2026, 12, 1) };
    const early = { stage: 1, nextReviewAt: at(2026, 11, 3) };
    expect(capNextReviewToExam(late, '2026-11-15', now)).toEqual({ stage: 5, nextReviewAt: cap });
    expect(capNextReviewToExam(early, '2026-11-15', now)).toBe(early);
    expect(capNextReviewToExam(late, null, now)).toBe(late);
  });
});
