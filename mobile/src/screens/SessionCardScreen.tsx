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
import { deckShortTitle } from '../content/deckShortTitle';
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
import { EMPTY_ROUTE_LIMIT } from '../features/gacha/planner/sessionBuilder';
import { rankCardsByOrder } from '../features/gacha/library/cardRank';
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
import { useScrollToTopOnChange } from '../features/gacha/session/useScrollToTopOnChange';
import SessionProgressHeader from '../features/gacha/components/SessionProgressHeader';
import RatingBar from '../features/gacha/components/RatingBar';
import ReviewBody from '../features/gacha/components/ReviewBody';
import { getFeatureFlags } from '../config/featureFlags';
import { loadExpoHaptics } from '../components/ceremonyHaptics';
import type { McqExport, McqOption } from '../types/deckExport';
import { mcqRequiredCount, resolveMcq } from '../features/gacha/mcq/normalizeMcq';
import { MCQ_COPY, mcqBannerPartial, mcqOverLimitAnnouncement } from '../features/gacha/mcq/mcqConstants';
import {
  describeScheduledRating,
  mapMcqVerdictToRating,
  resolveMcqVerdict,
  type McqConfidence,
  type McqVerdict,
} from '../features/gacha/mcq/mcqVerdict';
import { mcqSeed, shownOrderFor } from '../features/gacha/mcq/mcqShuffle';
import { buildKindHint, EMPTY_MCQ_RUN_STATE, noteServedCard, type McqRunState } from '../features/gacha/mcq/mcqRotation';
import { markMcqCoachSeen, readMcqCoachSeen } from '../features/gacha/mcq/mcqCoachPrefs';
import McqReviewBody, { type McqStage } from '../features/gacha/components/McqReviewBody';
import McqActionDock from '../features/gacha/components/McqActionDock';
import McqCoachLine from '../features/gacha/components/McqCoachLine';
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

