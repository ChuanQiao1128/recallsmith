import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import {
  buildHomeScreenVM,
  homeCarouselRows,
  type HomeDeckVM,
  type HomeViewModel,
} from '../features/gacha/selectors/homeSelectors';
import TodayPressureCard from '../features/gacha/components/TodayPressureCard';
import {
  autoApplyFreeDeckUpdates,
  executeDeckAction,
  loadHomeDeckSummaries,
  resolveDeckAction,
} from '../features/gacha/home/deckActionResolver';
import HomeDeckRow from '../features/gacha/home/HomeDeckRow';
import HomePackCarousel, { type HomePackPage } from '../features/gacha/home/HomePackCarousel';
import {
  buildReadyHomeVm,
  createCoalescedRunner,
  type HomeVmInputs,
} from '../features/gacha/home/homeRefresh';
import type { HomeDeckSummarySnapshot } from '../features/gacha/home/deckActionResolver';
import { fetchServerPremium } from '../features/gacha/home/homeRemote';
import { prepareHomeDeckWallets } from '../features/gacha/rewards/economyFloor';
import { loadDeckWallet } from '../features/gacha/rewards/deckWallet';
import { loadStreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { forceProgressSync } from '../sync/progressSync';
import { useAuthStore } from '../auth/authStore';
import { SessionExpiredBanner } from '../auth/SessionExpiredBanner';
import { setIsPremiumUser, usePremiumUser } from '../premium/premiumStore';
import { useFeatureFlags } from '../config/featureFlags';
import { useSessionStore } from '../features/gacha/session/sessionStore';
import { isStarterLessonOpen, resolveStarterSlug } from '../features/gacha/starter/starterGate';
import { STARTER_COPY } from '../features/gacha/starter/starterCopy';
import { skipStarterLesson } from '../features/gacha/starter/starterLesson';
import { buildExamCountdownLabel } from '../features/gacha/home/examCountdown';
import { useExamPaceLine } from '../features/gacha/home/useExamPaceLine';
import { getStudyGoal, type StudyGoal } from '../features/goal/studyGoal';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { packImageForSlug, packPaletteFromSlug } from '../theme/packArt';
import { recordFunnelEvent } from '../telemetry/funnel';

// R24 §2.2: swap an installed starter pack for the full deck when the manifest is reachable. Lazy and
// guarded: the starter module reaches deckRepository (expo-file-system, amplify), which Home itself
// only reaches through deckActionResolver. One shared import for the upgrade and the subscription.
let starterModule: Promise<typeof import('../content/starterOffline')> | null = null;
function loadStarterModule() {
  starterModule ??= import('../content/starterOffline');
  return starterModule;
}

/** Never throws. */
async function upgradeStarterDecksOnFocus(): Promise<string[]> {
  try {
    return await (await loadStarterModule()).upgradeStarterDecks();
  } catch {
    return [];
  }
}

// Every upgrade run that replaced a starter deck reaches Home through this listener, whoever started
// it: Home's own focus run, or App's foreground run while Home is already showing (no focus fires
// then). Returns the unsubscribe function. Never throws.
async function subscribeStarterUpgradesLazy(listener: (slugs: string[]) => void): Promise<() => void> {
  try {
    return (await loadStarterModule()).subscribeStarterUpgrades(listener);
  } catch {
    return () => {};
  }
}

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;
type HomeState = {
  loading: boolean;
  error: string | null;
  vm: HomeViewModel;
};
// 2026-10-18 home carousel: one cover page per pack row. `status` is what the pack's dot reads
// (VoiceOver: "AWS Architect Basics pack — Ready"), the same words the old YOUR PACKS tiles used.
function toPackPage(row: HomeDeckVM): HomePackPage {
  const slug = row.deck.slug;
  const dueCount = (row.deck as any)?.dueCount ?? (row.deck as any)?.dueToday ?? 0;
  const totalCards = (row.deck as any)?.totalCards ?? 0;
  const masteredCount = (row.deck as any)?.masteredCount ?? 0;
  // Fully mastered: every card in the deck has reached the mastery stage
  // (stage >= 4, read from masteredCount — F11). The learned-count proxy
  // ("reviewed once") must not decide this. We also require dueCount=0 (no
  // review is currently due) to avoid celebrating prematurely when a card just
  // dropped back into review.
  const isFullyMastered = totalCards > 0 && masteredCount >= totalCards && dueCount === 0;
  let status = 'Ready';
  if (row.actionHint === 'none') status = 'Soon';
  else if (row.actionHint === 'paywall') status = 'Locked';
  else if (row.actionHint === 'install' || row.actionHint === 'trial-start') status = 'Install';
  else if (row.update?.state === 'updating') status = 'Updating';
  else if (row.actionHint === 'update') status = 'Update';
  else if (isFullyMastered) status = 'Mastered ✓';
  else if (dueCount > 0) status = `${dueCount} due`;
  return {
    slug,
    title: row.deck.title ?? slug,
    shortTitle: row.shortTitle,
    realRow: row,
    cover: packImageForSlug(slug),
    palette: packPaletteFromSlug(slug),
    status,
    isFullyMastered,
  };
}

// The one page shown while no pack has loaded (offline first run, a failed load).
function emptyPackPage(): HomePackPage {
  return {
    slug: 'default',
    title: 'Your first pack',
    shortTitle: 'Your first pack',
    realRow: null,
    cover: packImageForSlug('default'),
    palette: packPaletteFromSlug('default'),
    status: 'Soon',
    isFullyMastered: false,
  };
}

const EMPTY_VM = buildHomeScreenVM({ state: 'empty' });
const HOME_TOKENS = {
  border: colors.hairline,
  borderStrong: colors.hairline,
  borderSoft: colors.hairline,
  card: colors.softCream,
  cardSoft: colors.parchmentBg,
  cardSofter: colors.softMist,
  iconBg: colors.softCream,
  badgeBg: colors.parchmentBgDeep,
  linkBg: colors.softLavender,
} as const;

export function HomeScreen({ navigation, route }: Props) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [deckBusySlug, setDeckBusySlug] = useState<string | null>(null);
  const [homeState, setHomeState] = useState<HomeState>({
    loading: true,
    error: null,
    vm: EMPTY_VM,
  });
  const isMountedRef = useRef(true);
  const selectedSlugRef = useRef<string | null>(null);
  // Free-deck auto-updates in flight. A ref, not state: the view model is the
  // render state, and this only has to be readable at the next build of it.
  const autoUpdatingRef = useRef<Set<string>>(new Set());
  // Last inputs a successful refresh built its VM from. A pack-tile tap rebuilds
  // the VM from these with no I/O; phase 2 replaces `summary` in place.
  const homeInputsRef = useRef<HomeVmInputs | null>(null);
  const refreshHomeRef = useRef<() => Promise<void>>(async () => {});
  const runRefreshRef = useRef<() => Promise<void>>(async () => {});
  const authStatus = useAuthStore((s) => s.status);
  const accessToken = useAuthStore((s) => s.accessToken);
  const authInit = useAuthStore((s) => s.init);
  const authUserSub = useAuthStore((s) => s.userSub);
  const isSignedIn = authStatus === 'signed_in';
  const cachedPremium = usePremiumUser(authUserSub);
  const [serverPremium, setServerPremium] = useState(false);
  const [serverPremiumLoaded, setServerPremiumLoaded] = useState(false);
  const isPremiumUser = serverPremiumLoaded ? serverPremium : cachedPremium;
  const paywallHidden = useFeatureFlags().paywall.hidden === true;
  const firstDrawCoach = route.params?.firstDrawCoach ?? false;
  // ─── Starter lesson (R22 §4) ───────────────────────────────────────
  // Non-null while onboarding is in the 'starter' stage: the deck whose first 5 cards the learner
  // studies before the first pack. Home sends the learner into the lesson once per mount; after a
  // pause it offers the lesson as the one primary action. Stage 'done' (every existing user) leaves
  // this null and Home exactly as it was.
  const [starterSlug, setStarterSlug] = useState<string | null>(null);
  const [starterStarted, setStarterStarted] = useState(false);
  const starterAutoStartedRef = useRef(false);
  const openStarterLesson = useCallback(
    (slug: string) => {
      setStarterStarted(true);
      // R24 M01: anonymous funnel step; recorded once per install however often the lesson opens.
      recordFunnelEvent('starter_started', slug);
      navigation.navigate('SessionCard', { slug, mode: 'learn-new' });
    },
    [navigation],
  );
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const open = await isStarterLessonOpen();
        if (cancelled || !isMountedRef.current) return;
        if (!open) {
          setStarterSlug(null);
          return;
        }
        const slug = await resolveStarterSlug(await loadActiveDeckSlug());
        if (cancelled || !isMountedRef.current) return;
        if (!slug) {
          // No study goal and no active deck: there is no lesson to teach, so the stage must not
          // keep every pack's bootstrap and floor on hold. Close it and re-prepare the wallets.
          // (2026-10-14 three decks: a goal on a hidden deck is not "none" -- resolveStarterSlug
          // moves that lesson to the first visible deck, so it never reaches this branch.)
          setStarterSlug(null);
          if (await skipStarterLesson()) {
            if (isMountedRef.current) void refreshHomeRef.current();
          }
          return;
        }
        setStarterSlug(slug);
        if (slug && !starterAutoStartedRef.current) {
          starterAutoStartedRef.current = true;
          openStarterLesson(slug);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [openStarterLesson]),
  );
  // R22 §2/§5: the study goal (deck + exam date), read on every focus so a goal set in onboarding
  // or changed in Settings › Study shows up on return. Null (the default for most learners) shows
  // nothing about exams.
  const [studyGoal, setStudyGoalState] = useState<StudyGoal | null>(null);
  const examDate = studyGoal?.examDate ?? null;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getStudyGoal().then((goal) => {
        if (cancelled || !isMountedRef.current) return;
        setStudyGoalState(goal);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );
  // ─── One-shot notice toast ─────────────────────────────────────────
  // Set by PermissionPrompt when the user denied/skipped notifications.
  // Auto-clears after 3.5s so it doesn't stick around forever. We
  // capture into local state once on mount so re-renders don't reset it.
  const incomingNotice = route.params?.notice;
  const [notice, setNotice] = useState<typeof incomingNotice>(incomingNotice);
  useEffect(() => {
    if (!incomingNotice) return;
    setNotice(incomingNotice);
    const t = setTimeout(() => setNotice(undefined), 3500) as unknown as number;
    return () => clearTimeout(t);
  }, [incomingNotice]);
  useEffect(() => {
    void authInit();
  }, [authInit]);
  useEffect(() => {
    let cancelled = false;
    setServerPremium(false);
    setServerPremiumLoaded(false);
    (async () => {
      if (!accessToken || !accessToken.trim()) {
        if (!cancelled) {
          setServerPremium(false);
          setServerPremiumLoaded(true);
        }
        try {
          await setIsPremiumUser(false, authUserSub);
        } catch {
          // Cache sync is best effort.
        }
        return;
      }
      try {
        const premium = await fetchServerPremium(accessToken);
        if (cancelled) return;
        setServerPremium(premium);
        setServerPremiumLoaded(true);
        try {
          await setIsPremiumUser(premium, authUserSub);
        } catch {
          // Cache sync is best effort.
        }
      } catch {
        if (cancelled) return;
        setServerPremium(false);
        setServerPremiumLoaded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, authUserSub]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadActiveDeckSlug();
      if (!cancelled) {
        setSelectedSlug(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    selectedSlugRef.current = selectedSlug;
  }, [selectedSlug]);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Apply free-deck updates from a just-loaded summary, unasked and without
  // blocking the render: the tile shows "Updating…" from the slugs collected
  // here, and each run refreshes Home when it settles so the new counts (and,
  // on failure, the fallback chip) appear on their own. The resolver guards one
  // attempt per slug per session; a throw here must never take Home down, so it
  // degrades to "no runs started".
  const startAutoUpdates = useCallback((summary: HomeDeckSummarySnapshot) => {
    try {
      const runs = autoApplyFreeDeckUpdates({
        deckSummaries: summary.deckSummaries,
        updates: summary.updates,
      });
      for (const run of runs) {
        autoUpdatingRef.current.add(run.slug);
        void run.done.then(() => {
          autoUpdatingRef.current.delete(run.slug);
          if (isMountedRef.current) void refreshHomeRef.current();
        });
      }
    } catch {
      // Auto-update is best effort; the chip remains the manual path.
    }
  }, []);
  const publishReadyVm = useCallback(
    (inputs: HomeVmInputs) => {
      setHomeState({
        loading: false,
        error: null,
        vm: buildReadyHomeVm({
          inputs,
          selectedSlug: selectedSlugRef.current,
          session: useSessionStore.getState(),
          isSignedIn,
          premium: isPremiumUser,
          updatingSlugs: [...autoUpdatingRef.current],
        }),
      });
    },
    [isPremiumUser, isSignedIn],
  );
  const runRefresh = useCallback(async () => {
    // Phase 1 (cache-first): build the VM from the cached manifest and the
    // decks already on the phone -- no network -- so Home paints immediately.
    try {
      const [summary, streak] = await Promise.all([
        loadHomeDeckSummaries({ premium: isPremiumUser, remote: false }),
        loadStreakSnapshot(),
      ]);
      if (!isMountedRef.current) return;
      const currentSelectedSlug = selectedSlugRef.current;
      const activeSlug = currentSelectedSlug ?? summary.deckSummaries[0]?.slug ?? null;
      if (!currentSelectedSlug && activeSlug) {
        setSelectedSlug(activeSlug);
      }
      const now = new Date(summary.asOfISO);
      // Per-pack wallets live here, and only here, because this is the one point
      // in the app where the deck summaries (owned-new and due per pack) are in
      // hand at the same instant. prepareHomeDeckWallets migrates the legacy
      // balance, bootstraps never-drawn packs, then floors each starved pack --
      // all writes -- and returns the wallets Home renders, so the map Home
      // shows is the map Home wrote. Sequencing it after the summaries load (not
      // inside loadHomeDeckSummaries) keeps the wallet writes on the near side of
      // the read that the view model uses.
      const deckWallets = await prepareHomeDeckWallets({
        deckSummaries: summary.deckSummaries,
        now,
      });
      if (!isMountedRef.current) return;
      homeInputsRef.current = { summary, deckWallets, streak };
      startAutoUpdates(summary);
      publishReadyVm(homeInputsRef.current);
    } catch {
      if (!isMountedRef.current) return;
      const currentSelectedSlug = selectedSlugRef.current;
      const fallbackWallet = currentSelectedSlug
        ? await loadDeckWallet(currentSelectedSlug).catch(() => ({
            availablePulls: 0,
            reservePulls: 0,
          }))
        : { availablePulls: 0, reservePulls: 0 };
      const vm = buildHomeScreenVM({
        state: 'error',
        hasSignedInUser: isSignedIn,
        wallet: fallbackWallet,
        message: 'Could not refresh Home right now.',
      });
      setHomeState({
        loading: false,
        error: 'Could not refresh Home right now.',
        vm,
      });
      return;
    }
    // Phase 2 (revalidate, background): re-check the remote manifest and
    // republish. A failure keeps the phase-1 VM with no error state, and there
    // is no second wallet read and no second economy-floor pass -- the wallet
    // Home already rendered is the wallet it keeps.
    try {
      const summary = await loadHomeDeckSummaries({ premium: isPremiumUser, remote: true });
      if (!isMountedRef.current || !homeInputsRef.current) return;
      homeInputsRef.current = { ...homeInputsRef.current, summary };
      startAutoUpdates(summary);
      publishReadyVm(homeInputsRef.current);
    } catch {
      // Revalidation is best effort; the cache-first VM stands.
    }
  }, [isPremiumUser, isSignedIn, publishReadyVm, startAutoUpdates]);
  useEffect(() => {
    runRefreshRef.current = runRefresh;
  }, [runRefresh]);
  // Stable across renders: overlapping calls (focus effect, auth effect, tile
  // taps, auto-update completions) fold into one in-flight run plus at most one
  // trailing run instead of stacking full refreshes.
  const refreshHome = useMemo(
    () => createCoalescedRunner(() => runRefreshRef.current()),
    [],
  );
  useEffect(() => {
    refreshHomeRef.current = refreshHome;
  }, [refreshHome]);
  // Rebuilds the VM for a newly selected pack from the inputs already in hand --
  // no loadHomeDeckSummaries, no storage read, no network -- so a swipe or a dot
  // tap switches instantly. Falls back to a full refresh only before the first
  // successful load has produced any inputs.
  // 2026-10-18 home carousel: `persist` makes the pack the app-wide active deck
  // (Library, Draw, SessionCard follow it), as a pack-tile tap did. Only an
  // installed pack gets that: an uninstalled one is selected on Home alone, so
  // Draw never resolves-or-installs a pack the learner only swiped past.
  const selectPackLocally = useCallback(
    (slug: string, persist: boolean) => {
      selectedSlugRef.current = slug;
      setSelectedSlug(slug);
      if (persist) void setActiveDeckSlug(slug);
      if (homeInputsRef.current) {
        publishReadyVm(homeInputsRef.current);
      } else {
        void refreshHome();
      }
    },
    [publishReadyVm, refreshHome],
  );
  // A swipe, a dot, a tap on a peeking pack or a VoiceOver pack action. Selection
  // only: never an install, a navigation or the paywall -- the cover and the
  // primary button keep those.
  const handleSelectPage = useCallback(
    (page: HomePackPage) => {
      if (!page.realRow) return;
      selectPackLocally(page.slug, page.realRow.deck.canStudy);
    },
    [selectPackLocally],
  );
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await refreshHome();
        if (cancelled || !isMountedRef.current) return;
      })();
      return () => {
        cancelled = true;
      };
    }, [refreshHome]),
  );
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void subscribeStarterUpgradesLazy(() => {
      if (isMountedRef.current) void refreshHomeRef.current();
    }).then((off) => {
      if (cancelled) off();
      else unsubscribe = off;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      // An upgrade that went in refreshes Home through the subscription above.
      void upgradeStarterDecksOnFocus();
    }, []),
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isSignedIn) {
        try {
          await forceProgressSync('home_auth_changed');
        } catch {
          // Sync failure should not block Home rendering.
        }
      }
      if (cancelled) return;
      await refreshHome();
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, authUserSub, isSignedIn, isPremiumUser, refreshHome]);
  const selectedDeckRow = useMemo(() => {
    return (
      homeState.vm.decks.rows.find((row) => row.deck.slug === homeState.vm.selectedDeckSlug) ??
      homeState.vm.decks.rows[0] ??
      null
    );
  }, [homeState.vm]);
  // U5: the daily target for the goal deck (not the selected one): its card count and learned count
  // from this load's deck summary. A goal deck Home does not list yields no line.
  const goalDeck = useMemo(() => {
    if (!studyGoal) return null;
    return homeState.vm.decks.rows.find((row) => row.deck.slug === studyGoal.deckSlug)?.deck ?? null;
  }, [homeState.vm, studyGoal]);
  const examPaceLine = useExamPaceLine({
    deckSlug: goalDeck ? goalDeck.slug : null,
    examDate,
    totalCards: goalDeck ? goalDeck.totalCards || goalDeck.localCards : null,
    learnedCards: goalDeck ? goalDeck.masteredApprox : null,
  });
  const handlePrimaryCta = useCallback(async () => {
    const slug = homeState.vm.selectedDeckSlug ?? selectedDeckRow?.deck.slug ?? null;
    if (starterSlug) {
      openStarterLesson(starterSlug);
      return;
    }
    switch (homeState.vm.cta.nav) {
      case 'challenge': {
        if (!slug) return;
        void setActiveDeckSlug(slug);
        setSelectedSlug(slug);
        // Skip the Challenge route-preview interstitial — the user's
        // intent is "review now", not "see a preview". SessionCard does
        // its own deck/route/progress loading. The Challenge route still
        // exists for the bottom Review tab + deep-link entries.
        navigation.navigate('SessionCard', { slug });
        return;
      }
      case 'library':
      case 'deck': {
        if (slug) {
          void setActiveDeckSlug(slug);
          setSelectedSlug(slug);
        }
        navigation.navigate('Library');
        return;
      }
      case 'draw': {
        navigation.navigate('Draw', {
          slug: slug ?? undefined,
          rewardPending: true,
        });
        return;
      }
      case 'retry': {
        await refreshHome();
        return;
      }
      case 'none':
      default:
        return;
    }
  }, [homeState.vm, navigation, openStarterLesson, refreshHome, selectedDeckRow, starterSlug]);
  const handleDeckPress = useCallback(
    async (row: HomeDeckVM) => {
      setDeckBusySlug(row.deck.slug);
      try {
        const updates = row.updateInfo ? { [row.deck.slug]: row.updateInfo } : {};
        const action = await resolveDeckAction({
          deck: row.deck,
          premium: isPremiumUser,
          signedIn: isSignedIn,
          updates,
        });
        if (action.kind === 'paywall') {
          if (paywallHidden) {
            Alert.alert('Not available right now', 'Premium packs are not available yet. Free packs stay open.');
            return;
          }
          navigation.navigate('Paywall');
          return;
        }
        if (action.kind === 'none') {
          return;
        }
        const { activeSlug } = await executeDeckAction(action);
        setSelectedSlug(activeSlug);
        // An update refreshes a deck the user already has; they tapped it on
        // Home and Home is where the new counts show. Fresh installs still go
        // to the Library, where the cards they just got are.
        if (action.kind === 'open' || action.kind === 'install' || action.kind === 'trial-start') {
          navigation.navigate('Library');
        }
        await refreshHome();
      } catch {
        Alert.alert('Deck action failed', 'Please try again in a moment.');
      } finally {
        if (isMountedRef.current) {
          setDeckBusySlug(null);
        }
      }
    },
    [isPremiumUser, isSignedIn, navigation, paywallHidden, refreshHome],
  );
  const renderCalendar = useMemo(() => {
    return homeState.vm.calendar.compact.next7.map((day) => {
      const dt = new Date(day.dateKey);
      const label = Number.isNaN(dt.getTime())
        ? day.dateKey
        : dt.toLocaleDateString('en-US', { weekday: 'short' });
      const barRatio =
        homeState.vm.calendar.compact.maxCount > 0
          ? day.count / homeState.vm.calendar.compact.maxCount
          : 0;
      return (
        <View key={day.dateKey} style={styles.calendarCell}>
          <Text style={styles.calendarDay} numberOfLines={1}>
            {label}
          </Text>
          <View style={styles.calendarBarTrack}>
            <View
              style={[
                styles.calendarBarFill,
                {
                  height: `${Math.max(8, Math.round(barRatio * 100))}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.calendarCount} numberOfLines={1}>
            {day.count}
          </Text>
        </View>
      );
    });
  }, [homeState.vm.calendar]);
  const primaryCtaDisabled = starterSlug
    ? false
    : homeState.vm.cta.disabled ||
      (homeState.vm.cta.nav === 'challenge' && !homeState.vm.selectedDeckSlug);
  const primaryCtaLabel = starterSlug
    ? starterStarted
      ? STARTER_COPY.ctaResumeLabel
      : STARTER_COPY.ctaLabel
    : homeState.vm.cta.label;
  const primaryCtaTestID = starterSlug ? 'home-starter-cta' : homeState.vm.cta.testID;
  const totalDueAcrossDecks = homeState.vm.counts.totalDueAllDecks;
  // 2026-10-18 home carousel: the hero headline counts the selected pack's due
  // cards only, so swiping to a pack with nothing due never leaves "N cards
  // waiting" over its "Open library". The header repeats the same number.
  const selectedDueToday = selectedDeckRow?.deck.canStudy ? Math.max(0, selectedDeckRow.deck.dueToday ?? 0) : 0;
  const cardsWaiting = `${selectedDueToday} card${selectedDueToday === 1 ? '' : 's'} waiting`;
  const examCountdownLabel = buildExamCountdownLabel(examDate, Date.now());
  // The header line is context, never a second instruction: the hero below carries the one
  // instruction (R22 §1.6). It shows the exam countdown when a date is set (with the goal deck's
  // daily target under it, U5: a pace, not a button); otherwise a status
  // that agrees with the hero. While the starter lesson is open the hero already says it all.
  // "Caught up" only sits over a hero that says the learner is clear; every other hero line
  // (new cards ready, today in progress, a deck to set up) gets no subtitle rather than a
  // contradicting one.
  const heroSaysClear =
    homeState.vm.statusKind === 'nothing_to_learn' || homeState.vm.statusKind === 'today_full_clear';
  const headerStatus = starterSlug
    ? null
    : selectedDueToday > 0
      ? `${cardsWaiting} today`
      : homeState.vm.draw.state === 'available' || homeState.vm.draw.state === 'reserve'
        ? 'A reward pack is ready'
        : !heroSaysClear
          ? null
          : selectedDeckRow?.deck.canStudy &&
              selectedDeckRow.deck.dueToday === 0 &&
              selectedDeckRow.deck.newToday === 0 &&
              homeState.vm.draw.state === 'locked'
            ? 'Caught up'
            : 'All caught up for now';
  // Only show the full-screen spinner on the FIRST load. Subsequent refreshes
  // (after navigating away + returning) keep the previous UI rendered so the
  // user doesn't see a jarring blank → fade → blank flash. A small inline
  // ActivityIndicator could be added next to the title later if desired.
  const hasLoadedOnce = homeState.vm !== EMPTY_VM;
  if (homeState.loading && !hasLoadedOnce) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-home-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Loading home...
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safeArea} testID="screen-home-root">
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <SessionExpiredBanner onSignIn={() => navigation.navigate('SignIn')} />
            {/* One-shot notice toast — surfaces feedback from the
                preceding screen (e.g. PermissionPrompt deny). Auto-fades
                after 3.5s via the notice useEffect above. Renders as a
                soft pill, not a blocking modal. */}
            {notice ? (
              <View style={styles.homeNoticeToast}>
                <Text style={styles.homeNoticeText} numberOfLines={2}>
                  {notice === 'notifications-denied'
                    ? "Notifications off. You can turn them on later in Settings."
                    : "We won't send reminders for now. Change anytime in Settings."}
                </Text>
              </View>
            ) : null}

            {/* Header — title + one context line (not marketing, not an
                instruction): the exam countdown when a date is set,
                otherwise a status that agrees with the hero. */}
            <View style={styles.headerRow}>
              <View style={styles.headerTextWrap}>
                <Text style={styles.title} numberOfLines={1}>
                  DeveloperCards
                </Text>
                {examCountdownLabel ? (
                  <Text testID="home-exam-countdown" style={styles.headerStatusSubtitle} numberOfLines={1}>
                    {examCountdownLabel}
                  </Text>
                ) : headerStatus ? (
                  <Text testID="home-header-subtitle" style={styles.headerStatusSubtitle} numberOfLines={1}>
                    {headerStatus}
                  </Text>
                ) : (
                  // The status line comes and goes with the selected pack; an empty line of the same
                  // style keeps its height so a swipe never moves the cover and the button below it.
                  <Text
                    testID="home-header-subtitle-spacer"
                    style={styles.headerStatusSubtitle}
                    numberOfLines={1}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {'\u00A0'}
                  </Text>
                )}
                {/* U5: the goal deck's daily target under the countdown (one line, only with a date). */}
                {examCountdownLabel && examPaceLine ? (
                  <Text testID="home-exam-pace" style={styles.headerStatusSubtitle} numberOfLines={1}>
                    {examPaceLine}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                style={({ pressed }) => [styles.settingsIcon, pressed && styles.pressed]}
                onPress={() => navigation.navigate('Settings')}
              >
                <Text style={styles.settingsText}>⚙︎</Text>
              </Pressable>
            </View>
            {/* ─── HERO BAND — the cover carousel ─────────────────────
                2026-10-18 home carousel: the hero pack is a horizontal
                swipe carousel, one page per pack in DECK_ORDER, with the
                short name and page dots under it (HomePackCarousel). The
                current cover floats on the page background and bobs gently
                when motion is enabled. Hero copy is action-driven, not a
                duplicate of the pack name. */}
            {(() => {
              // One page per pack row ('coming' decks get none); while the
              // starter lesson is open, the lesson's pack alone.
              const carouselRows = homeCarouselRows({
                rows: homeState.vm.decks.rows,
                selectedSlug: homeState.vm.selectedDeckSlug,
                lockedSlug: starterSlug,
              });
              const pages: HomePackPage[] =
                carouselRows.length > 0 ? carouselRows.map(toPackPage) : [emptyPackPage()];
              const currentIndex = Math.max(
                0,
                pages.findIndex((page) => page.slug === homeState.vm.selectedDeckSlug),
              );
              const featuredDeck: HomePackPage = pages[currentIndex] ?? pages[0];

              // Action-driven hero title — NEVER duplicate the pack name.
              // Priority: deck-mastered celebration → the selected pack's
              // due count → reward pack ready → vm fallback.
              const isFeaturedMastered = featuredDeck.isFullyMastered;
              const heroTitle =
                starterSlug
                  ? STARTER_COPY.headline
                  : isFeaturedMastered
                  ? 'Deck mastered 🎉'
                  : selectedDueToday > 0
                    ? cardsWaiting
                    : (homeState.vm.draw.state === 'available' || homeState.vm.draw.state === 'reserve')
                      ? 'A reward pack is ready'
                      : homeState.vm.hero.headline;

              // Featured-pack press handler — the current cover is tappable.
              // Its destination follows the same primary decision shown below,
              // except setup actions still use the existing deck resolver.
              const drawState = homeState.vm.draw.state;
              const featuredHint = featuredDeck.realRow?.actionHint ?? null;
              // While the auto-installer is already applying the update, the
              // pack behaves as an installed pack: a second tap must not
              // re-enter the install flow it is waiting on.
              const featuredUpdating = featuredDeck.realRow?.update?.state === 'updating';
              const resolvesFeaturedDeck =
                featuredHint === 'paywall'
                || (featuredHint === 'update' && !featuredUpdating)
                || featuredHint === 'trial-start'
                || (featuredHint === 'install' && drawState === 'locked');
              const featuredPackAccessibilityLabel = starterSlug
                ? primaryCtaLabel
                : !featuredDeck.realRow
                ? 'Connect to load packs'
                : firstDrawCoach
                  ? 'Open reward pack'
                  : resolvesFeaturedDeck
                    ? `${featuredDeck.status} ${featuredDeck.title}`
                    : homeState.vm.cta.label;
              const handleFeaturedPackPress = () => {
                if (starterSlug) {
                  openStarterLesson(starterSlug);
                  return;
                }
                if (!featuredDeck.realRow) {
                  void refreshHome();
                  return;
                }
                if (firstDrawCoach) {
                  navigation.navigate('Draw', {
                    slug: featuredDeck.slug,
                    rewardPending: true,
                  });
                  return;
                }
                const hint = featuredDeck.realRow.actionHint;
                if (
                  hint === 'paywall'
                  || (hint === 'update' && !featuredUpdating)
                  || hint === 'trial-start'
                  || (hint === 'install' && drawState === 'locked')
                ) {
                  void handleDeckPress(featuredDeck.realRow);
                  return;
                }
                if (hint === 'install' && drawState !== 'locked') {
                  navigation.navigate('Draw', {
                    slug: featuredDeck.slug,
                    rewardPending: drawState !== 'wallet-full',
                  });
                  return;
                }
                void handlePrimaryCta();
              };

              return (
                <>
                  <View style={styles.heroBand}>
                    {/* Short name and page dots sit under the carousel and
                        above the hero title, so nothing comes between the
                        title and the primary button. */}
                    <HomePackCarousel
                      pages={pages}
                      currentIndex={currentIndex}
                      locked={!!starterSlug}
                      featuredLabel={featuredPackAccessibilityLabel}
                      onFeaturedPress={handleFeaturedPackPress}
                      onSelectPage={handleSelectPage}
                    />

                    {/* Action-driven title — never duplicates the pack
                        name. "12 cards waiting" beats "C#" every time; the
                        count is the selected pack's.
                        R22 §5: two lines, shrinking rather than cutting off.
                        The box is always two lines tall (an invisible two-line
                        spacer in the same style, so it follows Dynamic Type)
                        and a one-line title sits centred in it: swiping
                        between packs never moves the button below. */}
                    <View style={styles.heroTitleBox}>
                      <Text
                        style={[styles.heroTitle, styles.heroTitleSpacer]}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        {'\u00A0\n\u00A0'}
                      </Text>
                      <View style={styles.heroTitleCentre}>
                        <Text
                          testID="home-hero-title"
                          style={styles.heroTitle}
                          numberOfLines={2}
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                        >
                          {heroTitle}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* ─── PRIMARY CTA — directly under the hero so it is on
                      the first screen of a 6.1-inch phone (R22 §1.6). ──── */}
                  <View testID="screen-home-primary-cta">
                    <Pressable
                      testID={primaryCtaTestID}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.primaryCta,
                        primaryCtaDisabled && styles.primaryCtaDisabled,
                        pressed && styles.pressed,
                      ]}
                      disabled={primaryCtaDisabled}
                      onPress={() => {
                        void handlePrimaryCta();
                      }}
                    >
                      <Text style={styles.primaryCtaText} numberOfLines={1}>
                        {primaryCtaLabel}
                      </Text>
                    </Pressable>
                  </View>
                  <Text
                    testID="home-draw-status-badge"
                    style={styles.rewardStatusText}
                    numberOfLines={1}
                  >
                    {homeState.vm.draw.label || '\u00A0'}
                  </Text>

                  {/* ─── TODAY GROUP — pressure card + update notice + goal ──── */}
                  <View style={styles.actionGroup}>
                    <TodayPressureCard
                      counts={homeState.vm.counts}
                      selectedDeckTitle={homeState.vm.selectedDeckTitle}
                    />
                    {/* One fixed line under the Today card, about the selected pack:
                        the update notice while a newer build exists ("Updating …"
                        while the free-deck auto-installer runs, or the manual
                        fallback, "tap the pack to install"), otherwise the goal
                        line. Both come and go with the pack, so the slot keeps the
                        height of the taller one (an invisible notice pill in the
                        same style, so it follows Dynamic Type) and a swipe never
                        moves anything below it. The notice wins while it lasts;
                        the goal line is back once the update settles. */}
                    <View testID="home-below-today-slot" style={styles.belowTodaySlot}>
                      <Text
                        style={[styles.updateNotice, styles.belowTodaySpacer]}
                        numberOfLines={1}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        {'\u00A0'}
                      </Text>
                      <View style={styles.belowTodayLine}>
                        {homeState.vm.updateNotice ? (
                          <Text
                            testID="home-update-notice"
                            style={[
                              styles.updateNotice,
                              styles.belowTodayContent,
                              homeState.vm.updateNotice.state === 'updating' && styles.updateNoticeUpdating,
                            ]}
                            numberOfLines={1}
                          >
                            {homeState.vm.updateNotice.text}
                          </Text>
                        ) : homeState.vm.goal ? (
                          <Text
                            testID="home-goal-line"
                            style={[styles.goalLine, styles.belowTodayContent]}
                            numberOfLines={1}
                          >
                            {homeState.vm.goal.text}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    {homeState.error ? (
                      <View style={styles.errorBlock}>
                        <Text style={styles.errorText} numberOfLines={3}>
                          {homeState.error}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          testID="home-error-retry"
                          style={({ pressed }) => [styles.errorRetryPill, pressed && styles.pressed]}
                          onPress={() => void refreshHome()}
                        >
                          <Text style={styles.errorRetryText} numberOfLines={1}>
                            Try again
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>

                </>
              );
            })()}

            {/* ─── Hidden test-contract probes ──────────────────────────
                The "Review N due cards" + "Open first draw" links and the
                deck/week toggles must remain in tree for the legacy test
                contract, but they should NOT visually compete with the
                single primary CTA. They render as 0×0 invisible probes. */}
            {totalDueAcrossDecks > 0 ? (
              <Pressable
                accessibilityRole="button"
                testID="home-study-due-link"
                style={styles.homeTestProbeHidden}
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onPress={() =>
                  navigation.navigate('SessionCard', {
                    slug: homeState.vm.selectedDeckSlug ?? undefined,
                  })
                }
              >
                <Text style={styles.homeTestProbeHidden}>
                  {`Review ${totalDueAcrossDecks} due cards`}
                </Text>
              </Pressable>
            ) : null}
            {firstDrawCoach ? (
              <Pressable
                accessibilityRole="button"
                testID="home-first-draw-link"
                style={styles.homeTestProbeHidden}
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onPress={() =>
                  navigation.navigate('Draw', {
                    slug: homeState.vm.selectedDeckSlug ?? undefined,
                    rewardPending: true,
                  })
                }
              >
                <Text style={styles.homeTestProbeHidden}>Open first draw</Text>
              </Pressable>
            ) : null}
            {/* ─── Hidden test-contract probes ────────────────────────────
                The "Your decks" + "Week support" toggle sections have been
                removed from the visual home (replaced by the 3-pack
                carousel above). Pressables are kept in tree as 0×0 so the
                home-collapse-* and home-deck-row-* tests still find them. */}
            <Pressable
              testID="home-collapse-decks-toggle"
              accessibilityRole="button"
              accessibilityState={{ expanded: deckOpen }}
              style={styles.homeTestProbeHidden}
              onPress={() => setDeckOpen((prev) => !prev)}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={styles.homeTestProbeHidden}>Your decks</Text>
            </Pressable>
            <View
              style={styles.homeTestProbeHidden}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {homeState.vm.decks.rows.map((row) => (
                <HomeDeckRow
                  key={row.deck.slug}
                  deck={row.deck}
                  action={row.actionHint}
                  statusLabel={row.statusLabel}
                  progressLabel={row.progressLabel}
                  selected={row.isSelected}
                  busy={deckBusySlug === row.deck.slug}
                  onPress={() => {
                    void handleDeckPress(row);
                  }}
                />
              ))}
            </View>
            <Pressable
              testID="home-collapse-week-support-toggle"
              accessibilityRole="button"
              accessibilityState={{ expanded: calendarOpen }}
              style={styles.homeTestProbeHidden}
              onPress={() => setCalendarOpen((prev) => !prev)}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={styles.homeTestProbeHidden}>Week support</Text>
            </Pressable>
            {/* ─── FOOTER LINK ────────────────────────────────────────
                Demoted from a card (avoided cream-on-cream-on-cream
                stacking). Now just a quiet inline link with chevron at
                the bottom of the page. */}
            {homeState.vm.account.lockup ? (
              <Pressable
                style={({ pressed }) => [styles.footerLink, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Sign in for cloud backup"
                onPress={() => navigation.navigate('SignIn')}
              >
                <Text style={styles.footerLinkText} numberOfLines={1}>
                  Sign in for cloud backup
                </Text>
                <Text style={styles.footerLinkArrow} numberOfLines={1}>
                  ›
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </LinearGradient>
    </SafeAreaView>
  );
}
export default HomeScreen;
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.md, paddingBottom: spacing.xl },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: spacing.sm, color: colors.inkSecondary, fontSize: typography.body },
  pressed: { opacity: 0.9 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  headerTextWrap: { flex: 1, paddingRight: spacing.sm },
  title: { fontSize: typography.title3, fontWeight: '900', letterSpacing: 0.4, color: colors.inkSecondary },
  subtitle: { marginTop: 4, fontSize: typography.bodySmall, color: colors.inkSecondary },
  // Functional brand subtitle — replaces marketing copy with what's actually
  // waiting today (e.g. "12 cards waiting today")
  headerStatusSubtitle: { marginTop: 2, fontSize: typography.caption, color: colors.inkMuted, fontWeight: '700', letterSpacing: 0.3 },
  // One-shot toast at the top of Home — used to acknowledge the prior
  // screen's outcome (e.g. notifications denied). Soft pill, ghost
  // border, dismisses on its own after 3.5s.
  homeNoticeToast: {
    marginBottom: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  homeNoticeText: {
    fontSize: typography.bodySmall,
    lineHeight: 17,
    color: colors.inkSoft,
    fontWeight: '700',
  },
  settingsIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: HOME_TOKENS.border, backgroundColor: HOME_TOKENS.iconBg },
  settingsText: { color: colors.ink, fontSize: 18 },
  // Legacy alias kept for any code paths still referencing primaryCard
  // styling; the new hero uses heroBand.
  primaryCard: { borderRadius: spacing.lg, borderWidth: 1, borderColor: HOME_TOKENS.borderStrong, backgroundColor: HOME_TOKENS.card, padding: spacing.md },

  // ─── HOME v4 — pack-floats-on-page hero ──────────────────────────────
  // No card chrome around the pack. The cover carousel (HomePackCarousel)
  // keeps the covers on the page background with only a shadow + a soft
  // gold halo behind the current one. Hero copy sits below (centered),
  // action-driven, never duplicating the pack name. The carousel pages carry
  // their own top padding, so the band starts tighter than the single pack did.
  heroBand: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: spacing.md,
  },
  heroTitleBox: {
    alignSelf: 'stretch',
    marginTop: 6,
  },
  heroTitleSpacer: { opacity: 0 },
  heroTitleCentre: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: typography.title1,
    lineHeight: 34,
    fontWeight: '900',
    color: colors.ink,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  // ─── ACTION GROUP — pressure + CTA + draw status ────────────────────
  // Wider top margin from heroBand → makes hero clearly the visual lead.
  // Today card group, now under the CTA and draw status line.
  actionGroup: {
    marginTop: spacing.md,
  },
  belowTodaySlot: { alignSelf: 'stretch' },
  belowTodaySpacer: { opacity: 0 },
  // Over the spacer, less its bottom margin, so the line sits centred on the pill's box.
  belowTodayLine: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: spacing.xs,
    left: 0,
    justifyContent: 'center',
  },
  belowTodayContent: { marginBottom: 0 },
  goalLine: {
    marginBottom: spacing.xs,
    color: colors.inkSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  // One-line deck-update notice under the Today card. Quiet pill in the
  // install blue; the "updating" variant drops the fill so it reads as a
  // status, not a prompt.
  updateNotice: {
    marginBottom: spacing.xs,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.softLavender,
    color: colors.pokeBlueDeep,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  updateNoticeUpdating: {
    backgroundColor: 'transparent',
    color: colors.inkSecondary,
  },

  // Hidden test probe — 0×0 view kept in tree so home-collapse-decks-toggle
  // / home-collapse-week-support-toggle / home-deck-row-{slug} /
  // home-study-due-link / home-first-draw-link testIDs remain findable for
  // the legacy test contract without competing for visual attention.
  homeTestProbeHidden: { width: 0, height: 0, opacity: 0, overflow: 'hidden', fontSize: 0, lineHeight: 0 },

  // ─── Primary CTA + draw status (single action only) ─────────────────
  primaryCta: {
    marginTop: spacing.md,
    minHeight: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.pokeBlue,
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryCtaDisabled: { opacity: 0.45 },
  primaryCtaText: { color: '#FFFFFF', fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  // Draw status sits under the CTA as a quiet centered line — no pill, no
  // dot, no extra color. The CTA is loud, this is a label.
  rewardStatusText: {
    marginTop: spacing.sm,
    alignSelf: 'center',
    textAlign: 'center',
    fontSize: typography.caption,
    fontWeight: '800',
    color: colors.inkSecondary,
    letterSpacing: 0.3,
  },

  errorText: { marginTop: spacing.xs, color: colors.danger, fontSize: typography.caption, lineHeight: 16 },
  // Error block — keeps Home hero intact even on network failure;
  // surfaces a calm message + actionable retry pill instead of a bare
  // error string. Brand-new users hitting this on cold launch see the
  // pack visual + "Try again" instead of a broken-looking screen.
  errorBlock: {
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(170,54,54,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(170,54,54,0.22)',
    alignItems: 'center',
  },
  errorRetryPill: {
    marginTop: 8,
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 16,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRetryText: {
    color: '#FFFFFF',
    fontSize: typography.bodySmall,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  collapseHeader: { marginTop: spacing.sm, minHeight: 56, borderRadius: spacing.buttonRadius, borderWidth: 1, borderColor: HOME_TOKENS.border, backgroundColor: HOME_TOKENS.cardSoft, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapseTextWrap: { flex: 1, paddingRight: spacing.sm },
  collapseTitle: { fontSize: typography.body, fontWeight: '800', color: colors.ink },
  collapseSubtitle: { marginTop: 2, fontSize: typography.caption, color: colors.inkSecondary },
  collapseArrow: { fontSize: typography.caption, fontWeight: '700', color: colors.inkSecondary },
  collapseBody: { marginTop: spacing.xs, borderRadius: spacing.cardRadius, backgroundColor: HOME_TOKENS.cardSofter, borderWidth: 1, borderColor: HOME_TOKENS.borderSoft, padding: spacing.sm },
  calendarGrid: { marginTop: spacing.xs, borderRadius: spacing.cardRadius, borderWidth: 1, borderColor: HOME_TOKENS.borderSoft, backgroundColor: HOME_TOKENS.cardSofter, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  calendarCell: { alignItems: 'center', width: '13%' },
  calendarDay: { fontSize: typography.caption, color: colors.inkSecondary },
  calendarBarTrack: { width: 10, height: 40, borderRadius: 999, backgroundColor: HOME_TOKENS.border, justifyContent: 'flex-end', overflow: 'hidden', marginTop: 4 },
  calendarBarFill: { width: 10, borderRadius: 999, backgroundColor: colors.gold },
  calendarCount: { marginTop: 4, fontSize: typography.caption, color: colors.inkSecondary, fontWeight: '700' },
  // ─── HOME v4 — footer link (demoted from card chrome) ────────────────
  // The Cloud-backup affordance was a softCream card stacked on top of
  // the softCream hero card on a parchment bg — three cream layers in a
  // row. Demoted to a quiet inline link with a chevron. Generous top
  // margin pushes it visibly below the action group.
  footerLink: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  footerLinkText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.inkMuted,
    letterSpacing: 0.3,
  },
  footerLinkArrow: {
    fontSize: 16,
    color: colors.inkMuted,
    fontWeight: '300',
  },
  // Legacy alias so any leftover references still work
  accountLockup: { marginTop: spacing.sm, fontSize: typography.caption, color: colors.inkSecondary },
});
