import {
  FREE_PULL_CAP,
  FREE_PULL_OVERFLOW_CAP,
  SESSION_MAIN_ROUTE_DEFAULT,
  SESSION_MIN_GOAL,
} from '../constants';
import type {
  CalendarDay,
  DeckSummary,
  HomeVM as LegacyHomeVM,
  RoutePreviewNode,
  TodayCounts,
} from '../contracts';
import type { UpdateInfo } from '../../../content/deckRepository';
import type { RewardWalletState } from '../rewards/rewardWallet';

export type HomeCtaKind =
  | 'first_run'
  | 'today_pending'
  | 'today_partial'
  | 'today_done'
  | 'today_full_clear'
  | 'due_only'
  | 'nothing_to_learn'
  | 'wallet_full'
  | 'error';

export type HomeCtaNav = 'challenge' | 'deck' | 'library' | 'draw' | 'none' | 'retry';

export type HomeDrawState = 'locked' | 'available' | 'reserve' | 'wallet-full';

export type HomeDeckActionHint =
  | 'open'
  | 'install'
  | 'update'
  | 'trial-start'
  | 'paywall'
  | 'none';

export type HomeDeckVM = {
  deck: DeckSummary;
  statusLabel: string;
  progressLabel: string;
  actionHint: HomeDeckActionHint;
  updateInfo: UpdateInfo | null;
  isSelected: boolean;
};

export type HomeCalendarCompact = {
  next7: CalendarDay[];
  maxCount: number;
};

export type HomeGoalVM = {
  minimum: string;
  fullClear: string;
};

export type HomeCtaVM = {
  kind: HomeCtaKind;
  label: string;
  nav: HomeCtaNav;
  testID: 'home-primary-cta';
  disabled: boolean;
};

export type HomeRuntimeStatus = {
  qualifiedToday: boolean;
  completedToday: number;
  completedRouteToday: boolean;
};

export type HomeDrawVM = {
  state: HomeDrawState;
  label: string;
};

export type HomeViewModel = LegacyHomeVM & {
  statusKind: HomeCtaKind;
  hero: LegacyHomeVM['hero'] & {
    headline: string;
    subline: string;
  };
  goal: HomeGoalVM;
  cta: HomeCtaVM;
  draw: HomeDrawVM;
  decks: {
    rows: HomeDeckVM[];
    defaultOpen: boolean;
  };
  calendar: {
    compact: HomeCalendarCompact;
    defaultOpen: false;
  };
  account: {
    lockup: string | null;
  };
  errorMessage: string | null;
  selectedDeckSlug: string | null;
};

function buildRoutePreview(selectedDeck: DeckSummary | null): RoutePreviewNode[] {
  if (!selectedDeck || !selectedDeck.canStudy) {
    return [
      {
        id: 'empty',
        role: 'warmup',
        title: 'No active route yet',
        subtitle: 'Install or unlock a deck first, then today’s route will appear here.',
      },
    ];
  }

  const due = selectedDeck.dueToday;
  const fresh = Math.min(selectedDeck.newToday, 2);
  const total = Math.max(
    1,
    Math.min(
      SESSION_MAIN_ROUTE_DEFAULT,
      Math.max(due, 1) + (due === 0 ? fresh : Math.min(fresh, 1)),
    ),
  );
  const hasBoss = due >= 3;
  const hasElite = due >= 2 || fresh >= 1;

  const nodes: RoutePreviewNode[] = [];

  for (let i = 0; i < total; i++) {
    const isFirst = i === 0;
    const isLast = i === total - 1;
    const role = isFirst
      ? 'warmup'
      : isLast && hasBoss
        ? 'boss'
        : hasElite && i === total - 2
          ? 'elite'
          : 'normal';

    const title =
      role === 'warmup'
        ? 'Warm-up node'
        : role === 'boss'
          ? 'Boss check'
          : role === 'elite'
            ? 'Elite review'
            : 'Normal node';

    const subtitle =
      role === 'warmup'
        ? 'Low-friction first win to keep momentum.'
        : role === 'boss'
          ? 'A tougher recall check to close the run.'
          : role === 'elite'
            ? 'One higher-pressure card in the middle.'
            : 'Standard recall / learning step.';

    nodes.push({ id: `${role}-${i}`, role, title, subtitle });
  }

  return nodes;
}

