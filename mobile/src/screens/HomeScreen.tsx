// mobile/src/screens/HomeScreen.tsx
// Home dashboard: calendar (7/30 toggle) + active deck overview + deck list with ALL/FREE/PREMIUM filter.
//
// Layout goals:
// 1) Top: Calendar (7d/30d switch) for the currently selected deck.
// 2) Middle: Selected deck overview (due/new/mastered + progress + start button).
// 3) Bottom: One vertical deck list card with a segmented filter (All / Free / Premium).
// 4) Keep existing style: light gradient background + glass cards.

import React, { useCallback, useMemo, useState } from 'react';
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

// Deck data + helpers (you already use these in your project)
import {
  MOCK_DECKS,
  getMockDeckBySlug,
  getActiveDeckSlug,
  setActiveDeckSlug,
} from '../mock/jsCoreStarterMock';

import type { CardProgress } from '../review/model';
import { isDue, formatDateKey } from '../review/model';

import {
  loadDeckProgress,
  loadOrInitDailyStats,
  type DailyStats,
} from '../review/storage';

import { syncDailyReminders } from '../notifications/reminders';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type CalendarRange = 7 | 30;

type DeckFilter = 'all' | 'free' | 'premium';

type CalendarDay = {
  dateKey: string; // YYYY-MM-DD
  count: number;
};

type DeckSummary = {
  slug: string;
  title: string;
  locale: string;
  version: string;
  deckType: number; // 1 = free starter, else premium
  totalCards: number;
  canStudy: boolean;

  dueToday: number;
  plannedToday: number;
  newToday: number;
  masteredApprox: number;
  percent: number; // 0..1

  // Precomputed upcoming schedule for the next 30 days (used for both 7/30 views).
  upcoming30: CalendarDay[];
};

type HomeState = {
  loading: boolean;
  asOfISO: string;
  deckSummaries: DeckSummary[];
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Build a fixed-length (days) calendar array for upcoming reviews.
 * - Keeps order stable (today ... today+days-1)
 * - Counts how many cards have nextReviewAt on each day
 */
function buildUpcoming(
  progress: CardProgress[],
  now: Date,
  days: number,
): CalendarDay[] {
  const out: CalendarDay[] = [];
  const index = new Map<string, number>();

  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    index.set(key, i);
    out.push({ dateKey: key, count: 0 });
  }

  for (const p of progress) {
    if (!p.nextReviewAt) continue;
    const key = formatDateKey(new Date(p.nextReviewAt));
    const idx = index.get(key);
    if (idx === undefined) continue;
    out[idx].count += 1;
  }

  return out;
}

function formatMMDD(dateKey: string) {
  // YYYY-MM-DD -> MM-DD
  return dateKey.slice(5);
}

