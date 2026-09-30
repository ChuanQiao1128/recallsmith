// The pure display helpers behind the Usage page and the Freshness tile
// (src/lib/usageView.ts, R20 V10).

import { describe, expect, it } from 'vitest';

import {
  FRESHNESS_HREF,
  formatCount,
  formatMinutes,
  formatRetention,
  sparklinePoints,
} from '../src/lib/usageView';

describe('usageView', () => {
  it('shows "—" for every figure the server has not computed', () => {
    for (const format of [formatCount, formatMinutes, formatRetention]) {
      expect(format(null)).toBe('—');
      expect(format(undefined)).toBe('—');
      expect(format(Number.NaN)).toBe('—');
    }
  });

  it('formats counts, retention shares and minutes', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12345)).toBe('12,345');
    expect(formatRetention(0)).toBe('0.0%');
    expect(formatRetention(0.3333)).toBe('33.3%');
    expect(formatRetention(1)).toBe('100.0%');
    expect(formatMinutes(95.4)).toBe('95 min');
    expect(formatMinutes(1440)).toBe('1,440 min');
  });

  it('draws the sparkline oldest to newest, skipping nulls, and nothing for fewer than two points', () => {
    expect(sparklinePoints([1, 3, 2], 100, 10)).toBe('0,10 50,0 100,5');
    expect(sparklinePoints([1, null, 3], 100, 10)).toBe('0,10 100,0');
    // A flat line sits in the middle rather than on an edge.
    expect(sparklinePoints([4, 4], 100, 10)).toBe('0,5 100,5');
    expect(sparklinePoints([4], 100, 10)).toBe('');
    expect(sparklinePoints([null, 4, null], 100, 10)).toBe('');
    expect(sparklinePoints([], 100, 10)).toBe('');
  });

  it('links the Freshness section on the Usage page', () => {
    expect(FRESHNESS_HREF).toBe('/usage#freshness');
  });
});
