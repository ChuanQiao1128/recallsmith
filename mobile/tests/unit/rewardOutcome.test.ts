import { describe, expect, it } from 'vitest';
import {
  accumulateRewardOutcome,
  EMPTY_REWARD_OUTCOME,
  rewardBadge,
  rewardLine,
  resolveSessionReward,
  type RewardOutcome,
} from '../../src/features/gacha/rewards/rewardResolver';
import { applyRewardToWallet } from '../../src/features/gacha/rewards/rewardWallet';
import type { RatingRewardStep } from '../../src/features/gacha/rewards/sessionRewards';

function outcome(partial: Partial<RewardOutcome>): RewardOutcome {
  return { ...EMPTY_REWARD_OUTCOME, ...partial };
}

describe('rewardOutcome', () => {
  it('accumulates steps into an outcome', () => {
    const paid: RatingRewardStep = {
      newCardPaid: true,
      dueClearPaid: false,
      pulls: 1,
      walletBefore: { availablePulls: 0, reservePulls: 0 },
      walletAfter: { availablePulls: 1, reservePulls: 0 },
      applied: { availablePulls: 1, reservePulls: 0, appliedToAvailable: 1, appliedToReserve: 0, dropped: 0 },
      newCardsLearnedToday: 1,
    };
    const zero: RatingRewardStep = {
      newCardPaid: false,
      dueClearPaid: false,
      pulls: 0,
      walletBefore: null,
      walletAfter: null,
      applied: null,
      newCardsLearnedToday: 1,
    };
    const dueClear: RatingRewardStep = {
      newCardPaid: false,
      dueClearPaid: true,
      pulls: 1,
      walletBefore: { availablePulls: 1, reservePulls: 0 },
      walletAfter: { availablePulls: 2, reservePulls: 0 },
      applied: { availablePulls: 2, reservePulls: 0, appliedToAvailable: 1, appliedToReserve: 0, dropped: 0 },
      newCardsLearnedToday: 1,
    };

    let acc = accumulateRewardOutcome(EMPTY_REWARD_OUTCOME, paid, 'u1');
    acc = accumulateRewardOutcome(acc, zero, 'u2');
    acc = accumulateRewardOutcome(acc, dueClear, 'u3');

    expect(acc.newCardPulls).toBe(1);
    expect(acc.newCardUids).toEqual(['u1']);
    expect(acc.dueClearPulls).toBe(1);
    expect(acc.rewardPulls).toBe(2);
    expect(acc.applied).toBe(2);
    expect(acc.dropped).toBe(0);
    expect(acc.walletBefore).toEqual({ availablePulls: 0, reservePulls: 0 });
    expect(acc.walletAfter).toEqual({ availablePulls: 2, reservePulls: 0 });
  });

  it('renders the four reward lines verbatim', () => {
    expect(rewardLine(outcome({ newCardPulls: 1, dueClearPulls: 0 }))).toBe('+1 pull · 1 new card learned');
    expect(rewardLine(outcome({ newCardPulls: 3, dueClearPulls: 0 }))).toBe('+3 pulls · 3 new cards learned');
    expect(rewardLine(outcome({ newCardPulls: 0, dueClearPulls: 1 }))).toBe("+1 · cleared today's due");
    expect(rewardLine(outcome({ newCardPulls: 3, dueClearPulls: 1 }))).toBe(
      "+4 pulls · 3 new cards learned · cleared today's due",
    );
    expect(rewardLine(EMPTY_REWARD_OUTCOME)).toBe('No free pulls this run');

    expect(rewardBadge(outcome({ rewardPulls: 2 }))).toBe('+2 pulls');
    expect(rewardBadge(EMPTY_REWARD_OUTCOME)).toBe('Progress saved');
  });

  it('resolves a session reward from an outcome and from no outcome', () => {
    const wallet = { availablePulls: 3, reservePulls: 0 };
    const empty = resolveSessionReward({ sessionDone: 0, sessionLimit: 4, minimumGoal: 1, wallet, reward: null });
    expect(empty.rewardPulls).toBe(0);
    expect(empty.walletAfter).toEqual(applyRewardToWallet(wallet, 0));

    const resolved = resolveSessionReward({
      sessionDone: 4,
      sessionLimit: 4,
      minimumGoal: 1,
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
    expect(resolved.walletAfter.availablePulls).toBe(60);
    expect(resolved.rewardMessage).toBe('+1 pull · 1 new card learned · 60 ready to use');
    expect(resolved.completedFullRun).toBe(true);

    const partial = resolveSessionReward({
      sessionDone: 2,
      sessionLimit: 4,
      minimumGoal: 1,
      wallet: { availablePulls: 0, reservePulls: 0 },
      reward: null,
    });
    expect(partial.completedFullRun).toBe(false);
  });
});
