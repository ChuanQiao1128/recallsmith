export const PLAN_SNAPSHOTS = {
  today: { due: 6, newCards: 2, reviewCards: 4 },
  week: [3, 5, 6, 4, 2, 7, 8],
  month: [2, 4, 1, 6, 3, 8, 5, 7, 4, 2, 6, 1],
};

export const PLAN_TODAY = {
  newCards: ['ConfigureAwait(false)', 'IQueryable vs IEnumerable'],
  reviewCards: ['DbContext lifetime', 'Middleware ordering', 'Task vs Thread', 'LINQ deferred execution'],
};

export const PLAN_WEEK = [
  { day: 'Mon', count: 3 },
  { day: 'Tue', count: 5 },
  { day: 'Wed', count: 6 },
  { day: 'Thu', count: 4 },
  { day: 'Fri', count: 2 },
  { day: 'Sat', count: 7 },
  { day: 'Sun', count: 8 },
];

export const PLAN_MONTH = [
  { date: 'Apr 24', count: 2 },
  { date: 'Apr 25', count: 4 },
  { date: 'Apr 26', count: 1 },
  { date: 'Apr 27', count: 6 },
  { date: 'Apr 28', count: 3 },
  { date: 'Apr 29', count: 8 },
];

export const WEEK_GOAL_DEFAULTS = { current: 18, suggested: 22 };
