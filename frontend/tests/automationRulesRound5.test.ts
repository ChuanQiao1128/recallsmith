// The F04 rules of the /automation console (R18A fix round 5): the open-only
// Decisions list shows the verdict (frontend-console-36) and the Overview's
// 24-hour split stays blind outside live (frontend-console-35).

import { describe, expect, it } from 'vitest';

import {
  BLIND_DECISIONS_LABEL,
  automationCountsBlind,
  decisionListShowsVerdict,
  decisionStateBars,
  isOpenDecision,
} from '../src/lib/automationRules';

describe('the verdict an open-only list shows (frontend-console-36)', () => {
  it('is shown by the open-exceptions filter alone, like the server open=true (routed rows only)', () => {
    expect(decisionListShowsVerdict({ state: '', reason: '', openOnly: true })).toBe(true);
    expect(decisionListShowsVerdict({ state: 'human', reason: '', openOnly: true })).toBe(true);
    expect(decisionListShowsVerdict({ state: '', reason: '', openOnly: false })).toBe(false);
  });

  it("keeps the client's open check to the server's predicate, so no pending would-accept row is listed", () => {
    expect(isOpenDecision({ state: 'human', humanAction: null })).toBe(true);
    expect(isOpenDecision({ state: 'would_accept', humanAction: null })).toBe(false);
    expect(isOpenDecision({ state: 'qa_queued', humanAction: null })).toBe(false);
  });
});

describe('the blind 24-hour split (frontend-console-35)', () => {
  it('is blind in any mode but live, an unknown one included', () => {
    expect(automationCountsBlind('live')).toBe(false);
    expect(automationCountsBlind('dry_run')).toBe(true);
    expect(automationCountsBlind('off')).toBe(true);
    expect(automationCountsBlind(null)).toBe(true);
  });

  it('adds the pending-capable states into one row and keeps auto-accepted and superseded apart', () => {
    const bars = decisionStateBars(
      { qa_pending: 1, qa_queued: 2, would_accept: 3, human: 1, auto_accepted: 0, superseded: 2 },
      100,
    ).length;
    expect(bars).toBe(6);
    const blind = decisionStateBars(
      { qa_pending: 1, qa_queued: 2, would_accept: 3, human: 1, auto_accepted: 0, superseded: 2 },
      100,
      true,
    );
    expect(blind.map(b => [b.label, b.count])).toEqual([
      [BLIND_DECISIONS_LABEL, 7],
      ['Auto-accepted', 0],
      ['Decided by a person', 2],
    ]);
    expect(blind[0].width).toBe(100);
    expect(blind.map(b => b.state)).not.toContain('would_accept');
    expect(blind.map(b => b.state)).not.toContain('human');
  });
});
