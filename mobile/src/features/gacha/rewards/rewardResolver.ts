import type { AppliedRewardWalletState, RewardWalletState } from './rewardWallet';
import { applyRewardToWallet, getRewardWalletMessage } from './rewardWallet';
import type { RatingRewardStep } from './sessionRewards';

// Duplicated here on purpose: rewardResolver must not import summaryMapper (the mapper
// imports the resolver, so the dependency runs one way only). COPY.reward.noPull
// (summaryMapper.ts:22) carries the same literal and stays unchanged.
const NO_PULL_LINE = 'No free pulls this run';

export type RewardOutcome = {
  newCardPulls: number;          // count of steps with newCardPaid
  newCardUids: string[];         // in pay order; length === newCardPulls
  dueClearPulls: 0 | 1;
  rewardPulls: number;           // newCardPulls + dueClearPulls
  applied: number;               // Σ appliedToAvailable + appliedToReserve
  dropped: number;               // Σ dropped (cap 60+5)
  walletBefore: RewardWalletState | null;   // first paying step's walletBefore
  walletAfter: RewardWalletState | null;    // last paying step's walletAfter
};

export const EMPTY_REWARD_OUTCOME: RewardOutcome = {
  newCardPulls: 0,
  newCardUids: [],
  dueClearPulls: 0,
  rewardPulls: 0,
  applied: 0,
  dropped: 0,
  walletBefore: null,
  walletAfter: null,
};

export function accumulateRewardOutcome(prev: RewardOutcome, step: RatingRewardStep, stableUid: string): RewardOutcome {
  const newCardPulls = prev.newCardPulls + (step.newCardPaid ? 1 : 0);
  const newCardUids = step.newCardPaid ? [...prev.newCardUids, stableUid] : prev.newCardUids;
  const dueClearPulls: 0 | 1 = prev.dueClearPulls === 1 || step.dueClearPaid ? 1 : 0;
  const applied = prev.applied + (step.applied ? step.applied.appliedToAvailable + step.applied.appliedToReserve : 0);
  const dropped = prev.dropped + (step.applied?.dropped ?? 0);

  return {
    newCardPulls,
    newCardUids,
    dueClearPulls,
    rewardPulls: newCardPulls + dueClearPulls,
    applied,
    dropped,
    walletBefore: prev.walletBefore ?? step.walletBefore,
    walletAfter: step.walletAfter ?? prev.walletAfter,
  };
}

/** Copy (economy-v2 §5):
 *  newCardPulls>0, dueClearPulls=0 → `+${n} pull${n===1?'':'s'} · ${n} new card${n===1?'':'s'} learned`
 *  newCardPulls=0, dueClearPulls=1 → `+1 · cleared today's due`
 *  both                            → `+${n+1} pulls · ${n} new card${n===1?'':'s'} learned · cleared today's due`
 *  none                            → 'No free pulls this run' (same literal as COPY.reward.noPull, summaryMapper.ts:22, unchanged) */
export function rewardLine(outcome: RewardOutcome): string {
  const n = outcome.newCardPulls;
  if (n > 0 && outcome.dueClearPulls === 0) {
    return `+${n} pull${n === 1 ? '' : 's'} · ${n} new card${n === 1 ? '' : 's'} learned`;
  }
  if (n === 0 && outcome.dueClearPulls === 1) {
    return `+1 · cleared today's due`;
  }
  if (n > 0 && outcome.dueClearPulls === 1) {
    return `+${n + 1} pulls · ${n} new card${n === 1 ? '' : 's'} learned · cleared today's due`;
  }
  return NO_PULL_LINE;
}

/** `+${rewardPulls} pull${…}` or 'Progress saved' — same shape as COPY.reward.badge (summaryMapper.ts:20). */
export function rewardBadge(outcome: RewardOutcome): string {
  const n = outcome.rewardPulls;
  return n > 0 ? `+${n} pull${n === 1 ? '' : 's'}` : 'Progress saved';
}

export type ResolvedSessionReward = {
  rewardPulls: number;
  completedMinimumGoal: boolean;   // sessionDone >= max(1, minimumGoal)  (unchanged, :41)
  completedFullRun: boolean;       // sessionLimit > 0 && sessionDone >= sessionLimit (unchanged, :42) — titles only, never pulls
  walletAfter: AppliedRewardWalletState;
  rewardMessage: string;           // `${rewardLine(outcome)} · ${getRewardWalletMessage(walletAfter)}`
  outcome: RewardOutcome;
};

/** `reward` absent/null → EMPTY_REWARD_OUTCOME (the route-complete Continue path, SessionCardScreen.tsx:682-690,
 *  and tests/p2-smoke.ts:127-147, which must keep compiling). walletAfter = applyRewardToWallet(wallet, 0) merged with
 *  outcome.walletAfter when present. */
export function resolveSessionReward(params: {
  sessionDone: number;
  sessionLimit: number;
  minimumGoal: number;
  wallet: RewardWalletState;
  reward?: RewardOutcome | null;
}): ResolvedSessionReward {
  const { sessionDone, sessionLimit, minimumGoal, wallet } = params;
  const outcome = params.reward ?? EMPTY_REWARD_OUTCOME;

  const safeSessionDone = Math.max(0, Math.floor(sessionDone));
  const safeSessionLimit = Math.max(0, Math.floor(sessionLimit));
  const safeMinimumGoal = Math.max(1, Math.floor(minimumGoal));
  const completedMinimumGoal = safeSessionDone >= safeMinimumGoal;
  const completedFullRun = safeSessionLimit > 0 && safeSessionDone >= safeSessionLimit;
  const rewardPulls = outcome.rewardPulls;

  const base = applyRewardToWallet(wallet, 0);
  let walletAfter: AppliedRewardWalletState = base;
  if (outcome.walletAfter != null) {
    const appliedToReserve = Math.max(
      0,
      outcome.walletAfter.reservePulls - (outcome.walletBefore ?? wallet).reservePulls,
    );
    const appliedToAvailable = Math.max(0, outcome.applied - appliedToReserve);
    walletAfter = {
      availablePulls: outcome.walletAfter.availablePulls,
      reservePulls: outcome.walletAfter.reservePulls,
      appliedToReserve,
      appliedToAvailable,
      dropped: outcome.dropped,
    };
  }

  const rewardMessage = `${rewardLine(outcome)} · ${getRewardWalletMessage(walletAfter)}`;

  return {
    rewardPulls,
    completedMinimumGoal,
    completedFullRun,
    walletAfter,
    rewardMessage,
    outcome,
  };
}
