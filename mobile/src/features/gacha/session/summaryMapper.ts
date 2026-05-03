import { FREE_PULL_CAP } from '../constants';
import type { HomeCtaKind } from '../selectors/homeSelectors';
import type { ResolvedSessionReward } from '../rewards/rewardResolver';
import { resolveSessionReward } from '../rewards/rewardResolver';
import type { RewardWalletState } from '../rewards/rewardWallet';

export const COPY = {
  title: {
    fullClear: 'Run complete 🎉',
    progress: 'Good progress today',
  },
  completion: {
    fullClear: "Cleared today's run.",
    minimum: 'You kept the streak.',
    partial: 'Progress logged for today.',
  },
  reward: {
    sectionFullClear: 'Full clear reward',
    sectionProgress: "Today's reward",
    sectionNoReward: 'Session update',
    badge: (pulls: number) => (pulls > 0 ? `+${pulls} pull${pulls === 1 ? '' : 's'}` : 'Progress saved'),
    gained: (pulls: number) => `+${pulls} free pull${pulls === 1 ? '' : 's'} added`,
    noPull: 'No free pulls this run',
    walletReady: (available: number) => `${available} ready to use`,
    walletReserve: (available: number, reserve: number) => `${available} ready · ${reserve} pending in reserve`,
    walletFull: (reserve: number) => `Free pulls full · ${reserve} pending in reserve`,
  },
  progress: {
    fullClearLabel: (done: number, total: number) => `${done} / ${total} cards · full clear`,
    minimumLabel: (done: number, total: number) => `${done} / ${total} cards · streak saved`,
    partialLabel: (done: number, total: number) => `${done} / ${total} cards · route started`,
    queueLabel: (dueCount: number) => `${dueCount} due card${dueCount === 1 ? '' : 's'} in today's queue`,
    streakRise: (before: number, after: number) => `🔥 ${before} → ${after}`,
    streakHold: (value: number) => `🔥 ${value}`,
    transitionsLabel: (newToLearning: number, learningToMastered: number) =>
      `${newToLearning} cards entered Learning · ${learningToMastered} cards mastered`,
  },
  nextAction: {
    continue: 'Continue',
    openLibrary: 'Open library',
    backHome: 'Back home',
  },
} as const;

