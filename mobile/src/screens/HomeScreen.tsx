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
import { LinearGradient } from 'expo-linear-gradient';
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
import { syncDailyReminders } from '../notifications/reminders';



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

  return { todayDueCount: dueNow, calendar };
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
        const remainingDueCount = progress.filter(p => isDue(p, now)).length;
        // 不要 await 也行（你函数内部已经 try/catch 了）
        syncDailyReminders({ remainingDueCount, now });
        if (cancelled) return;

        const dailyStats = await loadOrInitDailyStats(deck, progress);
        if (cancelled) return;

        const { todayDueCount, calendar } = buildCalendar(progress, now);
        // ✅ 同步 9:00(固定) + 20:00(有剩余才安排/没剩余就取消)
        await syncDailyReminders({ remainingDueCount: todayDueCount, now });
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
  const totalCards = deck.TotalCards;

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
            <Text style={styles.loadingText}>Preparing your study plan...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const plannedToday = dailyStats.plannedCount;
  const newToday = Math.max(plannedToday - todayDueCount, 0);
  const masteredApprox = Math.max(totalCards - (todayDueCount + newToday), 0);
  const overallPercent =
    totalCards > 0 ? masteredApprox / totalCards : 0;

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
          {/* 顶部标题 */}
         <View style={styles.headingRow}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.appTitle}>RecallSmith</Text>
                    <Text style={styles.appSubtitle}>
                    Smart spaced‑repetition for full‑stack interviews.
                    </Text>
                </View>

                <Pressable
                    style={({ pressed }) => [
                    styles.settingsButton,
                    pressed && styles.settingsButtonPressed,
                    ]}
                    onPress={() => navigation.navigate('Settings')}
                >
                    <Text style={styles.settingsButtonText}>Settings</Text>
                </Pressable>
                </View>

          {/* 主 Deck 概览玻璃卡片 */}
          <View style={styles.deckCard}>
            <View style={styles.deckHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deckTitle}>{deck.Title}</Text>
                <Text style={styles.deckMeta}>
                  Starter deck · {deck.Locale}
                </Text>
              </View>
              <View style={styles.deckBadge}>
                <Text style={styles.deckBadgeText}>{deck.Version}</Text>
              </View>
            </View>

            <View style={styles.deckProgressRow}>
              <Text style={styles.deckProgressLabel}>Overall progress</Text>
              <Text style={styles.deckProgressValue}>
                {masteredApprox} / {totalCards}
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

            <View style={styles.deckStatsRow}>
              <View style={styles.deckStat}>
                <Text style={styles.deckStatLabel}>Due today</Text>
                <Text style={[styles.deckStatValue, { color: '#EF4444' }]}>
                  {todayDueCount}
                </Text>
              </View>
              <View style={styles.deckStat}>
                <Text style={styles.deckStatLabel}>New today</Text>
                <Text style={[styles.deckStatValue, { color: '#0EA5E9' }]}>
                  {newToday}
                </Text>
              </View>
              <View style={styles.deckStat}>
                <Text style={styles.deckStatLabel}>Mastered (approx)</Text>
                <Text style={[styles.deckStatValue, { color: '#22C55E' }]}>
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
              <Text style={styles.primaryButtonText}>Open deck</Text>
            </Pressable>
          </View>

          {/* 日历玻璃卡片 */}
          <View style={styles.calendarCard}>
            <View style={styles.calendarHeaderRow}>
              <Text style={styles.sectionTitle}>Next 7 days</Text>
              <Text style={styles.sectionSubTitle}>
                Interval stages: {INTERVALS_DAYS.join(' / ')} days
              </Text>
            </View>
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
                const active = index === 0;
                return (
                  <View key={day.dateKey} style={styles.calendarItem}>
                    <Text
                      style={[
                        styles.calendarLabel,
                        active && styles.calendarLabelActive,
                      ]}
                    >
                      {label}
                    </Text>
                    <Text style={styles.calendarDate}>{day.dateKey}</Text>
                    <View style={styles.calendarDotRow}>
                      <View
                        style={[
                          styles.calendarDot,
                          day.count === 0 && { opacity: 0.25 },
                        ]}
                      />
                      <Text style={styles.calendarCount}>
                        {day.count} card{day.count === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default HomeScreen;

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
    paddingBottom: 28,
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
  headingBlock: {
    paddingTop: 6,
    paddingBottom: 16,
  },
  appTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: 0.4,
  },
  appSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#6B7280',
  },
  deckCard: {
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
  deckHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  deckTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  deckMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  deckBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(79,70,229,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.45)',
    marginLeft: 10,
  },
  deckBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4F46E5',
  },
  deckProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  deckProgressLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  deckProgressValue: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '500',
  },
  progressBarBg: {
    marginTop: 8,
    marginBottom: 10,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.3)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: '#6366F1',
    borderRadius: 999,
  },
  deckStatsRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  deckStat: {
    flex: 1,
  },
  deckStatLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  deckStatValue: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 2,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.92,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  calendarCard: {
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  sectionSubTitle: {
    fontSize: 11,
    color: '#6B7280',
  },
  calendarScroll: {
    marginTop: 6,
  },
  calendarItem: {
    width: 110,
    marginRight: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  calendarLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  calendarLabelActive: {
    color: '#4F46E5',
    fontWeight: '600',
  },
  calendarDate: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  calendarDotRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#6366F1',
    marginRight: 6,
  },
  calendarCount: {
    fontSize: 13,
    color: '#111827',
  },
  headingRow: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingTop: 6,
  paddingBottom: 16,
},
settingsButton: {
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: 'rgba(255,255,255,0.85)',
  marginLeft: 8,
},
settingsButtonPressed: {
  opacity: 0.9,
},
settingsButtonText: {
  fontSize: 12,
  fontWeight: '500',
  color: '#111827',
},
});