// mobile/src/screens/ReviewScreen.tsx
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Animated,
  useWindowDimensions,
  Alert,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import CodeBlock from '../components/CodeBlock';

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import type { DeckExport, CardExport } from '../types/deckExport';

import {
  resolveDeckBySlug,
  listManifestDecks,
  checkManifestForUpdates,
  installDeckFromUrl,
} from '../content/deckRepository';

import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';

import type { CardProgress, ReviewRating } from '../review/model';

import {
  loadDeckProgress,
  saveDeckProgress,
  loadOrInitDailyStats,
  type DailyStats,
} from '../review/storage';

import { syncDailyReminders } from '../notifications/reminders';

// ✅ progress sync
import {
  recordReviewEvent,
  scheduleProgressSync,
  applyCachedRemoteProgress,
} from '../sync/progressSync';

// ✅ premium entitlement
import { usePremiumUser, setIsPremiumUser } from '../premium/premiumStore';
import { rcGetCustomerInfoSafe, isPremiumActive } from '../premium/revenuecat';
import { countDueToday, pickNextCard } from '../features/gacha/planner/sessionPlanner';
import { buildRatedSessionState, buildSessionProgressVM, modeLabel, type CurrentCardLike } from '../features/gacha/session/sessionReviewHelpers';
import { buildCardMap, buildPreviewDeck, normalizeCodeLanguage, renderSimpleMarkdown, showTrialUpsellDialog, sortCards } from '../features/gacha/session/reviewContentHelpers';
import SessionProgressHeader from '../features/gacha/components/SessionProgressHeader';
import RatingBar from '../features/gacha/components/RatingBar';

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;
type UiRating = ReviewRating;

type TrialInfo = {
  isTrial: boolean;
  previewCount: number; // e.g. 30
  totalCards: number; // full deck total for dialog copy
};

