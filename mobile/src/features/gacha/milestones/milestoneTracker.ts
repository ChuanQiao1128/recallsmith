import type { StreakSnapshot } from '../streaks/streakTracker';

export type Milestone = {
  id: 'sessions-1' | 'sessions-3' | 'streak-3' | 'week-5' | 'streak-7';
  title: string;
  body: string;
};

const MILESTONES: Record<Milestone['id'], Milestone> = {
  'sessions-1': {
    id: 'sessions-1',
    title: 'First day complete',
    body: 'You closed your first qualified run. Keep the loop small and repeatable.',
  },
  'sessions-3': {
    id: 'sessions-3',
    title: 'Three clean runs',
    body: 'You now have enough history to build a reliable daily rhythm.',
  },
  'streak-3': {
    id: 'streak-3',
    title: '3-day streak',
    body: 'Momentum is visible now. Protect the next day, not the whole month.',
  },
  'week-5': {
    id: 'week-5',
    title: '5 days this week',
    body: 'Your week is doing the work, even without a big ceremony.',
  },
  'streak-7': {
    id: 'streak-7',
    title: '7-day streak',
    body: 'One full week of recall is locked in. Keep the route boring and consistent.',
  },
};

export function resolveNewMilestones(args: { before: StreakSnapshot; after: StreakSnapshot }): Milestone[] {
  const unlocked: Milestone[] = [];

  if (args.before.totalQualifiedSessions < 1 && args.after.totalQualifiedSessions >= 1) unlocked.push(MILESTONES['sessions-1']);
  if (args.before.totalQualifiedSessions < 3 && args.after.totalQualifiedSessions >= 3) unlocked.push(MILESTONES['sessions-3']);
  if (args.before.longestDailyStreak < 3 && args.after.longestDailyStreak >= 3) unlocked.push(MILESTONES['streak-3']);
  if (args.before.weekCompletedDays < 5 && args.after.weekCompletedDays >= 5) unlocked.push(MILESTONES['week-5']);
  if (args.before.longestDailyStreak < 7 && args.after.longestDailyStreak >= 7) unlocked.push(MILESTONES['streak-7']);

  return unlocked;
}
