import { describe, expect, it } from 'vitest';
import { buildSessionSummaryVM, COPY } from '../../src/features/gacha/session/summaryMapper';

describe('summaryMapper wallet scenarios', () => {
  it('maps 0 wallet state into minimum-goal reward copy', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 2,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });

    expect(summary.vm.reward.walletBefore).toEqual({ available: 0, reserve: 0 });
    expect(summary.vm.reward.walletAfter).toEqual({ available: 1, reserve: 0 });
    expect(summary.vm.progress.completionLabel).toBe('You kept the streak.');
    expect(summary.vm.reward.body).toContain('1 ready to use');
  });

  it('maps mid-wallet state (1-29) with additive pull copy', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 1,
      wallet: { availablePulls: 12, reservePulls: 0 },
    });

    expect(summary.vm.reward.walletAfter).toEqual({ available: 13, reserve: 0 });
    expect(summary.vm.reward.body).toContain('+1 free pull added');
    expect(summary.vm.reward.usePullsLabel).toBe('Use 13 pulls');
  });

  it('maps 29 → 30 + reserve with full-clear copy', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 4,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 29, reservePulls: 0 },
    });

    expect(summary.vm.progress.completionLabel).toBe("Cleared today's run.");
    expect(summary.vm.reward.walletAfter).toEqual({ available: 30, reserve: 1 });
    expect(summary.vm.reward.body).toContain('30 ready · 1 pending in reserve');
  });

  it('maps wallet-full state with reserve-pending copy', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 4,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 30, reservePulls: 5 },
    });

    expect(summary.vm.reward.walletAfter).toEqual({ available: 30, reserve: 5 });
    expect(summary.vm.reward.body).toContain('Free pulls full · 5 pending in reserve');
  });
});

describe('summaryMapper COPY terms', () => {
  it('COPY contains no loss-aversion terms', () => {
    const forbidden = ['lost', 'missed', 'forfeit', 'wasted', 'expired', 'gone'];
    const all = JSON.stringify(COPY).toLowerCase();

    for (const word of forbidden) {
      expect(all).not.toContain(word);
    }
  });
});
