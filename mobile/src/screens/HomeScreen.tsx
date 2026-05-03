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
import { buildUpcoming, clamp01, isLearnedProgress } from '../features/gacha/selectors/progressSelectors';
import type { CalendarDay, DeckSummary } from '../features/gacha/contracts';
import { buildHomeVM, type HomeDeckVM, type HomeViewModel } from '../features/gacha/selectors/homeSelectors';
import TodayPressureCard from '../features/gacha/components/TodayPressureCard';
import {
  executeDeckAction,
  loadDeckUpdates,
  resolveDeckAction,
} from '../features/gacha/home/deckActionResolver';
import HomeDeckRow from '../features/gacha/home/HomeDeckRow';
import { fetchServerPremium } from '../features/gacha/home/homeRemote';
import { loadRewardWalletState, type RewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { loadDeckProgress } from '../review/storage';
import { listManifestDecks, resolveDeckBySlug, type ManifestDeckEntry } from '../content/deckRepository';
import { syncDailyReminders } from '../notifications/reminders';
import { applyCachedRemoteProgress, forceProgressSync } from '../sync/progressSync';
import { useAuthStore } from '../auth/authStore';
import { setIsPremiumUser, usePremiumUser } from '../premium/premiumStore';
import { resolveHomeState } from '../features/gacha/home/homeStateMachine';
import { MOCK_HOME_STATES } from '../mock/home';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;
type HomeState = {
  loading: boolean;
  error: string | null;
  vm: HomeViewModel;
};
const EMPTY_VM = buildHomeVM({
  deckSummaries: [],
  selectedSlug: null,
  hasSignedInUser: false,
});
function toDeckEntriesFromUpdates(rawUpdates: Record<string, any>): ManifestDeckEntry[] {
  return Object.entries(rawUpdates ?? {})
    .map(([slug, info]) => ({
      slug,
      title: String((info as any)?.title ?? slug),
      locale: String((info as any)?.locale ?? 'en-US'),
      version: String((info as any)?.remoteVersion ?? 'unknown'),
      deckType: Number((info as any)?.deckType ?? 1),
      tier: (info as any)?.tier ?? null,
      availability: (info as any)?.availability ?? 'live',
      eta: (info as any)?.eta ?? null,
      downloadMode: (info as any)?.downloadMode ?? null,
      totalCards:
        typeof (info as any)?.remoteCardCount === 'number'
          ? (info as any).remoteCardCount
          : undefined,
      buildId: null,
      path: null,
      sha256: null,
      order:
        typeof (info as any)?.order === 'number' ? Number((info as any).order) : undefined,
      retiredAtMs: null,
    }))
    .sort((a, b) => {
      const ao = typeof a.order === 'number' ? a.order : 9999;
      const bo = typeof b.order === 'number' ? b.order : 9999;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });
}
async function buildDeckSummaries(params: {
  premium: boolean;
}): Promise<{
  deckSummaries: DeckSummary[];
  updates: Record<string, any>;
  allUpcoming30: CalendarDay[];
  asOfISO: string;
}> {
  const { premium } = params;
  const now = new Date();
  let updates: Record<string, any> = {};
  let manifestDecks: ManifestDeckEntry[] = [];
  try {
    updates = await loadDeckUpdates(premium);
  } catch {
    updates = {};
  }
  try {
    manifestDecks = await listManifestDecks();
  } catch {
    manifestDecks = [];
  }
  const deckEntries =
    manifestDecks.length > 0 ? manifestDecks : toDeckEntriesFromUpdates(updates);
  const allUpcoming30 = buildUpcoming([], now, 30);
  const deckSummaries: DeckSummary[] = [];
  let totalDueAllDecks = 0;
  for (const entry of deckEntries) {
    const availability = String(entry.availability ?? 'live').toLowerCase();
    if (availability === 'retired') {
      continue;
    }
    if (availability === 'coming') {
      deckSummaries.push({
        slug: entry.slug,
        title: entry.title ?? entry.slug,
        locale: entry.locale ?? 'en-US',
        version: entry.version,
        deckType: entry.deckType ?? 1,
        totalCards: entry.totalCards ?? 0,
        localCards: 0,
        studyCards: 0,
        canStudy: false,
        tier: entry.tier ?? null,
        availability: entry.availability ?? null,
        eta: entry.eta ?? null,
        downloadMode: entry.downloadMode ?? null,
        order: entry.order,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        percent: 0,
      });
      continue;
    }
    const deck = await resolveDeckBySlug(entry.slug);
    const localCards = deck?.Cards?.length ?? (deck as any)?.TotalCards ?? 0;
    const canStudy = !!deck && localCards > 0;
    const declaredTotal =
      typeof entry.totalCards === 'number' && Number.isFinite(entry.totalCards)
        ? entry.totalCards
        : localCards;
    if (!canStudy) {
      deckSummaries.push({
        slug: entry.slug,
        title: entry.title ?? entry.slug,
        locale: entry.locale ?? 'en-US',
        version: entry.version,
        deckType: entry.deckType ?? 1,
        totalCards: declaredTotal,
        localCards,
        studyCards: localCards,
        canStudy: false,
        tier: entry.tier ?? null,
        availability: entry.availability ?? null,
        eta: entry.eta ?? null,
        downloadMode: entry.downloadMode ?? null,
        order: entry.order,
        dueToday: 0,
        plannedToday: 0,
        newToday: 0,
        masteredApprox: 0,
        percent: 0,
      });
      continue;
    }
    try {
      await applyCachedRemoteProgress((deck as any).Slug);
    } catch {
      // Keep local-only progress if remote cache fails.
    }
    const progress = await loadDeckProgress(deck as any);
    const learned = progress.filter(isLearnedProgress).length;
    const denom = Math.max(1, localCards);
    const upcoming = buildUpcoming(progress, now, 30);
    const dueToday = upcoming[0]?.count ?? 0;
    totalDueAllDecks += dueToday;
    for (let i = 0; i < allUpcoming30.length; i++) {
      allUpcoming30[i].count += upcoming[i]?.count ?? 0;
    }
    deckSummaries.push({
      slug: String((deck as any).Slug),
      title: String((deck as any).Title),
      locale: String((deck as any).Locale),
      version: String((deck as any).Version),
      deckType: Number((deck as any).DeckType ?? 1),
      totalCards: declaredTotal,
      localCards,
      studyCards: localCards,
      canStudy: true,
      tier: entry.tier ?? null,
      availability: entry.availability ?? null,
      eta: entry.eta ?? null,
      downloadMode: entry.downloadMode ?? null,
      order: entry.order,
      dueToday,
      plannedToday: dueToday,
      newToday: Math.max(0, denom - learned),
      masteredApprox: learned,
      percent: clamp01(learned / denom),
    });
  }
  void syncDailyReminders({ remainingDueCount: totalDueAllDecks, now });
  return {
    deckSummaries,
    updates,
    allUpcoming30,
    asOfISO: now.toISOString(),
  };
}
export function HomeScreen({ navigation, route }: Props) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [deckBusySlug, setDeckBusySlug] = useState<string | null>(null);
  const [drawWallet, setDrawWallet] = useState<RewardWalletState>({
    availablePulls: 0,
    reservePulls: 0,
  });
  const [streakSnapshot, setStreakSnapshot] = useState<StreakSnapshot | null>(null);
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
  const isPremiumUser = serverPremium;
  const firstDrawCoach = route.params?.firstDrawCoach ?? false;
  const mockHomeStateOverride = route.params?.mockState;
  useEffect(() => {
    void authInit();
  }, [authInit]);
  useEffect(() => {
    let cancelled = false;
    setServerPremium(false);
    (async () => {
      if (!accessToken || !accessToken.trim()) {
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
        try {
          await setIsPremiumUser(premium, authUserSub);
        } catch {
          // Cache sync is best effort.
        }
      } catch {
        if (cancelled) return;
        setServerPremium(false);
        try {
          await setIsPremiumUser(false, authUserSub);
        } catch {
          // Cache sync is best effort.
        }
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
        buildDeckSummaries({ premium: isPremiumUser }),
        loadRewardWalletState(),
        loadStreakSnapshot(),
      ]);
      if (!isMountedRef.current) return;
      const currentSelectedSlug = selectedSlugRef.current;
      const activeSlug = currentSelectedSlug ?? summary.deckSummaries[0]?.slug ?? null;
      if (!currentSelectedSlug && activeSlug) {
        setSelectedSlug(activeSlug);
      }
      const vm = buildHomeVM({
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
      });
      setDrawWallet(wallet);
      setStreakSnapshot(streak);
      setHomeState({ loading: false, error: null, vm });
    } catch {
      if (!isMountedRef.current) return;
      const fallbackWallet = await loadRewardWalletState().catch(() => ({
        availablePulls: 0,
        reservePulls: 0,
      }));
      const vm = buildHomeVM({
        deckSummaries: [],
        selectedSlug: null,
        hasSignedInUser: isSignedIn,
        wallet: fallbackWallet,
        statusHint: 'error',
        errorMessage: 'Could not refresh Home right now.',
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
  const v6HomeState = useMemo(() => {
    if (mockHomeStateOverride) {
      return mockHomeStateOverride;
    }
    return resolveHomeState({
      dueCount: homeState.vm.counts.selectedDue,
      newCount: homeState.vm.counts.selectedNew,
      wallet: drawWallet,
      streakCount: streakSnapshot?.currentDailyStreak ?? 0,
    });
  }, [drawWallet, streakSnapshot, homeState.vm, mockHomeStateOverride]);
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
  if (homeState.loading) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
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
      <SafeAreaView style={styles.safeArea}>
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
                  Today: decide if you should run, how many cards, and where to start.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
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
              <Pressable
                testID={homeState.vm.cta.testID}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryCta,
                  (homeState.vm.cta.disabled || !homeState.vm.selectedDeckSlug) &&
                    homeState.vm.cta.nav !== 'retry' &&
                    styles.primaryCtaDisabled,
                  pressed && styles.pressed,
                ]}
                disabled={
                  homeState.vm.cta.disabled ||
                  (!homeState.vm.selectedDeckSlug && homeState.vm.cta.nav !== 'retry')
                }
                onPress={() => {
                  void handlePrimaryCta();
                }}
              >
                <Text style={styles.primaryCtaText} numberOfLines={1}>
                  {homeState.vm.cta.label}
                </Text>
              </Pressable>
              <Text style={styles.drawBadge} numberOfLines={1}>
                {homeState.vm.draw.label}
              </Text>
              {homeState.error ? (
                <Text style={styles.errorText} numberOfLines={2}>
                  {homeState.error}
                </Text>
              ) : null}
            </View>
            <Pressable
              style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}
              onPress={() => setDeckOpen((prev) => !prev)}
            >
              <Text style={styles.collapseTitle} numberOfLines={1}>
                Your decks ({homeState.vm.decks.rows.length})
              </Text>
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
              style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}
              onPress={() => setCalendarOpen((prev) => !prev)}
            >
              <Text style={styles.collapseTitle} numberOfLines={1}>
                Week support
              </Text>
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
            <Pressable
              style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]}
              onPress={() =>
                navigation.navigate('Draw', {
                  slug: homeState.vm.selectedDeckSlug ?? undefined,
                  rewardPending: true,
                })
              }
            >
              <Text style={styles.secondaryCtaText} numberOfLines={1}>
                {firstDrawCoach ? 'Open first draw route' : 'Peek at reward draw'}
              </Text>
            </Pressable>
            {firstDrawCoach ? (
              <View style={styles.coachCard}>
                <Text style={styles.coachTitle} numberOfLines={1}>
                  First draw coach
                </Text>
                <Text style={styles.coachBody} numberOfLines={1}>
                  Draw first, then run the daily route.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.inlineButton, pressed && styles.pressed]}
                  onPress={() =>
                    navigation.navigate('Draw', {
                      slug: homeState.vm.selectedDeckSlug ?? undefined,
                      rewardPending: true,
                    })
                  }
                >
                  <Text style={styles.inlineButtonText} numberOfLines={1}>
                    Start first draw
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {v6HomeState !== 'active' ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateTitle} numberOfLines={1}>
                  {MOCK_HOME_STATES[v6HomeState].title}
                </Text>
                <Text style={styles.stateBody} numberOfLines={1}>
                  {MOCK_HOME_STATES[v6HomeState].helper}
                </Text>
              </View>
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
  settingsIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(90,75,56,0.16)', backgroundColor: 'rgba(255,255,255,0.84)' },
  settingsText: { color: colors.ink, fontSize: 18 },
  primaryCard: { borderRadius: spacing.lg, borderWidth: 1, borderColor: 'rgba(90,75,56,0.18)', backgroundColor: 'rgba(255,255,255,0.88)', padding: spacing.md },
  heroEyebrow: { fontSize: typography.caption, fontWeight: '800', color: colors.gold, letterSpacing: 0.8 },
  heroHeadline: { marginTop: spacing.xs, fontSize: typography.title2, lineHeight: 28, fontWeight: '900', color: colors.ink },
  heroSubline: { marginTop: 6, fontSize: typography.bodySmall, color: colors.inkSecondary },
  countsSlot: { marginTop: spacing.sm },
  goalRow: { marginTop: spacing.xs, gap: 4 },
  goalText: { fontSize: typography.bodySmall, color: colors.inkSecondary, fontWeight: '700' },
  primaryCta: { marginTop: spacing.sm, minHeight: 46, borderRadius: spacing.buttonRadius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.ink },
  primaryCtaDisabled: { opacity: 0.45 },
  primaryCtaText: { color: colors.parchmentBg, fontSize: typography.button, fontWeight: '900' },
  drawBadge: { marginTop: spacing.sm, alignSelf: 'flex-start', fontSize: typography.caption, fontWeight: '800', color: colors.inkSecondary, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(90,75,56,0.18)', backgroundColor: 'rgba(243,232,200,0.8)' },
  errorText: { marginTop: spacing.xs, color: colors.danger, fontSize: typography.caption, lineHeight: 16 },
  collapseHeader: { marginTop: spacing.sm, minHeight: 44, borderRadius: spacing.buttonRadius, borderWidth: 1, borderColor: 'rgba(90,75,56,0.16)', backgroundColor: 'rgba(255,255,255,0.72)', paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapseTitle: { fontSize: typography.body, fontWeight: '800', color: colors.ink },
  collapseArrow: { fontSize: typography.caption, fontWeight: '700', color: colors.inkSecondary },
  collapseBody: { marginTop: spacing.xs, borderRadius: spacing.cardRadius, backgroundColor: 'rgba(255,255,255,0.62)', borderWidth: 1, borderColor: 'rgba(90,75,56,0.12)', padding: spacing.sm },
  calendarGrid: { marginTop: spacing.xs, borderRadius: spacing.cardRadius, borderWidth: 1, borderColor: 'rgba(90,75,56,0.12)', backgroundColor: 'rgba(255,255,255,0.62)', padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  calendarCell: { alignItems: 'center', width: '13%' },
  calendarDay: { fontSize: typography.caption, color: colors.inkSecondary },
  calendarBarTrack: { width: 10, height: 40, borderRadius: 999, backgroundColor: 'rgba(90,75,56,0.16)', justifyContent: 'flex-end', overflow: 'hidden', marginTop: 4 },
  calendarBarFill: { width: 10, borderRadius: 999, backgroundColor: colors.gold },
  calendarCount: { marginTop: 4, fontSize: typography.caption, color: colors.inkSecondary, fontWeight: '700' },
  accountLockup: { marginTop: spacing.sm, fontSize: typography.caption, color: colors.inkSecondary },
  secondaryCta: { marginTop: spacing.sm, minHeight: 44, borderRadius: spacing.buttonRadius, borderWidth: 1, borderColor: 'rgba(90,75,56,0.16)', backgroundColor: 'rgba(200,136,58,0.14)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryCtaText: { fontSize: typography.bodySmall, fontWeight: '800', color: colors.ink },
  coachCard: { marginTop: spacing.sm, borderRadius: spacing.cardRadius, borderWidth: 1, borderColor: 'rgba(90,75,56,0.16)', backgroundColor: 'rgba(255,255,255,0.72)', padding: spacing.sm },
  coachTitle: { fontSize: typography.body, fontWeight: '800', color: colors.ink },
  coachBody: { marginTop: 4, fontSize: typography.caption, color: colors.inkSecondary },
  inlineButton: { marginTop: spacing.xs, minHeight: 44, borderRadius: spacing.buttonRadius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, backgroundColor: 'rgba(232,184,90,0.2)' },
  inlineButtonText: { fontSize: typography.bodySmall, fontWeight: '800', color: colors.ink },
  stateCard: { marginTop: spacing.sm, borderRadius: spacing.cardRadius, borderWidth: 1, borderColor: 'rgba(90,75,56,0.16)', backgroundColor: 'rgba(255,255,255,0.72)', padding: spacing.sm },
  stateTitle: { fontSize: typography.body, fontWeight: '800', color: colors.ink },
  stateBody: { marginTop: 4, fontSize: typography.caption, color: colors.inkSecondary },
});