function startOfToday(now: Date) {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function isLearned(p: CardProgress): boolean {
  return typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0;
}

/**
 * ✅ Robust premium check:
 * - First try your helper isPremiumActive()
 * - If it’s wrong/mismatched, fallback to RC CustomerInfo structure
 */
function computePremiumActive(customerInfo: any): boolean {
  try {
    if (isPremiumActive(customerInfo)) return true;
  } catch {
    // ignore
  }

  const activeEnt = (customerInfo as any)?.entitlements?.active;
  if (activeEnt && typeof activeEnt === 'object') {
    const keys = Object.keys(activeEnt);
    if (keys.length > 0) {
      for (const k of keys) {
        if ((activeEnt as any)[k]?.isActive === true) return true;
      }
      return true;
    }
  }

  const subs = (customerInfo as any)?.activeSubscriptions;
  if (Array.isArray(subs) && subs.length > 0) return true;

  return false;
}

export function ReviewScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug ?? null;
  const { mode = 'mixed', limit = 20 } = route.params ?? {};

  // ✅ trial: DeckScreen 会传 previewLimit（例如 30）
  const previewLimitParamRaw = Number((route.params as any)?.previewLimit ?? 0);
  const previewLimitParam = Number.isFinite(previewLimitParamRaw) ? previewLimitParamRaw : 0;

  const [slug, setSlug] = useState<string | null>(slugFromRoute);
  const [deck, setDeck] = useState<DeckExport | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [current, setCurrent] = useState<CurrentCardLike | null>(null);

  // ✅ premium entitlement
  const isPremiumUser = usePremiumUser();

  // ✅ trial info (for dialog copy)
  const trialRef = useRef<TrialInfo>({ isTrial: false, previewCount: 0, totalCards: 0 });

  // ✅ cache cards index to avoid sort/map repeatedly
  const cardIndexRef = useRef<{ cards: CardExport[]; cardMap: Map<string, CardExport> } | null>(null);

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
        if (manifest[0]?.slug) setSlug(manifest[0].slug);
      }
      void initSlug();

      return () => {
        cancelled = true;
      };
    }, [slugFromRoute]),
  );

  const [showBack, setShowBack] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  const [reviewing, setReviewing] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);
  const sessionLimit = limit;

  const avoidUidRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cardShownAtRef = useRef(Date.now());

  const { height: winH } = useWindowDimensions();
  const flipHeight = useMemo(() => {
    const reserved = 280;
    const usable = winH - reserved;
    return Math.max(350, Math.min(usable, winH - 50));
  }, [winH]);

  const frontRotate = flipAnim.interpolate({ inputRange: [0, 180], outputRange: ['0deg', '180deg'] });
  const backRotate = flipAnim.interpolate({ inputRange: [0, 180], outputRange: ['180deg', '360deg'] });

  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 89.9, 90, 180],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 89.9, 90, 180],
    outputRange: [0, 0, 1, 1],
  });

  useEffect(() => {
    if (current?.card?.StableUid) {
      cardShownAtRef.current = Date.now();
    }
  }, [current?.card?.StableUid]);

  function animateFlip(toBack: boolean) {
    Animated.spring(flipAnim, {
      toValue: toBack ? 180 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 90,
    }).start();
  }

  useEffect(() => {
    animateFlip(showBack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBack]);

  function resetToFront() {
    setShowBack(false);
    flipAnim.stopAnimation();
    flipAnim.setValue(0);
  }

  function goPaywall(reason?: string) {
    const navAny = navigation as any;
    if (typeof navAny.replace === 'function') {
      navAny.replace('Paywall', reason ? { reason } : undefined);
      return;
    }

    navAny.navigate('Paywall' as any);

    // fallback: if user comes back, show a clear message instead of spinner
    setLoadError(reason ?? 'Premium is required to continue.');
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
        const slugStr = slug;
        if (!slugStr) return;

        setLoading(true);
        setLoadError(null);
        resetToFront();
        setSessionDone(0);
        avoidUidRef.current = null;

        const now = new Date();

        // local vars to avoid store race
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
            if (active) setIsPremiumUser(true);
            return premiumActive;
          } catch {
            return false;
          }
        };

        try {
          const wantsTrial = previewLimitParam > 0;

          // 1) manifest gate: coming / premium
          const manifest = await listManifestDecks();
          const entry = manifest.find((x) => x.slug === slugStr) ?? null;

          const availability = String(entry?.availability ?? '').toLowerCase();
          if (availability === 'coming') {
            throw new Error(entry?.eta ? `Coming soon. ETA: ${entry.eta}` : 'Coming soon.');
          }

          const premiumByManifest =
            entry
              ? String(entry.tier ?? '').toLowerCase() === 'premium' ||
                String(entry.downloadMode ?? '').toLowerCase() === 'auth'
              : false;

          // ✅ If manifest says premium but store says not, verify once with RevenueCat.
          if (premiumByManifest && !premiumActive) {
            await ensurePremiumOnce();
          }

          // 2) resolve local
          let resolved = await resolveDeckBySlug(slugStr);

          // 3) auto-install if public deck not installed
          if (!resolved) {
            const updates = await checkManifestForUpdates();
            const info = (updates as any)[slugStr];
            if (info?.remoteUrl && info?.remoteVersion) {
              const ok = await installDeckFromUrl(
                slugStr,
                info.remoteUrl,
                info.remoteVersion,
                info.remoteSha256 ?? null,
              );
              if (ok) {
                resolved = await resolveDeckBySlug(slugStr);
              }
            }
          }

          if (!resolved) throw new Error('Deck not found');
          if (cancelled) return;

          // ✅ defensive: deckType premium
          const premiumByDeck = resolved.DeckType !== 1;
          const isPremiumDeck = premiumByManifest || premiumByDeck;

          // ✅ If deck is premium and still not premiumActive, verify once with RevenueCat
          if (isPremiumDeck && !premiumActive) {
            await ensurePremiumOnce();
          }

          // ✅ Decide trial AFTER verification (prevents premium user being treated as trial)
          const isTrial = isPremiumDeck && !premiumActive && wantsTrial;

          // ✅ If premium deck, not premium, and no trial => paywall
          if (isPremiumDeck && !premiumActive && !isTrial) {
            goPaywall('Premium is required to start this deck.');
            return;
          }

          // ✅ build deckForStudy: trial uses preview deck
          const fullCardsLen = (resolved.Cards ?? []).length;
          const totalCardsFull = ((resolved.TotalCards ?? fullCardsLen) || fullCardsLen) as number;

          const previewCount = isTrial
            ? Math.max(0, Math.min(previewLimitParam, fullCardsLen || previewLimitParam))
            : 0;

          const deckForStudy = isTrial ? buildPreviewDeck(resolved, previewCount) : resolved;

          // ✅ update index cache
          cardIndexRef.current = {
            cards: sortCards(deckForStudy),
            cardMap: buildCardMap(deckForStudy),
          };

          trialRef.current = {
            isTrial,
            previewCount: isTrial ? (deckForStudy.Cards?.length ?? previewCount) : 0,
            totalCards: totalCardsFull,
          };

          setDeck(deckForStudy);
          void setActiveDeckSlug(resolved.Slug);

          // ✅ apply cached remote progress (then load local)
          try {
            await applyCachedRemoteProgress(resolved.Slug);
          } catch {}

          const p = await loadDeckProgress(deckForStudy);
          if (cancelled) return;

          // ✅ trial finished guard: if user tries to open learn/mixed after preview done, show dialog
          if (isTrial && trialRef.current.previewCount > 0) {
            const learnedCount = p.filter(isLearned).length;
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

          const stats = await loadOrInitDailyStats(deckForStudy, p);
          if (cancelled) return;

          const next = pickNextCard({
            deck: deckForStudy,
            progress: p,
            now,
            mode,
            avoidUid: null,
            index: cardIndexRef.current,
          });

          sessionIdRef.current = `${deckForStudy.Slug}-${now.getTime()}`;
          setProgress(p);
          setDailyStats(stats);
          setCurrent(next);
          setLoading(false);

          const remainingDueCount = countDueToday(p, now);
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
    }, [slug, mode, limit, previewLimitParam, isPremiumUser, navigation]),
  );

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <Text style={styles.title}>Deck not available</Text>
            <Text style={styles.subtitle}>{loadError}</Text>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed, { marginTop: 10 }]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (loading || !dailyStats || !deck) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.loadingText}>Loading cards...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const now = new Date();
  const dueTodayCount = countDueToday(progress, now);
  const sessionVm = buildSessionProgressVM({
    sessionDone,
    sessionLimit,
    dueTodayCount,
    mode,
  });

  const PERSPECTIVE = 1000;

  async function handleRating(uiRating: UiRating) {
    if (!current || !dailyStats || !deck) return;
    if (reviewing) return;
    if (sessionLimit > 0 && sessionDone >= sessionLimit) return;

    setReviewing(true);
    try {
      const nowAtRating = new Date();
      const nowMs = nowAtRating.getTime();

      const nextState = buildRatedSessionState({
        current,
        progress,
        rating: uiRating,
        mode,
        sessionDone,
        sessionLimit,
        now: nowAtRating,
        cardIndex: cardIndexRef.current,
      });

      // Events are facts, progress is a projection; facts must land first. If we
      // are killed between the two writes, a queued event still rebuilds the
      // progress on the next sync, but a saved progress with no event means the
      // server never learns this review happened. Ordering the cheap write after
      // the durable one is the only ordering that degrades safely.
      try {
        const eventId = await recordReviewEvent({
          deckSlug: deck.Slug,
          deckVersion: deck.Version,
          stableUid: nextState.updatedOne.stableUid,
          rating: uiRating,
          reviewedAtMs: nowMs,
          sessionId: sessionIdRef.current,
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
        console.warn('[Review] recordReviewEvent failed:', (e as any)?.message ?? e);
      }

      await saveDeckProgress(deck, nextState.updatedProgress);

      {
        const t = trialRef.current;
        if (t.isTrial && (mode === 'learn-new' || mode === 'mixed') && t.previewCount > 0) {
          const nextLearnedCount = nextState.updatedProgress.filter(isLearned).length;
          const crossed = nextState.prevLearnedCount < t.previewCount && nextLearnedCount >= t.previewCount;
          if (crossed) {
            showTrialUpsellDialog(navigation, {
              deckTitle: deck.Title,
              previewCount: t.previewCount,
              totalCards: t.totalCards,
            });
          }
        }
      }

      setSessionDone(nextState.nextDone);
      avoidUidRef.current = nextState.updatedOne.stableUid;
      setProgress(nextState.updatedProgress);
      setCurrent(nextState.nextCurrent);

      resetToFront();
      void syncDailyReminders({ remainingDueCount: nextState.remainingDueCount, now: new Date(nowAtRating.getTime()) });
    } finally {
      setReviewing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Deck</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {deck.Title}
              </Text>
              <Text style={styles.subtitle}>{sessionVm.subtitle}</Text>
            </View>
          </View>

          <SessionProgressHeader vm={sessionVm} />

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionTitle}>Now reviewing</Text>
            <Text style={styles.sectionSubtitle}>Read first, then rate from memory. The next card should feel close, not delayed.</Text>

            {!current ? (
              <View style={styles.doneCard}>
                <Text style={styles.doneTitle}>Route complete 🎉</Text>
                <Text style={styles.doneBody}>
                  This run is complete. Review the reward summary, then decide whether to return home or reopen the deck.
                </Text>
                <View style={styles.doneActions}>
                  <Pressable
                    style={({ pressed }) => [styles.doneButton, pressed && styles.backButtonPressed]}
                    onPress={() =>
                      navigation.replace('SessionSummary', {
                        slug: deck.Slug,
                        deckTitle: deck.Title,
                        sessionDone,
                        sessionLimit,
                        minimumGoal: 1,
                        dueCount: dueTodayCount,
                      })
                    }
                  >
                    <Text style={styles.doneButtonText}>View summary</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.cardCard}>
                <View style={[styles.flipWrap, { height: flipHeight }]}>
                  <Animated.View
                    pointerEvents={showBack ? 'none' : 'auto'}
                    style={[
                      styles.flipFace,
                      {
                        opacity: frontOpacity,
                        zIndex: showBack ? 0 : 2,
                        transform: [{ perspective: PERSPECTIVE }, { rotateY: frontRotate }],
                      },
                    ]}
                  >
                    <Pressable
                      style={styles.facePressable}
                      onPress={() => setShowBack(true)}
                      accessibilityLabel="Flip to see answer"
                    >
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardOrder}>#{current.card.OrderInDeck}</Text>
                        <Text style={styles.cardChip}>
                          {current.card.Difficulty === 1 ? 'Easy' : current.card.Difficulty === 2 ? 'Medium' : 'Hard'}
                        </Text>
                        {current.card.CodeLanguage ? (
                          <Text style={styles.cardChipSecondary}>{current.card.CodeLanguage}</Text>
                        ) : null}
                      </View>

                      <Text style={styles.cardQuestion}>{current.card.Question}</Text>

                      <View style={styles.flipHintBox}>
                        <Text style={styles.flipHintText}>Tap once to reveal the answer, examples, and rating controls.</Text>
                      </View>
                    </Pressable>
                  </Animated.View>

                  <Animated.View
                    pointerEvents={showBack ? 'auto' : 'none'}
                    style={[
                      styles.flipFace,
                      {
                        opacity: backOpacity,
                        zIndex: showBack ? 2 : 0,
                        transform: [{ perspective: PERSPECTIVE }, { rotateY: backRotate }],
                      },
                    ]}
                  >
                    <View style={styles.backFaceContainer}>
                      <View style={styles.backTopRow}>
                        <Text style={styles.backTitle}>Answer</Text>

                        <Pressable
                          style={({ pressed }) => [styles.flipBackBtn, pressed && { opacity: 0.9 }]}
                          onPress={() => setShowBack(false)}
                          accessibilityLabel="Flip back to question"
                        >
                          <Text style={styles.flipBackBtnText}>↩︎</Text>
                        </Pressable>
                      </View>

                      <View style={styles.backBody}>
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
                          {current.card.Explanation ? (
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionHeader}>Explanation</Text>
                              <Text style={styles.sectionBody}>{current.card.Explanation}</Text>
                            </View>
                          ) : null}

                          {current.card.CodeSnippet ? (
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionHeader}>Coding Sample</Text>

                              <View style={styles.codeContainer}>
                                <CodeBlock
                                  code={current.card.CodeSnippet}
                                  language={normalizeCodeLanguage(current.card.CodeLanguage || 'javascript')}
                                />
                              </View>
                            </View>
                          ) : null}

                          {current.card.RealWorldUsage ? (
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionHeader}>Real Usage</Text>
                              <View style={styles.mdContainer}>
                                {renderSimpleMarkdown(current.card.RealWorldUsage, styles)}
                              </View>
                            </View>
                          ) : null}
                        </ScrollView>
                      </View>

                      <View style={styles.backRatingSection}>
                        <RatingBar disabled={reviewing} onRate={handleRating} />
                      </View>
                    </View>
                  </Animated.View>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default ReviewScreen;

