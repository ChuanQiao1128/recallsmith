import type { RoutePreviewNode } from '../contracts';
import type { RewardWalletState } from '../rewards/rewardWallet';
import type { StreakSnapshot } from '../streaks/streakTracker';
import {
  buildHomeScreenVM,
  type HomeRuntimeStatus,
  type HomeViewModel,
} from '../selectors/homeSelectors';
import { formatDateKey } from '../../../review/model';
import type { HomeDeckSummarySnapshot } from './deckActionResolver';

/**
 * Coalesces overlapping refreshes into a single in-flight run plus at most one
 * trailing run. This is what stops Home's mount (focus effect + auth effect)
 * and its rapid-fire callers (tile taps, auto-update completions) from running
 * two or three full refreshes on top of each other.
 *
 * Semantics:
 * - A call while idle starts a run and resolves when that run settles.
 * - A call while a run is in flight schedules exactly one trailing run; any
 *   further calls in the same window join that same trailing run. The returned
 *   promise resolves after the trailing run settles.
 * - The returned promises always resolve (a task rejection is swallowed), and
 *   the runner keeps working after a rejected task.
 */
export function createCoalescedRunner(task: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let trailing: Promise<void> | null = null;

  const startRun = (): Promise<void> => {
    // Rejections are swallowed here so a failed task never rejects a caller's
    // promise and never wedges the runner: the next call starts cleanly.
    const run = Promise.resolve()
      .then(task)
      .then(
        () => undefined,
        () => undefined,
      );
    inFlight = run;
    // Registered before any trailing continuation, so it always runs first and
    // only clears the slot if this is still the current run.
    void run.then(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  };

  return function coalescedRun(): Promise<void> {
    if (!inFlight) {
      return startRun();
    }
    if (!trailing) {
      trailing = inFlight.then(() => {
        trailing = null;
        return startRun();
      });
    }
    return trailing;
  };
}

export type HomeVmInputs = {
  summary: HomeDeckSummarySnapshot;
  wallet: RewardWalletState;
  streak: StreakSnapshot;
};

type HomeSessionInputs = {
  slug: string | null;
  startedAt: number | null;
  completedCount: number;
  route: RoutePreviewNode[];
};

/**
 * Pure construction of Home's ready view model from inputs already in hand.
 * Identical inputs produce an identical VM. Does no I/O and starts no
 * auto-updates -- HomeScreen owns those side effects so a pack-tile tap can
 * rebuild the VM locally without touching storage or the network.
 */
export function buildReadyHomeVm(params: {
  inputs: HomeVmInputs;
  selectedSlug: string | null;
  session: HomeSessionInputs;
  isSignedIn: boolean;
  premium: boolean;
  updatingSlugs: string[];
}): HomeViewModel {
  const { inputs, selectedSlug, session, isSignedIn, premium, updatingSlugs } = params;
  const { summary, wallet, streak } = inputs;

  const activeSlug = selectedSlug ?? summary.deckSummaries[0]?.slug ?? null;
  const now = new Date(summary.asOfISO);
  const todayKey = formatDateKey(now);
  const sessionStartDay =
    typeof session.startedAt === 'number' && session.startedAt > 0
      ? formatDateKey(new Date(session.startedAt))
      : null;
  const sameDeckSession =
    !!activeSlug && session.slug === activeSlug && sessionStartDay === todayKey;
  const runtimeStatus: HomeRuntimeStatus = {
    qualifiedToday: streak.lastQualifiedDateKey === todayKey,
    completedToday: sameDeckSession ? session.completedCount : 0,
    completedRouteToday:
      sameDeckSession &&
      session.route.length > 0 &&
      session.completedCount >= session.route.length,
  };

  return buildHomeScreenVM({
    state: 'ready',
    params: {
      deckSummaries: summary.deckSummaries,
      selectedSlug: activeSlug,
      hasSignedInUser: isSignedIn,
      wallet,
      updates: summary.updates,
      allUpcoming30: summary.allUpcoming30,
      premium,
      accountLockup: isSignedIn
        ? null
        : 'Sign in to unlock cloud backup and month planning.',
      runtimeStatus,
      updatingSlugs,
    },
  });
}
