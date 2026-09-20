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
import { countDueToday, pickNextCard, planChallengeRoute } from '../features/gacha/planner/sessionPlanner';
import { computeTomorrowLoad, forecastLine } from '../features/gacha/planner/loadForecast';
import { resolveEffectiveOwned } from '../features/gacha/draw/effectiveOwned';
import { settleRatingReward } from '../features/gacha/rewards/sessionRewards';
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
const EMPTY_TRIAL_INFO: TrialInfo = { isTrial: false, previewCount: 0, totalCards: 0 };

function isLearned(progress: CardProgress): boolean {
  return typeof progress.lastReviewedAt === 'number' && progress.lastReviewedAt > 0;
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
  const { mode = 'mixed', completionRoute = 'summary' } = route.params ?? {};
  // Route-supplied limit is now optional. When the caller doesn't
  // explicitly pass one, sessionLimit derives from planChallengeRoute
  // (which respects SESSION_MAIN_ROUTE_DEFAULT = 5 + actual due/new
  // card availability). Was hard-coded to 20 — the source of "Run 0/20"
  // headers showing on decks that only had 3 due cards.
  const routeLimit = route.params?.limit;
  const previewLimitRaw = Number((route.params as any)?.previewLimit ?? 0);
  const previewLimit = Number.isFinite(previewLimitRaw) ? previewLimitRaw : 0;
  const [slug, setSlug] = useState<string | null>(slugFromRoute);
  const [deck, setDeck] = useState<DeckExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  // The gate for this deck, resolved once per load and then held. It is state
  // rather than a ref because the render path counts due cards with it, and it
  // never changes mid-session: rating a card cannot make you own or stop
  // owning one, and a draw cannot happen without leaving this screen.
  const [ownedSet, setOwnedSet] = useState<Set<string> | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [current, setCurrent] = useState<CurrentCardLike | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [plannedMinimumGoal, setPlannedMinimumGoal] = useState<number | null>(null);
  // Cached planner-derived limit. Loaded after planChallengeRoute runs.
  // null until first plan, then sticks. Falls back to routeLimit (when
  // caller passes one explicitly), then to 5 (the new default cap).
  const [plannedLimit, setPlannedLimit] = useState<number | null>(null);
  const [trialInfo, setTrialInfo] = useState<TrialInfo>(EMPTY_TRIAL_INFO);
  const [loadForecast, setLoadForecast] = useState<string | null>(null);
  const sessionLimit = plannedLimit ?? routeLimit ?? 5;
  const isPremiumUser = usePremiumUser();
  const insets = useSafeAreaInsets();
  const trialRef = useRef<TrialInfo>(EMPTY_TRIAL_INFO);
  const cardIndexRef = useRef<{ cards: CardExport[]; cardMap: Map<string, CardExport> } | null>(null);
  const cardShownAtRef = useRef(Date.now());
  const sessionId = useSessionStore((state) => state.sessionId);
  const sessionRoute = useSessionStore((state) => state.route);
  const sessionRouteIndex = useSessionStore((state) => state.currentIndex);
  const startSession = useSessionStore((state) => state.startSession);
  const recordSessionRating = useSessionStore((state) => state.recordRating);
  const recordRewardStep = useSessionStore((state) => state.recordRewardStep);
  const advanceSession = useSessionStore((state) => state.advanceSession);
  useEffect(() => {
    return () => {
      resetSessionStore();
    };
  }, []);
  useEffect(() => {
    if (current?.card?.StableUid) {
      cardShownAtRef.current = Date.now();
    }
  }, [current?.card?.StableUid]);
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
        setPlannedMinimumGoal(null);
        setPlannedLimit(null);
        trialRef.current = EMPTY_TRIAL_INFO;
        setTrialInfo(EMPTY_TRIAL_INFO);
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
        setLoadForecast(null);
        setPlannedMinimumGoal(null);
        setPlannedLimit(null);
        trialRef.current = EMPTY_TRIAL_INFO;
        setTrialInfo(EMPTY_TRIAL_INFO);
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
          const nextTrialInfo = {
            isTrial,
            previewCount: isTrial ? (deckForStudy.Cards?.length ?? previewCount) : 0,
            totalCards: fullCount,
          };
          trialRef.current = nextTrialInfo;
          setTrialInfo(nextTrialInfo);
          setDeck(deckForStudy);
          void setActiveDeckSlug(resolved.Slug);
          try {
            await applyCachedRemoteProgress(resolved.Slug);
          } catch {
            // Keep local-only data if sync cache fails.
          }
          const nextProgress = await loadDeckProgress(deckForStudy);
          if (cancelled) return;
          // Resolved against the deck's own slug, not deckForStudy's, so a
          // trial preview (which is a synthesised deck object with the same
          // slug) reads the same collection as the full deck would.
          const nextOwned = await resolveEffectiveOwned(resolved.Slug, nextProgress);
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
          const plannedChallenge = planChallengeRoute({
            deck: deckForStudy,
            progress: nextProgress,
            now,
            ownedSet: nextOwned,
            mode,
          });
          setPlannedMinimumGoal(plannedChallenge.minimumGoal);
          // Sync sessionLimit to the planner's actual route length so
          // the header reads "Run 0/3" when the deck has 3 due cards
          // (was always "Run 0/20" because of the hard-coded default).
          setPlannedLimit(plannedChallenge.limit);
          const nextCurrent = pickNextCard({
            deck: deckForStudy,
            progress: nextProgress,
            now,
            mode,
            avoidUid: null,
            index: cardIndexRef.current,
            ownedSet: nextOwned,
          });
          startSession({
            sessionId: `${deckForStudy.Slug}-${now.getTime()}`,
            slug: deckForStudy.Slug,
            route: plannedChallenge.nodes,
            startedAt: now.getTime(),
          });
          setProgress(nextProgress);
          setOwnedSet(nextOwned);
          setDailyStats(stats);
          setCurrent(nextCurrent);
          setLoading(false);
          const remainingDueCount = countDueToday(nextProgress, now, nextOwned);
          void syncDailyReminders({ remainingDueCount, now });
        } catch (e: any) {
          if (cancelled) return;
          setDeck(null);
          setProgress([]);
          setDailyStats(null);
          setCurrent(null);
          setOwnedSet(null);
          setPlannedMinimumGoal(null);
          trialRef.current = EMPTY_TRIAL_INFO;
          setTrialInfo(EMPTY_TRIAL_INFO);
          setLoadError(e?.message ?? 'Failed to load deck.');
          setLoading(false);
        }
      }
      void load();
      return () => {
        cancelled = true;
      };
      // sessionLimit is INTENTIONALLY excluded from the dep array.
      // Including it caused an infinite reload loop:
      //   load() → setPlannedLimit(null)        → sessionLimit changes
      //          → effect re-fires → setPlannedLimit(planned.limit) → changes again
      //          → effect re-fires → ...
      // The visual symptom on Home → SessionCard was a loading card
      // that flashed continuously. sessionLimit is derived state we
      // SET inside this effect, so it must not gate the effect itself.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPremiumUser, mode, navigation, previewLimit, slug]),
  );
  const now = new Date();
  const dueTodayCount = countDueToday(progress, now, ownedSet);
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
        ownedSet,
      });
      // Events are facts, progress is a projection; facts must land first. A
      // queued event can rebuild the progress on the next sync, but a saved
      // progress with no event means the server never learns this review
      // happened, so a kill between the two writes must not land on that side.
      try {
        const eventId = await recordReviewEvent({
          deckSlug: deck.Slug,
          deckVersion: deck.Version,
          stableUid: nextState.updatedOne.stableUid,
          rating,
          reviewedAtMs: nowMs,
          sessionId,
          cardRevision: typeof current.card.Revision === 'number' ? current.card.Revision : 1,
          statedDifficulty: typeof current.card.Difficulty === 'number' ? current.card.Difficulty : null,
          reviewStage: isLearned(current.progress) ? 'repeat_review' : 'first_review',
          dwellTimeMs: Math.max(0, nowMs - cardShownAtRef.current),
          progressAfter: nextState.updatedOne,
          lastSeenRevision: nextState.updatedOne.lastSeenRevision,
        });
        if (eventId) {
          scheduleProgressSync('rating');
        }
      } catch (e) {
        console.warn('[SessionCard] recordReviewEvent failed:', (e as any)?.message ?? e);
      }
      // The whole array, every time. nextState.updatedProgress is the deck's
      // full progress with one entry replaced -- never an owned-filtered view.
      // saveDeckProgress is a wholesale overwrite, so handing it a gated slice
      // would delete the progress of every card the gate happened to exclude,
      // and the gate's own grandfather rule reads that progress back.
      await saveDeckProgress(deck, nextState.updatedProgress);
      const rewardStep = await settleRatingReward({
        slug: deck.Slug,
        stableUid: current.card.StableUid,
        rating,
        progressBefore: progress,
        newCardEligible: mode !== 'sweep',
        dueBefore: dueTodayCount,
        remainingDueCount: nextState.remainingDueCount,
        now: nowAtRating,
      });
      recordRewardStep(rewardStep, current.card.StableUid);
      const outcome = useSessionStore.getState().rewardOutcome;
      setLoadForecast(
        mode === 'sweep' ? null : forecastLine(
          computeTomorrowLoad({
            progress: nextState.updatedProgress,
            now: nowAtRating,
            ownedSet,
            newCardsLearnedToday: rewardStep.newCardsLearnedToday,
          }),
        ),
      );
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
      const minimumGoal =
        plannedMinimumGoal ??
        planChallengeRoute({
          deck,
          progress: nextState.updatedProgress,
          now: nowAtRating,
          ownedSet,
          mode,
        }).minimumGoal;
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
            rewardPulls: outcome.rewardPulls,
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
          minimumGoal,
          dueCount: nextState.remainingDueCount,
          streakEarned: useSessionStore.getState().streakEarned,
          reward: outcome,
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
  function requestPause() {
    Alert.alert('Pause this run?', 'Your ratings are saved.', [
      { text: 'Keep reviewing', style: 'cancel' },
      { text: 'Pause', onPress: () => navigation.goBack() },
    ]);
  }
  const ratingDockHeight = 164 + Math.max(insets.bottom, 8);
  const doneMinimumGoal =
    plannedMinimumGoal ?? planChallengeRoute({ deck, progress, now, ownedSet, mode }).minimumGoal;
  const previewChecked = trialInfo.isTrial
    ? Math.min(trialInfo.previewCount, progress.filter(isLearned).length)
    : 0;
  const previewRemaining = Math.max(trialInfo.previewCount - previewChecked, 0);
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
              style={({ pressed }) => [styles.pauseButton, pressed && styles.pressed]}
              onPress={requestPause}
            >
              <Text style={styles.pauseText} numberOfLines={1}>
                Pause
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
          {loadForecast ? (
            <Text testID="session-card-load-forecast" numberOfLines={2} style={styles.forecastLine}>
              {loadForecast}
            </Text>
          ) : null}
          <ScrollView
            testID="screen-session-card-primary-surface"
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              current ? { paddingBottom: ratingDockHeight } : { paddingBottom: spacing.lg },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {trialInfo.isTrial && trialInfo.previewCount > 0 ? (
              <View style={styles.trialPreview} testID="session-card-trial-preview">
                <Text style={styles.trialPreviewLabel} numberOfLines={1}>
                  Preview run
                </Text>
                <Text style={styles.trialPreviewBody} numberOfLines={1}>
                  {previewRemaining} of {trialInfo.previewCount} preview cards remaining
                </Text>
              </View>
            ) : null}
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
                          rewardPulls: useSessionStore.getState().rewardOutcome.rewardPulls,
                          masteredCount: progress.filter((item) => item.stage >= 4).length,
                        })
                      : navigation.replace('SessionSummary', {
                          slug: deck.Slug,
                          deckTitle: deck.Title,
                          sessionDone,
                          sessionLimit,
                          minimumGoal: doneMinimumGoal,
                          dueCount: dueTodayCount,
                          streakEarned: useSessionStore.getState().streakEarned,
                        })
                  }
                >
                  <Text style={styles.doneButtonText} numberOfLines={1}>
                    Continue
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
  // Pause button — strengthened to read as a real escape control.
  // Bigger touch target (48), softCream fill (matches brand), hairline
  // gold border, bolder ink text. Data is auto-saved on every rating
  // so swipe-back is also safe, but explicit Pause is more discoverable.
  pauseButton: {
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: 14,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    marginRight: spacing.sm,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pauseText: {
    color: colors.inkSoft,
    fontSize: typography.bodySmall,
    fontWeight: '900',
    letterSpacing: 0.3,
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
  forecastLine: {
    marginTop: spacing.xs,
    marginBottom: 4,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    fontWeight: '700',
    textAlign: 'center',
  },
  trialPreview: {
    marginBottom: spacing.xs,
    borderRadius: spacing.buttonRadius,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.1)',
  },
  trialPreviewLabel: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  trialPreviewBody: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    fontWeight: '700',
  },
  doneCard: {
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  doneTitle: {
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '900',
  },
  doneBody: {
    marginTop: spacing.xs,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
    lineHeight: 20,
  },
  doneButton: {
    marginTop: spacing.md,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: typography.button,
    fontWeight: '900',
    letterSpacing: 0.4,
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