const CARD_GLASS = 'rgba(255,255,255,0.18)';
const CARD_BORDER = 'rgba(255,255,255,0.5)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  loadingText: { marginTop: 10, color: '#6B7280' },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backButtonPressed: { opacity: 0.9 },
  backText: { fontSize: 13, color: '#111827' },

  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 12, color: '#6B7280' },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  sectionSubtitle: { fontSize: 12, lineHeight: 18, color: '#6B7280', marginBottom: 12 },

  doneCard: {
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  doneTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  doneBody: { marginTop: 8, fontSize: 13, lineHeight: 20, color: '#4B5563' },
  doneActions: { marginTop: 14, flexDirection: 'row' },
  doneButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(79,70,229,0.12)',
  },
  doneButtonText: { fontSize: 13, fontWeight: '700', color: '#4F46E5' },

  cardCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },

  flipWrap: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.96)',
    overflow: 'hidden',
  },
  flipFace: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backfaceVisibility: 'hidden',
  },

  facePressable: { flex: 1, paddingVertical: 10, paddingHorizontal: 10 },

  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardOrder: { fontSize: 12, color: '#6B7280', marginRight: 6 },
  cardChip: {
    fontSize: 11,
    color: '#111827',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginRight: 4,
  },
  cardChipSecondary: {
    fontSize: 11,
    color: '#4B5563',
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },

  cardQuestion: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginTop: 6,
  },

  flipHintBox: {
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(79,70,229,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.14)',
  },
  flipHintText: { fontSize: 12, color: '#6B7280' },

  backTopRow: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backTitle: { fontSize: 13, fontWeight: '800', color: '#111827', flex: 1 },
  flipBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(17,24,39,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipBackBtnText: { fontSize: 16, fontWeight: '900', color: '#111827' },

  backFaceContainer: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBody: { flex: 1, marginTop: 4 },
  backRatingSection: { paddingTop: 4, paddingHorizontal: 0 },

  sectionBlock: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  sectionHeader: { fontSize: 12, fontWeight: '900', color: '#4F46E5', marginBottom: 6 },
  sectionBody: { fontSize: 13, color: '#374151', lineHeight: 18 },

  codeContainer: {
    borderRadius: 10,
    backgroundColor: '#1E1E1E',
    paddingVertical: 8,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },

  mdContainer: {
    paddingTop: 2,
    paddingBottom: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(243,244,246,0.95)',
  },
  mdBulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  mdBullet: { width: 18, fontSize: 14, color: '#374151', lineHeight: 18 },
  mdText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },
});
