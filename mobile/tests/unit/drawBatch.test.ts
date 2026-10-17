// 2026-10-17 batch open: the Draw screen's open buttons come from n = min(draws held in the pack,
// cards in the pack not yet owned). n = 0 → no open button, n = 1 → "Open 1" alone, n >= 2 →
// "Open {min(n, 5)}" plus "Open 1". No "Open 10", and nothing that names a bigger batch.
import { describe, expect, it } from 'vitest';

import { clampOpenCount, drawButtonPlan, MAX_BATCH_OPEN } from '../../src/features/gacha/draw/drawBatch';

const COUNTS = [0, 1, 2, 3, 4, 5, 6, 9, 10, 12] as const;

describe('drawButtonPlan', () => {
  it('caps a batch at five cards', () => {
    expect(MAX_BATCH_OPEN).toBe(5);
  });

  it.each([
    // held, undrawn → openable, batch, single
    [0, 12, 0, null, false],
    [1, 12, 1, null, true],
    [2, 12, 2, 2, true],
    [3, 12, 3, 3, true],
    [4, 12, 4, 4, true],
    [5, 12, 5, 5, true],
    [6, 12, 6, 5, true],
    [9, 12, 9, 5, true],
    [10, 12, 10, 5, true],
    [12, 12, 12, 5, true],
  ] as const)('holding %i draws with %i cards missing', (held, undrawn, openable, batch, single) => {
    expect(drawButtonPlan({ held, undrawn })).toEqual({ openable, batch, single });
  });

  it.each([
    // The pack has fewer missing cards than draws held: the missing cards are the limit.
    [12, 0, 0, null, false],
    [12, 1, 1, null, true],
    [12, 2, 2, 2, true],
    [12, 3, 3, 3, true],
    [5, 4, 4, 4, true],
    [10, 6, 6, 5, true],
    [6, 1, 1, null, true],
    [3, 2, 2, 2, true],
  ] as const)('holding %i draws with only %i cards missing', (held, undrawn, openable, batch, single) => {
    expect(drawButtonPlan({ held, undrawn })).toEqual({ openable, batch, single });
  });

  it('follows n = min(held, undrawn) over the whole grid of counts', () => {
    for (const held of COUNTS) {
      for (const undrawn of COUNTS) {
        const n = Math.min(held, undrawn);
        const plan = drawButtonPlan({ held, undrawn });
        expect(plan.openable, `${held}/${undrawn}`).toBe(n);
        if (n === 0) {
          expect(plan, `${held}/${undrawn}`).toEqual({ openable: 0, batch: null, single: false });
        } else if (n === 1) {
          expect(plan, `${held}/${undrawn}`).toEqual({ openable: 1, batch: null, single: true });
        } else {
          expect(plan.single, `${held}/${undrawn}`).toBe(true);
          expect(plan.batch, `${held}/${undrawn}`).toBe(Math.min(n, 5));
          // Never a ten-card button, never a batch bigger than what can actually be opened.
          expect(plan.batch!).toBeGreaterThanOrEqual(2);
          expect(plan.batch!).toBeLessThanOrEqual(Math.min(n, MAX_BATCH_OPEN));
        }
      }
    }
  });

  it('reads junk counts as zero and floors fractions', () => {
    expect(drawButtonPlan({ held: -3, undrawn: 12 })).toEqual({ openable: 0, batch: null, single: false });
    expect(drawButtonPlan({ held: Number.NaN, undrawn: 12 })).toEqual({ openable: 0, batch: null, single: false });
    expect(drawButtonPlan({ held: 12, undrawn: Number.NaN })).toEqual({ openable: 0, batch: null, single: false });
    expect(drawButtonPlan({ held: 2.9, undrawn: 12 })).toEqual({ openable: 2, batch: 2, single: true });
    expect(drawButtonPlan({ held: Number.POSITIVE_INFINITY, undrawn: 7 })).toEqual({ openable: 0, batch: null, single: false });
  });
});

describe('clampOpenCount (the charge-safety clamp right before the commit)', () => {
  it('opens the requested batch when the pack still holds the draws and the cards', () => {
    expect(clampOpenCount({ requested: 5, held: 12, undrawn: 12 })).toBe(5);
    expect(clampOpenCount({ requested: 1, held: 12, undrawn: 12 })).toBe(1);
    expect(clampOpenCount({ requested: 3, held: 3, undrawn: 3 })).toBe(3);
  });

  it('cuts the batch to the draws held at the moment of the press', () => {
    // The button said Open 5, but a sync or another screen spent two meanwhile.
    expect(clampOpenCount({ requested: 5, held: 3, undrawn: 12 })).toBe(3);
    expect(clampOpenCount({ requested: 5, held: 1, undrawn: 12 })).toBe(1);
  });

  it('cuts the batch to the cards still missing', () => {
    expect(clampOpenCount({ requested: 5, held: 12, undrawn: 2 })).toBe(2);
  });

  it('opens nothing when the pack holds no draws or misses no cards', () => {
    expect(clampOpenCount({ requested: 5, held: 0, undrawn: 12 })).toBe(0);
    expect(clampOpenCount({ requested: 1, held: 0, undrawn: 12 })).toBe(0);
    expect(clampOpenCount({ requested: 5, held: 12, undrawn: 0 })).toBe(0);
    expect(clampOpenCount({ requested: 0, held: 12, undrawn: 12 })).toBe(0);
  });

  it('never asks for more than one batch', () => {
    expect(clampOpenCount({ requested: 10, held: 12, undrawn: 12 })).toBe(MAX_BATCH_OPEN);
  });
});
