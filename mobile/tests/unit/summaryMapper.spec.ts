import { describe, expect, it } from 'vitest';
import {
  buildSessionSummaryVM,
  COPY,
  primaryActionGoesHome,
  resolveSecondaryAction,
} from '../../src/features/gacha/session/summaryMapper';

// These scenarios were written against the pre-v3 reward formula (full clear
// = +2 pulls, minimum goal = +1). rewardResolver.ts deliberately replaced it
// with "full clear = +1, anything below full clear = 0" once the session cap
// dropped to 5 cards, so a partial run no longer moves the wallet at all.
// Assertions below track the current formula; the old numbers are kept in the
// test names only where they still describe the input wallet.
describe('summaryMapper wallet scenarios', () => {
  it('maps 0 wallet state into minimum-goal reward copy', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 2,
      wallet: { availablePulls: 0, reservePulls: 0 },
      reward: null,
    });

    expect(summary.vm.reward.walletBefore).toEqual({ available: 0, reserve: 0 });
    expect(summary.vm.reward.walletAfter).toEqual({ available: 0, reserve: 0 });
    expect(summary.vm.progress.completionLabel).toBe('You kept the streak.');
    expect(summary.vm.reward.body).toContain('No free pulls this run');
    expect(summary.vm.reward.body).toContain('0 ready to use');
  });

  it('maps mid-wallet state with no pull when the run earned nothing', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 1,
      wallet: { availablePulls: 12, reservePulls: 0 },
      reward: null,
    });

    expect(summary.vm.reward.walletAfter).toEqual({ available: 12, reserve: 0 });
    expect(summary.vm.reward.body).toContain('No free pulls this run');
    expect(summary.vm.reward.usePullsLabel).toBe('Use 12 pulls');
  });

  it('maps 59 → 60 with one new card learned', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 4,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 59, reservePulls: 0 },
      reward: {
        newCardPulls: 1,
        newCardUids: ['u1'],
        dueClearPulls: 0,
        rewardPulls: 1,
        applied: 1,
        dropped: 0,
        walletBefore: { availablePulls: 59, reservePulls: 0 },
        walletAfter: { availablePulls: 60, reservePulls: 0 },
      },
    });

    expect(summary.vm.progress.completionLabel).toBe("Cleared today's run.");
    // +1 fits exactly in the remaining available room, so nothing spills into reserve.
    expect(summary.vm.reward.walletAfter).toEqual({ available: 60, reserve: 0 });
    expect(summary.vm.reward.body).toContain('+1 pull · 1 new card learned');
    expect(summary.vm.reward.body).toContain('60 ready to use');
  });

  it('maps wallet-full state with reserve-pending copy', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 4,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 60, reservePulls: 5 },
      reward: {
        newCardPulls: 1,
        newCardUids: ['u1'],
        dueClearPulls: 0,
        rewardPulls: 1,
        applied: 0,
        dropped: 1,
        walletBefore: { availablePulls: 60, reservePulls: 5 },
        walletAfter: { availablePulls: 60, reservePulls: 5 },
      },
    });

    expect(summary.vm.reward.walletAfter).toEqual({ available: 60, reserve: 5 });
    expect(summary.vm.reward.body).toContain('Free pulls full · 5 pending in reserve');
  });

  it('maps next-action titles across ready states', () => {
    const fullClear = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 4,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    const minimumGoal = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 2,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    const empty = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 0,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    const partialReady = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 0,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 2,
    });

    expect(fullClear.vm.nextAction.title).toBe('Cleared today. What now?');
    expect(minimumGoal.vm.nextAction.title).toBe('Streak saved. Keep moving?');
    expect(empty.vm.nextAction.title).toBe('No run logged yet');
    expect(empty.vm.nextAction.body).toBe("Browse your library while we wait for tomorrow's run.");
    expect(partialReady.vm.nextAction.title).toBe('Progress saved. Keep going?');
  });

  it('keeps all primary action labels short enough for 360pt buttons', () => {
    const scenarios = [
      { sessionDone: 4, sessionLimit: 4, minimumGoal: 1, dueCount: 0 },
      { sessionDone: 1, sessionLimit: 4, minimumGoal: 1, dueCount: 2 },
      { sessionDone: 0, sessionLimit: 4, minimumGoal: 1, dueCount: 0 },
      { sessionDone: 0, sessionLimit: 4, minimumGoal: 1, dueCount: 2 },
    ];

    for (const scenario of scenarios) {
      const summary = buildSessionSummaryVM({
        deckTitle: 'C# Interview',
        wallet: { availablePulls: 60, reservePulls: 5 },
        ...scenario,
      });
      expect(summary.vm.nextAction.primary.label.length).toBeLessThanOrEqual(22);
    }
  });
});