// Vitest supplies react-native without AccessibilityInfo — guarded lookup so tests don't crash (HomeScreen.tsx pattern).
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const AI: any = readRN('AccessibilityInfo', null);
// Options-stage dock, stacked worst case: 8 + hint 20 + count 20 + 56 + 8 + 56 + link 44 = 212 (D05 gap 5).
const MCQ_DOCK_HEIGHT = 216;
type McqCardState = {
  mcq: McqExport | null;               // resolveMcq(card, getFeatureFlags()) — null ⇒ renderAsMcq false
  stage: McqStage;                     // 'stem' when flags.mcq.recallFirst !== false, else 'options'
  shownOrder: McqOption[];             // shownOrderFor(mcq, mcqSeed(sessionId, StableUid, attemptIndex))
  picks: string[];
  firstPicks: string[] | null;         // the first COMPLETE set (length === requiredCount); set once
  changedPick: boolean;                // submitted set ≠ firstPicks (as sets)
  confidence: McqConfidence | null;
  verdict: McqVerdict | null;
  mappedRating: ReviewRating | null;
  scheduleLine: string | null;
  attemptIndex: number;
};
const EMPTY_MCQ_CARD_STATE: McqCardState = {
  mcq: null, stage: 'stem', shownOrder: [], picks: [], firstPicks: null, changedPick: false,
  confidence: null, verdict: null, mappedRating: null, scheduleLine: null, attemptIndex: 0,
};
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
}
function mcqHaptic(kind: 'success' | 'warning' | 'error'): void {
  try {
    const haptics = loadExpoHaptics();
    if (!haptics) return;
    const name = kind === 'success' ? 'Success' : kind === 'warning' ? 'Warning' : 'Error';
    Promise.resolve(haptics.notificationAsync(haptics.NotificationFeedbackType[name])).catch(() => {});
  } catch {
    // device mechanism only; never reaches a test or a user without the native module
  }
}

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
  const { mode = 'mixed' } = route.params ?? {};
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
  // Bumped by the error state's Retry so the load effect re-runs without a
  // slug change (offline / deck-not-found recovers once the deck is reachable).
  const [reloadToken, setReloadToken] = useState(0);
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
  const [mcqState, setMcqState] = useState<McqCardState>(EMPTY_MCQ_CARD_STATE);
  const renderAsMcq = mcqState.mcq !== null;
  const [coachSeen, setCoachSeen] = useState<boolean | null>(null);
  // The dock's measured height (onLayout). The scroll surface reserves exactly this much at the
  // bottom so the last line of a card never hides under the opaque dock — the dock is taller in
  // the options stage and taller again while the coach line is inside it (review 2026-09-22 #1).
  const [dockLayoutHeight, setDockLayoutHeight] = useState<number | null>(null);
  const [plannedMinimumGoal, setPlannedMinimumGoal] = useState<number | null>(null);
  // Cached planner-derived limit. Loaded after planChallengeRoute runs.
  // null until first plan, then sticks. Falls back to routeLimit (when
  // caller passes one explicitly), then to 5 (the new default cap).
  const [plannedLimit, setPlannedLimit] = useState<number | null>(null);
  // True when the planner answered EMPTY_ROUTE_LIMIT: the account holds no
  // card of this deck, so no session is started and the screen shows the
  // draw instead of a run header over nothing.
  const [emptyDeck, setEmptyDeck] = useState(false);
  const [trialInfo, setTrialInfo] = useState<TrialInfo>(EMPTY_TRIAL_INFO);
  const [loadForecast, setLoadForecast] = useState<string | null>(null);
  const sessionLimit = plannedLimit ?? routeLimit ?? 5;
  const isPremiumUser = usePremiumUser();
  const insets = useSafeAreaInsets();
  const trialRef = useRef<TrialInfo>(EMPTY_TRIAL_INFO);
  const scrollRef = useRef<ScrollView>(null);
  const cardIndexRef = useRef<{ cards: CardExport[]; cardMap: Map<string, CardExport> } | null>(null);
  // stableUid → 1-based position in the deck's OrderInDeck order; the same
  // number the Library tile and DrawResult print, so "#011" means one card.
  const rankMapRef = useRef<Map<string, number>>(new Map());
  const cardShownAtRef = useRef(Date.now());
  const optionsShownAtRef = useRef(0);
  const submittedAtRef = useRef(0);
  const attemptIndexRef = useRef<Map<string, number>>(new Map());   // StableUid → serves so far this run
  const mcqRunRef = useRef<McqRunState>(EMPTY_MCQ_RUN_STATE);
  const picksRef = useRef<{ landed: number; answered: number }>({ landed: 0, answered: 0 });
  const coachSeenRef = useRef<boolean | null>(null);                 // null = not read yet; latch + last value (gap 3)
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
  // Reset the scroll surface to the top on every new card / attempt / completion,
  // so a tall next card never opens with its first lines above the viewport
  // (MCORE-03). Must sit above the screen's early returns to keep hook order stable.
  useScrollToTopOnChange(
    scrollRef,
    current ? `${current.card.StableUid}:${mcqState.attemptIndex}:${sessionDone}` : null,
  );
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
  function applyCurrent(next: CurrentCardLike | null, sessionIdForSeed: string): void {
    const flags = getFeatureFlags();
    const mcq = next ? resolveMcq(next.card, flags) : null;
    if (next) {
      const uid = next.card.StableUid;
      const attemptIndex = attemptIndexRef.current.get(uid) ?? 0;
      attemptIndexRef.current.set(uid, attemptIndex + 1);
      mcqRunRef.current = noteServedCard(mcqRunRef.current, next.progress, mcq !== null);
      if (mcq !== null && coachSeenRef.current === null) {
        coachSeenRef.current = true;               // latch: one read per session; "seen" until the read says otherwise
        void readMcqCoachSeen().then((seen) => {
          coachSeenRef.current = seen;
          setCoachSeen(seen);
        });
      }
      setCurrent(next);
      if (mcq !== null) {
        const stage: McqStage = flags.mcq.recallFirst !== false ? 'stem' : 'options';
        if (stage === 'options') optionsShownAtRef.current = Date.now();
        setMcqState({
          ...EMPTY_MCQ_CARD_STATE,
          mcq,
          stage,
          shownOrder: shownOrderFor(mcq, mcqSeed(sessionIdForSeed, uid, attemptIndex)),
          attemptIndex,
        });
        return;
      }
    } else {
      setCurrent(null);
    }
    setMcqState(EMPTY_MCQ_CARD_STATE);
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
        setEmptyDeck(false);
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
        setMcqState(EMPTY_MCQ_CARD_STATE);
        setCoachSeen(null);
        attemptIndexRef.current = new Map();
        mcqRunRef.current = EMPTY_MCQ_RUN_STATE;
        picksRef.current = { landed: 0, answered: 0 };
        coachSeenRef.current = null;
        setLoadForecast(null);
        setPlannedMinimumGoal(null);
        setPlannedLimit(null);
        setEmptyDeck(false);
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
          // Ranked over the full deck, not the trial slice: a preview card's
          // number has to match what the Library shows for it after purchase.
          rankMapRef.current = rankCardsByOrder(fullCards);
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
          if (plannedChallenge.limit === EMPTY_ROUTE_LIMIT) {
            // No card to deal: never start a session (no "Run 0/1", no
            // route-complete card, no summary). The empty state below owns
            // the screen until a pull puts a card in this deck.
            setProgress(nextProgress);
            setOwnedSet(nextOwned);
            setDailyStats(stats);
            setCurrent(null);
            setEmptyDeck(true);
            setLoading(false);
            return;
          }
          const nextCurrent = pickNextCard({
            deck: deckForStudy,
            progress: nextProgress,
            now,
            mode,
            avoidUid: null,
            index: cardIndexRef.current,
            ownedSet: nextOwned,
            kindHint: buildKindHint(mcqRunRef.current, getFeatureFlags()),
          });
          const nextSessionId = `${deckForStudy.Slug}-${now.getTime()}`;
          startSession({
            sessionId: nextSessionId,
            slug: deckForStudy.Slug,
            route: plannedChallenge.nodes,
            startedAt: now.getTime(),
          });
          setProgress(nextProgress);
          setOwnedSet(nextOwned);
          setDailyStats(stats);
          applyCurrent(nextCurrent, nextSessionId);
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
          setEmptyDeck(false);
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
    }, [isPremiumUser, mode, navigation, previewLimit, slug, reloadToken]),
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
        kindHint: buildKindHint(mcqRunRef.current, getFeatureFlags()),
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
      // Held in a local as well as in state: when this rating ends the run the
      // screen is replaced before the state ever renders, so the line travels
      // to SessionSummary as a route param instead (review finding C).
      const nextLoadForecast =
        mode === 'sweep'
          ? null
          : forecastLine(
              computeTomorrowLoad({
                progress: nextState.updatedProgress,
                now: nowAtRating,
                ownedSet,
                newCardsLearnedToday: rewardStep.newCardsLearnedToday,
              }),
            );
      setLoadForecast(nextLoadForecast);
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
      applyCurrent(nextState.nextCurrent, useSessionStore.getState().sessionId ?? '');
      setShowAnswer(false);
      void syncDailyReminders({
        remainingDueCount: nextState.remainingDueCount,
        now: new Date(nowAtRating.getTime()),
      });
      if (!nextState.nextCurrent) {
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
          // Only when there is a line: the route-complete Continue path and the
          // no-milestone case keep the exact param shape the tests pin.
          ...(nextLoadForecast ? { loadForecast: nextLoadForecast } : {}),
          ...(picksRef.current.answered > 0 ? { picks: { ...picksRef.current } } : {}),
        });
      }
    } finally {
      setReviewing(false);
    }
  }
  function handleShowOptions(): void {
    if (mcqState.stage !== 'stem') return;
    optionsShownAtRef.current = Date.now();
    setMcqState((prev) => ({ ...prev, stage: 'options' }));
  }
  function handleToggleOption(key: string): void {
    const mcq = mcqState.mcq;
    if (!mcq || mcqState.stage !== 'options' || reviewing) return;
    const n = mcqRequiredCount(mcq);
    setMcqState((prev) => {
      let next: string[];
      if (n === 1) {
        next = [key];
      } else if (prev.picks.includes(key)) {
        next = prev.picks.filter((entry) => entry !== key);
      } else if (prev.picks.length >= n) {
        return prev;   // body already showed 'Deselect one first' and called onOverLimit
      } else {
        next = [...prev.picks, key];
      }
      const firstPicks = prev.firstPicks ?? (next.length === n ? next : null);
      return { ...prev, picks: next, firstPicks };
    });
  }
  function settleMcq(picks: string[], confidence: McqConfidence, changedPick: boolean): void {
    const mcq = mcqState.mcq;
    if (!current || !mcq || mcqState.stage !== 'options' || reviewing) return;
    const verdict = resolveMcqVerdict(picks, mcq);
    const responseMs = Date.now() - optionsShownAtRef.current;
    const reviewStage = isLearned(current.progress) ? 'repeat_review' : 'first_review';
    const mappedRating = mapMcqVerdictToRating({
      verdict,
      confidence,
      changedPick,
      responseMs,
      optionCount: mcqState.shownOrder.length,
      reviewStage,
      stage: current.progress.stage,
      hardStreak: current.progress.hardStreak ?? 0,
      redeal: mcqState.attemptIndex >= 1,   // same-run redeal after a lapse never reaches easy (plan §5.4)
    });
    const scheduleLine = describeScheduledRating(current.progress, mappedRating, new Date()).line;
    setMcqState((prev) => ({ ...prev, stage: 'verdict', picks, confidence, changedPick, verdict, mappedRating, scheduleLine }));
    setShowAnswer(true);
    submittedAtRef.current = Date.now();
    mcqHaptic(verdict === 'correct' ? 'success' : verdict === 'partial' ? 'warning' : 'error');
    const n = mcqRequiredCount(mcq);
    const k = mcq.options.filter((o) => o.correct && picks.includes(o.key)).length;
    const banner =
      verdict === 'correct' ? MCQ_COPY.bannerCorrect : verdict === 'partial' ? mcqBannerPartial(k, n) : MCQ_COPY.bannerWrong;
    AI?.announceForAccessibility?.(`${banner}. ${scheduleLine}.`);
  }
  function handleSubmit(confidence: McqConfidence): void {
    const mcq = mcqState.mcq;
    if (!mcq || mcqState.picks.length !== mcqRequiredCount(mcq)) return;
    settleMcq(mcqState.picks, confidence, mcqState.firstPicks !== null && !sameSet(mcqState.picks, mcqState.firstPicks));
  }
  function handleDontKnow(): void {
    settleMcq([], 'unsure', false);
  }
  function handleMcqNext(): void {
    const mappedRating = mcqState.mappedRating;
    if (mcqState.stage !== 'verdict' || !mappedRating) return;
    picksRef.current = {
      answered: picksRef.current.answered + 1,
      landed: picksRef.current.landed + (mcqState.verdict !== 'wrong' ? 1 : 0),
    };
    if (coachSeen === false) handleCoachDismiss();
    void handleRating(mappedRating);
  }
  function handleCoachDismiss(): void {
    coachSeenRef.current = true;
    setCoachSeen(true);
    void markMcqCoachSeen();
  }
  // A tap beyond requiredCount on a choose-N card: the body shows its inline hint; the parent owns
  // the haptic and the VoiceOver announcement (D04 brief Constraints; review 2026-09-22 #5).
  function handleOverLimit(): void {
    mcqHaptic('warning');
    const mcq = mcqState.mcq;
    if (mcq) AI?.announceForAccessibility?.(mcqOverLimitAnnouncement(mcqRequiredCount(mcq)));
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
              accessibilityRole="button"
              onPress={() => setReloadToken((n) => n + 1)}
              testID="session-card-error-retry"
            >
              <Text style={styles.backText} numberOfLines={1}>
                Retry
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed, { marginTop: 10 }]}
              accessibilityRole="button"
              onPress={() => navigation.navigate('Library')}
              testID="session-card-error-choose-deck"
            >
              <Text style={styles.backText} numberOfLines={1}>
                Choose another deck
              </Text>
            </Pressable>
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
  if (emptyDeck) {
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
                accessibilityRole="button"
                onPress={() => navigation.goBack()}
                testID="session-card-empty-deck-back"
              >
                <Text style={styles.backText} numberOfLines={1}>
                  ← Back
                </Text>
              </Pressable>
              <View style={styles.headerTextWrap}>
                <Text style={styles.title} numberOfLines={1}>
                  {deck.Title}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  No cards yet
                </Text>
              </View>
            </View>
            <View style={styles.doneCard} testID="session-card-empty-deck">
              <Text style={styles.doneTitle} numberOfLines={1}>
                No cards yet
              </Text>
              <Text style={styles.doneBody} numberOfLines={3}>
                You don’t hold any card of this deck yet. Open a pack to get your first cards — every
                card you pull joins today’s run.
              </Text>
              <Pressable
                testID="session-card-empty-deck-cta"
                accessibilityRole="button"
                style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
                onPress={() => navigation.navigate('Draw', { slug: deck.Slug, rewardPending: true })}
              >
                <Text style={styles.doneButtonText} numberOfLines={1}>
                  Open a pack to get your first cards
                </Text>
              </Pressable>
            </View>
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
  const ratingDockHeight = (renderAsMcq ? MCQ_DOCK_HEIGHT : 164) + Math.max(insets.bottom, 8);
  // Reserved bottom padding: the measured dock once it has laid out, the stage default until then.
  const scrollBottomPadding = dockLayoutHeight ?? ratingDockHeight;
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
                {deckShortTitle(deck.Slug, deck.Title)}
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
            ref={scrollRef}
            testID="screen-session-card-primary-surface"
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              current ? { paddingBottom: scrollBottomPadding } : { paddingBottom: spacing.lg },
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
                    navigation.replace('SessionSummary', {
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
            ) : mcqState.mcq ? (
              <McqReviewBody
                card={current.card}
                mcq={mcqState.mcq}
                rank={rankMapRef.current.get(current.card.StableUid) ?? null}
                stage={mcqState.stage}
                shownOrder={mcqState.shownOrder}
                picks={mcqState.picks}
                verdict={mcqState.verdict}
                scheduleLine={mcqState.scheduleLine}
                attemptIndex={mcqState.attemptIndex}
                onToggleOption={handleToggleOption}
                onOverLimit={handleOverLimit}
              />
            ) : (
              <ReviewBody
                card={current.card}
                rank={rankMapRef.current.get(current.card.StableUid) ?? null}
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
              onLayout={(event) => setDockLayoutHeight(event.nativeEvent.layout.height)}
            >
              {/* Inside the dock, above the action rows: the dock is absolute and opaque, so an
                  in-flow sibling before it would be painted over (review 2026-09-22 #1). */}
              <McqCoachLine visible={renderAsMcq && coachSeen === false} onDismiss={handleCoachDismiss} />
              {mcqState.mcq ? (
                <McqActionDock
                  testID="review-rating-bar"
                  stage={mcqState.stage}
                  requiredCount={mcqRequiredCount(mcqState.mcq)}
                  selectedCount={mcqState.picks.length}
                  disabled={reviewing}
                  isLastNode={sessionLimit > 0 && sessionDone + 1 >= sessionLimit}
                  onShowOptions={handleShowOptions}
                  onSubmit={handleSubmit}
                  onDontKnow={handleDontKnow}
                  onNext={handleMcqNext}
                />
              ) : (
                <RatingBar
                  testID="review-rating-bar"
                  disabled={reviewing || !showAnswer}
                  revealed={showAnswer}
                  onRate={(rating) => void handleRating(rating)}
                />
              )}
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
  // Opaque on purpose. At 95% alpha the code sample scrolled under the dock
  // and bled through the rating buttons (owner's device, 2026-09-21); the
  // hairline and the upward shadow now carry the "this floats above the
  // card" reading instead of translucency.
  ratingDock: {
    position: 'absolute',
    left: spacing.screenPadding,
    right: spacing.screenPadding,
    bottom: 0,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.parchmentBg,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
  pressed: {
    opacity: 0.9,
  },
});
