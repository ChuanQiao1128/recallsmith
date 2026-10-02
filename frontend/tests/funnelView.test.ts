// The pure helpers behind the Usage page's "Funnel (anonymous installs)"
// section (src/lib/funnelView.ts, R24 contract §3.5): steps with conversion from
// first open, the last 12 cohort weeks, per-deck steps and SVG bar widths.

import { describe, expect, it } from 'vitest';

import type { FunnelCounts, FunnelReport, FunnelWeek } from '../src/api/usage';
import {
  FUNNEL_RECENT_WEEKS,
  FUNNEL_STEP_LABELS,
  barWidth,
  deckFunnelSteps,
  formatConversion,
  formatStep,
  isFunnelEmpty,
  overallFunnelSteps,
  recentCohortWeeks,
} from '../src/lib/funnelView';

function counts(overrides: Partial<FunnelCounts> = {}): FunnelCounts {
  return {
    first_open: null,
    goal_chosen: null,
    starter_started: null,
    starter_completed: null,
    first_pack_opened: null,
    returned_day_1: null,
    returned_day_7: null,
    signup_started: null,
    signup_completed: null,
    ...overrides,
  };
}

describe('overallFunnelSteps', () => {
  it('lists every event in funnel order with its conversion from first open and bar share', () => {
    const steps = overallFunnelSteps(counts({ first_open: 40, goal_chosen: 30, starter_started: 10, signup_completed: 0 }));
    expect(steps.map(s => s.event)).toEqual([
      'first_open',
      'goal_chosen',
      'starter_started',
      'starter_completed',
      'first_pack_opened',
      'returned_day_1',
      'returned_day_7',
      'signup_started',
      'signup_completed',
    ]);
    expect(steps[0]).toEqual({ event: 'first_open', label: 'First open', count: 40, isBase: true, conversion: 1, fraction: 1 });
    expect(steps[1]).toEqual({ event: 'goal_chosen', label: 'Goal chosen', count: 30, isBase: false, conversion: 0.75, fraction: 0.75 });
    expect(steps[2].conversion).toBe(0.25);
    // Not computed stays null (shown as "—"), a real zero stays zero.
    expect(steps[3]).toMatchObject({ count: null, conversion: null, fraction: 0 });
    expect(steps[8]).toMatchObject({ count: 0, conversion: 0, fraction: 0 });
  });

  it('has no conversion when nothing was opened, and scales bars to the largest step', () => {
    const steps = overallFunnelSteps(counts({ first_open: 0, goal_chosen: 4, starter_started: 2 }));
    expect(steps.map(s => s.conversion)).toEqual(Array(9).fill(null));
    expect(steps[1].fraction).toBe(1);
    expect(steps[2].fraction).toBe(0.5);
  });

  it('labels every event in plain words', () => {
    expect(Object.values(FUNNEL_STEP_LABELS)).toEqual([
      'First open',
      'Goal chosen',
      'Starter started',
      'Starter completed',
      'First pack opened',
      'Returned day 1',
      'Returned day 7',
      'Sign-up started',
      'Sign-up completed',
    ]);
  });
});

describe('deckFunnelSteps', () => {
  it('covers the four deck steps with conversion from goal chosen', () => {
    const steps = deckFunnelSteps({ goal_chosen: 10, starter_started: 5, starter_completed: 2, first_pack_opened: null });
    expect(steps.map(s => [s.event, s.count, s.conversion])).toEqual([
      ['goal_chosen', 10, 1],
      ['starter_started', 5, 0.5],
      ['starter_completed', 2, 0.2],
      ['first_pack_opened', null, null],
    ]);
  });
});

describe('recentCohortWeeks', () => {
  it('keeps the last 12 cohort weeks, newest first', () => {
    const weeks: FunnelWeek[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 6, 6 + i * 7)).toISOString().slice(0, 10);
      weeks.push({ weekStart: d, counts: counts({ first_open: i }) });
    }
    const shuffled = [...weeks].reverse().sort((a, b) => (a.counts.first_open ?? 0) % 3 - (b.counts.first_open ?? 0) % 3);
    const recent = recentCohortWeeks(shuffled);
    expect(FUNNEL_RECENT_WEEKS).toBe(12);
    expect(recent).toHaveLength(12);
    expect(recent[0].weekStart).toBe(weeks[13].weekStart);
    expect(recent[11].weekStart).toBe(weeks[2].weekStart);
    expect(recentCohortWeeks([])).toEqual([]);
  });
});

describe('formatting', () => {
  it('formats a conversion with one decimal, or "—"', () => {
    expect(formatConversion(0.25)).toBe('25.0%');
    expect(formatConversion(1)).toBe('100.0%');
    expect(formatConversion(null)).toBe('—');
  });

  it('shows a step as its count with the conversion in brackets, the base step and unknowns bare', () => {
    const [first, goal, started, completed] = overallFunnelSteps(
      counts({ first_open: 1200, goal_chosen: 900, starter_started: 3 }),
    );
    expect(formatStep(first)).toBe('1,200');
    expect(formatStep(goal)).toBe('900 (75.0%)');
    expect(formatStep(started)).toBe('3 (0.3%)');
    // A later step as large as the first still shows its conversion.
    const [, same] = overallFunnelSteps(counts({ first_open: 9, goal_chosen: 9 }));
    expect(formatStep(same)).toBe('9 (100.0%)');
    expect(formatStep(completed)).toBe('—');
    const [noBase] = overallFunnelSteps(counts({ goal_chosen: 5 })).slice(1);
    expect(formatStep(noBase)).toBe('5');
  });

  it('turns a 0..1 share into a bar width, clamped', () => {
    expect(barWidth(0.5, 200)).toBe(100);
    expect(barWidth(1 / 3, 200)).toBe(66.7);
    expect(barWidth(2, 200)).toBe(200);
    expect(barWidth(-1, 200)).toBe(0);
    expect(barWidth(Number.NaN, 200)).toBe(0);
  });
});

describe('isFunnelEmpty', () => {
  const empty: FunnelReport = { days: 90, overall: counts(), weeks: [], decks: [] };

  it('is empty when no install was counted and no week or deck is listed', () => {
    expect(isFunnelEmpty(empty)).toBe(true);
    expect(isFunnelEmpty({ ...empty, overall: counts({ first_open: 0 }) })).toBe(true);
  });

  it('is not empty once anything was counted', () => {
    expect(isFunnelEmpty({ ...empty, overall: counts({ first_open: 1 }) })).toBe(false);
    expect(isFunnelEmpty({ ...empty, weeks: [{ weekStart: '2026-09-28', counts: counts({ first_open: 2 }) }] })).toBe(false);
  });
});
