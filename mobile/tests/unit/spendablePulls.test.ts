import { describe, expect, it } from 'vitest';

import { spendablePullsNow } from '../../src/features/gacha/rewards/spendablePulls';

describe('spendablePullsNow', () => {
  it('counts only available pulls, never reserve', () => {
    expect(spendablePullsNow({ availablePulls: 60, reservePulls: 5 })).toBe(60);
  });

  it('clamps missing, negative and non-numeric values to zero', () => {
    expect(spendablePullsNow(null)).toBe(0);
    expect(spendablePullsNow(undefined)).toBe(0);
    expect(spendablePullsNow({})).toBe(0);
    expect(spendablePullsNow({ availablePulls: -3 })).toBe(0);
    expect(spendablePullsNow({ availablePulls: NaN })).toBe(0);
    expect(spendablePullsNow({ availablePulls: '7' as any })).toBe(7);
    expect(spendablePullsNow({ availablePulls: 2.9 })).toBe(2);
  });
});
