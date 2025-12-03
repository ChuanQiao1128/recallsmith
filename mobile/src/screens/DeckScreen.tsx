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
import { LinearGradient } from 'expo-linear-gradient';
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
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.loadingText}>Loading deck...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
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
                JavaScript core concepts · Starter deck
              </Text>
            </View>
          </View>

          {/* 玻璃进度卡片 */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Study overview</Text>

            <View style={styles.heroTopRow}>
              <Text style={styles.heroTotal}>
                {masteredApprox}/{totalCards}
              </Text>
              <Text style={styles.heroTotalLabel}>cards mastered (approx)</Text>
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
              <View style={styles.heroStat}>
                <Text style={styles.heroStatLabel}>Due today</Text>
                <Text style={[styles.heroStatValue, { color: '#EF4444' }]}>
                  {dueToday}
                </Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatLabel}>New today</Text>
                <Text style={[styles.heroStatValue, { color: '#0EA5E9' }]}>
                  {newToday}
                </Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatLabel}>Planned today</Text>
                <Text style={[styles.heroStatValue, { color: '#22C55E' }]}>
                  {plannedToday}
                </Text>
              </View>
            </View>
          </View>

          {/* 本次学习张数 */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Cards for this session</Text>
            <Text style={styles.sectionSubTitle}>
              Start small and keep consistency. 20–30 cards per run is a good
              default.
            </Text>

            <View style={styles.sessionRow}>
              <Pressable
                style={styles.sessionButton}
                onPress={() => changeSession(-5)}
              >
                <Text style={styles.sessionButtonText}>−</Text>
              </Pressable>
              <View style={styles.sessionCenter}>
                <Text style={styles.sessionNumber}>{sessionCount}</Text>
                <Text style={styles.sessionLabel}>cards</Text>
              </View>
              <Pressable
                style={styles.sessionButton}
                onPress={() => changeSession(+5)}
              >
                <Text style={styles.sessionButtonText}>+</Text>
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

          {/* 模式选择 */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Choose study mode</Text>
            <Text style={styles.sectionSubTitle}>
              All modes still follow the same spaced‑repetition engine.
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
                  Clear today&apos;s backlog first. Best for keeping the system
                  healthy.
                </Text>
              </View>
              <Text style={styles.modeCount}>
                {dueToday} due
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
                  Only introduce fresh material. Perfect when you already cleared
                  reviews.
                </Text>
              </View>
              <Text style={styles.modeCount}>
                {newToday} planned
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
                  A balanced run that mixes due reviews and a few new cards.
                </Text>
              </View>
              <Text style={styles.modeCount}>
                up to {sessionCount}
              </Text>
            </Pressable>

            <View style={styles.tipBox}>
              <Text style={styles.tipTitle}>Study tip</Text>
              <Text style={styles.tipBody}>
                A simple routine: clear all due cards, then add 20–30 new ones.
                Your calendar will always feel manageable.
              </Text>
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DeckScreen;

const CARD_BG = 'rgba(255,255,255,0.18)';
const CARD_BORDER = 'rgba(255,255,255,0.55)';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F3FF',
  },
  gradient: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 24,
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
    marginTop: 10,
    marginBottom: 16,
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.7)',
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
    borderRadius: 24,
    padding: 18,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
    marginBottom: 16,
  },
  heroLabel: {
    fontSize: 12,
    color: '#4338CA',
    fontWeight: '600',
    marginBottom: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  heroTotal: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginRight: 6,
  },
  heroTotalLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  progressBarBg: {
    marginTop: 4,
    marginBottom: 10,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: '#6366F1',
    borderRadius: 999,
  },
  heroStatsRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  heroStat: {
    flex: 1,
  },
  heroStatLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  heroStatValue: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  sectionSubTitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  sessionButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionButtonText: {
    fontSize: 22,
    color: '#111827',
    fontWeight: '600',
  },
  sessionCenter: {
    flex: 1,
    alignItems: 'center',
  },
  sessionNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: '#4F46E5',
  },
  sessionLabel: {
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
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
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
    maxWidth: 210,
  },
  modeCount: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  tipBox: {
    marginTop: 12,
    borderRadius: 14,
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