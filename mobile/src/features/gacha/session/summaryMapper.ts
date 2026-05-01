import type { ResolvedSessionReward } from '../rewards/rewardResolver';
import { resolveSessionReward } from '../rewards/rewardResolver';
import type { RewardWalletState } from '../rewards/rewardWallet';

export type SessionSummaryVM = {
  title: string;
  subtitle: string;
  rewardTitle: string;
  rewardBody: string;
  rewardBadge: string;
  completionLabel: string;
  progressBody: string;
  nextActionLabel: string;
  secondaryActionLabel: string;
};

export function buildSessionSummaryVM(params: {
  deckTitle: string;
  sessionDone: number;
  sessionLimit: number;
  minimumGoal: number;
  dueCount: number;
  wallet?: RewardWalletState | null;
}): { vm: SessionSummaryVM; resolvedReward: ResolvedSessionReward } {
  const { deckTitle, sessionDone, sessionLimit, minimumGoal, dueCount, wallet } = params;
  const resolvedReward = resolveSessionReward({
    sessionDone,
    sessionLimit,
    minimumGoal,
    wallet: wallet ?? { availablePulls: 0, reservePulls: 0 },
  });

  const completionLabel = resolvedReward.completedFullRun
    ? 'Full run cleared'
    : resolvedReward.completedMinimumGoal
      ? 'Minimum goal cleared'
      : 'Practice progress saved';

  const rewardBadge =
    resolvedReward.rewardPulls > 0
      ? `+${resolvedReward.rewardPulls} pull${resolvedReward.rewardPulls === 1 ? '' : 's'}`
      : 'Progress saved';

  const vm: SessionSummaryVM = {
    title: resolvedReward.completedFullRun ? 'Run complete 🎉' : 'Good progress today',
    subtitle: `${deckTitle} · ${sessionDone}/${sessionLimit || '∞'} cleared`,
    rewardTitle: resolvedReward.completedFullRun ? 'Full clear reward' : 'Today’s reward',
    rewardBody:
      wallet == null
        ? resolvedReward.rewardPulls > 0
          ? `+${resolvedReward.rewardPulls} free pull${resolvedReward.rewardPulls === 1 ? '' : 's'} earned for this run.`
          : 'Progress saved for this run.'
        : resolvedReward.rewardMessage,
    rewardBadge,
    completionLabel,
    progressBody: `${sessionDone} node${sessionDone === 1 ? '' : 's'} cleared · ${dueCount} due card${dueCount === 1 ? '' : 's'} were in today’s queue`,
    nextActionLabel: resolvedReward.completedFullRun ? 'Back to home' : 'Keep momentum',
    secondaryActionLabel: 'Open library',
  };

  return { vm, resolvedReward };
}