export type SessionSummaryVM = {
  reward: {
    title: string;
    body: string;
    badge: string;
    pulls: number;
    walletBefore: { available: number; reserve: number };
    walletAfter: { available: number; reserve: number };
    fullClear: boolean;
    minimumGoalMet: boolean;
    usePullsLabel: string | null;
  };
  progress: {
    done: number;
    total: number;
    completionLabel: string;
    body: string;
    streakNote: string | null;
    transitionsNote: string | null;
    transitions: {
      newToLearning: number;
      learningToMastered: number;
    };
  };
  nextAction: {
    primary: { label: string; kind: HomeCtaKind };
    secondary: { label: string; kind: HomeCtaKind } | null;
  };

  // Legacy flat fields kept for compatibility with existing tests.
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

function resolveWalletLine(walletAfter: {
  availablePulls: number;
  reservePulls: number;
  dropped?: number;
}): string {
  if ((walletAfter.dropped ?? 0) > 0) {
    return COPY.reward.walletFull(walletAfter.reservePulls);
  }
  if (walletAfter.reservePulls > 0) {
    return COPY.reward.walletReserve(walletAfter.availablePulls, walletAfter.reservePulls);
  }
  return COPY.reward.walletReady(walletAfter.availablePulls);
}

function resolvePrimaryAction(params: {
  dueCount: number;
  resolvedReward: ResolvedSessionReward;
}): { label: string; kind: HomeCtaKind } {
  const { dueCount, resolvedReward } = params;

  if (resolvedReward.completedFullRun) {
    return { label: COPY.nextAction.continue, kind: 'today_full_clear' };
  }

  if (resolvedReward.completedMinimumGoal || dueCount > 0) {
    return { label: COPY.nextAction.continue, kind: 'today_done' };
  }

  return { label: COPY.nextAction.openLibrary, kind: 'nothing_to_learn' };
}

export function buildSessionSummaryVM(params: {
  deckTitle: string;
  sessionDone: number;
  sessionLimit: number;
  minimumGoal: number;
  dueCount: number;
  wallet?: RewardWalletState | null;
  streakBefore?: number | null;
  streakAfter?: number | null;
  transitions?: {
    newToLearning: number;
    learningToMastered: number;
  };
}): { vm: SessionSummaryVM; resolvedReward: ResolvedSessionReward } {
  const {
    deckTitle,
    sessionDone,
    sessionLimit,
    minimumGoal,
    dueCount,
    wallet,
    streakBefore = null,
    streakAfter = null,
    transitions,
  } = params;

  const resolvedReward = resolveSessionReward({
    sessionDone,
    sessionLimit,
    minimumGoal,
    wallet: wallet ?? { availablePulls: 0, reservePulls: 0 },
  });

  const completionLabel = resolvedReward.completedFullRun
    ? COPY.completion.fullClear
    : resolvedReward.completedMinimumGoal
      ? COPY.completion.minimum
      : COPY.completion.partial;

  const legacyCompletionLabel = resolvedReward.completedFullRun
    ? 'Full run cleared'
    : resolvedReward.completedMinimumGoal
      ? 'Minimum goal cleared'
      : 'Practice progress saved';

  const rewardTitle = resolvedReward.completedFullRun
    ? COPY.reward.sectionFullClear
    : resolvedReward.completedMinimumGoal
      ? COPY.reward.sectionProgress
      : COPY.reward.sectionNoReward;

  const rewardLine = resolvedReward.rewardPulls > 0 ? COPY.reward.gained(resolvedReward.rewardPulls) : COPY.reward.noPull;
  const walletLine = resolveWalletLine(resolvedReward.walletAfter);
  const legacyRewardBody =
    wallet == null
      ? resolvedReward.rewardPulls > 0
        ? `+${resolvedReward.rewardPulls} free pull${resolvedReward.rewardPulls === 1 ? '' : 's'} earned for this run.`
        : 'Progress saved for this run.'
      : resolvedReward.rewardMessage;

  const total = sessionLimit > 0 ? sessionLimit : Math.max(1, sessionDone);
  const progressBody = resolvedReward.completedFullRun
    ? COPY.progress.fullClearLabel(sessionDone, total)
    : resolvedReward.completedMinimumGoal
      ? COPY.progress.minimumLabel(sessionDone, total)
      : COPY.progress.partialLabel(sessionDone, total);

  const streakNote =
    streakBefore != null && streakAfter != null
      ? streakAfter > streakBefore
        ? COPY.progress.streakRise(streakBefore, streakAfter)
        : COPY.progress.streakHold(streakAfter)
      : null;

  const transitionSummary = {
    newToLearning: Math.max(0, Math.floor(transitions?.newToLearning ?? 0)),
    learningToMastered: Math.max(0, Math.floor(transitions?.learningToMastered ?? 0)),
  };

  const transitionsNote =
    transitionSummary.newToLearning > 0 || transitionSummary.learningToMastered > 0
      ? COPY.progress.transitionsLabel(transitionSummary.newToLearning, transitionSummary.learningToMastered)
      : null;

  const primaryAction = resolvePrimaryAction({ dueCount, resolvedReward });
  const secondaryAction = { label: COPY.nextAction.backHome, kind: 'today_done' as HomeCtaKind };

  const vm: SessionSummaryVM = {
    reward: {
      title: rewardTitle,
      body: `${rewardLine} · ${walletLine}`,
      badge: COPY.reward.badge(resolvedReward.rewardPulls),
      pulls: resolvedReward.rewardPulls,
      walletBefore: {
        available: wallet?.availablePulls ?? 0,
        reserve: wallet?.reservePulls ?? 0,
      },
      walletAfter: {
        available: resolvedReward.walletAfter.availablePulls,
        reserve: resolvedReward.walletAfter.reservePulls,
      },
      fullClear: resolvedReward.completedFullRun,
      minimumGoalMet: resolvedReward.completedMinimumGoal,
      usePullsLabel:
        resolvedReward.walletAfter.availablePulls > 0
          ? `Use ${resolvedReward.walletAfter.availablePulls} pull${resolvedReward.walletAfter.availablePulls === 1 ? '' : 's'}`
          : null,
    },
    progress: {
      done: sessionDone,
      total,
      completionLabel,
      body: `${progressBody} · ${COPY.progress.queueLabel(dueCount)}`,
      streakNote,
      transitionsNote,
      transitions: transitionSummary,
    },
    nextAction: {
      primary: primaryAction,
      secondary: secondaryAction,
    },

    title: resolvedReward.completedFullRun ? COPY.title.fullClear : COPY.title.progress,
    subtitle: `${deckTitle} · ${sessionDone}/${sessionLimit || '∞'} cleared`,
    rewardTitle,
    rewardBody: legacyRewardBody,
    rewardBadge: COPY.reward.badge(resolvedReward.rewardPulls),
    completionLabel: legacyCompletionLabel,
    progressBody: `${progressBody} · ${COPY.progress.queueLabel(dueCount)}`,
    nextActionLabel: resolvedReward.completedFullRun ? 'Back to home' : 'Keep momentum',
    secondaryActionLabel: secondaryAction.label,
  };

  return { vm, resolvedReward };
}