function weekdayShort(d: Date) {
  // Force English weekday labels for consistency.
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

export function HomeScreen({ navigation }: Props) {
  /**
   * Persist the last selected deck so:
   * - Review screen can use the same deck without extra params
   * - Next app launch stays on your last deck
   */
  const [selectedSlug, setSelectedSlug] = useState(() => {
    const stored = getActiveDeckSlug();
    return getMockDeckBySlug(stored)?.Slug ?? MOCK_DECKS[0]?.Slug;
  });

  // Calendar display range toggle
  const [calendarRange, setCalendarRange] = useState<CalendarRange>(7);

  const [deckFilter, setDeckFilter] = useState<DeckFilter>('all');

  // Home data state
  const [state, setState] = useState<HomeState>({
    loading: true,
    asOfISO: new Date().toISOString(),
    deckSummaries: [],
  });

  // Deck object for the active selection.
  const activeDeck = useMemo(() => {
    return getMockDeckBySlug(selectedSlug) ?? MOCK_DECKS[0];
  }, [selectedSlug]);

  /**
   * Load summaries when entering Home (focus).
   * We compute per-deck due/progress so the vertical list is actually useful.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setState(prev => ({ ...prev, loading: true }));

        const now = new Date();
        const deckSummaries: DeckSummary[] = [];
        let totalDueAllDecks = 0;

        for (const deck of MOCK_DECKS) {
          const totalCards = deck.TotalCards ?? deck.Cards?.length ?? 0;
          const canStudy = (deck.Cards?.length ?? 0) > 0;

          // Premium placeholder (no cards shipped yet)
          if (!canStudy) {
            deckSummaries.push({
              slug: deck.Slug,
              title: deck.Title,
              locale: deck.Locale,
              version: deck.Version,
              deckType: deck.DeckType,
              totalCards,
              canStudy,
              dueToday: 0,
              plannedToday: 0,
              newToday: 0,
              masteredApprox: 0,
              percent: 0,
              upcoming30: buildUpcoming([], now, 30),
            });
            continue;
          }

          // Load progress and daily stats for this deck
          const progress = await loadDeckProgress(deck);
          if (cancelled) return;

          const dailyStats: DailyStats = await loadOrInitDailyStats(
            deck,
            progress,
          );
          if (cancelled) return;

          const dueToday = progress.filter(p => isDue(p, now)).length;
          const plannedToday = dailyStats.plannedCount;
          const newToday = Math.max(plannedToday - dueToday, 0);
          const masteredApprox = Math.max(totalCards - (dueToday + newToday), 0);
          const percent =
            totalCards > 0 ? clamp01(masteredApprox / totalCards) : 0;

          totalDueAllDecks += dueToday;

          deckSummaries.push({
            slug: deck.Slug,
            title: deck.Title,
            locale: deck.Locale,
            version: deck.Version,
            deckType: deck.DeckType,
            totalCards,
            canStudy,
            dueToday,
            plannedToday,
            newToday,
            masteredApprox,
            percent,
            upcoming30: buildUpcoming(progress, now, 30),
          });
        }

        // App-level reminders: if ANY deck has due cards, remind at 20:00.
        void syncDailyReminders({ remainingDueCount: totalDueAllDecks, now });

        if (cancelled) return;
        setState({ loading: false, asOfISO: now.toISOString(), deckSummaries });
      }

      void load();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const { loading, asOfISO, deckSummaries } = state;
  const asOf = useMemo(() => new Date(asOfISO), [asOfISO]);

  // Split deck list into Free / Premium sections
  const freeDecks = useMemo(
    () => deckSummaries.filter(d => d.deckType === 1),
    [deckSummaries],
  );
  const premiumDecks = useMemo(
    () => deckSummaries.filter(d => d.deckType !== 1),
    [deckSummaries],
  );

  const activeSummary = useMemo(() => {
    return (
      deckSummaries.find(d => d.slug === activeDeck.Slug) ??
      deckSummaries[0] ??
      null
    );
  }, [deckSummaries, activeDeck.Slug]);

  // Calendar for selected deck: slice from precomputed 30-day list
  const calendar = useMemo(() => {
    const list = activeSummary?.upcoming30 ?? buildUpcoming([], asOf, 30);
    return calendarRange === 7 ? list.slice(0, 7) : list;
  }, [activeSummary, asOf, calendarRange]);

  // For visual scaling (bars)
  const maxUpcoming = useMemo(() => {
    let max = 0;
    for (const d of calendar) max = Math.max(max, d.count);
    return max;
  }, [calendar]);

  const canStudy = activeSummary?.canStudy ?? false;

  if (loading || !activeSummary) {
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
            <Text style={styles.loadingText}>Loading home…</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  function selectDeck(slug: string) {
    // Persist selection (Review screen + next app launch use the same deck).
    setActiveDeckSlug(slug);
    setSelectedSlug(slug);
  }

  function dayLabelForIndex(i: number) {
    // Use index relative to "asOf" to avoid date parsing issues.
    if (i === 0) return 'Today';
    if (i === 1) return calendarRange === 7 ? 'Tomorrow' : 'Next';
    const d = new Date(asOf.getTime());
    d.setDate(d.getDate() + i);
    return weekdayShort(d);
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
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.appTitle}>DevCards</Text>
              <Text style={styles.appSubtitle}>Make fundamentals feel automatic.</Text>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.iconButtonText}>⚙︎</Text>
            </Pressable>
          </View>

          {/* Calendar (top) */}
          <View style={styles.cardGlass}>
            <View style={styles.cardHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Calendar</Text>

                {/* Fixed height: force the subtitle to ONE line with ellipsis */}
                <Text
                  style={styles.cardSubtitle}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  Upcoming reviews for{' '}
                  <Text style={styles.cardSubtitleStrong}>{activeSummary.title}</Text>
                </Text>
              </View>

              {/* 7 / 30 toggle */}
              <View style={styles.segment}>
                <Pressable
                  style={({ pressed }) => [
                    styles.segmentItem,
                    calendarRange === 7 && styles.segmentItemActive,
                    pressed && styles.segmentPressed,
                  ]}
                  onPress={() => setCalendarRange(7)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      calendarRange === 7 && styles.segmentTextActive,
                    ]}
                  >
                    7d
                  </Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.segmentItem,
                    calendarRange === 30 && styles.segmentItemActive,
                    pressed && styles.segmentPressed,
                  ]}
                  onPress={() => setCalendarRange(30)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      calendarRange === 30 && styles.segmentTextActive,
                    ]}
                  >
                    30d
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* 7-day compact bar grid */}
            {calendarRange === 7 ? (
              <View style={styles.calendarGrid7}>
                {calendar.map((day, idx) => {
                  // Minimum non-zero bar height for readability, kept subtle by opacity when count=0.
                  const pct =
                    maxUpcoming <= 0 ? 0 : Math.max(0.1, day.count / maxUpcoming);

                  return (
                    <View key={day.dateKey} style={styles.calCell7}>
                      <Text style={styles.calLabel7} numberOfLines={1}>
                        {dayLabelForIndex(idx)}
                      </Text>

                      {/* Vertical “thermometer” bar (compact) */}
                      <View style={styles.calBarBg7}>
                        <View
                          style={[
                            styles.calBarFill7,
                            {
                              flex: pct,
                              opacity: day.count === 0 ? 0.18 : 1,
                            },
                          ]}
                        />
                        <View style={{ flex: 1 - pct }} />
                      </View>

                      <Text style={styles.calCount7}>{day.count}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              // 30-day horizontal scroll cards
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.calendarScroll30}
              >
                {calendar.map((day, idx) => {
                  const pct =
                    maxUpcoming <= 0 ? 0 : clamp01(day.count / maxUpcoming);

                  return (
                    <View key={day.dateKey} style={styles.dayCard30}>
                      <Text style={styles.dayLabel30}>
                        {idx === 0 ? 'Today' : formatMMDD(day.dateKey)}
                      </Text>
                      <View style={styles.dayBarBg30}>
                        <View
                          style={[
                            styles.dayBarFill30,
                            {
                              width: `${pct * 100}%`,
                              opacity: day.count === 0 ? 0.18 : 1,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.dayCount30}>{day.count} cards</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <Text style={styles.hintText}>
              Tip: Tap a deck below to switch the calendar and study dashboard.
            </Text>
          </View>

          {/* Active deck overview */}
          <View style={styles.cardGlass}>
            <View style={styles.deckHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deckTitle}>{activeSummary.title}</Text>
                <Text style={styles.deckMeta}>
                  {activeSummary.locale} · {activeSummary.totalCards} cards
                </Text>
              </View>

              <View
                style={[
                  styles.badge,
                  activeSummary.deckType !== 1 && styles.badgePremium,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    activeSummary.deckType !== 1 && styles.badgeTextPremium,
                  ]}
                >
                  {activeSummary.deckType === 1 ? 'Free' : 'Premium'}
                </Text>
              </View>
            </View>

            {!activeSummary.canStudy ? (
              <Text style={styles.placeholderText}>
                This deck is a placeholder in this build. Content will be available later.
              </Text>
            ) : (
              <>
                <View style={styles.statsRow}>
                  <View style={styles.statPill}>
                    <Text style={styles.statNumber}>{activeSummary.dueToday}</Text>
                    <Text style={styles.statLabel}>due</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Text style={styles.statNumber}>{activeSummary.newToday}</Text>
                    <Text style={styles.statLabel}>new</Text>
                  </View>
                  <View style={styles.statPill}>
                    <Text style={styles.statNumber}>
                      {activeSummary.masteredApprox}
                    </Text>
                    <Text style={styles.statLabel}>mastered</Text>
                  </View>
                </View>

                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        flex: activeSummary.percent,
                        opacity: activeSummary.percent === 0 ? 0 : 1,
                      },
                    ]}
                  />
                  <View style={{ flex: 1 - activeSummary.percent }} />
                </View>

                <Text style={styles.progressText}>
                  {Math.round(activeSummary.percent * 100)}% overall · {activeSummary.dueToday} due today
                </Text>
              </>
            )}

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

          {/* Deck list (ALL / Free / Premium in one card) */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Decks</Text>
              <Text style={styles.sectionMeta}>{deckSummaries.length}</Text>
            </View>

            <View style={styles.deckFilterRow}>
              <View style={styles.segment}>
                <Pressable
                  style={({ pressed }) => [
                    styles.segmentItem,
                    deckFilter === 'all' && styles.segmentItemActive,
                    pressed && styles.segmentPressed,
                  ]}
                  onPress={() => setDeckFilter('all')}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      deckFilter === 'all' && styles.segmentTextActive,
                    ]}
                  >
                    All
                  </Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.segmentItem,
                    deckFilter === 'free' && styles.segmentItemActive,
                    pressed && styles.segmentPressed,
                  ]}
                  onPress={() => setDeckFilter('free')}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      deckFilter === 'free' && styles.segmentTextActive,
                    ]}
                  >
                    Free
                  </Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.segmentItem,
                    deckFilter === 'premium' && styles.segmentItemActive,
                    pressed && styles.segmentPressed,
                  ]}
                  onPress={() => setDeckFilter('premium')}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      deckFilter === 'premium' && styles.segmentTextActive,
                    ]}
                  >
                    Premium
                  </Text>
                </Pressable>
              </View>
            </View>

            {deckFilter !== 'premium' ? null : (
              <Text style={styles.sectionHint}>
                Premium decks are placeholders in this build.
              </Text>
            )}

            {deckFilter === 'all' ? (
              <>
                <Text style={styles.groupLabel}>Free</Text>
                {freeDecks.map(d => {
                  const active = d.slug === selectedSlug;
                  return (
                    <Pressable
                      key={d.slug}
                      style={({ pressed }) => [
                        styles.deckRow,
                        active && styles.deckRowActive,
                        pressed && styles.deckRowPressed,
                      ]}
                      onPress={() => selectDeck(d.slug)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.deckRowTitle,
                            active && styles.deckRowTitleActive,
                          ]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {d.title}
                        </Text>
                        <Text style={styles.deckRowSub} numberOfLines={1}>
                          {d.totalCards} cards · v{d.version}
                        </Text>
                      </View>

                      <View style={styles.deckRowRight}>
                        <Text style={styles.duePill}>{d.dueToday} due</Text>
                        <View style={styles.rowBarBg}>
                          <View
                            style={[
                              styles.rowBarFill,
                              {
                                flex: d.percent,
                                opacity: d.percent === 0 ? 0 : 1,
                              },
                            ]}
                          />
                          <View style={{ flex: 1 - d.percent }} />
                        </View>
                      </View>
                    </Pressable>
                  );
                })}

                <View style={styles.groupDivider} />

                <Text style={styles.groupLabel}>Premium</Text>
                {premiumDecks.map(d => {
                  const active = d.slug === selectedSlug;
                  return (
                    <Pressable
                      key={d.slug}
                      style={({ pressed }) => [
                        styles.deckRow,
                        active && styles.deckRowActive,
                        pressed && styles.deckRowPressed,
                      ]}
                      onPress={() => selectDeck(d.slug)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.deckRowTitle,
                            active && styles.deckRowTitleActive,
                          ]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {d.title}
                        </Text>
                        <Text style={styles.deckRowSub} numberOfLines={1}>
                          {d.totalCards} cards · v{d.version}
                        </Text>
                      </View>
                      <Text style={styles.premiumPill}>Premium</Text>
                    </Pressable>
                  );
                })}
              </>
            ) : deckFilter === 'free' ? (
              freeDecks.map(d => {
                const active = d.slug === selectedSlug;
                return (
                  <Pressable
                    key={d.slug}
                    style={({ pressed }) => [
                      styles.deckRow,
                      active && styles.deckRowActive,
                      pressed && styles.deckRowPressed,
                    ]}
                    onPress={() => selectDeck(d.slug)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.deckRowTitle,
                          active && styles.deckRowTitleActive,
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {d.title}
                      </Text>
                      <Text style={styles.deckRowSub} numberOfLines={1}>
                        {d.totalCards} cards · v{d.version}
                      </Text>
                    </View>

                    <View style={styles.deckRowRight}>
                      <Text style={styles.duePill}>{d.dueToday} due</Text>
                      <View style={styles.rowBarBg}>
                        <View
                          style={[
                            styles.rowBarFill,
                            {
                              flex: d.percent,
                              opacity: d.percent === 0 ? 0 : 1,
                            },
                          ]}
                        />
                        <View style={{ flex: 1 - d.percent }} />
                      </View>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              premiumDecks.map(d => {
                const active = d.slug === selectedSlug;
                return (
                  <Pressable
                    key={d.slug}
                    style={({ pressed }) => [
                      styles.deckRow,
                      active && styles.deckRowActive,
                      pressed && styles.deckRowPressed,
                    ]}
                    onPress={() => selectDeck(d.slug)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.deckRowTitle,
                          active && styles.deckRowTitleActive,
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {d.title}
                      </Text>
                      <Text style={styles.deckRowSub} numberOfLines={1}>
                        {d.totalCards} cards · v{d.version}
                      </Text>
                    </View>
                    <Text style={styles.premiumPill}>Premium</Text>
                  </Pressable>
                );
              })
            )}
          </View>

          <View style={{ height: 24 }} />
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
  appSubtitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },

  iconButton: {
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
  iconButtonPressed: { opacity: 0.92 },
  iconButtonText: { fontSize: 18, color: '#111827' },

  cardGlass: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },

  cardHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  cardSubtitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },
  cardSubtitleStrong: { fontWeight: '800', color: '#111827' },

  segment: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
  },
  segmentItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  segmentItemActive: {
    backgroundColor: 'rgba(79,70,229,0.14)',
  },
  segmentPressed: { opacity: 0.92 },
  segmentText: { fontSize: 12, fontWeight: '700', color: '#111827' },
  segmentTextActive: { color: '#4F46E5' },

  // --- Calendar 7d grid ---
  calendarGrid7: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  calCell7: {
    alignItems: 'center',
    width: '13%',
  },
  calLabel7: {
    fontSize: 10,
    color: '#6B7280',
  },
  calBarBg7: {
    marginTop: 6,
    height: 28,
    width: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.08)',
    overflow: 'hidden',
    flexDirection: 'column',
  },
  calBarFill7: {
    width: 10,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  calCount7: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: '#111827',
  },

  // --- Calendar 30d scroll ---
  calendarScroll30: { paddingTop: 12, paddingBottom: 2 },
  dayCard30: {
    width: 118,
    padding: 12,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
  },
  dayLabel30: { fontSize: 12, fontWeight: '800', color: '#111827' },
  dayBarBg30: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.08)',
    overflow: 'hidden',
  },
  dayBarFill30: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  dayCount30: {
    marginTop: 8,
    fontSize: 12,
    color: '#111827',
    fontWeight: '700',
  },

  hintText: { marginTop: 10, fontSize: 11, color: '#6B7280' },

  // --- Active deck overview ---
  deckHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  deckTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  deckMeta: { marginTop: 4, color: '#6B7280', fontSize: 12 },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(79,70,229,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.25)',
  },
  badgePremium: {
    backgroundColor: 'rgba(17,24,39,0.06)',
    borderColor: 'rgba(17,24,39,0.10)',
  },
  badgeText: { fontSize: 12, fontWeight: '800', color: '#4F46E5' },
  badgeTextPremium: { color: '#111827' },

  placeholderText: {
    marginTop: 10,
    fontSize: 12,
    color: '#6B7280',
  },

  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  statPill: {
    width: '31%',
    borderRadius: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
  },
  statNumber: { fontSize: 18, fontWeight: '800', color: '#111827' },
  statLabel: { fontSize: 11, color: '#6B7280', marginTop: 2 },

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

  // --- Deck list sections ---
  sectionCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  sectionMeta: { fontSize: 12, color: '#6B7280' },
  sectionHint: { marginTop: 6, fontSize: 12, color: '#6B7280' },

  deckFilterRow: {
    marginTop: 10,
    marginBottom: 6,
    alignItems: 'flex-start',
  },

  groupLabel: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '800',
    color: '#111827',
  },

  groupDivider: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(17,24,39,0.10)',
  },

  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17,24,39,0.04)',
    marginTop: 10,
  },
  deckRowActive: {
    backgroundColor: 'rgba(79,70,229,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.18)',
  },
  deckRowPressed: { opacity: 0.92 },

  deckRowTitle: { fontSize: 13, fontWeight: '800', color: '#111827' },
  deckRowTitleActive: { color: '#4F46E5' },
  deckRowSub: { marginTop: 3, fontSize: 11, color: '#6B7280' },

  deckRowRight: { alignItems: 'flex-end', marginLeft: 10 },
  duePill: {
    fontSize: 11,
    fontWeight: '900',
    color: '#4F46E5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(79,70,229,0.10)',
  },

  rowBarBg: {
    width: 90,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.08)',
    overflow: 'hidden',
    flexDirection: 'row',
    marginTop: 8,
  },
  rowBarFill: { backgroundColor: '#4F46E5', borderRadius: 999 },

  premiumPill: {
    marginLeft: 10,
    fontSize: 11,
    fontWeight: '900',
    color: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
  },
});