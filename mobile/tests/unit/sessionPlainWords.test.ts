import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCQ_COPY } from '../../src/features/gacha/mcq/mcqConstants';
import { resolveNewMilestones } from '../../src/features/gacha/milestones/milestoneTracker';
import { buildChallengeRoute } from '../../src/features/gacha/planner/sessionBuilder';
import { getRewardWalletMessage } from '../../src/features/gacha/rewards/rewardWallet';
import { buildSessionSummaryVM, COPY } from '../../src/features/gacha/session/summaryMapper';
import type { StreakSnapshot } from '../../src/features/gacha/streaks/streakTracker';

// R24B W03: the study session, multiple-choice dock, session summary, rewards and
// milestones speak plain words (session, draws, saved draws, extra draws waiting).
const JARGON = /\b(pulls?|pity|wallet|reserve|run|runs|boss|elite|node|full clear|route|momentum)\b/i;

const screenSource = (name: string) =>
  readFileSync(path.join(__dirname, '../../src/screens', `${name}.tsx`), 'utf8');

function snapshot(overrides: Partial<StreakSnapshot>): StreakSnapshot {
  return {
    currentDailyStreak: 0,
    longestDailyStreak: 0,
    weekCompletedDays: 0,
    totalQualifiedSessions: 0,
    lastQualifiedDateKey: null,
    currentWeekKey: null,
    ...overrides,
  };
}

describe('session summary copy', () => {
  it('uses session and draw words in the summary copy table', () => {
    expect(COPY.title.fullClear).toBe('Session complete 🎉');
    expect(COPY.title.none).toBe('No session logged yet');
    expect(COPY.completion.fullClear).toBe('Cleared today’s session.');
    expect(COPY.reward.sectionFullClear).toBe('Session reward');
    expect(COPY.reward.badge(1)).toBe('+1 draw');
    expect(COPY.reward.badge(3)).toBe('+3 draws');
    expect(COPY.reward.noPull).toBe('No free draws this session');
    expect(COPY.reward.walletReserve(60, 2)).toBe('60 ready for this pack · 2 extra waiting');
    expect(COPY.reward.walletFull(5)).toBe('Saved draws full · 5 extra waiting');
    expect(COPY.reward.useDraws(1)).toBe('Use 1 draw');
    expect(COPY.progress.fullClearLabel(5, 5)).toBe('5 / 5 cards · all due cards done');
    expect(COPY.progress.partialLabel(1, 5)).toBe('1 / 5 cards · session started');
    expect(COPY.nextAction.emptyTitle).toBe('No session logged yet');
    expect(COPY.nextAction.drawBody).toBe('Continue your day, then open Draw when you want to use your draws.');
    expect(COPY.nextAction.homeBody).toBe('Continue to Home for the next session.');
    expect(COPY.nextAction.emptyBody).toBe('Browse your library while we wait for tomorrow’s session.');
  });

  it('leaves no game word in any learner string of the copy table', () => {
    const strings: string[] = [];
    for (const group of Object.values(COPY)) {
      for (const value of Object.values(group)) {
        if (typeof value === 'string') strings.push(value);
        else strings.push(String((value as (...args: number[]) => string)(2, 3)));
      }
    }
    expect(strings.filter((s) => JARGON.test(s))).toEqual([]);
  });

  it('builds a full-clear summary in plain words', () => {
    const { vm } = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 5,
      sessionLimit: 5,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 0, reservePulls: 0 },
      reward: {
        newCardPulls: 2,
        newCardUids: ['a', 'b'],
        dueClearPulls: 0,
        rewardPulls: 2,
        applied: 2,
        dropped: 0,
        walletBefore: { availablePulls: 0, reservePulls: 0 },
        walletAfter: { availablePulls: 2, reservePulls: 0 },
      },
    });

    expect(vm.title).toBe('Session complete 🎉');
    expect(vm.reward.title).toBe('Session reward');
    expect(vm.reward.badge).toBe('+2 draws');
    expect(vm.reward.pulls).toBe(2);
    expect(vm.reward.walletBefore).toEqual({ available: 0, reserve: 0 });
    expect(vm.reward.walletAfter).toEqual({ available: 2, reserve: 0 });
    expect(vm.reward.usePullsLabel).toBe('Use 2 draws');
    expect(vm.progress.body).toContain('5 / 5 cards · all due cards done');
    expect(vm.nextAction.body).toBe('Continue your day, then open Draw when you want to use your draws.');
    expect(vm.completionLabel).toBe('All due cards done');
    for (const text of [vm.title, vm.reward.title, vm.reward.body, vm.reward.badge, vm.progress.body, vm.nextAction.title, vm.nextAction.body, vm.nextActionLabel]) {
      expect(text).not.toMatch(JARGON);
    }
  });

  it('names the extra draws waiting when the saved draws overflow', () => {
    const { vm } = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 5,
      sessionLimit: 5,
      minimumGoal: 1,
      dueCount: 0,
      wallet: { availablePulls: 59, reservePulls: 0 },
      reward: {
        newCardPulls: 3,
        newCardUids: ['a', 'b', 'c'],
        dueClearPulls: 0,
        rewardPulls: 3,
        applied: 3,
        dropped: 0,
        walletBefore: { availablePulls: 59, reservePulls: 0 },
        walletAfter: { availablePulls: 60, reservePulls: 2 },
      },
    });

    expect(vm.reward.body).toBe('+3 draws · 3 new cards learned · 60 ready for this pack · 2 extra waiting');
    expect(vm.reward.walletAfter).toEqual({ available: 60, reserve: 2 });
  });

  it('says "session started" for a partial session', () => {
    const { vm } = buildSessionSummaryVM({
      deckTitle: 'C# Interview',
      sessionDone: 1,
      sessionLimit: 5,
      minimumGoal: 3,
      dueCount: 2,
      wallet: { availablePulls: 0, reservePulls: 0 },
      reward: null,
    });
    expect(vm.progress.body).toContain('1 / 5 cards · session started');
    expect(vm.nextAction.body).toBe('Continue to Home for the next session.');
    expect(vm.rewardBody).toBe('No free draws this session · 0 ready to use');
  });
});

