// mobile/src/screens/HomeScreen.tsx
import React, { useState, useCallback, useMemo } from 'react';
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
import {
  MOCK_DECKS,
  getMockDeckBySlug,
  getActiveDeckSlug,
  setActiveDeckSlug,
} from '../mock/jsCoreStarterMock';
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
  const calendar: CalendarDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    calendar.push({ dateKey: formatDateKey(d), count: 0 });
  }

  for (const p of progress) {
    if (!p.nextReviewAt) continue;
    const key = formatDateKey(new Date(p.nextReviewAt));
    const day = calendar.find(c => c.dateKey === key);
    if (day) day.count += 1;
  }

  const todayDueCount = progress.filter(p => isDue(p, now)).length;
  return { todayDueCount, calendar };
}

export function HomeScreen({ navigation }: Props) {
  const [selectedSlug, setSelectedSlug] = useState(() => getActiveDeckSlug());
  const deck = useMemo(() => {
    return getMockDeckBySlug(selectedSlug) ?? MOCK_DECKS[0];
  }, [selectedSlug]);

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

        if (!deck.Cards || deck.Cards.length === 0) {
          const { todayDueCount, calendar } = buildCalendar([], now);
          void syncDailyReminders({ remainingDueCount: 0, now });

          if (cancelled) return;
          setState({
            loading: false,
            progress: [],
            dailyStats: ({ plannedCount: 0 } as DailyStats),
            todayDueCount,
            calendar,
          });
          return;
        }

        const progress = await loadDeckProgress(deck);
        if (cancelled) return;

        const dailyStats = await loadOrInitDailyStats(deck, progress);
        if (cancelled) return;

        const { todayDueCount, calendar } = buildCalendar(progress, now);

        // ✅ only one sync
        void syncDailyReminders({ remainingDueCount: todayDueCount, now });

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
    }, [deck.Slug]),
  );

  const { loading, dailyStats, todayDueCount, calendar } = state;
  const totalCards = deck.TotalCards ?? deck.Cards?.length ?? 0;
  const canStudy = (deck.Cards?.length ?? 0) > 0;

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
            <Text style={styles.loadingText}>Loading home...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const plannedToday = dailyStats.plannedCount;
  const newToday = Math.max(plannedToday - todayDueCount, 0);
  const masteredApprox = Math.max(totalCards - (todayDueCount + newToday), 0);
  const overallPercent = totalCards > 0 ? masteredApprox / totalCards : 0;

  const nextReviewMs = (() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(20, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  })();

  const hours = Math.floor(nextReviewMs / (1000 * 60 * 60));
  const minutes = Math.floor((nextReviewMs % (1000 * 60 * 60)) / (1000 * 60));
  const nextReviewText = `${hours}h ${minutes}m`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.appTitle}>DevCards</Text>
              <Text style={styles.appSubtitle}>
                Daily practice — personalized schedule.
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.settingsButton,
                pressed && styles.settingsButtonPressed,
              ]}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.settingsText}>⚙︎</Text>
            </Pressable>
          </View>

          {/* Deck switcher */}
          <View style={styles.deckSwitcherCard}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.deckSwitcherScroll}
            >
              {MOCK_DECKS.map(d => {
                const active = d.Slug === selectedSlug;
                const isPremium = d.DeckType !== 1;
                return (
                  <Pressable
                    key={d.Slug}
                    style={({ pressed }) => [
                      styles.deckChip,
                      active && styles.deckChipActive,
                      pressed && styles.deckChipPressed,
                    ]}
                    onPress={() => {
                      setActiveDeckSlug(d.Slug);
                      setSelectedSlug(d.Slug);
                    }}
                  >
                    <Text
                      style={[
                        styles.deckChipTitle,
                        active && styles.deckChipTitleActive,
                      ]}
                      numberOfLines={1}
                    >
                      {d.Title}
                    </Text>
                    <Text
                      style={[
                        styles.deckChipMeta,
                        active && styles.deckChipMetaActive,
                      ]}
                    >
                      {isPremium ? 'Premium' : 'Starter'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.deckCard}>
            <Text style={styles.deckTitle}>{deck.Title}</Text>
            <Text style={styles.deckMeta}>
              {deck.Locale} · v{deck.Version}
            </Text>

            <View style={styles.deckCountsRow}>
              <View style={styles.countPill}>
                <Text style={styles.countNumber}>{todayDueCount}</Text>
                <Text style={styles.countLabel}>due</Text>
              </View>
              <View style={styles.countPill}>
                <Text style={styles.countNumber}>{newToday}</Text>
                <Text style={styles.countLabel}>new</Text>
              </View>
              <View style={styles.countPill}>
                <Text style={styles.countNumber}>{masteredApprox}</Text>
                <Text style={styles.countLabel}>mastered</Text>
              </View>
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

            <Text style={styles.progressText}>
              {Math.round(overallPercent * 100)}% overall • Next review in{' '}
              {nextReviewText}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                !canStudy && styles.primaryButtonDisabled,
                pressed && styles.primaryButtonPressed,
              ]}
              disabled={!canStudy}
              onPress={() => navigation.navigate('Review', {})}
            >
              <Text style={styles.primaryButtonText}>
                {canStudy ? 'Start review' : 'Coming soon'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.calendarCard}>
            <Text style={styles.sectionTitle}>Next 7 days</Text>
            <View style={styles.calendarRow}>
              {calendar.map(day => (
                <View key={day.dateKey} style={styles.calendarCell}>
                  <Text style={styles.calendarDay}>{day.dateKey.slice(5)}</Text>
                  <View style={styles.calendarDotWrap}>
                    <View
                      style={[
                        styles.calendarDot,
                        { opacity: day.count === 0 ? 0.18 : 1 },
                      ]}
                    />
                  </View>
                  <Text style={styles.calendarCount}>{day.count}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.calendarHint}>
              Next intervals: {INTERVALS_DAYS.join(', ')} days.
            </Text>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default HomeScreen;

const GLASS = 'rgba(255,255,255,0.16)';
const BORDER = 'rgba(255,255,255,0.45)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 10, color: '#6B7280' },

  headingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  appTitle: { fontSize: 22, fontWeight: '800', color: '#111827' },
  appSubtitle: { marginTop: 4, color: '#6B7280' },

  settingsButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  settingsButtonPressed: { opacity: 0.92 },
  settingsText: { fontSize: 18, color: '#111827' },

  deckSwitcherCard: { marginBottom: 14 },
  deckSwitcherScroll: { paddingRight: 6 },
  deckChip: {
    width: 170,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  deckChipActive: {
    backgroundColor: 'rgba(79,70,229,0.10)',
    borderColor: 'rgba(79,70,229,0.28)',
  },
  deckChipPressed: { opacity: 0.92 },
  deckChipTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  deckChipTitleActive: { color: '#4F46E5' },
  deckChipMeta: { marginTop: 4, fontSize: 11, color: '#6B7280' },
  deckChipMetaActive: { color: '#4F46E5', fontWeight: '600' },

  deckCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  deckTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  deckMeta: { marginTop: 4, color: '#6B7280', fontSize: 12 },

  deckCountsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  countPill: {
    width: '31%',
    borderRadius: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
  },
  countNumber: { fontSize: 18, fontWeight: '800', color: '#111827' },
  countLabel: { fontSize: 11, color: '#6B7280', marginTop: 2 },

  progressBarBg: {
    marginTop: 12,
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: { backgroundColor: '#4F46E5', borderRadius: 999 },
  progressText: { marginTop: 10, fontSize: 12, color: '#374151' },

  primaryButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: '#4F46E5',
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonPressed: { opacity: 0.92 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  calendarCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  calendarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  calendarCell: { alignItems: 'center', width: '13%' },
  calendarDay: { fontSize: 11, color: '#6B7280' },
  calendarDotWrap: { marginTop: 6, marginBottom: 4 },
  calendarDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  calendarCount: { fontSize: 11, color: '#111827', fontWeight: '600' },
  calendarHint: { marginTop: 10, fontSize: 11, color: '#6B7280' },
});