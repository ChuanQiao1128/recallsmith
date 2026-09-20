export const DAILY_STREAK_ALLOWED_RATINGS = ['hard', 'good', 'easy'] as const;
// Daily session size cap. Real-device feedback was that 20 felt
// punishing — 5 is the sweet spot where one short run = one earned
// pull, matching the dopamine cadence users expect from a daily
// micro-loop. The planner uses this as an upper bound — actual
// session length scales down with available due+new cards.
export const SESSION_MAIN_ROUTE_DEFAULT = 5;
export const SESSION_MIN_GOAL = 1;
export const FREE_PULL_CAP = 60;
export const FREE_PULL_OVERFLOW_CAP = 5;
export const MASTERY_STAGE_THRESHOLD = 4;
// Sweep pacing: a "Review all" run is sized so the deck's learned cards are
// covered once over this many days (economy-v2 R8 — a sweep pays no per-card pull).
export const SWEEP_SPREAD_DAYS = 7;