describe('reward wallet message', () => {
  it('speaks of extra draws, not a reserve', () => {
    expect(
      getRewardWalletMessage({ availablePulls: 60, reservePulls: 2, appliedToAvailable: 0, appliedToReserve: 2, dropped: 0 }),
    ).toBe('60 ready · 2 extra waiting');
    expect(
      getRewardWalletMessage({ availablePulls: 60, reservePulls: 5, appliedToAvailable: 0, appliedToReserve: 0, dropped: 1 }),
    ).toBe('60 ready · extra draws full for now');
  });
});

describe('session route words', () => {
  it('titles the harder card and the last card in plain words', () => {
    const route = buildChallengeRoute({ slug: 'csharp', deckTitle: 'C# Interview', dueCount: 5, newCount: 0, ownedCount: 5 });
    const titles = route.nodes.map((n) => n.title).filter(Boolean);
    expect(titles).toContain('Harder recall');
    expect(titles).toContain('Final check');
    for (const n of route.nodes) {
      expect(n.title).not.toMatch(JARGON);
      expect(n.subtitle).not.toMatch(JARGON);
    }
    expect(route.summary).not.toMatch(JARGON);
  });

  it('labels the multiple-choice last-card button "Finish session"', () => {
    expect(MCQ_COPY.finishRun).toBe('Finish session');
  });
});

describe('milestones', () => {
  it('counts sessions, not runs', () => {
    const unlocked = resolveNewMilestones({
      before: snapshot({}),
      after: snapshot({ totalQualifiedSessions: 3, longestDailyStreak: 7, weekCompletedDays: 5 }),
    });
    expect(unlocked.map((m) => m.title)).toContain('Three clean sessions');
    expect(unlocked.find((m) => m.id === 'sessions-1')?.body).toBe(
      'You closed your first session that counted. Keep the loop small and repeatable.',
    );
    for (const m of unlocked) {
      expect(`${m.title} ${m.body}`).not.toMatch(/\b(run|runs|route|momentum|ceremony)\b/i);
    }
  });
});

describe('session screens', () => {
  it('the study session screen uses session words', () => {
    const src = screenSource('SessionCardScreen');
    expect(src).toContain("Alert.alert('Pause this session?'");
    expect(src).toContain('Preview session');
    expect(src).toContain('Session complete');
    expect(src).toContain('This session is complete. Continue to the summary for rewards and next steps.');
    expect(src).not.toMatch(/Pause this run\?|Preview run|Route complete|This run is complete|joins today’s run/);
  });

  it('the summary screen offers new draws, not pulls', () => {
    const src = screenSource('SessionSummaryScreen');
    expect(src).toContain("`Use ${earnedPulls} new ${earnedPulls === 1 ? 'draw' : 'draws'} now`");
    expect(src).not.toContain("'pull' : 'pulls'");
  });
});
