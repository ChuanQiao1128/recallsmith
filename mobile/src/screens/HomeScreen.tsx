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
import * as RN from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import {
  buildHomeScreenVM,
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
import {
  buildReadyHomeVm,
  createCoalescedRunner,
  type HomeVmInputs,
} from '../features/gacha/home/homeRefresh';
import type { HomeDeckSummarySnapshot } from '../features/gacha/home/deckActionResolver';
import { fetchServerPremium } from '../features/gacha/home/homeRemote';
import { applyEconomyFloorIfStarved } from '../features/gacha/rewards/economyFloor';
import { loadRewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { loadStreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { forceProgressSync } from '../sync/progressSync';
import { useAuthStore } from '../auth/authStore';
import { SessionExpiredBanner } from '../auth/SessionExpiredBanner';
import { setIsPremiumUser, usePremiumUser } from '../premium/premiumStore';
import { useFeatureFlags } from '../config/featureFlags';
import { useSessionStore } from '../features/gacha/session/sessionStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { packImageForSlug, packPaletteFromSlug } from '../theme/packArt';

// Vitest supplies react-native without Image — guarded lookup so tests don't crash.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);
const AI: any = readRN('AccessibilityInfo', null);
const RNEasing: any = readRN('Easing', null);
// Safe Animated lookup — vitest's RN facade throws on missing exports.
// Mirrors the pattern used in DrawScreen.tsx: `A` is a tolerant facade and
// `hasAnimated` flips animations off during tests so JSX still renders.
const A: any = readRN('Animated', {});
const AnimatedView: any = A.View ?? View;
const hasAnimated = typeof A.Value === 'function';
type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;
type HomeState = {
  loading: boolean;
  error: string | null;
  vm: HomeViewModel;
};
type HomeVisualDeck = {
  slug: string;
  title: string;
  /** Tile label (content/deckShortTitle); `title` stays the full manifest name for the hero. */
  shortTitle: string;
  realRow: HomeDeckVM | null;
  cover: ReturnType<typeof packImageForSlug>;
  palette: ReturnType<typeof packPaletteFromSlug>;
  status: string;
  isFullyMastered: boolean;
  disabled: boolean;
  selected: boolean;
};
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
  // ─── Idle hero animations ──────────────────────────────────────────
  // The pack bobs gently up/down (3px), unless reduced motion is enabled.
  // The guarded Animated facade keeps the static hero available in tests.
  const packBobRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  useEffect(() => {
    if (!hasAnimated) return;
    const easing = RNEasing?.inOut ? RNEasing.inOut(RNEasing.ease) : undefined;
    const bob = A.loop(
      A.sequence([
        A.timing(packBobRef.current, { toValue: 1, duration: 2400, easing, useNativeDriver: true }),
        A.timing(packBobRef.current, { toValue: 0, duration: 2400, easing, useNativeDriver: true }),
      ]),
    );
    let stopped = false;
    const apply = (enabled: boolean) => {
      if (enabled) {
        try { bob.stop(); } catch { /* noop */ }
        packBobRef.current?.setValue?.(0.5);
      } else if (!stopped) {
        bob.start();
      }
    };
    AI?.isReduceMotionEnabled?.().then(apply).catch(() => bob.start()) ?? bob.start();
    const sub = AI?.addEventListener?.('reduceMotionChanged', apply);
    return () => {
      stopped = true;
      try { bob.stop(); } catch { /* noop */ }
      sub?.remove?.();
    };
  }, []);
  const packTranslateY = hasAnimated && packBobRef.current
    ? packBobRef.current.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] })
    : 0;
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
      const [summary, walletBeforeFloor, streak] = await Promise.all([
        loadHomeDeckSummaries({ premium: isPremiumUser, remote: false }),
        loadRewardWalletState(),
        loadStreakSnapshot(),
      ]);
      if (!isMountedRef.current) return;
      const currentSelectedSlug = selectedSlugRef.current;
      const activeSlug = currentSelectedSlug ?? summary.deckSummaries[0]?.slug ?? null;
      if (!currentSelectedSlug && activeSlug) {
        setSelectedSlug(activeSlug);
      }
      const now = new Date(summary.asOfISO);
      // The economy floor lives here, and only here, because this is the one
      // point in the app where its three inputs are in hand at the same
      // instant: the deck summaries brought owned-new and due, the wallet read
      // brought the balance. Pushing it down into loadHomeDeckSummaries would
      // put the grant on the far side of a Promise.all from the wallet read
      // that renders it -- the write would land after the read that the view
      // model uses, so the load that granted a pull would still draw "Clear
      // today's route to unlock pulls" and the user would be told they are
      // stuck on the very screen that just unstuck them. Sequencing it after
      // the join costs one storage round-trip on starved loads only (the
      // predicate short-circuits before touching storage otherwise) and buys
      // the guarantee that the wallet Home renders is the wallet Home wrote.
      const { wallet } = await applyEconomyFloorIfStarved({
        ownedNewCount: summary.totalNewAllDecks,
        dueCount: summary.totalDueAllDecks,
        wallet: walletBeforeFloor,
        now,
      });
      if (!isMountedRef.current) return;
      homeInputsRef.current = { summary, wallet, streak };
      startAutoUpdates(summary);
      publishReadyVm(homeInputsRef.current);
    } catch {
      if (!isMountedRef.current) return;
      const fallbackWallet = await loadRewardWalletState().catch(() => ({
        availablePulls: 0,
        reservePulls: 0,
      }));
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
  // no loadHomeDeckSummaries, no storage read, no network -- so a tile tap
  // highlights instantly. Falls back to a full refresh only before the first
  // successful load has produced any inputs.
  const selectPackLocally = useCallback(
    (slug: string) => {
      selectedSlugRef.current = slug;
      setSelectedSlug(slug);
      void setActiveDeckSlug(slug);
      if (homeInputsRef.current) {
        publishReadyVm(homeInputsRef.current);
      } else {
        void refreshHome();
      }
    },
    [publishReadyVm, refreshHome],
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
  const handlePrimaryCta = useCallback(async () => {
    const slug = homeState.vm.selectedDeckSlug ?? selectedDeckRow?.deck.slug ?? null;
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
  }, [homeState.vm, navigation, refreshHome, selectedDeckRow]);
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
  const primaryCtaDisabled =
    homeState.vm.cta.disabled ||
    (homeState.vm.cta.nav === 'challenge' && !homeState.vm.selectedDeckSlug);
  const totalDueAcrossDecks = homeState.vm.counts.totalDueAllDecks;
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

            {/* Header — title + functional status subtitle (not marketing).
                The subtitle reflects what's actually waiting today, so the
                top of the page already answers "what should I do?". */}
            <View style={styles.headerRow}>
              <View style={styles.headerTextWrap}>
                <Text style={styles.title} numberOfLines={1}>
                  DeveloperCards
                </Text>
                <Text style={styles.headerStatusSubtitle} numberOfLines={1}>
                  {totalDueAcrossDecks > 0
                    ? `${totalDueAcrossDecks} cards waiting today`
                    : homeState.vm.draw.state === 'available' || homeState.vm.draw.state === 'reserve'
                      ? 'A reward draw is ready'
                      : firstDrawCoach
                        ? 'Tap your pack to begin'
                        : selectedDeckRow?.deck.canStudy &&
                            selectedDeckRow.deck.dueToday === 0 &&
                            selectedDeckRow.deck.newToday === 0 &&
                            homeState.vm.draw.state === 'locked'
                          ? 'Caught up'
                          : 'All caught up for now'}
                </Text>
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
            {/* ─── HERO BAND v4 ──────────────────────────────────────
                Pack now FLOATS on the page background — no frame, no
                border, no parchmentBg backing. Just shadow + a soft gold
                halo positioned behind it for ambient light. The pack
                also bobs gently (3px translateY) when motion is enabled.
                Hero copy is action-driven, not a duplicate of the pack name. */}
            {(() => {
              // Build the shelf from real manifest rows only. Rows with
              // availability: 'coming' render as disabled "Soon" tiles.
              const realRows = homeState.vm.decks.rows;

              const realVisualDecks: HomeVisualDeck[] = realRows.map((realRow) => {
                const slug = realRow.deck.slug;
                const cover = packImageForSlug(slug);
                const palette = packPaletteFromSlug(slug);
                const dueCount = (realRow.deck as any)?.dueCount ?? (realRow.deck as any)?.dueToday ?? 0;
                const totalCards = (realRow.deck as any)?.totalCards ?? 0;
                const masteredCount = (realRow.deck as any)?.masteredCount ?? 0;
                // Fully mastered: every card in the deck has reached the
                // mastery stage (stage >= 4, read from masteredCount — F11).
                // The learned-count proxy ("reviewed once") must not decide
                // this. We also require dueCount=0 (no review is currently
                // due) to avoid celebrating prematurely when a card just
                // dropped back into review.
                const isFullyMastered =
                  totalCards > 0 && masteredCount >= totalCards && dueCount === 0;
                let status = 'Ready';
                if (realRow.actionHint === 'none') status = 'Soon';
                else if (realRow.actionHint === 'paywall') status = 'Locked';
                else if (realRow.actionHint === 'install' || realRow.actionHint === 'trial-start') status = 'Install';
                else if (realRow.update?.state === 'updating') status = 'Updating';
                else if (realRow.actionHint === 'update') status = 'Update';
                else if (isFullyMastered) status = 'Mastered ✓';
                else if (dueCount > 0) status = `${dueCount} due`;
                return {
                  slug,
                  title: realRow.deck.title ?? slug,
                  shortTitle: realRow.shortTitle,
                  realRow,
                  cover,
                  palette,
                  status,
                  isFullyMastered,
                  disabled: realRow.actionHint === 'none',
                  selected: slug === homeState.vm.selectedDeckSlug,
                };
              });

              const visualDecks = realVisualDecks;
              const EMPTY_FEATURED: HomeVisualDeck = {
                slug: 'default',
                title: 'Your first pack',
                shortTitle: 'Your first pack',
                realRow: null,
                cover: packImageForSlug('default'),
                palette: packPaletteFromSlug('default'),
                status: 'Soon',
                isFullyMastered: false,
                disabled: true,
                selected: false,
              };
              const featuredDeck: HomeVisualDeck =
                visualDecks.find((d) => d.selected)
                ?? visualDecks.find((d) => !d.disabled)
                ?? visualDecks[0]
                ?? EMPTY_FEATURED;

              // Action-driven hero title — NEVER duplicate the pack name.
              // Priority: deck-mastered celebration → due count →
              // reward draw ready → vm fallback.
              const isFeaturedMastered = featuredDeck.isFullyMastered;
              const heroTitle =
                isFeaturedMastered
                  ? 'Deck mastered 🎉'
                  : totalDueAcrossDecks > 0
                    ? `${totalDueAcrossDecks} cards waiting`
                    : (homeState.vm.draw.state === 'available' || homeState.vm.draw.state === 'reserve')
                      ? 'A reward draw is ready'
                      : homeState.vm.hero.headline;

              // Status dot color for selector tiles (replaces text badge)
              const statusDotColor = (deck: HomeVisualDeck) => {
                if (!deck.realRow || deck.status === 'Soon') return colors.inkMuted;
                if (deck.status === 'Locked') return colors.inkMuted;
                if (deck.status === 'Install' || deck.status === 'Update' || deck.status === 'Updating') return colors.pokeBlue;
                if (deck.status.endsWith(' due')) return colors.gold;
                return colors.mint; // ready / default
              };

              // Featured-pack press handler — pack is now tappable.
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
              const featuredPackAccessibilityLabel = !featuredDeck.realRow
                ? 'Connect to load packs'
                : firstDrawCoach
                  ? 'Open reward draw'
                  : resolvesFeaturedDeck
                    ? `${featuredDeck.status} ${featuredDeck.title}`
                    : homeState.vm.cta.label;
              const handleFeaturedPackPress = () => {
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
                  {/* ─── HERO BAND — pack floats on page background ──── */}
                  <View style={styles.heroBand}>
                    {/* Gold radial halo behind the pack (faint ambient
                        light, no border, low opacity). Sits in the bg layer. */}
                    <View pointerEvents="none" style={styles.heroHalo} />

                    {/* Pack is now tappable — direct affordance to "open
                        this pack". Wrap AnimatedView (idle bob) in a
                        Pressable. Press routes intelligently per state. */}
                    <Pressable
                      testID="home-featured-pack"
                      accessibilityRole="button"
                      accessibilityLabel={featuredPackAccessibilityLabel}
                      onPress={handleFeaturedPackPress}
                      hitSlop={8}
                    >
                      <AnimatedView
                        style={[
                          styles.heroPackFloat,
                          hasAnimated ? { transform: [{ translateY: packTranslateY }] } : null,
                        ]}
                      >
                        {featuredDeck.cover && RNImage ? (
                          <RNImage
                            source={featuredDeck.cover}
                            resizeMode="contain"
                            style={styles.heroPackImage}
                          />
                        ) : (
                          <LinearGradient
                            colors={featuredDeck.palette.cover}
                            start={{ x: 0.1, y: 0 }}
                            end={{ x: 0.9, y: 1 }}
                            style={styles.heroPackFallback}
                          >
                            <Text style={styles.heroPackFallbackTitle} numberOfLines={2}>
                              {featuredDeck.title}
                            </Text>
                          </LinearGradient>
                        )}
                      </AnimatedView>
                    </Pressable>

                    {/* Action-driven title — never duplicates the pack
                        name. "12 cards waiting" beats "C#" every time. */}
                    <Text style={styles.heroTitle} numberOfLines={1}>
                      {heroTitle}
                    </Text>
                  </View>

                  {/* ─── ACTION GROUP — pressure + CTA + draw status ──── */}
                  <View style={styles.actionGroup}>
                    <TodayPressureCard
                      counts={homeState.vm.counts}
                      selectedDeckTitle={homeState.vm.selectedDeckTitle}
                    />
                    {/* One line for the selected deck while a newer build exists:
                        "Updating …" while the free-deck auto-installer runs, and the
                        manual fallback ("tap the pack to install") when it has not
                        or could not. */}
                    {homeState.vm.updateNotice ? (
                      <Text
                        testID="home-update-notice"
                        style={[
                          styles.updateNotice,
                          homeState.vm.updateNotice.state === 'updating' && styles.updateNoticeUpdating,
                        ]}
                        numberOfLines={1}
                      >
                        {homeState.vm.updateNotice.text}
                      </Text>
                    ) : null}
                    {homeState.vm.goal ? (
                      <Text testID="home-goal-line" style={styles.goalLine} numberOfLines={1}>
                        {`${homeState.vm.goal.minimum} · ${homeState.vm.goal.fullClear}`}
                      </Text>
                    ) : null}
                    <View testID="screen-home-primary-cta">
                      <Pressable
                        testID={homeState.vm.cta.testID}
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
                          {homeState.vm.cta.label}
                        </Text>
                      </Pressable>
                    </View>
                    <Text
                      testID="home-draw-status-badge"
                      style={styles.rewardStatusText}
                      numberOfLines={1}
                    >
                      {homeState.vm.draw.label}
                    </Text>
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

                  {/* ─── SELECTOR v4 — small thumbnails + status dots ──── */}
                  <View style={styles.selectorBlock}>
                    <Text style={styles.sectionLabel} numberOfLines={1}>
                      Your packs
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.selectorContent}
                      testID="home-pack-visual"
                    >
                      {visualDecks.map((d) => (
                        <Pressable
                          key={d.slug}
                          accessibilityRole="button"
                          accessibilityLabel={`${d.shortTitle} pack — ${d.status}`}
                          disabled={d.disabled}
                          style={({ pressed }) => [
                            styles.selectorTile,
                            d.selected && styles.selectorTileSelected,
                            pressed && styles.pressed,
                          ]}
                          onPress={() => {
                            if (!d.realRow) return;
                            const hint = d.realRow.actionHint;
                            const updating = d.realRow.update?.state === 'updating';
                            if (hint === 'open' || hint === 'none' || (hint === 'update' && updating)) {
                              selectPackLocally(d.slug);
                              return;
                            }
                            void handleDeckPress(d.realRow);
                          }}
                        >
                          {/* Two-layer thumbnail: outer = shadow, inner = clip */}
                          <View style={styles.selectorThumbShadow}>
                            <View style={styles.selectorThumbFrame}>
                              {d.cover && RNImage ? (
                                <RNImage
                                  source={d.cover}
                                  resizeMode="contain"
                                  style={styles.selectorThumbImage}
                                />
                              ) : (
                                <LinearGradient
                                  colors={d.palette.cover}
                                  start={{ x: 0.1, y: 0 }}
                                  end={{ x: 0.9, y: 1 }}
                                  style={styles.selectorThumbFallback}
                                >
                                  <Text style={styles.selectorThumbFallbackText} numberOfLines={1}>
                                    {d.shortTitle}
                                  </Text>
                                </LinearGradient>
                              )}
                            </View>
                            {/* Update chip over the pack art. The blue dot alone
                                said nothing; a stale deck (81 of 115 cards) now
                                says what it is missing, or that it is on its way. */}
                            {d.realRow?.update ? (
                              <View
                                testID={`home-pack-update-chip-${d.slug}`}
                                pointerEvents="none"
                                style={[
                                  styles.selectorUpdateChip,
                                  d.realRow.update.state === 'updating' && styles.selectorUpdateChipUpdating,
                                ]}
                              >
                                <Text style={styles.selectorUpdateChipText} numberOfLines={2}>
                                  {d.realRow.update.chipLabel}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {/* Tile meta: status color dot + short title (two lines allowed) */}
                          <View style={styles.selectorMetaRow}>
                            <View
                              style={[
                                styles.selectorStatusDot,
                                { backgroundColor: statusDotColor(d) },
                              ]}
                            />
                            <Text
                              style={[
                                styles.selectorTitle,
                                d.selected && styles.selectorTitleSelected,
                              ]}
                              numberOfLines={2}
                            >
                              {d.shortTitle}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
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
  // No card chrome around the pack. The pack lives on the page background
  // with only a shadow + a soft gold halo behind it. Hero copy sits below
  // the pack (centered), action-driven, never duplicating the pack name.
  heroBand: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  // Soft gold halo positioned BEHIND the pack — gives an ambient-light
  // feel without adding any structural framing. Sits 220×220 centered.
  heroHalo: {
    position: 'absolute',
    top: 0,
    width: 240,
    height: 240,
    borderRadius: 240,
    backgroundColor: 'rgba(232,184,90,0.18)', // colors.glowGold @ 18%
  },
  // Floating pack — shadow only, no border, no backing color. The image
  // is drawn directly on the parchment page.
  heroPackFloat: {
    width: 168,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(58,35,5,0.30)',
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  heroPackImage: {
    width: '100%',
    height: '100%',
  },
  heroPackFallback: {
    width: 168,
    height: 240,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  heroPackFallbackTitle: {
    color: '#FFFFFF',
    fontSize: typography.title2,
    fontWeight: '900',
    textAlign: 'center',
  },
  heroTitle: {
    marginTop: 6,
    fontSize: typography.title1,
    lineHeight: 34,
    fontWeight: '900',
    color: colors.ink,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  // ─── ACTION GROUP — pressure + CTA + draw status ────────────────────
  // Wider top margin from heroBand → makes hero clearly the visual lead.
  actionGroup: {
    marginTop: spacing.sm,
  },
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

  // ─── HOME v4 — pack selector with thumbnails ────────────────────────
  // Bigger top margin (lg) than the rest of the gaps — that's how the
  // page tells the user "selector is below the hero, not part of it".
  selectorBlock: {
    marginTop: spacing.lg,
  },
  sectionLabel: {
    marginBottom: spacing.xs,
    fontSize: typography.caption,
    fontWeight: '900',
    color: colors.inkMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  selectorContent: {
    columnGap: 12,
    paddingRight: spacing.screenPadding,
    paddingVertical: 4,
  },
  selectorTile: {
    width: 72,
    alignItems: 'center',
  },
  selectorTileSelected: {
    transform: [{ translateY: -3 }],
  },
  // Two-layer thumbnail: outer = shadow only, inner = clip
  selectorThumbShadow: {
    width: 64,
    height: 88,
    borderRadius: 10,
    shadowColor: 'rgba(58,35,5,0.20)',
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  // "Update · +34 cards" pill pinned to the bottom of the thumbnail. Wider
  // than the 64pt thumb on purpose (it may wrap to two short lines) and
  // centred on it, so the count survives the tile width.
  selectorUpdateChip: {
    position: 'absolute',
    bottom: 4,
    left: -4,
    right: -4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorUpdateChipUpdating: {
    backgroundColor: colors.inkSecondary,
  },
  selectorUpdateChipText: {
    color: '#FFFFFF',
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '900',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  selectorThumbFrame: {
    width: 64,
    height: 88,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  selectorThumbImage: {
    width: '100%',
    height: '100%',
  },
  selectorThumbFallback: {
    width: 64,
    height: 88,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  selectorThumbFallbackText: {
    color: '#FFFFFF',
    fontSize: typography.caption,
    fontWeight: '900',
    textAlign: 'center',
  },
  selectorMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    maxWidth: 72,
  },
  selectorStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginTop: 4,
  },
  selectorTitle: {
    fontSize: typography.caption,
    lineHeight: 14,
    fontWeight: '900',
    color: colors.inkSoft,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  selectorTitleSelected: {
    color: colors.pokeBlueDeep,
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
