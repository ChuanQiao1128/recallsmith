import type { CardProgress } from '../review/model';

export const schedulerStateKeys = ['lapses', 'hardStreak', 'fsrsStability', 'fsrsDifficulty',
  'fsrsAnchorAt', 'fsrsReviewedAt'] as const;
type SchedulerState = Pick<CardProgress, typeof schedulerStateKeys[number]>;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Always return the entire group. Keeping a prior review's model next to a
// newer due date would give the next FSRS calculation the wrong history.
export function schedulerStatePatch(value: unknown, reviewedAt: number): SchedulerState {
  const out: SchedulerState = { lapses: undefined, hardStreak: undefined, fsrsStability: undefined,
    fsrsDifficulty: undefined, fsrsAnchorAt: undefined, fsrsReviewedAt: undefined };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const v = value as Record<string, unknown>;
  for (const key of ['lapses', 'hardStreak'] as const) {
    const n = v[key];
    if (finite(n) && Number.isInteger(n) && n >= 0 && n <= 2_147_483_647) out[key] = n;
  }
  if (finite(v.fsrsStability) && v.fsrsStability > 0 && finite(v.fsrsDifficulty)
    && v.fsrsDifficulty >= 1 && v.fsrsDifficulty <= 10 && v.fsrsAnchorAt === reviewedAt
    && finite(v.fsrsReviewedAt) && Number.isInteger(v.fsrsReviewedAt) && v.fsrsReviewedAt > 0 && v.fsrsReviewedAt <= reviewedAt) {
    out.fsrsStability = v.fsrsStability;
    out.fsrsDifficulty = v.fsrsDifficulty;
    out.fsrsAnchorAt = reviewedAt;
    out.fsrsReviewedAt = v.fsrsReviewedAt;
  }
  return out;
}
