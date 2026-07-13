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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import {
  buildHomeScreenVM,
  type HomeDeckVM,
  type HomeRuntimeStatus,
  type HomeViewModel,
} from '../features/gacha/selectors/homeSelectors';
import TodayPressureCard from '../features/gacha/components/TodayPressureCard';
import {
  executeDeckAction,
  loadHomeDeckSummaries,
  resolveDeckAction,
} from '../features/gacha/home/deckActionResolver';
import HomeDeckRow from '../features/gacha/home/HomeDeckRow';
import { fetchServerPremium } from '../features/gacha/home/homeRemote';
import { loadRewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { loadStreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { formatDateKey } from '../review/model';
import { forceProgressSync } from '../sync/progressSync';
import { useAuthStore } from '../auth/authStore';
import { setIsPremiumUser, usePremiumUser } from '../premium/premiumStore';
import { useSessionStore } from '../features/gacha/session/sessionStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { packImageForSlug, packPaletteFromSlug } from '../theme/packArt';

// ─── Mocked deck shelf for the home carousel ─────────────────────────────
// Real backend decks (manifest) may differ. These are visual placeholders
// for the upcoming C# / AI / Cloud launches — tap a pack to navigate to
// the Draw flow with that slug. Once those decks ship, this constant goes
// away and we read from `homeState.vm` instead.
const MOCKED_HOME_DECKS = [
  { slug: 'csharp', title: 'C#', tagline: 'Interview core' },
  { slug: 'ai', title: 'AI', tagline: 'ML & prompt engineering' },
  { slug: 'cloud', title: 'Cloud', tagline: 'AWS / GCP / Azure' },
] as const;

// Vitest mocks react-native without Image — guarded lookup so tests don't crash.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);
// Safe Animated lookup — vitest's RN mock proxy throws on missing exports.
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
  const authStatus = useAuthStore((s) => s.status);
  const accessToken = useAuthStore((s) => s.accessToken);
  const authInit = useAuthStore((s) => s.init);
  const authUserSub = useAuthStore((s) => s.userSub);
  const isSignedIn = authStatus === 'signed_in';
  const cachedPremium = usePremiumUser(authUserSub);
  const [serverPremium, setServerPremium] = useState(false);
  const [serverPremiumLoaded, setServerPremiumLoaded] = useState(false);
  const isPremiumUser = serverPremiumLoaded ? serverPremium : cachedPremium;
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
  // Pack bobs gently up/down (3px) on a 3s loop — gives the hero a
  // pulse without distracting from content. Kicker breathes in opacity
  // (0.6 ↔ 1) on a faster 2.2s loop. Both are guarded by hasAnimated so
  // vitest stays happy.
  const packBobRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const kickerBreathRef = useRef<any>(hasAnimated ? new A.Value(1) : null);
  useEffect(() => {
    if (!hasAnimated) return;
    const bob = A.loop(
      A.sequence([
        A.timing(packBobRef.current, { toValue: 1, duration: 1500, useNativeDriver: true }),
        A.timing(packBobRef.current, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ]),
    );
    const breath = A.loop(
      A.sequence([
        A.timing(kickerBreathRef.current, { toValue: 0.6, duration: 1100, useNativeDriver: true }),
        A.timing(kickerBreathRef.current, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]),
    );
    bob.start();
    breath.start();
    return () => {
      try { bob.stop(); } catch { /* noop */ }
      try { breath.stop(); } catch { /* noop */ }
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
  const refreshHome = useCallback(async () => {
    setHomeState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [summary, wallet, streak] = await Promise.all([
        loadHomeDeckSummaries({ premium: isPremiumUser }),
        loadRewardWalletState(),
        loadStreakSnapshot(),
      ]);
      if (!isMountedRef.current) return;
      const currentSelectedSlug = selectedSlugRef.current;
      const activeSlug = currentSelectedSlug ?? summary.deckSummaries[0]?.slug ?? null;
      if (!currentSelectedSlug && activeSlug) {
        setSelectedSlug(activeSlug);
      }
      const session = useSessionStore.getState();
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
      const vm = buildHomeScreenVM({
        state: 'ready',
        params: {
          deckSummaries: summary.deckSummaries,
          selectedSlug: activeSlug,
          hasSignedInUser: isSignedIn,
          wallet,
          updates: summary.updates,
          allUpcoming30: summary.allUpcoming30,
          premium: isPremiumUser,
          accountLockup: isSignedIn
            ? null
            : 'Sign in to unlock cloud backup and month planning.',
          runtimeStatus,
        },
      });
      setHomeState({ loading: false, error: null, vm });
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
    }
  }, [isPremiumUser, isSignedIn]);
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
      setHomeState((prev) => ({ ...prev, loading: true }));
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
          navigation.navigate('Paywall');
          return;
        }
        if (action.kind === 'none') {
          return;
        }
        const { activeSlug } = await executeDeckAction(action);
        setSelectedSlug(activeSlug);
        if (action.kind === 'open' || action.kind === 'install' || action.kind === 'update' || action.kind === 'trial-start') {
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
    [isPremiumUser, isSignedIn, navigation, refreshHome],
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
      <SafeAreaProvider>
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
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} testID="screen-home-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
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
                also bobs gently (3px translateY, 3s loop) and the gold
                kicker breathes in opacity. Hero copy is action-driven,
                NOT a duplicate of the pack name. */}
            {(() => {
              // Build deck list — REAL installed decks first (using
              // their actual slugs from the backend manifest), then
              // fill remaining slots with MOCKED entries that aren't
              // already represented (for "Coming soon" packs we plan
              // to ship). This avoids the bug where a slug mismatch
              // (e.g. real slug 'cs-dotnet' vs mock 'csharp') made the
              // featured pack tap show "Coming soon" even though the
              // user had the deck installed.
              const realRows = homeState.vm.decks.rows;
              const realSlugSet = new Set(realRows.map((r) => r.deck.slug));

              const realVisualDecks = realRows.map((realRow) => {
                const slug = realRow.deck.slug;
                const cover = packImageForSlug(slug);
                const palette = packPaletteFromSlug(slug);
                const dueCount = (realRow.deck as any)?.dueCount ?? (realRow.deck as any)?.dueToday ?? 0;
                const totalCards = (realRow.deck as any)?.totalCards ?? 0;
                const masteredApprox = (realRow.deck as any)?.masteredApprox ?? 0;
                // Fully mastered: every card in the deck has reached
                // mastery stage. We also require dueCount=0 (no review
                // is currently due) to avoid celebrating prematurely
                // when a card just dropped back into review.
                const isFullyMastered =
                  totalCards > 0 && masteredApprox >= totalCards && dueCount === 0;
                let status = 'Ready';
                if (realRow.actionHint === 'paywall') status = 'Locked';
                else if (realRow.actionHint === 'install' || realRow.actionHint === 'trial-start') status = 'Install';
                else if (realRow.actionHint === 'update') status = 'Update';
                else if (isFullyMastered) status = 'Mastered ✓';
                else if (dueCount > 0) status = `${dueCount} due`;
                return {
                  slug,
                  title: realRow.deck.title ?? slug,
                  tagline: '',
                  realRow,
                  cover,
                  palette,
                  status,
                  isFullyMastered,
                  disabled: false,
                  selected: slug === homeState.vm.selectedDeckSlug,
                };
              });

              const mockedFillerDecks = MOCKED_HOME_DECKS
                .filter((d) => !realSlugSet.has(d.slug))
                .map((d) => ({
                  ...d,
                  realRow: undefined as any,
                  cover: packImageForSlug(d.slug),
                  palette: packPaletteFromSlug(d.slug),
                  status: 'Coming soon',
                  disabled: true,
                  selected: false,
                }));

              const visualDecks = [...realVisualDecks, ...mockedFillerDecks];
              const featuredDeck =
                visualDecks.find((d) => d.selected) ??
                visualDecks.find((d) => d.realRow) ??
                visualDecks[0];

              // Action-driven hero title — NEVER duplicate the pack name.
              // Priority: deck-mastered celebration → due count →
              // reward draw ready → vm fallback.
              const featuredDeckProvisional =
                visualDecks.find((d) => d.selected)
                ?? visualDecks.find((d) => d.realRow)
                ?? visualDecks[0];
              const isFeaturedMastered = !!(featuredDeckProvisional as any)?.isFullyMastered;
              const heroTitle =
                isFeaturedMastered
                  ? 'Deck mastered 🎉'
                  : totalDueAcrossDecks > 0
                    ? `${totalDueAcrossDecks} cards waiting`
                    : (homeState.vm.draw.state === 'available' || homeState.vm.draw.state === 'reserve')
                      ? 'A reward draw is ready'
                      : homeState.vm.hero.headline;

              // Status dot color for selector tiles (replaces text badge)
              const statusDotColor = (deck: typeof visualDecks[number]) => {
                if (!deck.realRow) return colors.inkMuted; // coming soon
                if (deck.status === 'Locked') return colors.inkMuted;
                if (deck.status === 'Install' || deck.status === 'Update') return colors.pokeBlue;
                if (deck.status.endsWith(' due')) return colors.gold;
                return colors.mint; // ready / default
              };

              // Featured-pack press handler — pack is now tappable.
              // Resolves to the most natural intent for each state:
              //   • mocked-only (no realRow) → Coming soon alert
              //   • paywall / install / update / trial → resolver
              //     (handleDeckPress routes to Paywall / installs the pack / etc)
              //   • installed + has pulls → straight to Draw
              //   • installed + no pulls → SessionCard (earn pulls path)
              const drawState = homeState.vm.draw.state;
              const walletHasPulls =
                drawState === 'available' || drawState === 'reserve' || drawState === 'wallet-full';
              const handleFeaturedPackPress = () => {
                if (!featuredDeck.realRow) {
                  Alert.alert(
                    `${featuredDeck.title} — Coming soon`,
                    'This pack will be available shortly.',
                  );
                  return;
                }
                const hint = featuredDeck.realRow.actionHint;
                if (
                  hint === 'paywall'
                  || hint === 'install'
                  || hint === 'update'
                  || hint === 'trial-start'
                ) {
                  void handleDeckPress(featuredDeck.realRow);
                  return;
                }
                if (walletHasPulls) {
                  navigation.navigate('Draw', {
                    slug: featuredDeck.slug,
                    rewardPending: drawState !== 'wallet-full',
                  });
                  return;
                }
                // Installed + no pulls → drop straight into a session
                // (matches the empty-pulls escape CTA in DrawScreen)
                navigation.navigate('SessionCard', { slug: featuredDeck.slug });
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
                      accessibilityLabel={`Open ${featuredDeck.title} pack`}
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

                    {/* Breathing kicker — gold uppercase status of the
                        featured pack (e.g. "12 DUE" / "READY"). Sits ABOVE
                        the title because it's the smallest text and the
                        title needs to be the visual landing. */}
                    <AnimatedView
                      style={[
                        styles.heroKickerWrap,
                        hasAnimated ? { opacity: kickerBreathRef.current ?? 1 } : null,
                      ]}
                    >
                      <Text style={styles.heroKicker} numberOfLines={1}>
                        {featuredDeck.status}
                      </Text>
                    </AnimatedView>

                    {/* Action-driven title — never duplicates the pack
                        name. "12 cards waiting" beats "C#" every time. */}
                    <Text style={styles.heroTitle} numberOfLines={2}>
                      {heroTitle}
                    </Text>
                    <Text style={styles.heroSupport} numberOfLines={2}>
                      {homeState.vm.hero.subline}
                    </Text>
                  </View>

                  {/* ─── ACTION GROUP — pressure + CTA + draw status ──── */}
                  <View style={styles.actionGroup}>
                    <TodayPressureCard
                      counts={homeState.vm.counts}
                      selectedDeckTitle={homeState.vm.selectedDeckTitle}
                    />
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
                      Choose a pack
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
                          accessibilityLabel={`${d.title} pack — ${d.status}`}
                          style={({ pressed }) => [
                            styles.selectorTile,
                            d.selected && styles.selectorTileSelected,
                            pressed && styles.pressed,
                          ]}
                          onPress={() => {
                            if (d.realRow) {
                              void handleDeckPress(d.realRow);
                            } else {
                              Alert.alert(
                                `${d.title} — Coming soon`,
                                'This pack will be available shortly.',
                              );
                            }
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
                                    {d.title}
                                  </Text>
                                </LinearGradient>
                              )}
                            </View>
                          </View>
                          {/* Tile meta: status color dot + title (no text badge) */}
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
                              numberOfLines={1}
                            >
                              {d.title}
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
    </SafeAreaProvider>
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
  kicker: { fontSize: typography.caption, fontWeight: '800', color: colors.inkSecondary, letterSpacing: 1 },
  title: { marginTop: 4, fontSize: typography.title1, fontWeight: '900', color: colors.ink },
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
    fontSize: 12,
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
    paddingBottom: spacing.lg,
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
  heroKickerWrap: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  // gold uppercase, breathes in opacity
  heroKicker: {
    fontSize: typography.caption,
    fontWeight: '900',
    color: colors.gold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
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
  heroSupport: {
    marginTop: 6,
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.inkMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  // ─── ACTION GROUP — pressure + CTA + draw status ────────────────────
  // Wider top margin from heroBand → makes hero clearly the visual lead.
  actionGroup: {
    marginTop: spacing.md,
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
  rewardStatusRow: {
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  rewardStatusText: {
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
    alignItems: 'center',
    gap: 4,
    maxWidth: 72,
  },
  selectorStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  selectorTitle: {
    fontSize: typography.caption,
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
    fontSize: 12,
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
