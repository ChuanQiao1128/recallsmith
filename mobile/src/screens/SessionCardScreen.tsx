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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { CardExport, DeckExport } from '../types/deckExport';
import {
  checkManifestForUpdates,
  installDeckFromUrl,
  listManifestDecks,
  resolveDeckBySlug,
} from '../content/deckRepository';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import type { CardProgress, ReviewRating } from '../review/model';
import {
  loadDeckProgress,
  loadOrInitDailyStats,
  saveDeckProgress,
  type DailyStats,
} from '../review/storage';
import { syncDailyReminders } from '../notifications/reminders';
import {
  applyCachedRemoteProgress,
  recordReviewEvent,
  scheduleProgressSync,
} from '../sync/progressSync';
import { countDueToday, pickNextCard } from '../features/gacha/planner/sessionPlanner';
import {
  buildRatedSessionState,
  buildSessionProgressVM,
  type CurrentCardLike,
} from '../features/gacha/session/sessionReviewHelpers';
import {
  buildCardMap,
  buildPreviewDeck,
  showTrialUpsellDialog,
  sortCards,
} from '../features/gacha/session/reviewContentHelpers';
import { resolveRouteRole } from '../features/gacha/planner/sessionRoles';
import type { RoutePreviewNode } from '../features/gacha/contracts';
import { resetSessionStore, useSessionStore } from '../features/gacha/session/sessionStore';
import SessionProgressHeader from '../features/gacha/components/SessionProgressHeader';
import RatingBar from '../features/gacha/components/RatingBar';
import ReviewBody from '../features/gacha/components/ReviewBody';
import { isPremiumActive, rcGetCustomerInfoSafe } from '../premium/revenuecat';
import { setIsPremiumUser, usePremiumUser } from '../premium/premiumStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
type Props = NativeStackScreenProps<RootStackParamList, 'SessionCard'>;
type UiRating = ReviewRating;
type TrialInfo = {
  isTrial: boolean;
  previewCount: number;
  totalCards: number;
};
function isLearned(progress: CardProgress): boolean {
  return typeof progress.lastReviewedAt === 'number' && progress.lastReviewedAt > 0;
}
function buildSessionRouteNodes(limit: number): RoutePreviewNode[] {
  const total = Math.max(1, limit);
  const hasBoss = total >= 4;
  const hasElite = total >= 2;
  return Array.from({ length: total }).map((_, index) => {
    const role = resolveRouteRole({ index, total, hasElite, hasBoss });
    if (role === 'warmup') {
      return {
        id: `warmup-${index}`,
        role,
        title: 'Warm-up node',
        subtitle: 'Start with one low-friction recall win.',
      };
    }
    if (role === 'elite') {
      return {
        id: `elite-${index}`,
        role,
        title: 'Elite recall',
        subtitle: 'A sharper mid-run check.',
      };
    }
    if (role === 'boss') {
      return {
        id: `boss-${index}`,
        role,
        title: 'Boss check',
        subtitle: 'Close the run with a clean recap test.',
      };
    }
    return {
      id: `normal-${index}`,
      role,
      title: 'Normal node',
      subtitle: 'Standard learning / recall step.',
    };
  });
}
function computePremiumActive(customerInfo: any): boolean {
  try {
    if (isPremiumActive(customerInfo)) return true;
  } catch {
    // fall through
  }
  const activeEnt = customerInfo?.entitlements?.active;
  if (activeEnt && typeof activeEnt === 'object') {
    const keys = Object.keys(activeEnt);
    if (keys.length > 0) {
      for (const key of keys) {
        if (activeEnt[key]?.isActive === true) return true;
      }
      return true;
    }
  }
  const subs = customerInfo?.activeSubscriptions;
  if (Array.isArray(subs) && subs.length > 0) return true;
  return false;
}
export function SessionCardScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug ?? null;
  const { mode = 'mixed', limit = 20, completionRoute = 'summary' } = route.params ?? {};
  const previewLimitRaw = Number((route.params as any)?.previewLimit ?? 0);
  const previewLimit = Number.isFinite(previewLimitRaw) ? previewLimitRaw : 0;
  const [slug, setSlug] = useState<string | null>(slugFromRoute);
  const [deck, setDeck] = useState<DeckExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [current, setCurrent] = useState<CurrentCardLike | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const sessionLimit = limit;
  const isPremiumUser = usePremiumUser();
  const insets = useSafeAreaInsets();
  const trialRef = useRef<TrialInfo>({ isTrial: false, previewCount: 0, totalCards: 0 });
  const cardIndexRef = useRef<{ cards: CardExport[]; cardMap: Map<string, CardExport> } | null>(null);
  const sessionRoute = useSessionStore((state) => state.route);
  const sessionRouteIndex = useSessionStore((state) => state.currentIndex);
  const startSession = useSessionStore((state) => state.startSession);
  const recordSessionRating = useSessionStore((state) => state.recordRating);
  const advanceSession = useSessionStore((state) => state.advanceSession);
  useEffect(() => {
    return () => {
      resetSessionStore();
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (slugFromRoute) {
        setSlug(slugFromRoute);
        void setActiveDeckSlug(slugFromRoute);
        return;
      }
      let cancelled = false;
      async function initSlug() {
        const stored = await loadActiveDeckSlug();
        if (cancelled) return;
        if (stored) {
          setSlug(stored);
          return;
        }
        const manifest = await listManifestDecks();
        if (cancelled) return;
        if (manifest[0]?.slug) {
          setSlug(manifest[0].slug);
        }
      }
      void initSlug();
      return () => {
        cancelled = true;
      };
    }, [slugFromRoute]),
  );
  function goPaywall(reason?: string) {
    const navAny = navigation as any;
    if (typeof navAny.replace === 'function') {
      navAny.replace('Paywall', reason ? { reason } : undefined);
      return;
    }
    navAny.navigate('Paywall' as any);
    setLoadError(reason ?? 'Premium required for this deck.');
    setLoading(false);
    setDeck(null);
    setDailyStats(null);
    setCurrent(null);
  }
  useFocusEffect(
    useCallback(() => {
      if (!slug) {
        setLoading(false);
        setLoadError('No deck available. Please install a deck from Settings.');
        setDeck(null);
        setProgress([]);
        setDailyStats(null);
        setCurrent(null);
        return;
      }
      let cancelled = false;
      async function load() {
        const slugValue = slug;
        if (!slugValue) return;
        setLoading(true);
        setLoadError(null);
        setSessionDone(0);
        setShowAnswer(false);
        const now = new Date();
        let premiumActive = isPremiumUser;
        let verifiedPremium = false;
        const ensurePremiumOnce = async () => {
          if (premiumActive) return true;
          if (verifiedPremium) return premiumActive;
          verifiedPremium = true;
          try {
            const info = await rcGetCustomerInfoSafe();
            const active = computePremiumActive(info);
            premiumActive = active;
            if (active) await setIsPremiumUser(true);
            return active;
          } catch {
            return false;
          }
        };
        try {
          const wantsTrial = previewLimit > 0;
          const manifest = await listManifestDecks();
          const entry = manifest.find((item) => item.slug === slugValue) ?? null;
          const availability = String(entry?.availability ?? '').toLowerCase();
          if (availability === 'coming') {
            throw new Error(entry?.eta ? `Coming soon. ETA: ${entry.eta}` : 'Coming soon.');
          }
          const premiumByManifest =
            !!entry &&
            (String(entry.tier ?? '').toLowerCase() === 'premium' ||
              String(entry.downloadMode ?? '').toLowerCase() === 'auth');
          if (premiumByManifest && !premiumActive) {
            await ensurePremiumOnce();
          }
          let resolved = await resolveDeckBySlug(slugValue);
          if (!resolved) {
            const updates = await checkManifestForUpdates();
            const info = (updates as any)[slugValue];
            if (info?.remoteUrl && info?.remoteVersion) {
              const ok = await installDeckFromUrl(
                slugValue,
                info.remoteUrl,
                info.remoteVersion,
                info.remoteSha256 ?? null,
              );
              if (ok) {
                resolved = await resolveDeckBySlug(slugValue);
              }
            }
          }
          if (!resolved) {
            throw new Error('Deck not found');
          }
          if (cancelled) return;
          const premiumByDeck = resolved.DeckType !== 1;
          const premiumDeck = premiumByManifest || premiumByDeck;
          if (premiumDeck && !premiumActive) {
            await ensurePremiumOnce();
          }
          const isTrial = premiumDeck && !premiumActive && wantsTrial;
          if (premiumDeck && !premiumActive && !isTrial) {
            goPaywall('Premium required for this deck.');
            return;
          }
          const fullCards = resolved.Cards ?? [];
          const fullCount = ((resolved.TotalCards ?? fullCards.length) || fullCards.length) as number;
          const previewCount = isTrial
            ? Math.max(0, Math.min(previewLimit, fullCards.length || previewLimit))
            : 0;
          const deckForStudy = isTrial ? buildPreviewDeck(resolved, previewCount) : resolved;
          cardIndexRef.current = {
            cards: sortCards(deckForStudy),
            cardMap: buildCardMap(deckForStudy),
          };
          trialRef.current = {
            isTrial,
            previewCount: isTrial ? (deckForStudy.Cards?.length ?? previewCount) : 0,
            totalCards: fullCount,
          };
          setDeck(deckForStudy);
          void setActiveDeckSlug(resolved.Slug);
          try {
            await applyCachedRemoteProgress(resolved.Slug);
          } catch {
            // Keep local-only data if sync cache fails.
          }
          const nextProgress = await loadDeckProgress(deckForStudy);
          if (cancelled) return;
          if (isTrial && trialRef.current.previewCount > 0) {
            const learnedCount = nextProgress.filter(isLearned).length;
            const previewDone = learnedCount >= trialRef.current.previewCount;
            if (previewDone && (mode === 'learn-new' || mode === 'mixed')) {
              showTrialUpsellDialog(navigation, {
                deckTitle: resolved.Title,
                previewCount: trialRef.current.previewCount,
                totalCards: trialRef.current.totalCards,
              });
              navigation.goBack();
              return;
            }
          }
          const stats = await loadOrInitDailyStats(deckForStudy, nextProgress);
          if (cancelled) return;
          const nextCurrent = pickNextCard({
            deck: deckForStudy,
            progress: nextProgress,
            now,
            mode,
            avoidUid: null,
            index: cardIndexRef.current,
          });
          const routeNodes = buildSessionRouteNodes(
            sessionLimit > 0
              ? sessionLimit
              : Math.max(1, cardIndexRef.current?.cards.length ?? 1),
          );
          startSession({
            sessionId: `${deckForStudy.Slug}-${now.getTime()}`,
            slug: deckForStudy.Slug,
            route: routeNodes,
            startedAt: now.getTime(),
          });
          setProgress(nextProgress);
          setDailyStats(stats);
          setCurrent(nextCurrent);
          setLoading(false);
          const remainingDueCount = countDueToday(nextProgress, now);
          void syncDailyReminders({ remainingDueCount, now });
        } catch (e: any) {
          if (cancelled) return;
          setDeck(null);
          setProgress([]);
          setDailyStats(null);
          setCurrent(null);
          setLoadError(e?.message ?? 'Failed to load deck.');
          setLoading(false);
        }
      }
      void load();
      return () => {
        cancelled = true;
      };
    }, [isPremiumUser, mode, navigation, previewLimit, sessionLimit, slug]),
  );
  const now = new Date();
  const dueTodayCount = countDueToday(progress, now);
  const sessionVm = useMemo(
    () =>
      buildSessionProgressVM({
        sessionDone,
        sessionLimit,
        dueTodayCount,
        mode,
        currentRoleLabel: sessionRoute[sessionRouteIndex]?.title ?? null,
      }),
    [dueTodayCount, mode, sessionDone, sessionLimit, sessionRoute, sessionRouteIndex],
  );
  async function handleRating(rating: UiRating) {
    if (!current || !dailyStats || !deck) return;
    if (reviewing) return;
    if (!showAnswer) return;
    if (sessionLimit > 0 && sessionDone >= sessionLimit) return;
    setReviewing(true);
    try {
      const nowAtRating = new Date();
      const nowMs = nowAtRating.getTime();
      const nextState = buildRatedSessionState({
        current,
        progress,
        rating,
        mode,
        sessionDone,
        sessionLimit,
        now: nowAtRating,
        cardIndex: cardIndexRef.current,
      });
      await saveDeckProgress(deck, nextState.updatedProgress);
      try {
        const eventId = await recordReviewEvent({
          deckSlug: deck.Slug,
          deckVersion: deck.Version,
          stableUid: nextState.updatedOne.stableUid,
          rating,
          reviewedAtMs: nowMs,
          progressAfter: nextState.updatedOne,
          lastSeenRevision: nextState.updatedOne.lastSeenRevision,
        });
        if (eventId) {
          scheduleProgressSync('rating');
        }
      } catch (e) {
        console.warn('[SessionCard] recordReviewEvent failed:', (e as any)?.message ?? e);
      }
      const trial = trialRef.current;
      if (trial.isTrial && (mode === 'learn-new' || mode === 'mixed') && trial.previewCount > 0) {
        const nextLearnedCount = nextState.updatedProgress.filter(isLearned).length;
        const crossed =
          nextState.prevLearnedCount < trial.previewCount &&
          nextLearnedCount >= trial.previewCount;
        if (crossed) {
          showTrialUpsellDialog(navigation, {
            deckTitle: deck.Title,
            previewCount: trial.previewCount,
            totalCards: trial.totalCards,
          });
        }
      }
      recordSessionRating({ stableUid: current.card.StableUid, rating });
      advanceSession();
      setSessionDone(nextState.nextDone);
      setProgress(nextState.updatedProgress);
      setCurrent(nextState.nextCurrent);
      setShowAnswer(false);
      void syncDailyReminders({
        remainingDueCount: nextState.remainingDueCount,
        now: new Date(nowAtRating.getTime()),
      });
      if (!nextState.nextCurrent) {
        if (completionRoute === 'settlement') {
          navigation.replace('Settlement', {
            slug: deck.Slug,
            deckTitle: deck.Title,
            sessionDone: nextState.nextDone,
            rewardPulls: nextState.nextDone >= sessionLimit ? 2 : nextState.nextDone >= 1 ? 1 : 0,
            masteredCount: Math.max(
              0,
              nextState.updatedProgress.filter((item) => item.stage >= 4).length -
                progress.filter((item) => item.stage >= 4).length,
            ),
          });
          return;
        }
        navigation.replace('SessionSummary', {
          sessionId: useSessionStore.getState().sessionId ?? undefined,
          slug: deck.Slug,
          deckTitle: deck.Title,
          sessionDone: nextState.nextDone,
          sessionLimit,
          minimumGoal: 1,
          dueCount: nextState.remainingDueCount,
          streakEarned: useSessionStore.getState().streakEarned,
        });
      }
    } finally {
      setReviewing(false);
    }
  }
  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-session-card-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <Text style={styles.errorTitle} numberOfLines={2}>
              Deck not available
            </Text>
            <Text style={styles.errorBody} numberOfLines={2}>
              {loadError}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed, { marginTop: 10 }]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText} numberOfLines={1}>
                ← Back
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }
  if (loading || !dailyStats || !deck) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-session-card-root">
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Loading cards...
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }
  const ratingDockHeight = 164 + Math.max(insets.bottom, 8);
  return (
    <SafeAreaView style={styles.safeArea} testID="screen-session-card-root">
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText} numberOfLines={1}>
                ← Challenge
              </Text>
            </Pressable>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {deck.Title}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {sessionVm.subtitle}
              </Text>
            </View>
          </View>
          <SessionProgressHeader vm={sessionVm} />
          <ScrollView
            testID="screen-session-card-primary-surface"
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              current ? { paddingBottom: ratingDockHeight } : { paddingBottom: spacing.lg },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {!current ? (
              <View style={styles.doneCard}>
                <Text style={styles.doneTitle} numberOfLines={1}>
                  Route complete
                </Text>
                <Text style={styles.doneBody} numberOfLines={2}>
                  This run is complete. Continue to the summary for rewards and next steps.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
                  onPress={() =>
                    completionRoute === 'settlement'
                      ? navigation.replace('Settlement', {
                          slug: deck.Slug,
                          deckTitle: deck.Title,
                          sessionDone,
                          rewardPulls: sessionDone >= sessionLimit ? 2 : sessionDone >= 1 ? 1 : 0,
                          masteredCount: progress.filter((item) => item.stage >= 4).length,
                        })
                      : navigation.replace('SessionSummary', {
                          slug: deck.Slug,
                          deckTitle: deck.Title,
                          sessionDone,
                          sessionLimit,
                          minimumGoal: 1,
                          dueCount: dueTodayCount,
                          streakEarned: useSessionStore.getState().streakEarned,
                        })
                  }
                >
                  <Text style={styles.doneButtonText} numberOfLines={1}>
                    View summary
                  </Text>
                </Pressable>
              </View>
            ) : (
              <ReviewBody
                card={current.card}
                faceUp={showAnswer}
                onFlip={() => setShowAnswer((prev) => !prev)}
              />
            )}
          </ScrollView>
          {current ? (
            <View
              style={[
                styles.ratingDock,
                {
                  paddingBottom: Math.max(insets.bottom, 8),
                },
              ]}
              testID="review-rating-dock"
            >
              <RatingBar
                testID="review-rating-bar"
                disabled={reviewing || !showAnswer}
                onRate={(rating) => void handleRating(rating)}
              />
            </View>
          ) : null}
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}
export default SessionCardScreen;
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.parchmentBg,
  },
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
  },
  errorTitle: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '900',
  },
  errorBody: {
    marginTop: spacing.xs,
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    textAlign: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  backButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.82)',
    marginRight: spacing.xs,
  },
  backText: {
    color: colors.ink,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: spacing.xs,
  },
  doneCard: {
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  doneTitle: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '800',
  },
  doneBody: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    lineHeight: 20,
  },
  doneButton: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    color: colors.parchmentBg,
    fontSize: typography.button,
    fontWeight: '800',
  },
  ratingDock: {
    position: 'absolute',
    left: spacing.screenPadding,
    right: spacing.screenPadding,
    bottom: 0,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
    backgroundColor: 'rgba(250,243,224,0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(42,34,24,0.14)',
  },
  pressed: {
    opacity: 0.9,
  },
});
