import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

import { applySessionStreak, loadStreakSnapshot } from '../../src/features/gacha/streaks/streakTracker';
import { resolveNewMilestones } from '../../src/features/gacha/milestones/milestoneTracker';
import { filterAudienceCandidateRows, getAudiencePreferenceLabel } from '../../src/features/gacha/audience/audienceRules';
import { buildReminderPlanVM } from '../../src/features/gacha/reminders/reminderPlanner';

describe('p6 systems', () => {
  beforeEach(() => {
    store.clear();
  });

  it('records daily and weekly streak progress across consecutive days', async () => {
    const day1 = await applySessionStreak({ sessionId: 'sess-1', earned: true, now: new Date('2026-04-20T09:00:00Z') });
    expect(day1.after.currentDailyStreak).toBe(1);
    expect(day1.after.weekCompletedDays).toBe(1);
    expect(day1.after.totalQualifiedSessions).toBe(1);

    const day2 = await applySessionStreak({ sessionId: 'sess-2', earned: true, now: new Date('2026-04-21T09:00:00Z') });
    expect(day2.after.currentDailyStreak).toBe(2);
    expect(day2.after.longestDailyStreak).toBe(2);
    expect(day2.after.weekCompletedDays).toBe(2);
    expect(day2.after.totalQualifiedSessions).toBe(2);

    const snapshot = await loadStreakSnapshot();
    expect(snapshot.currentDailyStreak).toBe(2);
    expect(snapshot.weekCompletedDays).toBe(2);
  });

  it('dedupes the same session and does not double-apply streak progress', async () => {
    await applySessionStreak({ sessionId: 'sess-1', earned: true, now: new Date('2026-04-20T09:00:00Z') });
    const result = await applySessionStreak({ sessionId: 'sess-1', earned: true, now: new Date('2026-04-20T09:05:00Z') });

    expect(result.applied).toBe(false);
    expect(result.after.currentDailyStreak).toBe(1);
    expect(result.after.totalQualifiedSessions).toBe(1);
  });

  it('resolves newly unlocked milestones when thresholds are crossed', () => {
    const milestones = resolveNewMilestones({
      before: {
        currentDailyStreak: 2,
        longestDailyStreak: 2,
        weekCompletedDays: 2,
        totalQualifiedSessions: 2,
        lastQualifiedDateKey: '2026-04-21',
        currentWeekKey: '2026-W17',
      },
      after: {
        currentDailyStreak: 3,
        longestDailyStreak: 3,
        weekCompletedDays: 3,
        totalQualifiedSessions: 3,
        lastQualifiedDateKey: '2026-04-22',
        currentWeekKey: '2026-W17',
      },
    });

    expect(milestones.map((item) => item.id)).toEqual(['sessions-3', 'streak-3']);
  });

  it('filters candidate rows by audience preference without breaking fallback behavior', () => {
    const rows = [
      { stableUid: '1', difficulty: 1 },
      { stableUid: '2', difficulty: 2 },
      { stableUid: '3', difficulty: 3 },
    ] as any;

    expect(filterAudienceCandidateRows(rows, 'junior').map((item: any) => item.stableUid)).toEqual(['1', '2']);
    expect(filterAudienceCandidateRows(rows, 'all').map((item: any) => item.stableUid)).toEqual(['2', '3']);
    expect(filterAudienceCandidateRows([{ stableUid: '3', difficulty: 3 }] as any, 'junior')).toHaveLength(1);
    expect(getAudiencePreferenceLabel('both')).toBe('Balanced');
  });

  it('builds a reminder plan summary that explains rescue behavior', () => {
    const vm = buildReminderPlanVM({
      morningEnabled: true,
      morningTime: '08:00',
      eveningEnabled: true,
      eveningTime: '20:00',
    });

    expect(vm.statusLine).toContain('08:00');
    expect(vm.statusLine).toContain('20:00');
    expect(vm.eveningLine.toLowerCase()).toContain('due cards remain');
  });
});