function buildCounts(deckSummaries: DeckSummary[], selectedDeck: DeckSummary | null): TodayCounts {
  const totalDueAllDecks = deckSummaries.reduce(
    (sum, deck) => sum + (deck.canStudy ? deck.dueToday : 0),
    0,
  );

  const routePreview = buildRoutePreview(selectedDeck);
  const normalCount = routePreview.filter(
    (node) => node.role === 'warmup' || node.role === 'normal',
  ).length;
  const eliteCount = routePreview.filter((node) => node.role === 'elite').length;
  const bossCount = routePreview.filter((node) => node.role === 'boss').length;

  return {
    totalDueAllDecks,
    selectedDue: selectedDeck?.dueToday ?? 0,
    selectedNew: selectedDeck?.newToday ?? 0,
    selectedMastered: selectedDeck?.masteredApprox ?? 0,
    normalCount,
    eliteCount,
    bossCount,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toWalletState(wallet?: RewardWalletState | null): RewardWalletState {
  return {
    availablePulls: Math.max(0, Number(wallet?.availablePulls ?? 0) || 0),
    reservePulls: Math.max(0, Number(wallet?.reservePulls ?? 0) || 0),
  };
}

function buildDrawVM(wallet?: RewardWalletState | null): HomeDrawVM {
  const safeWallet = toWalletState(wallet);

  if (
    safeWallet.availablePulls >= FREE_PULL_CAP &&
    safeWallet.reservePulls >= FREE_PULL_OVERFLOW_CAP
  ) {
    return {
      state: 'wallet-full',
      label: `Wallet full (${FREE_PULL_CAP} + ${FREE_PULL_OVERFLOW_CAP})`,
    };
  }

  if (safeWallet.reservePulls > 0) {
    return {
      state: 'reserve',
      label: `${safeWallet.availablePulls} ready · ${safeWallet.reservePulls} in reserve`,
    };
  }

  if (safeWallet.availablePulls > 0) {
    return {
      state: 'available',
      label: `${safeWallet.availablePulls} pull${safeWallet.availablePulls === 1 ? '' : 's'} ready`,
    };
  }

  return {
    state: 'locked',
    label: 'Clear today’s route to unlock pulls',
  };
}

function inferStatusKind(input: {
  selectedDeck: DeckSummary | null;
  draw: HomeDrawVM;
  statusHint?: HomeCtaKind;
  errorMessage?: string | null;
  runtimeStatus?: Partial<HomeRuntimeStatus>;
}): HomeCtaKind {
  const { selectedDeck, draw, statusHint, errorMessage, runtimeStatus } = input;
  const completedToday = Math.max(0, Number(runtimeStatus?.completedToday ?? 0) || 0);
  const qualifiedToday = !!runtimeStatus?.qualifiedToday;
  const completedRouteToday = !!runtimeStatus?.completedRouteToday;

  if (statusHint) return statusHint;
  if (errorMessage) return 'error';

  if (!selectedDeck || !selectedDeck.canStudy) {
    return 'first_run';
  }

  if (draw.state === 'wallet-full') {
    return 'wallet_full';
  }

  const hasTodayWork = selectedDeck.dueToday > 0 || selectedDeck.newToday > 0;
  if (completedRouteToday || (qualifiedToday && !hasTodayWork)) {
    return 'today_full_clear';
  }

  if (qualifiedToday && hasTodayWork) {
    return 'today_done';
  }

  if (completedToday > 0 && hasTodayWork) {
    return 'today_partial';
  }

  if (selectedDeck.dueToday > 0 && selectedDeck.newToday === 0) {
    return 'due_only';
  }

  if (hasTodayWork) {
    return 'today_pending';
  }

  return 'nothing_to_learn';
}

function mapStatusToCta(kind: HomeCtaKind): HomeCtaVM {
  switch (kind) {
    case 'first_run':
      return {
        kind,
        label: 'Open library',
        nav: 'library',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'today_pending':
      return {
        kind,
        label: 'Start today’s challenge',
        nav: 'challenge',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'today_partial':
      return {
        kind,
        label: 'Continue today’s challenge',
        nav: 'challenge',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'today_done':
      return {
        kind,
        label: 'Minimum goal reached',
        nav: 'draw',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'today_full_clear':
      return {
        kind,
        label: 'Full clear completed',
        nav: 'draw',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'due_only':
      return {
        kind,
        label: 'Clear due reviews',
        nav: 'challenge',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'nothing_to_learn':
      return {
        kind,
        label: 'Open library',
        nav: 'library',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'wallet_full':
      return {
        kind,
        label: 'Spend reward pulls',
        nav: 'draw',
        testID: 'home-primary-cta',
        disabled: false,
      };
    case 'error':
      return {
        kind,
        label: 'Try again',
        nav: 'retry',
        testID: 'home-primary-cta',
        disabled: false,
      };
    default:
      return {
        kind: 'error',
        label: 'Try again',
        nav: 'retry',
        testID: 'home-primary-cta',
        disabled: false,
      };
  }
}

function buildGoalVM(selectedDeck: DeckSummary | null): HomeGoalVM {
  const total = Math.max(0, (selectedDeck?.dueToday ?? 0) + (selectedDeck?.newToday ?? 0));
  return {
    minimum: `Keep streak: ${SESSION_MIN_GOAL} card`,
    fullClear: total > 0 ? `Full clear: ${total} card${total === 1 ? '' : 's'}` : 'Full clear: 0 cards',
  };
}

function buildHeroCopy(params: {
  statusKind: HomeCtaKind;
  selectedDeck: DeckSummary | null;
  counts: TodayCounts;
  hasSignedInUser: boolean;
}): { eyebrow: string; title: string; subtitle: string; helper: string } {
  const { statusKind, selectedDeck, counts, hasSignedInUser } = params;

  if (!selectedDeck) {
    return {
      eyebrow: 'Today',
      title: 'Get your first deck ready',
      subtitle: 'Install one deck to unlock today’s challenge.',
      helper: 'Once a deck is ready, Home will show the exact start button for today.',
    };
  }

  if (!selectedDeck.canStudy) {
    return {
      eyebrow: selectedDeck.title,
      title: 'Finish setup, then start today’s run',
      subtitle: 'This deck is not ready for study yet.',
      helper: 'Open the deck to install or unlock it first.',
    };
  }

  switch (statusKind) {
    case 'today_partial':
      return {
        eyebrow: 'Today',
        title: `${selectedDeck.title} is in progress`,
        subtitle: 'You already started today. Finish the remaining route.',
        helper: `${counts.selectedDue} due · ${counts.selectedNew} fresh still waiting.`,
      };
    case 'today_done': {
      const remaining = counts.selectedDue + counts.selectedNew;
      return {
        eyebrow: 'Today',
        title: 'Minimum goal already done',
        subtitle: 'You can stop here or spend pulls and keep momentum.',
        helper: `${remaining} card${remaining === 1 ? '' : 's'} still available for full clear.`,
      };
    }
    case 'today_full_clear':
      return {
        eyebrow: 'Today',
        title: 'Full clear completed',
        subtitle: 'Great close. Pulls are ready when you want them.',
        helper: 'No remaining route pressure in this deck.',
      };
    case 'due_only':
      return {
        eyebrow: 'Today',
        title: `${selectedDeck.dueToday} due in ${selectedDeck.title}`,
        subtitle: 'Review-only day. Clear due cards to keep the streak stable.',
        helper: 'No fresh cards are required today.',
      };
    case 'nothing_to_learn':
      return {
        eyebrow: 'Today',
        title: `You are clear for now in ${selectedDeck.title}`,
        subtitle: 'No due cards and no fresh cards queued right now.',
        helper: hasSignedInUser
          ? 'Browse another deck or come back later today.'
          : 'Sign in later for backup and cross-device continuity.',
      };
    case 'wallet_full':
      return {
        eyebrow: 'Today',
        title: 'Reward wallet is full',
        subtitle: 'Spend pulls first, then continue the study loop.',
        helper: `${FREE_PULL_CAP} ready and ${FREE_PULL_OVERFLOW_CAP} reserve are currently occupied.`,
      };
    case 'error':
      return {
        eyebrow: 'Home',
        title: 'Could not refresh Home right now',
        subtitle: 'Your local progress is safe. Retry to sync state.',
        helper: 'If this keeps happening, reopen the app after network stabilizes.',
      };
    default: {
      const hasTodayWork = selectedDeck.dueToday > 0 || selectedDeck.newToday > 0;
      const title =
        selectedDeck.dueToday > 0
          ? `${selectedDeck.dueToday} due today in ${selectedDeck.title}`
          : selectedDeck.newToday > 0
            ? `A short fresh run is ready in ${selectedDeck.title}`
            : `You are clear for now in ${selectedDeck.title}`;
      return {
        eyebrow: 'Today',
        title,
        subtitle: hasTodayWork
          ? `${counts.normalCount} normal · ${counts.eliteCount} elite · ${counts.bossCount} boss max`
          : 'No pressure day; review later or browse your decks.',
        helper: hasTodayWork
          ? `Clear ${SESSION_MIN_GOAL} node to keep momentum. Full run stays capped at ${SESSION_MAIN_ROUTE_DEFAULT} nodes.`
          : hasSignedInUser
            ? 'You can review again later or open another deck while today is light.'
            : 'Sign in later for backup and extended planning, but today you are clear.',
      };
    }
  }
}

function actionHintForDeck(params: {
  deck: DeckSummary;
  updateInfo: UpdateInfo | null;
  premium: boolean;
  signedIn: boolean;
}): HomeDeckActionHint {
  const { deck, updateInfo, premium, signedIn } = params;

  const availability = String(deck.availability ?? 'live').toLowerCase();
  if (availability === 'coming') return 'none';

  const isPremiumDeck = deck.deckType !== 1 || String(deck.tier ?? '').toLowerCase() === 'premium';

  if (!deck.canStudy) {
    if (updateInfo?.remoteUrl && updateInfo.remoteVersion) {
      if (isPremiumDeck && !premium) {
        return signedIn ? 'trial-start' : 'paywall';
      }
      return 'install';
    }
    return isPremiumDeck && !premium ? 'paywall' : 'open';
  }

  if (updateInfo?.hasUpdate && updateInfo.remoteUrl && updateInfo.remoteVersion) {
    return 'update';
  }

  return 'open';
}

function buildDeckRows(params: {
  deckSummaries: DeckSummary[];
  selectedSlug: string | null;
  updates: Record<string, UpdateInfo>;
  premium: boolean;
  signedIn: boolean;
}): HomeDeckVM[] {
  const { deckSummaries, selectedSlug, updates, premium, signedIn } = params;

  return deckSummaries.map((deck) => {
    const updateInfo = updates[deck.slug] ?? null;
    const actionHint = actionHintForDeck({ deck, updateInfo, premium, signedIn });

    const statusLabel =
      actionHint === 'update'
        ? 'Update available'
        : actionHint === 'install'
          ? 'Install required'
          : actionHint === 'trial-start'
            ? 'Start trial install'
            : actionHint === 'paywall'
              ? 'Premium required'
              : actionHint === 'none'
                ? 'Coming soon'
                : 'Ready';

    const progressLabel = deck.canStudy
      ? `${deck.dueToday} due · ${deck.newToday} fresh`
      : `0 due · ${deck.totalCards} cards`;

    return {
      deck,
      statusLabel,
      progressLabel,
      actionHint,
      updateInfo,
      isSelected: deck.slug === selectedSlug,
    };
  });
}

function buildCalendarCompact(allUpcoming30: CalendarDay[]): HomeCalendarCompact {
  const next7 = allUpcoming30.slice(0, 7);
  const maxCount = next7.reduce((max, day) => Math.max(max, day.count), 0);
  return {
    next7,
    maxCount: clamp(maxCount, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function buildHomeVM(params: {
  deckSummaries: DeckSummary[];
  selectedSlug: string | null;
  hasSignedInUser: boolean;
  wallet?: RewardWalletState | null;
  updates?: Record<string, UpdateInfo>;
  allUpcoming30?: CalendarDay[];
  premium?: boolean;
  accountLockup?: string | null;
  statusHint?: HomeCtaKind;
  errorMessage?: string | null;
  runtimeStatus?: Partial<HomeRuntimeStatus>;
}): HomeViewModel {
  const {
    deckSummaries,
    selectedSlug,
    hasSignedInUser,
    wallet,
    updates = {},
    allUpcoming30 = [],
    premium = false,
    accountLockup = null,
    statusHint,
    errorMessage = null,
    runtimeStatus,
  } = params;

  const selectedDeck =
    deckSummaries.find((deck) => deck.slug === selectedSlug) ?? deckSummaries[0] ?? null;
  const counts = buildCounts(deckSummaries, selectedDeck);
  const routePreview = buildRoutePreview(selectedDeck);
  const draw = buildDrawVM(wallet);
  const statusKind = inferStatusKind({
    selectedDeck,
    draw,
    statusHint,
    errorMessage,
    runtimeStatus,
  });
  let cta = mapStatusToCta(statusKind);
  if (!selectedDeck) {
    cta = {
      kind: 'first_run',
      label: 'Open library',
      nav: 'library',
      testID: 'home-primary-cta',
      disabled: false,
    };
  } else if (!selectedDeck.canStudy && statusKind === 'first_run') {
    cta = {
      ...cta,
      label: 'Open library',
      nav: 'library',
      disabled: false,
    };
  }
  const heroCopy = buildHeroCopy({
    statusKind,
    selectedDeck,
    counts,
    hasSignedInUser,
  });

  const decks = buildDeckRows({
    deckSummaries,
    selectedSlug: selectedDeck?.slug ?? null,
    updates,
    premium,
    signedIn: hasSignedInUser,
  });

  const vm: HomeViewModel = {
    hero: {
      ...heroCopy,
      headline: heroCopy.title,
      subline: heroCopy.subtitle,
      ctaLabel: cta.label,
      ctaAction:
        cta.nav === 'challenge'
          ? 'challenge'
          : cta.nav === 'deck' || cta.nav === 'library'
            ? 'deck'
            : 'none',
      ctaDisabled: cta.disabled,
    },
    counts,
    routePreview,
    selectedDeckTitle: selectedDeck?.title ?? null,
    drawStatusLabel: !selectedDeck
      ? 'No active deck yet'
      : selectedDeck.dueToday > 0 || selectedDeck.newToday > 0
        ? 'New pulls unlock after you clear today’s work.'
        : draw.label,

    statusKind,
    goal: buildGoalVM(selectedDeck),
    cta,
    draw,
    decks: {
      rows: decks,
      defaultOpen: false,
    },
    calendar: {
      compact: buildCalendarCompact(allUpcoming30),
      defaultOpen: false,
    },
    account: {
      lockup: accountLockup,
    },
    errorMessage,
    selectedDeckSlug: selectedDeck?.slug ?? null,
  };

  if (statusKind === 'error') {
    vm.hero.ctaAction = 'none';
    vm.hero.ctaLabel = cta.label;
    vm.hero.ctaDisabled = false;
    vm.drawStatusLabel = 'Retry when network is back';
  }

  return vm;
}
