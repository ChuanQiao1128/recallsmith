// mobile/src/screens/ReviewScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { jsCoreStarterMock } from '../mock/jsCoreStarterMock';
import type { DeckExport, CardExport } from '../types/deckExport';
import type { CardProgress, ReviewRating } from '../review/model';
import { isDue } from '../review/model';
import {
  loadDeckProgress,
  saveDeckProgress,
  loadOrInitDailyStats,
  type DailyStats,
} from '../review/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;

type UiRating = 'again' | 'hard' | 'good' | 'easy';

interface CurrentCard {
  card: CardExport;
  progress: CardProgress;
}

function buildCardMap(deck: DeckExport): Map<string, CardExport> {
  const map = new Map<string, CardExport>();
  for (const c of deck.Cards) {
    map.set(c.StableUid, c);
  }
  return map;
}

// 目前只按“应复习”选下一张，mode 先不区分
function pickNextDueCard(
  deck: DeckExport,
  progress: CardProgress[],
  now: Date,
): CurrentCard | null {
  const cardMap = buildCardMap(deck);
  const sorted = [...deck.Cards].sort(
    (a, b) => a.OrderInDeck - b.OrderInDeck,
  );

  for (const card of sorted) {
    const p = progress.find(x => x.stableUid === card.StableUid);
    if (!p) continue;
    if (isDue(p, now)) {
      return { card, progress: p };
    }
  }
  return null;
}

// UI rating -> 模型 rating 的简单映射
function mapUiRatingToModel(rating: UiRating): ReviewRating {
  if (rating === 'again') return 'again';
  if (rating === 'easy') return 'easy';
  // 'hard' 和 'good' 现在都走 'good' 分支
  return 'good';
}

export function ReviewScreen({ navigation, route }: Props) {
  const deck = jsCoreStarterMock;
  const { mode = 'mixed', limit = 20 } = route.params ?? {};

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [current, setCurrent] = useState<CurrentCard | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const [sessionLimit] = useState(limit);
  const [sessionDone, setSessionDone] = useState(0);

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

        setProgress(p);
        setDailyStats(stats);
        setCurrent(next);
        setLoading(false);
      }

      load();

      return () => {
        cancelled = true;
      };
    }, [deck, mode, limit]),
  );

  const now = new Date();

  async function handleRating(rating: UiRating) {
    if (!current || !dailyStats) return;
    if (reviewing) return;

    // session 配额用完就不再处理
    if (sessionLimit > 0 && sessionDone >= sessionLimit) {
      return;
    }

    setReviewing(true);
    try {
      const modelRating = mapUiRatingToModel(rating);

      const updatedOne = require('../review/model').scheduleNextReview(
        current.progress,
        modelRating,
        new Date(),
      ) as CardProgress;

      const newProgress = progress.map(p =>
        p.stableUid === updatedOne.stableUid ? updatedOne : p,
      );

      await saveDeckProgress(deck, newProgress);

      const nextDone = sessionDone + 1;
      setSessionDone(nextDone);

      const remaining =
        sessionLimit > 0 ? Math.max(sessionLimit - nextDone, 0) : Infinity;

      const next =
        remaining > 0
          ? pickNextDueCard(deck, newProgress, new Date())
          : null;

      setProgress(newProgress);
      setCurrent(next);
      setShowAnswer(false);
    } finally {
      setReviewing(false);
    }
  }

  if (loading || !dailyStats) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Loading cards...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const dueNowCount = progress.filter(p => isDue(p, now)).length;
  const sessionPercent =
    sessionLimit > 0 ? Math.min(sessionDone / sessionLimit, 1) : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* 自定义 header */}
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

        {/* 今日进度条（针对本 session） */}
        <View style={styles.sessionBarCard}>
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
            {dueNowCount} card
            {dueNowCount === 1 ? '' : 's'} still due in total today.
          </Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.sectionTitle}>Now reviewing</Text>

          {!current ? (
            <View style={styles.doneBox}>
              <Text style={styles.doneTitle}>Nice work 🎉</Text>
              <Text style={styles.doneBody}>
                This session is complete. You can go back to the deck screen to
                start another run later today.
              </Text>
            </View>
          ) : (
            <View style={styles.cardBox}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardOrder}>
                  #{current.card.OrderInDeck}
                </Text>
                <Text style={styles.cardTag}>
                  {current.card.Difficulty === 1
                    ? 'Easy'
                    : current.card.Difficulty === 2
                    ? 'Medium'
                    : 'Hard'}
                </Text>
                {current.card.CodeLanguage ? (
                  <Text style={styles.cardTagSecondary}>
                    {current.card.CodeLanguage}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.cardQuestion}>
                {current.card.Question}
              </Text>

              {!showAnswer ? (
                <View style={styles.answerHiddenBox}>
                  <Text style={styles.answerHiddenText}>
                    Take a moment to recall the answer, then tap when you&apos;re
                    ready.
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

                  <Text style={styles.ratingHint}>
                    How well did you remember this card?
                  </Text>

                  {/* 四个按钮：Again / Hard / Good / Easy */}
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
                      <Text style={styles.ratingSub}>See very soon</Text>
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
                      <Text style={styles.ratingSub}>Longer interval</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

export default ReviewScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  container: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  center: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
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
    backgroundColor: '#E5E7EB',
    marginRight: 10,
  },
  backButtonPressed: {
    opacity: 0.8,
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
  sessionBarCard: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
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
    marginBottom: 4,
    flexDirection: 'row',
    height: 6,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
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
    marginTop: 12,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  cardBox: {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardOrder: {
    fontSize: 12,
    color: '#6B7280',
    marginRight: 6,
  },
  cardTag: {
    fontSize: 11,
    color: '#111827',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginRight: 4,
  },
  cardTagSecondary: {
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
    marginTop: 4,
    marginBottom: 8,
  },
  answerHiddenBox: {
    marginTop: 10,
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
    fontSize: 14,
    color: '#374151',
    marginTop: 4,
    marginBottom: 8,
  },
  codeContainer: {
    marginTop: 4,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: '#111827',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  codeText: {
    fontFamily: 'Menlo',
    color: '#E5E7EB',
    fontSize: 12,
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
    borderRadius: 12,
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
  doneBox: {
    borderRadius: 16,
    backgroundColor: '#ECFDF5',
    padding: 16,
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
});