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
type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;
type HomeState = {
  loading: boolean;
  error: string | null;
  vm: HomeViewModel;
};
const EMPTY_VM = buildHomeScreenVM({ state: 'empty' });
const HOME_TOKENS = {
  border: 'rgba(90,75,56,0.16)',
  borderStrong: 'rgba(90,75,56,0.18)',
  borderSoft: 'rgba(90,75,56,0.12)',
  card: 'rgba(255,255,255,0.88)',
  cardSoft: 'rgba(255,255,255,0.72)',
  cardSofter: 'rgba(255,255,255,0.62)',
  iconBg: 'rgba(255,255,255,0.84)',
  badgeBg: 'rgba(243,232,200,0.8)',
  linkBg: 'rgba(232,184,90,0.2)',
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
        navigation.navigate('Challenge', { slug });
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
  const hasDrawPulls = homeState.vm.draw.state !== 'locked';
  const primaryCtaLabel =
    hasDrawPulls && homeState.vm.selectedDeckTitle
      ? `Open ${homeState.vm.selectedDeckTitle}`
      : homeState.vm.cta.label;
  const totalDueAcrossDecks = homeState.vm.counts.totalDueAllDecks;
  if (homeState.loading) {
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
            <View style={styles.headerRow}>
              <View style={styles.headerTextWrap}>
                <Text style={styles.kicker} numberOfLines={1}>
                  HOME
                </Text>
                <Text style={styles.title} numberOfLines={1}>
                  RecallSmith
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  Today's plan, in one screen.
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
            <View style={styles.primaryCard}>
              <Text style={styles.heroEyebrow} numberOfLines={1}>
                {homeState.vm.hero.eyebrow}
              </Text>
              <Text style={styles.heroHeadline} numberOfLines={2}>
                {homeState.vm.hero.headline}
              </Text>
              <Text style={styles.heroSubline} numberOfLines={1}>
                {homeState.vm.hero.subline}
              </Text>
              <View style={styles.countsSlot}>
                <TodayPressureCard
                  counts={homeState.vm.counts}
                  selectedDeckTitle={homeState.vm.selectedDeckTitle}
                />
              </View>
              <View style={styles.goalRow}>
                <Text style={styles.goalText} numberOfLines={1}>
                  {homeState.vm.goal.minimum}
                </Text>
                <Text style={styles.goalText} numberOfLines={1}>
                  {homeState.vm.goal.fullClear}
                </Text>
              </View>
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
                    {primaryCtaLabel}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.drawBadge} numberOfLines={1}>
                {homeState.vm.draw.label}
              </Text>
              {totalDueAcrossDecks > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  testID="home-study-due-link"
                  style={({ pressed }) => [styles.studyDueLink, pressed && styles.pressed]}
                  onPress={() => navigation.navigate('Challenge')}
                >
                  <Text style={styles.studyDueLinkText} numberOfLines={1}>
                    {`Study ${totalDueAcrossDecks} due cards`}
                  </Text>
                </Pressable>
              ) : null}
              {firstDrawCoach ? (
                <Pressable
                  accessibilityRole="button"
                  testID="home-first-draw-link"
                  style={({ pressed }) => [styles.heroSecondaryLink, pressed && styles.pressed]}
                  onPress={() =>
                    navigation.navigate('Draw', {
                      slug: homeState.vm.selectedDeckSlug ?? undefined,
                      rewardPending: true,
                    })
                  }
                >
                  <Text style={styles.heroSecondaryLinkText} numberOfLines={1}>
                    Open first draw
                  </Text>
                </Pressable>
              ) : null}
              {homeState.error ? (
                <Text style={styles.errorText} numberOfLines={2}>
                  {homeState.error}
                </Text>
              ) : null}
            </View>
            <Pressable
              testID="home-collapse-decks-toggle"
              accessibilityRole="button"
              accessibilityState={{ expanded: deckOpen }}
              style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}
              onPress={() => setDeckOpen((prev) => !prev)}
            >
              <View style={styles.collapseTextWrap}>
                <Text style={styles.collapseTitle} numberOfLines={1}>
                  Your decks ({homeState.vm.decks.rows.length})
                </Text>
                <Text style={styles.collapseSubtitle} numberOfLines={1}>
                  Deck status and actions
                </Text>
              </View>
              <Text style={styles.collapseArrow} numberOfLines={1}>
                {deckOpen ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
            {deckOpen ? (
              <View style={styles.collapseBody}>
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
            ) : null}
            <Pressable
              testID="home-collapse-week-support-toggle"
              accessibilityRole="button"
              accessibilityState={{ expanded: calendarOpen }}
              style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}
              onPress={() => setCalendarOpen((prev) => !prev)}
            >
              <View style={styles.collapseTextWrap}>
                <Text style={styles.collapseTitle} numberOfLines={1}>
                  Week support
                </Text>
                <Text style={styles.collapseSubtitle} numberOfLines={1}>
                  7-day review shape
                </Text>
              </View>
              <Text style={styles.collapseArrow} numberOfLines={1}>
                {calendarOpen ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
            {calendarOpen ? <View style={styles.calendarGrid}>{renderCalendar}</View> : null}
            {homeState.vm.account.lockup ? (
              <Text style={styles.accountLockup} numberOfLines={1}>
                {homeState.vm.account.lockup}
              </Text>
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
  settingsIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: HOME_TOKENS.border, backgroundColor: HOME_TOKENS.iconBg },
  settingsText: { color: colors.ink, fontSize: 18 },
  primaryCard: { borderRadius: spacing.lg, borderWidth: 1, borderColor: HOME_TOKENS.borderStrong, backgroundColor: HOME_TOKENS.card, padding: spacing.md },
  heroEyebrow: { fontSize: typography.caption, fontWeight: '800', color: colors.gold, letterSpacing: 0.8 },
  heroHeadline: { marginTop: spacing.xs, fontSize: typography.title2, lineHeight: 28, fontWeight: '900', color: colors.ink },
  heroSubline: { marginTop: 6, fontSize: typography.bodySmall, color: colors.inkSecondary },
  countsSlot: { marginTop: spacing.sm },
  goalRow: { marginTop: spacing.xs, gap: 4 },
  goalText: { fontSize: typography.bodySmall, color: colors.inkSecondary, fontWeight: '700' },
  primaryCta: { marginTop: spacing.sm, minHeight: 46, borderRadius: spacing.buttonRadius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.ink },
  primaryCtaDisabled: { opacity: 0.45 },
  primaryCtaText: { color: colors.parchmentBg, fontSize: typography.button, fontWeight: '900' },
  drawBadge: { marginTop: spacing.sm, alignSelf: 'flex-start', fontSize: typography.caption, fontWeight: '800', color: colors.inkSecondary, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: HOME_TOKENS.borderStrong, backgroundColor: HOME_TOKENS.badgeBg },
  studyDueLink: { marginTop: spacing.xs, minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  studyDueLinkText: { fontSize: typography.bodySmall, fontWeight: '800', color: colors.ink },
  heroSecondaryLink: { marginTop: spacing.xs, minHeight: 44, alignSelf: 'flex-start', borderRadius: spacing.buttonRadius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, backgroundColor: HOME_TOKENS.linkBg },
  heroSecondaryLinkText: { fontSize: typography.bodySmall, fontWeight: '800', color: colors.ink },
  errorText: { marginTop: spacing.xs, color: colors.danger, fontSize: typography.caption, lineHeight: 16 },
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
  accountLockup: { marginTop: spacing.sm, fontSize: typography.caption, color: colors.inkSecondary },
});
