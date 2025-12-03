// mobile/src/screens/HomeScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { jsCoreStarterMock } from '../mock/jsCoreStarterMock';
import type { CardProgress } from '../review/model';
import { isDue, formatDateKey, INTERVALS_DAYS } from '../review/model';
import {
  loadDeckProgress,
  loadOrInitDailyStats,
  type DailyStats,
} from '../review/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

interface CalendarDay {
  dateKey: string;
  count: number;
}

interface HomeState {
  loading: boolean;
  progress: CardProgress[];
  dailyStats: DailyStats | null;
  todayDueCount: number;
  calendar: CalendarDay[];
}

// 根据 progress 计算今天应复习数量 + 未来 7 天日历
function buildCalendar(
  progress: CardProgress[],
  now: Date,
): { todayDueCount: number; calendar: CalendarDay[] } {
  const days = 7;
  const map: Record<string, number> = {};

  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    map[key] = 0;
  }

  for (const p of progress) {
    const next = new Date(p.nextReviewAt);
    const key = formatDateKey(next);
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      map[key] += 1;
    }
  }

  const calendar: CalendarDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    calendar.push({ dateKey: key, count: map[key] ?? 0 });
  }

  const dueNow = progress.filter(p => isDue(p, now)).length;

  return {
    todayDueCount: dueNow,
    calendar,
  };
}

export function HomeScreen({ navigation }: Props) {
  const deck = jsCoreStarterMock;

  const [state, setState] = useState<HomeState>({
    loading: true,
    progress: [],
    dailyStats: null,
    todayDueCount: 0,
    calendar: [],
  });

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

        const { todayDueCount, calendar } = buildCalendar(progress, now);

        setState({
          loading: false,
          progress,
          dailyStats,
          todayDueCount,
          calendar,
        });
      }

      load();

      return () => {
        cancelled = true;
      };
    }, [deck]),
  );

  const { loading, dailyStats, todayDueCount, calendar } = state;

  if (loading || !dailyStats) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Preparing your study plan...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalCards = deck.TotalCards;
  const plannedToday = dailyStats.plannedCount;
  const newToday = Math.max(plannedToday - todayDueCount, 0);
  const masteredApprox = Math.max(totalCards - (todayDueCount + newToday), 0);
  const overallPercent =
    totalCards > 0 ? masteredApprox / totalCards : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.screenTitle}>Today&apos;s study</Text>
        <Text style={styles.screenSubtitle}>
          Stay on track with spaced repetition for JavaScript.
        </Text>

        {/* Deck 卡片 */}
        <Pressable
          style={({ pressed }) => [
            styles.deckCard,
            pressed && styles.deckCardPressed,
          ]}
          onPress={() => navigation.navigate('Deck')}
        >
          <View style={styles.deckHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.deckTitle}>{deck.Title}</Text>
              <Text style={styles.deckMeta}>
                {deck.DeckType === 1 ? 'Starter deck' : 'Paid deck'} ·{' '}
                {deck.Locale}
              </Text>
            </View>
            <View style={styles.versionPill}>
              <Text style={styles.versionPillText}>{deck.Version}</Text>
            </View>
          </View>

          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>Overall progress</Text>
            <Text style={styles.progressValue}>
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

          <View style={styles.statsRow}>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Due today</Text>
              <Text style={[styles.statValue, { color: '#EF4444' }]}>
                {todayDueCount}
              </Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>New today</Text>
              <Text style={[styles.statValue, { color: '#0EA5E9' }]}>
                {newToday}
              </Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statLabel}>Mastered (approx)</Text>
              <Text style={[styles.statValue, { color: '#22C55E' }]}>
                {masteredApprox}
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
            onPress={() => navigation.navigate('Deck')}
          >
            <Text style={styles.primaryButtonText}>
              Open deck & choose mode
            </Text>
          </Pressable>
        </Pressable>

        {/* 未来 7 天日历 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Next 7 days</Text>
          <Text style={styles.sectionSubtitle}>
            Each dot shows how many cards are scheduled on that day.
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.calendarScroll}
          >
            {calendar.map((day, index) => {
              const label =
                index === 0
                  ? 'Today'
                  : index === 1
                  ? 'Tomorrow'
                  : `+${index}d`;
              const emphasized = index === 0;

              return (
                <View key={day.dateKey} style={styles.calendarItem}>
                  <Text
                    style={[
                      styles.calendarLabel,
                      emphasized && styles.calendarLabelEmphasis,
                    ]}
                  >
                    {label}
                  </Text>
                  <Text style={styles.calendarDate}>{day.dateKey}</Text>
                  <View style={styles.calendarDotRow}>
                    <View style={styles.calendarDot} />
                    <Text style={styles.calendarCount}>
                      {day.count} card{day.count === 1 ? '' : 's'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <Text style={styles.intervalHint}>
            Interval stages: {INTERVALS_DAYS.join(' / ')} days
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default HomeScreen;

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
  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  screenSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6B7280',
  },
  deckCard: {
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  deckCardPressed: {
    opacity: 0.9,
  },
  deckHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  deckTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  deckMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  versionPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    marginLeft: 8,
  },
  versionPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4F46E5',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  progressLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  progressValue: {
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
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: '#6366F1',
    borderRadius: 999,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statChip: {
    flex: 1,
    paddingVertical: 6,
  },
  statLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  statValue: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
  },
  calendarScroll: {
    marginTop: 12,
  },
  calendarItem: {
    width: 120,
    marginRight: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  calendarLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  calendarLabelEmphasis: {
    color: '#4F46E5',
    fontWeight: '600',
  },
  calendarDate: {
    marginTop: 2,
    fontSize: 11,
    color: '#9CA3AF',
  },
  calendarDotRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#6366F1',
    marginRight: 6,
  },
  calendarCount: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  intervalHint: {
    marginTop: 8,
    fontSize: 11,
    color: '#6B7280',
  },
});