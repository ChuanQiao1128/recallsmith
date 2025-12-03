// mobile/src/screens/DeckScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList, StudyMode } from '../navigation/types';
import { jsCoreStarterMock } from '../mock/jsCoreStarterMock';
import type { CardProgress } from '../review/model';
import { isDue } from '../review/model';
import {
  loadDeckProgress,
  loadOrInitDailyStats,
  type DailyStats,
} from '../review/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Deck'>;

interface DeckState {
  loading: boolean;
  progress: CardProgress[];
  dailyStats: DailyStats | null;
}

export function DeckScreen({ navigation }: Props) {
  const deck = jsCoreStarterMock;

  const [state, setState] = useState<DeckState>({
    loading: true,
    progress: [],
    dailyStats: null,
  });

  const [sessionCount, setSessionCount] = useState(20);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setState(prev => ({ ...prev, loading: true }));
        const now = new Date();
        const progress = await loadDeckProgress(deck);
        if (cancelled) return;

        const dailyStats = await loadOrInitDailyStats(deck, progress);
        if (cancelled) return;

        setState({
          loading: false,
          progress,
          dailyStats,
        });
      }

      load();

      return () => {
        cancelled = true;
      };
    }, [deck]),
  );

  const { loading, progress, dailyStats } = state;

  const now = new Date();
  const dueToday = progress.filter(p => isDue(p, now)).length;
  const totalCards = deck.TotalCards;
  const plannedToday = dailyStats?.plannedCount ?? 0;
  const newToday = Math.max(plannedToday - dueToday, 0);
  const masteredApprox = Math.max(totalCards - (dueToday + newToday), 0);
  const overallPercent =
    totalCards > 0 ? masteredApprox / totalCards : 0;

  const minSession = 5;
  const maxSession = 50;

  function changeSession(delta: number) {
    setSessionCount(prev => {
      const next = Math.min(maxSession, Math.max(minSession, prev + delta));
      return next;
    });
  }

  function setPreset(count: number) {
    setSessionCount(count);
  }

  function startMode(mode: StudyMode) {
    navigation.navigate('Review', {
      mode,
      limit: sessionCount,
    });
  }

  if (loading || !dailyStats) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Loading deck...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* 顶部 header */}
        <View style={styles.headerRow}>
          <Pressable
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backText}>← Home</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{deck.Title}</Text>
            <Text style={styles.subtitle}>
              JavaScript interview starter deck · {deck.Locale}
            </Text>
          </View>
        </View>

        {/* 大进度卡片 */}
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Study progress</Text>

          <View style={styles.heroProgressRow}>
            <Text style={styles.heroProgressLabel}>Overall</Text>
            <Text style={styles.heroProgressValue}>
              {masteredApprox} / {totalCards} cards
            </Text>
          </View>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { flex: overallPercent, opacity: overallPercent === 0 ? 0 : 1 },
              ]}
            />
            <View style={{ flex: 1 - overallPercent }} />
          </View>

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStatBox}>
              <Text style={styles.heroStatLabel}>Due today</Text>
              <Text style={[styles.heroStatValue, { color: '#EF4444' }]}>
                {dueToday}
              </Text>
            </View>
            <View style={styles.heroStatBox}>
              <Text style={styles.heroStatLabel}>New today</Text>
              <Text style={[styles.heroStatValue, { color: '#0EA5E9' }]}>
                {newToday}
              </Text>
            </View>
            <View style={styles.heroStatBox}>
              <Text style={styles.heroStatLabel}>Mastered (approx)</Text>
              <Text style={[styles.heroStatValue, { color: '#22C55E' }]}>
                {masteredApprox}
              </Text>
            </View>
          </View>
        </View>

        {/* 本次学习卡片数量 */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Cards for this session</Text>
          <Text style={styles.sectionSubtitle}>
            A shorter session is easier to finish; 20–30 cards works well for
            most people.
          </Text>

          <View style={styles.sessionRow}>
            <Pressable
              style={styles.counterButton}
              onPress={() => changeSession(-5)}
            >
              <Text style={styles.counterButtonText}>−</Text>
            </Pressable>
            <View style={styles.sessionCountBox}>
              <Text style={styles.sessionCountValue}>{sessionCount}</Text>
              <Text style={styles.sessionCountLabel}>cards</Text>
            </View>
            <Pressable
              style={styles.counterButton}
              onPress={() => changeSession(+5)}
            >
              <Text style={styles.counterButtonText}>+</Text>
            </Pressable>
          </View>

          <View style={styles.sessionPresetRow}>
            {[10, 20, 30, 50].map(v => (
              <Pressable
                key={v}
                style={[
                  styles.presetChip,
                  sessionCount === v && styles.presetChipActive,
                ]}
                onPress={() => setPreset(v)}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    sessionCount === v && styles.presetChipTextActive,
                  ]}
                >
                  {v}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 学习模式 */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Choose study mode</Text>
          <Text style={styles.sectionSubtitle}>
            All modes still use spaced repetition under the hood.
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.modeCard,
              styles.modeCardReview,
              pressed && styles.modeCardPressed,
            ]}
            onPress={() => startMode('review-due')}
          >
            <View>
              <Text style={styles.modeTitle}>Review due cards</Text>
              <Text style={styles.modeSubtitle}>
                Focus only on cards that are scheduled for today.
              </Text>
            </View>
            <Text style={styles.modeCount}>
              {dueToday} due card{dueToday === 1 ? '' : 's'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.modeCard,
              styles.modeCardNew,
              pressed && styles.modeCardPressed,
            ]}
            onPress={() => startMode('learn-new')}
          >
            <View>
              <Text style={styles.modeTitle}>Learn new cards</Text>
              <Text style={styles.modeSubtitle}>
                Introduce new material while keeping sessions short.
              </Text>
            </View>
            <Text style={styles.modeCount}>
              {newToday} new card{newToday === 1 ? '' : 's'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.modeCard,
              styles.modeCardMixed,
              pressed && styles.modeCardPressed,
            ]}
            onPress={() => startMode('mixed')}
          >
            <View>
              <Text style={styles.modeTitle}>Mixed session</Text>
              <Text style={styles.modeSubtitle}>
                Combine due reviews and a few new cards in one balanced run.
              </Text>
            </View>
            <Text style={styles.modeCount}>
              Up to {sessionCount} cards
            </Text>
          </Pressable>

          <View style={styles.tipBox}>
            <Text style={styles.tipTitle}>Study tip</Text>
            <Text style={styles.tipBody}>
              Based on the forgetting curve, it&apos;s usually best to clear
              your due cards first, then add 20–30 new cards per day.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default DeckScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
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
    marginBottom: 16,
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
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  heroCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#EEF2FF',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#312E81',
    marginBottom: 8,
  },
  heroProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroProgressLabel: {
    fontSize: 12,
    color: '#4338CA',
  },
  heroProgressValue: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '500',
  },
  progressBarBg: {
    marginTop: 6,
    marginBottom: 10,
    flexDirection: 'row',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: '#4F46E5',
    borderRadius: 999,
  },
  heroStatsRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  heroStatBox: {
    flex: 1,
    paddingVertical: 6,
  },
  heroStatLabel: {
    fontSize: 11,
    color: '#4F46E5',
  },
  heroStatValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: '700',
  },
  sectionCard: {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  counterButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  counterButtonText: {
    fontSize: 20,
    color: '#111827',
    fontWeight: '600',
  },
  sessionCountBox: {
    flex: 1,
    alignItems: 'center',
  },
  sessionCountValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#4F46E5',
  },
  sessionCountLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  sessionPresetRow: {
    flexDirection: 'row',
    marginTop: 10,
    justifyContent: 'space-between',
  },
  presetChip: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  presetChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  presetChipText: {
    fontSize: 13,
    color: '#111827',
  },
  presetChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  modeCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  modeCardReview: {
    backgroundColor: '#FEE2E2',
  },
  modeCardNew: {
    backgroundColor: '#DBEAFE',
  },
  modeCardMixed: {
    backgroundColor: '#E0E7FF',
  },
  modeCardPressed: {
    opacity: 0.9,
  },
  modeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  modeSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#4B5563',
    maxWidth: 200,
  },
  modeCount: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  tipBox: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#F5F3FF',
    padding: 10,
  },
  tipTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4F46E5',
    marginBottom: 4,
  },
  tipBody: {
    fontSize: 12,
    color: '#4B5563',
  },
});