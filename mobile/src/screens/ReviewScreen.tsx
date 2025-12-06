// mobile/src/screens/ReviewScreen.tsx
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';

// ✅ 用 slug 方式拿 deck（避免 activeSlug 异步竞争）
import {
  MOCK_DECKS,
  getMockDeckBySlug,
  getActiveDeckSlug,
  setActiveDeckSlug,
} from '../mock/jsCoreStarterMock';

import type { DeckExport, CardExport } from '../types/deckExport';
import type { CardProgress } from '../review/model';
import {
  isDue,
  scheduleNextReview,
  type ReviewRating,
} from '../review/model';
import {
  loadDeckProgress,
  saveDeckProgress,
  loadOrInitDailyStats,
  type DailyStats,
} from '../review/storage';
import { syncDailyReminders } from '../notifications/reminders';

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;
type UiRating = ReviewRating;

interface CurrentCard {
  card: CardExport;
  progress: CardProgress;
}

function pickNextDueCard(
  deck: DeckExport,
  progress: CardProgress[],
  now: Date,
): CurrentCard | null {
  const sorted = [...deck.Cards].sort((a, b) => a.OrderInDeck - b.OrderInDeck);

  for (const card of sorted) {
    const p = progress.find(x => x.stableUid === card.StableUid);
    if (!p) continue;
    if (isDue(p, now)) return { card, progress: p };
  }
  return null;
}

/**
 * 计算“所有 deck 的 due 总数”，用于 20:00提醒（全局任务）。
 * - 可复用当前 deck 的 progress，避免重复读存储。
 */
async function computeTotalDueAllDecks(args: {
  now: Date;
  currentDeckSlug?: string;
  currentProgress?: CardProgress[];
}): Promise<number> {
  const { now, currentDeckSlug, currentProgress } = args;

  let total = 0;
  for (const d of MOCK_DECKS) {
    const canStudy = (d.Cards?.length ?? 0) > 0;
    if (!canStudy) continue;

    if (currentDeckSlug && currentProgress && d.Slug === currentDeckSlug) {
      total += currentProgress.filter(p => isDue(p, now)).length;
    } else {
      const p = await loadDeckProgress(d);
      total += p.filter(x => isDue(x, now)).length;
    }
  }
  return total;
}

