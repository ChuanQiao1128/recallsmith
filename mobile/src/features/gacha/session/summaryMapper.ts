import type { HomeCtaKind } from '../selectors/homeSelectors';
import {
  EMPTY_REWARD_WALLET,
  rewardLine as buildRewardLine,
  resolveSessionReward,
  summaryRewardCounts,
  walletLineCounts,
} from '../rewards/rewardResolver';
import type { ResolvedSessionReward, RewardOutcome, SummaryRewardCounts } from '../rewards/rewardResolver';
import type { RewardWalletState } from '../rewards/rewardWallet';

export const COPY = {
  title: {
    fullClear: 'Session complete 🎉',
    progress: 'Good progress today',
    // sessionDone 0: nothing was rated, so neither "progress" nor "complete"
    // is true. Same words as nextAction.emptyTitle so the hero and the
    // action card stop contradicting each other on a session that never dealt.
    none: 'No session logged yet',
  },
  completion: {
    fullClear: 'Cleared today’s session.',
    minimum: 'You kept the streak.',
    partial: 'Progress logged for today.',
    none: 'Nothing reviewed this time.',
  },
  reward: {
    sectionFullClear: 'Session reward',
    sectionProgress: "Today's reward",
    sectionNoReward: 'Session update',
    badge: (count: number) => (count > 0 ? `+${count} draw${count === 1 ? '' : 's'}` : 'Progress saved'),
    noPull: 'No free draws this session',
    walletReady: (available: number) => `${available} ready for this pack`,
    walletReserve: (available: number, waiting: number) => `${available} ready for this pack · ${waiting} extra waiting`,
    walletFull: (waiting: number) => `Saved draws full · ${waiting} extra waiting`,
    useDraws: (available: number) => `Use ${available} draw${available === 1 ? '' : 's'}`,
  },
  progress: {
    fullClearLabel: (done: number, total: number) => `${done} / ${total} cards · all due cards done`,
    minimumLabel: (done: number, total: number) => `${done} / ${total} cards · streak saved`,
    partialLabel: (done: number, total: number) => `${done} / ${total} cards · session started`,
    noneLabel: (total: number) => (total > 0 ? `0 / ${total} cards · not started` : 'No cards to review yet'),
    queueLabel: (dueCount: number) => `${dueCount} due card${dueCount === 1 ? '' : 's'} in today's queue`,
    streakRise: (before: number, after: number) => `🔥 ${before} → ${after}`,
    streakHold: (value: number) => `🔥 ${value}`,
    transitionsLabel: (newToLearning: number, learningToMastered: number) =>
      `${newToLearning} cards entered Learning · ${learningToMastered} cards mastered`,
  },
  nextAction: {
    fullClearTitle: 'Cleared today. What now?',
    streakSavedTitle: 'Streak saved. Keep moving?',
    progressTitle: 'Progress saved. Keep going?',
    emptyTitle: 'No session logged yet',
    libraryTitle: 'Library is ready',
    drawBody: 'Continue your day, then open Draw when you want to use your draws.',
    homeBody: 'Continue to Home for the next session.',
    libraryBody: "Browse your library to review today's updates.",
    emptyBody: 'Browse your library while we wait for tomorrow’s session.',
    continue: 'Continue',
    openLibrary: 'Open library',
    backHome: 'Back home',
  },
} as const;