describe('summaryMapper — a run with nothing rated', () => {
  // Owner's device, 2026-09-21: an empty deck reached the summary through the
  // route-complete Continue and read "Good progress today · 0/1 cleared",
  // "Progress logged for today." and "0 / 1 cards · route started" next to
  // "No run logged yet". The planner now hands such a deck limit 0
  // (EMPTY_ROUTE_LIMIT) and the summary must not invent a card for it.
  it('reads as no run everywhere for limit 0 / done 0, with no phantom "0 / 1"', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'Claude Developer Foundations (CCDV-F)',
      sessionDone: 0,
      sessionLimit: 0,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 25, reservePulls: 0 },
      reward: null,
    });

    expect(summary.vm.title).toBe('No run logged yet');
    expect(summary.vm.subtitle).toBe('Claude Developer Foundations (CCDV-F) · no cards reviewed');
    expect(summary.vm.progress.done).toBe(0);
    expect(summary.vm.progress.total).toBe(0);
    expect(summary.vm.progress.completionLabel).toBe('Nothing reviewed this time.');
    expect(summary.vm.progress.body).toBe("No cards to review yet · 0 due cards in today's queue");
    expect(summary.vm.completionLabel).toBe('No cards reviewed');
    expect(summary.vm.nextAction.title).toBe('No run logged yet');
    expect(summary.vm.reward.fullClear).toBe(false);
    expect(summary.vm.reward.minimumGoalMet).toBe(false);

    const all = JSON.stringify(summary.vm);
    expect(all).not.toContain('0/1');
    expect(all).not.toContain('0 / 1');
    expect(all).not.toContain('Good progress today');
    expect(all).not.toContain('Progress logged for today.');
  });

  it('keeps the planned total when the run had cards but none were rated', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 0,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    expect(summary.vm.title).toBe('No run logged yet');
    expect(summary.vm.progress.total).toBe(4);
    expect(summary.vm.progress.body).toBe("0 / 4 cards · not started · 0 due cards in today's queue");
    expect(summary.vm.progress.completionLabel).toBe('Nothing reviewed this time.');
    expect(summary.vm.subtitle).toBe('C# Interview · no cards reviewed');
  });

  it('leaves a rated run untouched: unlimited runs still read done / done', () => {
    const summary = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 3,
      sessionLimit: 0,
      minimumGoal: 1,
      dueCount: 1,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    expect(summary.vm.title).toBe('Good progress today');
    expect(summary.vm.progress.total).toBe(3);
    expect(summary.vm.progress.body).toBe("3 / 3 cards · streak saved · 1 due card in today's queue");
    expect(summary.vm.subtitle).toBe('C# Interview · 3/∞ cleared');
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

describe('summaryMapper secondary action', () => {
  it('offers the library under a primary that already goes Home', () => {
    // 4/4 with pulls: primary "Continue" (today_full_clear → Home). The old
    // secondary was "Back home" -- the same tap with a second label.
    const fullClear = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 4,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 0, reservePulls: 0 },
    });
    const minimum = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 2,
    });

    for (const summary of [fullClear, minimum]) {
      expect(summary.vm.nextAction.primary.label).toBe('Continue');
      expect(summary.vm.nextAction.secondary).toEqual({ label: 'Open library', kind: 'nothing_to_learn' });
      expect(summary.vm.secondaryActionLabel).toBe('Open library');
    }
  });

  it('offers Home under a primary that opens the library', () => {
    const nothing = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 0,
      sessionLimit: 4,
      minimumGoal: 1,
      dueCount: 0,
    });

    expect(nothing.vm.nextAction.primary).toEqual({ label: 'Open library', kind: 'nothing_to_learn' });
    expect(nothing.vm.nextAction.secondary).toEqual({ label: 'Back home', kind: 'today_done' });
  });

  it('never pairs a primary with a secondary that goes to the same screen', () => {
    const scenarios = [
      { sessionDone: 4, sessionLimit: 4, minimumGoal: 1, dueCount: 0 },
      { sessionDone: 1, sessionLimit: 4, minimumGoal: 1, dueCount: 2 },
      { sessionDone: 0, sessionLimit: 4, minimumGoal: 1, dueCount: 0 },
      { sessionDone: 0, sessionLimit: 4, minimumGoal: 1, dueCount: 2 },
    ];
    for (const scenario of scenarios) {
      const { vm } = buildSessionSummaryVM({ deckTitle: 'C# Interview', ...scenario });
      expect(primaryActionGoesHome(vm.nextAction.primary.kind)).not.toBe(
        primaryActionGoesHome(vm.nextAction.secondary!.kind),
      );
    }
    expect(resolveSecondaryAction({ primaryGoesHome: true })).toEqual({ label: 'Open library', kind: 'nothing_to_learn' });
    expect(resolveSecondaryAction({ primaryGoesHome: false })).toEqual({ label: 'Back home', kind: 'today_done' });
  });
});