export function ReviewScreen({ navigation, route }: Props) {
  const params = route.params;

  const slugFromRoute = params?.slug;
  const mode = params?.mode ?? 'mixed';
  const limit = params?.limit ?? 20;

  const fallbackSlug = getActiveDeckSlug() ?? MOCK_DECKS[0]?.Slug;
  const slug = slugFromRoute ?? fallbackSlug;

  const deck = useMemo(() => {
    return (slug ? getMockDeckBySlug(slug) : undefined) ?? MOCK_DECKS[0];
  }, [slug]);

  // 进入复习页也把它设为 active（给 Home/Deck 等同步用）
  useEffect(() => {
    if (deck?.Slug) setActiveDeckSlug(deck.Slug);
  }, [deck?.Slug]);

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [current, setCurrent] = useState<CurrentCard | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const [sessionLimit] = useState(limit);
  const [sessionDone, setSessionDone] = useState(0);

  // 全局 due 总数（用于提醒）
  const totalDueAllDecksRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setLoading(true);
        setShowAnswer(false);
        setSessionDone(0);

        const now = new Date();

        const p = await loadDeckProgress(deck);
        if (cancelled) return;

        const stats = await loadOrInitDailyStats(deck, p);
        if (cancelled) return;

        const next = pickNextDueCard(deck, p, now);

        // ✅ 先写 state
        setProgress(p);
        setDailyStats(stats);
        setCurrent(next);
        setLoading(false);

        // ✅ 再同步全局提醒（避免 active slug 写入竞争）
        const totalDueAllDecks = await computeTotalDueAllDecks({
          now,
          currentDeckSlug: deck.Slug,
          currentProgress: p,
        });
        totalDueAllDecksRef.current = totalDueAllDecks;
        void syncDailyReminders({ remainingDueCount: totalDueAllDecks, now });
      }

      void load();

      return () => {
        cancelled = true;
      };
    }, [deck?.Slug, mode, limit]),
  );

  const now = new Date();

  async function handleRating(uiRating: UiRating) {
    if (!current || !dailyStats) return;
    if (reviewing) return;
    if (sessionLimit > 0 && sessionDone >= sessionLimit) return;

    setReviewing(true);
    try {
      const now = new Date();

      // 当前 deck：更新前 due
      const dueBefore = progress.filter(p => isDue(p, now)).length;

      const updatedOne = scheduleNextReview(current.progress, uiRating, now);
      const newProgress = progress.map(p =>
        p.stableUid === updatedOne.stableUid ? updatedOne : p,
      );

      await saveDeckProgress(deck, newProgress);

      const nextDone = sessionDone + 1;
      setSessionDone(nextDone);

      const remaining =
        sessionLimit > 0 ? Math.max(sessionLimit - nextDone, 0) : Infinity;

      const next =
        remaining > 0 ? pickNextDueCard(deck, newProgress, new Date()) : null;

      setProgress(newProgress);
      setCurrent(next);
      setShowAnswer(false);

      // 当前 deck：更新后 due
      const dueAfter = newProgress.filter(p => isDue(p, now)).length;

      // ✅ 全局 due：用 delta 更新（避免每题都遍历所有 deck）
      const prevGlobal = totalDueAllDecksRef.current;
      const nextGlobal = Math.max(0, prevGlobal - dueBefore + dueAfter);
      totalDueAllDecksRef.current = nextGlobal;

      void syncDailyReminders({ remainingDueCount: nextGlobal, now });
    } finally {
      setReviewing(false);
    }
  }

  if (loading || !dailyStats) {
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

  const dueNowCount = progress.filter(p => isDue(p, now)).length;
  const sessionPercent =
    sessionLimit > 0 ? Math.min(sessionDone / sessionLimit, 1) : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.container}>
          {/* header */}
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Deck</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {deck.Title}
              </Text>
              <Text style={styles.subtitle}>
                Session {sessionDone}/{sessionLimit || '∞'} · Mode {mode}
              </Text>
            </View>
          </View>

          {/* session bar */}
          <View style={styles.sessionCard}>
            <View style={styles.sessionHeaderRow}>
              <Text style={styles.sessionLabel}>Session progress</Text>
              <Text style={styles.sessionValue}>
                {sessionDone} / {sessionLimit || '∞'}
              </Text>
            </View>
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  { flex: sessionPercent, opacity: sessionPercent === 0 ? 0 : 1 },
                ]}
              />
              <View style={{ flex: 1 - sessionPercent }} />
            </View>
            <Text style={styles.sessionHint}>
              {dueNowCount} card{dueNowCount === 1 ? '' : 's'} still due in this deck today.
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionTitle}>Now reviewing</Text>

            {!current ? (
              <View style={styles.doneCard}>
                <Text style={styles.doneTitle}>You are done for now 🎉</Text>
                <Text style={styles.doneBody}>
                  This session is complete. You can go back to the deck screen
                  and start another run later today.
                </Text>
              </View>
            ) : (
              <View style={styles.cardCard}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardOrder}>#{current.card.OrderInDeck}</Text>
                  <Text style={styles.cardChip}>
                    {current.card.Difficulty === 1
                      ? 'Easy'
                      : current.card.Difficulty === 2
                      ? 'Medium'
                      : 'Hard'}
                  </Text>
                  {current.card.CodeLanguage ? (
                    <Text style={styles.cardChipSecondary}>
                      {current.card.CodeLanguage}
                    </Text>
                  ) : null}
                </View>

                <Text style={styles.cardQuestion}>{current.card.Question}</Text>

                {!showAnswer ? (
                  <View style={styles.answerHiddenBox}>
                    <Text style={styles.answerHiddenText}>
                      Try to recall the answer from memory. When you are ready,
                      flip the card.
                    </Text>
                    <Pressable
                      style={({ pressed }) => [
                        styles.showButton,
                        pressed && styles.showButtonPressed,
                      ]}
                      onPress={() => setShowAnswer(true)}
                    >
                      <Text style={styles.showButtonText}>Show answer</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    {current.card.Explanation ? (
                      <Text style={styles.cardExplanation}>
                        {current.card.Explanation}
                      </Text>
                    ) : null}

                    {current.card.CodeSnippet ? (
                      <ScrollView
                        style={styles.codeContainer}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                      >
                        <Text style={styles.codeText}>
                          {current.card.CodeSnippet}
                        </Text>
                      </ScrollView>
                    ) : null}

                    {current.card.RealWorldUsage ? (
                      <View style={styles.realWorldBox}>
                        <Text style={styles.realWorldTitle}>Real‑world usage</Text>
                        <Text style={styles.realWorldBody}>
                          {current.card.RealWorldUsage}
                        </Text>
                      </View>
                    ) : null}

                    <Text style={styles.ratingHint}>
                      How well did you remember this card?
                    </Text>

                    <View style={styles.ratingGrid}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.ratingButton,
                          styles.ratingAgain,
                          pressed && styles.ratingPressed,
                          reviewing && styles.ratingDisabled,
                        ]}
                        disabled={reviewing}
                        onPress={() => handleRating('again')}
                      >
                        <Text style={styles.ratingTitle}>Again</Text>
                        <Text style={styles.ratingSub}>Show very soon</Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [
                          styles.ratingButton,
                          styles.ratingHard,
                          pressed && styles.ratingPressed,
                          reviewing && styles.ratingDisabled,
                        ]}
                        disabled={reviewing}
                        onPress={() => handleRating('hard')}
                      >
                        <Text style={styles.ratingTitle}>Hard</Text>
                        <Text style={styles.ratingSub}>Short interval</Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [
                          styles.ratingButton,
                          styles.ratingGood,
                          pressed && styles.ratingPressed,
                          reviewing && styles.ratingDisabled,
                        ]}
                        disabled={reviewing}
                        onPress={() => handleRating('good')}
                      >
                        <Text style={styles.ratingTitle}>Good</Text>
                        <Text style={styles.ratingSub}>Normal interval</Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [
                          styles.ratingButton,
                          styles.ratingEasy,
                          pressed && styles.ratingPressed,
                          reviewing && styles.ratingDisabled,
                        ]}
                        disabled={reviewing}
                        onPress={() => handleRating('easy')}
                      >
                        <Text style={styles.ratingTitle}>Easy</Text>
                        <Text style={styles.ratingSub}>Much later</Text>
                      </Pressable>
                    </View>
                  </>
                )}
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
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F3FF',
  },
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#6B7280',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backButtonPressed: {
    opacity: 0.9,
  },
  backText: {
    fontSize: 13,
    color: '#111827',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  sessionCard: {
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: CARD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sessionLabel: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  sessionValue: {
    fontSize: 13,
    color: '#4F46E5',
    fontWeight: '600',
  },
  progressBarBg: {
    marginTop: 6,
    marginBottom: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: '#4F46E5',
    borderRadius: 999,
  },
  sessionHint: {
    fontSize: 11,
    color: '#6B7280',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardOrder: {
    fontSize: 12,
    color: '#6B7280',
    marginRight: 6,
  },
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
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  answerHiddenBox: {
    marginTop: 8,
    alignItems: 'center',
  },
  answerHiddenText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 8,
  },
  showButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  showButtonPressed: {
    opacity: 0.9,
  },
  showButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  cardExplanation: {
    marginTop: 4,
    fontSize: 14,
    color: '#374151',
    marginBottom: 8,
  },
  codeContainer: {
    borderRadius: 10,
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  codeText: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: '#E5E7EB',
  },
  ratingHint: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  ratingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  ratingButton: {
    width: '48%',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  ratingAgain: {
    backgroundColor: '#FEE2E2',
  },
  ratingHard: {
    backgroundColor: '#FFEDD5',
  },
  ratingGood: {
    backgroundColor: '#DCFCE7',
  },
  ratingEasy: {
    backgroundColor: '#DBEAFE',
  },
  ratingPressed: {
    opacity: 0.9,
  },
  ratingDisabled: {
    opacity: 0.5,
  },
  ratingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  ratingSub: {
    fontSize: 11,
    color: '#4B5563',
    marginTop: 2,
  },
  doneCard: {
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#ECFDF5',
  },
  doneTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#166534',
    marginBottom: 4,
  },
  doneBody: {
    fontSize: 13,
    color: '#166534',
  },
  realWorldBox: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(79,70,229,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.18)',
    marginBottom: 10,
  },
  realWorldTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4F46E5',
    marginBottom: 6,
  },
  realWorldBody: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
});