export type SessionSummaryVM = {
  reward: SummaryRewardCounts & {
    title: string;
    body: string;
    badge: string;
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
    title: string;
    body: string;
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

function resolveWalletLine(walletAfter: ResolvedSessionReward['walletAfter']): string {
  const { ready, waiting, dropped } = walletLineCounts(walletAfter);
  if (dropped > 0) {
    return COPY.reward.walletFull(waiting);
  }
  if (waiting > 0) {
    return COPY.reward.walletReserve(ready, waiting);
  }
  return COPY.reward.walletReady(ready);
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

// The secondary link is always the destination the primary does not already
// offer. "Back home" under a primary that goes Home (the "Continue" kinds, and
// the demoted "Back to Home" the screen shows next to the reward callout) was
// the same tap twice with two labels; under "Open library" it is the one
// other place to go, and the library is that other place otherwise.
export function resolveSecondaryAction(params: {
  primaryGoesHome: boolean;
}): { label: string; kind: HomeCtaKind } {
  return params.primaryGoesHome
    ? { label: COPY.nextAction.openLibrary, kind: 'nothing_to_learn' }
    : { label: COPY.nextAction.backHome, kind: 'today_done' };
}

export function primaryActionGoesHome(kind: HomeCtaKind): boolean {
  return kind !== 'nothing_to_learn' && kind !== 'wallet_full';
}

function resolveNextActionCopy(params: {
  resolvedReward: ResolvedSessionReward;
  hasActivity: boolean;
  primaryKind: HomeCtaKind;
}): { title: string; body: string } {
  const { resolvedReward, hasActivity, primaryKind } = params;

  if (!hasActivity) {
    return { title: COPY.nextAction.emptyTitle, body: COPY.nextAction.emptyBody };
  }

  if (primaryKind === 'nothing_to_learn') {
    return { title: COPY.nextAction.libraryTitle, body: COPY.nextAction.libraryBody };
  }

  if (resolvedReward.completedFullRun) {
    return { title: COPY.nextAction.fullClearTitle, body: COPY.nextAction.drawBody };
  }

  if (resolvedReward.completedMinimumGoal) {
    return { title: COPY.nextAction.streakSavedTitle, body: COPY.nextAction.homeBody };
  }

  return { title: COPY.nextAction.progressTitle, body: COPY.nextAction.homeBody };
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
  reward?: RewardOutcome | null;
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
    reward,
  } = params;

  const resolvedReward = resolveSessionReward({
    sessionDone,
    sessionLimit,
    minimumGoal,
    wallet: wallet ?? EMPTY_REWARD_WALLET,
    reward: reward ?? null,
  });
  const outcome = resolvedReward.outcome;

  // A session with nothing rated. Reachable from an empty deck (planner limit 0,
  // see sessionBuilder.EMPTY_ROUTE_LIMIT) and from any session-complete Continue
  // pressed before the first rating; both used to read "Good progress today ·
  // 0/1 cleared" next to "No session logged yet".
  const noRun = sessionDone <= 0;

  const completionLabel = noRun
    ? COPY.completion.none
    : resolvedReward.completedFullRun
      ? COPY.completion.fullClear
      : resolvedReward.completedMinimumGoal
        ? COPY.completion.minimum
        : COPY.completion.partial;

  const legacyCompletionLabel = noRun
    ? 'No cards reviewed'
    : resolvedReward.completedFullRun
      ? 'All due cards done'
      : resolvedReward.completedMinimumGoal
        ? 'Minimum goal cleared'
        : 'Practice progress saved';

  const rewardTitle = resolvedReward.completedFullRun
    ? COPY.reward.sectionFullClear
    : resolvedReward.completedMinimumGoal
      ? COPY.reward.sectionProgress
      : COPY.reward.sectionNoReward;

  const rewardLine = buildRewardLine(outcome);
  const walletLine = resolveWalletLine(resolvedReward.walletAfter);
  const legacyRewardBody =
    wallet == null
      ? resolvedReward.rewardPulls > 0
        ? rewardLine
        : 'Progress saved for this session.'
      : resolvedReward.rewardMessage;

  // No Math.max(1, …): a limit of 0 with nothing done is an empty deck, and
  // "0 / 1" invented a card that does not exist. Unlimited sessions (limit 0,
  // done > 0) still read done / done as before.
  const total = sessionLimit > 0 ? sessionLimit : Math.max(0, sessionDone);
  const progressBody = noRun
    ? COPY.progress.noneLabel(total)
    : resolvedReward.completedFullRun
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
  const secondaryAction = resolveSecondaryAction({
    primaryGoesHome: primaryActionGoesHome(primaryAction.kind),
  });
  const nextActionCopy = resolveNextActionCopy({
    resolvedReward,
    hasActivity: sessionDone > 0 || dueCount > 0 || resolvedReward.rewardPulls > 0 || (streakAfter ?? 0) > 0,
    primaryKind: primaryAction.kind,
  });

  const vm: SessionSummaryVM = {
    reward: {
      title: rewardTitle,
      body: `${rewardLine} · ${walletLine}`,
      badge: COPY.reward.badge(resolvedReward.rewardPulls),
      ...summaryRewardCounts(resolvedReward, wallet),
      fullClear: resolvedReward.completedFullRun,
      minimumGoalMet: resolvedReward.completedMinimumGoal,
      usePullsLabel:
        resolvedReward.walletAfter.availablePulls > 0
          ? COPY.reward.useDraws(resolvedReward.walletAfter.availablePulls)
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
      title: nextActionCopy.title,
      body: nextActionCopy.body,
      primary: primaryAction,
      secondary: secondaryAction,
    },

    title: noRun ? COPY.title.none : resolvedReward.completedFullRun ? COPY.title.fullClear : COPY.title.progress,
    subtitle: noRun
      ? `${deckTitle} · no cards reviewed`
      : `${deckTitle} · ${sessionDone}/${sessionLimit || '∞'} cleared`,
    rewardTitle,
    rewardBody: legacyRewardBody,
    rewardBadge: COPY.reward.badge(resolvedReward.rewardPulls),
    completionLabel: legacyCompletionLabel,
    progressBody: `${progressBody} · ${COPY.progress.queueLabel(dueCount)}`,
    nextActionLabel: resolvedReward.completedFullRun ? 'Back to home' : 'Keep going',
    secondaryActionLabel: secondaryAction.label,
  };

  return { vm, resolvedReward };
}
