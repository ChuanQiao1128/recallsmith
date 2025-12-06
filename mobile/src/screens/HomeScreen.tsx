// mobile/src/screens/HomeScreen.tsx
// Plan A (Home):
// 1) Calendar card (fixed height): Week preview (tap-to-toast) + Month modal calendar
// 2) Selected deck overview + start button
// 3) ONE deck list card with ALL / Free / Premium filter
//
// Calendar UX changes:
// - Week: Top shows date, bottom shows Today/weekday. Tap a day -> lightweight toast ("Aug 12 · 6 cards").
// - Month: Full current-month grid in a modal. "0" doesn't show dot/count, but spacing stays consistent.
// - Removed the old "View 30-day plan" button; only Week/Month segment remains.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Modal,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';

// Deck data + helpers (existing in your project)
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

type CalendarDay = { dateKey: string; count: number };

type DeckSummary = {
  slug: string;
  title: string;
  locale: string;
  version: string;
  deckType: number; // 1 = free, else premium
  totalCards: number;
  canStudy: boolean;

  dueToday: number;
  plannedToday: number;
  newToday: number;
  masteredApprox: number;
  percent: number; // 0..1

  // Precomputed: today -> today+29 buckets
  upcoming30: CalendarDay[];
};

type HomeState = {
  loading: boolean;
  asOfISO: string;
  deckSummaries: DeckSummary[];
};

type DeckFilter = 'all' | 'free' | 'premium';

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function startOfToday(d: Date) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

function weekdayShort(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function formatMonthYear(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatTooltipDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const WEEKDAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Build upcoming schedule buckets (today -> today+(days-1)).
 * UX: overdue cards are counted into “today” so backlog isn't hidden.
 */
function buildUpcoming(progress: CardProgress[], now: Date, days: number): CalendarDay[] {
  const out: CalendarDay[] = [];
  const index = new Map<string, number>();
  const today0 = startOfToday(now);

  for (let i = 0; i < days; i++) {
    const d = new Date(today0.getTime());
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    index.set(key, i);
    out.push({ dateKey: key, count: 0 });
  }

  for (const p of progress) {
    if (!p.nextReviewAt) continue;
    const next = new Date(p.nextReviewAt);

    const key = formatDateKey(next);
    const idx = index.get(key);

    // In-range date
    if (idx !== undefined) {
      out[idx].count += 1;
      continue;
    }

    // Overdue -> today
    if (next.getTime() < today0.getTime() && out.length > 0) {
      out[0].count += 1;
    }
  }

  return out;
}

export function HomeScreen({ navigation }: Props) {
  // Selection state: prefer stored active deck slug
  const [selectedSlug, setSelectedSlug] = useState(() => {
    const stored = getActiveDeckSlug();
    return getMockDeckBySlug(stored)?.Slug ?? MOCK_DECKS[0]?.Slug;
  });

  const [deckFilter, setDeckFilter] = useState<DeckFilter>('all');

  // Month modal state
  const [isMonthOpen, setIsMonthOpen] = useState(false);

  // Lightweight toast state (for week taps)
  const [toastText, setToastText] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (text: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);

      setToastText(text);
      setToastVisible(true);

      toastAnim.stopAnimation();
      toastAnim.setValue(0);

      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      toastTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setToastVisible(false);
        });
      }, 1400);
    },
    [toastAnim],
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Home data state
  const [state, setState] = useState<HomeState>({
    loading: true,
    asOfISO: new Date().toISOString(),
    deckSummaries: [],
  });

  const activeDeck = useMemo(() => {
    return getMockDeckBySlug(selectedSlug) ?? MOCK_DECKS[0];
  }, [selectedSlug]);

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

          const progress = await loadDeckProgress(deck);
          if (cancelled) return;

          const dailyStats: DailyStats = await loadOrInitDailyStats(deck, progress);
          if (cancelled) return;

          const dueToday = progress.filter(p => isDue(p, now)).length;
          const plannedToday = dailyStats.plannedCount;
          const newToday = Math.max(plannedToday - dueToday, 0);
          const masteredApprox = Math.max(totalCards - (dueToday + newToday), 0);
          const percent = totalCards > 0 ? clamp01(masteredApprox / totalCards) : 0;

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

        // Reminders: if ANY deck has due cards, schedule/cancel 20:00 reminder
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
  const today0 = useMemo(() => startOfToday(asOf), [asOf]);

  const activeSummary = useMemo(() => {
    return deckSummaries.find(d => d.slug === activeDeck.Slug) ?? deckSummaries[0] ?? null;
  }, [deckSummaries, activeDeck.Slug]);

  // 30-day buckets for the selected deck
  const calendar30 = useMemo(() => {
    return activeSummary?.upcoming30 ?? buildUpcoming([], asOf, 30);
  }, [activeSummary, asOf]);

  // Week preview is always the first 7 buckets
  const calendar7 = useMemo(() => calendar30.slice(0, 7), [calendar30]);

  const maxUpcoming7 = useMemo(() => {
    let m = 0;
    for (const d of calendar7) m = Math.max(m, d.count);
    return m;
  }, [calendar7]);

  const maxUpcoming30 = useMemo(() => {
    let m = 0;
    for (const d of calendar30) m = Math.max(m, d.count);
    return m;
  }, [calendar30]);

  const countsByDateKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of calendar30) map.set(d.dateKey, d.count);
    return map;
  }, [calendar30]);

  // Full current month grid (Mon-start), always 6 rows (42 cells) for stable height
  const monthGrid = useMemo(() => {
    const year = today0.getFullYear();
    const month = today0.getMonth();

    const monthStart = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Monday-start lead padding: Mon=0..Sun=6
    const lead = (monthStart.getDay() + 6) % 7;

    const cells = Array.from({ length: 42 }, (_, i) => {
      const dayNum = i - lead + 1; // 1..daysInMonth, others out-of-month
      const date = new Date(year, month, dayNum);
      const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
      const dateKey = formatDateKey(date);
      const count = countsByDateKey.get(dateKey) ?? 0;

      const isToday =
        date.getFullYear() === today0.getFullYear() &&
        date.getMonth() === today0.getMonth() &&
        date.getDate() === today0.getDate();

      return { date, dateKey, inMonth, count, isToday };
    });

    return { cells, lead, daysInMonth };
  }, [today0, countsByDateKey]);

  const filteredDecks = useMemo(() => {
    const sorted = [...deckSummaries].sort((a, b) => {
      const ta = a.deckType === 1 ? 0 : 1;
      const tb = b.deckType === 1 ? 0 : 1;
      return ta !== tb ? ta - tb : a.title.localeCompare(b.title);
    });

    if (deckFilter === 'free') return sorted.filter(d => d.deckType === 1);
    if (deckFilter === 'premium') return sorted.filter(d => d.deckType !== 1);
    return sorted;
  }, [deckSummaries, deckFilter]);

  function selectDeck(slug: string) {
    setActiveDeckSlug(slug);
    setSelectedSlug(slug);
  }

  function openMonth() {
    setIsMonthOpen(true);
  }
  function closeMonth() {
    setIsMonthOpen(false);
  }

  function toastForDay(date: Date, count: number) {
    const d = formatTooltipDate(date);
    const noun = count === 1 ? 'card' : 'cards';
    showToast(`${d} · ${count} ${noun}`);
  }

  const canStudy = activeSummary?.canStudy ?? false;

  if (loading || !activeSummary) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.loadingText}>Loading home…</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const monthTitle = formatMonthYear(today0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <View style={styles.screen}>
          {/* Month modal */}
          <Modal animationType="fade" transparent visible={isMonthOpen} onRequestClose={closeMonth}>
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={closeMonth} />

              <View style={styles.modalCard}>
                <View style={styles.modalHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{monthTitle}</Text>
                    <Text style={styles.modalSubtitle} numberOfLines={1} ellipsizeMode="tail">
                      {activeSummary.title}
                    </Text>
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.9 }]}
                    onPress={closeMonth}
                    accessibilityLabel="Close month calendar"
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </Pressable>
                </View>

                <View style={styles.weekdayRow}>
                  {WEEKDAYS_MON.map(w => (
                    <Text key={w} style={styles.weekdayText}>
                      {w}
                    </Text>
                  ))}
                </View>

                <View style={styles.monthGrid}>
                  {monthGrid.cells.map(cell => {
                    const intensity =
                      maxUpcoming30 <= 0 ? 0 : clamp01(cell.count / maxUpcoming30);

                    const dotOpacity = cell.count > 0 ? 0.25 + 0.75 * intensity : 0;
                    const countOpacity = cell.count > 0 ? 1 : 0;

                    // Make cells tappable (optional, but useful)
                    return (
                      <Pressable
                        key={cell.dateKey}
                        style={({ pressed }) => [
                          styles.dayCell,
                          cell.isToday && styles.dayCellToday,
                          pressed && styles.dayCellPressed,
                          !cell.inMonth && styles.dayCellOutMonth,
                        ]}
                        onPress={() => toastForDay(cell.date, cell.count)}
                        hitSlop={6}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            cell.isToday && styles.dayNumberToday,
                            !cell.inMonth && styles.dayNumberOutMonth,
                          ]}
                        >
                          {cell.date.getDate()}
                        </Text>

                        {/* iOS-like: 0 shows nothing (but we keep layout via opacity placeholders) */}
                        <View style={styles.dayMetaBox}>
                          <View style={[styles.dayDot, { opacity: dotOpacity }]} />
                          <Text style={[styles.dayCount, { opacity: countOpacity }]}>
                            {cell.count}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.modalLegend}>
                  Dot + count appear only when cards are scheduled (&gt; 0). Overdue cards are counted into “today”.
                </Text>
              </View>
            </View>
          </Modal>

          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.headingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.appTitle}>DevCards</Text>
                <Text style={styles.appSubtitle}>Make fundamentals feel automatic.</Text>
              </View>

              <Pressable
                style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
                onPress={() => navigation.navigate('Settings')}
              >
                <Text style={styles.iconButtonText}>⚙︎</Text>
              </Pressable>
            </View>

            {/* Calendar card (fixed height, no jumping) */}
            <View style={[styles.cardGlass, styles.calendarCardFixed]}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Calendar</Text>

                {/* Week / Month */}
                <View style={styles.segment}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.segmentItem,
                      !isMonthOpen && styles.segmentItemActive,
                      pressed && styles.segmentPressed,
                    ]}
                    onPress={() => {
                      // Week preview is always shown in-card.
                      if (isMonthOpen) closeMonth();
                    }}
                  >
                    <Text style={[styles.segmentText, !isMonthOpen && styles.segmentTextActive]}>
                      Week
                    </Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.segmentItem,
                      isMonthOpen && styles.segmentItemActive,
                      pressed && styles.segmentPressed,
                    ]}
                    onPress={openMonth}
                  >
                    <Text style={[styles.segmentText, isMonthOpen && styles.segmentTextActive]}>
                      Month
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Deck row: single line ellipsis so height stays stable */}
              <View style={styles.calendarDeckRow}>
                <Text style={styles.calendarDeckLabel}>Deck</Text>
                <Text style={styles.calendarDeckValue} numberOfLines={1} ellipsizeMode="tail">
                  {activeSummary.title}
                </Text>
              </View>

              {/* Week preview: date on top, label at bottom, tap-to-toast */}
              <View style={styles.calendarGrid7}>
                {calendar7.map((day, idx) => {
                  const date = new Date(today0.getTime());
                  date.setDate(date.getDate() + idx);

                  const topDate = formatTooltipDate(date); // e.g. "Aug 12"
                  const bottomLabel = idx === 0 ? 'Today' : weekdayShort(date);

                  const ratio = maxUpcoming7 <= 0 ? 0 : day.count / maxUpcoming7;
                  const fill = day.count === 0 ? 0 : Math.max(0.1, clamp01(ratio));
                  const rest = 1 - fill;

                  return (
                    <Pressable
                      key={day.dateKey}
                      style={({ pressed }) => [styles.calCell7, pressed && styles.calCell7Pressed]}
                      onPress={() => toastForDay(date, day.count)}
                      hitSlop={8}
                    >
                      <Text style={styles.calDate7} numberOfLines={1}>
                        {topDate}
                      </Text>

                      <View style={styles.calBarBg7}>
                        {/* spacer first => fill grows from bottom */}
                        <View style={{ flex: rest }} />
                        <View
                          style={[
                            styles.calBarFill7,
                            {
                              flex: fill,
                              opacity: day.count === 0 ? 0.18 : 1,
                            },
                          ]}
                        />
                      </View>

                      <Text style={styles.calLabel7} numberOfLines={1}>
                        {bottomLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.hintText}>
                Tip: Select a deck below to switch what this calendar represents.
              </Text>
            </View>

            {/* Selected deck overview */}
            <View style={styles.cardGlass}>
              <View style={styles.deckHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deckTitle} numberOfLines={1}>
                    {activeSummary.title}
                  </Text>
                  <Text style={styles.deckMeta} numberOfLines={1}>
                    {activeSummary.locale} · {activeSummary.totalCards} cards · v{activeSummary.version}
                  </Text>
                </View>

                <View style={[styles.badge, activeSummary.deckType !== 1 && styles.badgePremium]}>
                  <Text style={[styles.badgeText, activeSummary.deckType !== 1 && styles.badgeTextPremium]}>
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
                      <Text style={styles.statNumber}>{activeSummary.masteredApprox}</Text>
                      <Text style={styles.statLabel}>mastered</Text>
                    </View>
                  </View>

                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { flex: activeSummary.percent, opacity: activeSummary.percent === 0 ? 0 : 1 },
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
                <Text style={styles.primaryButtonText}>{canStudy ? 'Start review' : 'Coming soon'}</Text>
              </Pressable>
            </View>

            {/* Deck list (ONE card) with ALL / Free / Premium filter */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Decks</Text>
                <Text style={styles.sectionMeta}>{deckSummaries.length}</Text>
              </View>

              <View style={styles.segmentThree}>
                {(['all', 'free', 'premium'] as const).map(key => {
                  const active = deckFilter === key;
                  const label = key === 'all' ? 'ALL' : key === 'free' ? 'Free' : 'Premium';

                  return (
                    <Pressable
                      key={key}
                      style={({ pressed }) => [
                        styles.segmentThreeItem,
                        active && styles.segmentThreeItemActive,
                        pressed && styles.segmentPressed,
                      ]}
                      onPress={() => setDeckFilter(key)}
                    >
                      <Text style={[styles.segmentThreeText, active && styles.segmentThreeTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.sectionHint}>
                Tap a deck to switch what you study (calendar + start button).
              </Text>

              {filteredDecks.map(d => {
                const active = d.slug === selectedSlug;
                const isPremium = d.deckType !== 1;

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
                      <Text style={[styles.deckRowTitle, active && styles.deckRowTitleActive]} numberOfLines={1}>
                        {d.title}
                      </Text>
                      <Text style={styles.deckRowSub} numberOfLines={1}>
                        {isPremium ? 'Premium' : 'Free'} · {d.totalCards} cards
                      </Text>
                    </View>

                    {d.canStudy ? (
                      <View style={styles.deckRowRight}>
                        <Text style={styles.duePill}>{d.dueToday} due</Text>
                        <View style={styles.rowBarBg}>
                          <View style={[styles.rowBarFill, { flex: d.percent, opacity: d.percent === 0 ? 0 : 1 }]} />
                          <View style={{ flex: 1 - d.percent }} />
                        </View>
                      </View>
                    ) : (
                      <Text style={styles.lockedPill}>Locked</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Toast overlay (week taps, month taps) */}
          {toastVisible && (
            <View pointerEvents="none" style={styles.toastWrap}>
              <Animated.View
                style={[
                  styles.toastCard,
                  {
                    opacity: toastAnim,
                    transform: [
                      {
                        translateY: toastAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [8, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={styles.toastText}>{toastText}</Text>
              </Animated.View>
            </View>
          )}
        </View>
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
  screen: { flex: 1 },
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

  // Calendar fixed sizing to prevent “jumping” when deck names vary
  calendarCardFixed: { minHeight: 220 },

  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },

  segment: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
  },
  segmentItem: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  segmentItemActive: { backgroundColor: 'rgba(79,70,229,0.14)' },
  segmentPressed: { opacity: 0.92 },
  segmentText: { fontSize: 12, fontWeight: '700', color: '#111827' },
  segmentTextActive: { color: '#4F46E5' },

  calendarDeckRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  calendarDeckLabel: { fontSize: 12, color: '#6B7280', marginRight: 10 },
  calendarDeckValue: { flex: 1, fontSize: 12, fontWeight: '800', color: '#111827' },

  // Week preview grid
  calendarGrid7: { flexDirection: 'row', marginTop: 12 },
  calCell7: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  calCell7Pressed: { opacity: 0.9 },
  calDate7: { fontSize: 10, fontWeight: '800', color: '#111827' },
  calLabel7: { marginTop: 6, fontSize: 10, color: '#6B7280', fontWeight: '700' },
  calBarBg7: {
    marginTop: 8,
    height: 30,
    width: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.08)',
    overflow: 'hidden',
    flexDirection: 'column',
  },
  calBarFill7: { width: 10, borderRadius: 999, backgroundColor: '#4F46E5' },

  hintText: { marginTop: 10, fontSize: 11, color: '#6B7280' },

  // Selected deck overview
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
  badgePremium: { backgroundColor: 'rgba(17,24,39,0.06)', borderColor: 'rgba(17,24,39,0.10)' },
  badgeText: { fontSize: 12, fontWeight: '800', color: '#4F46E5' },
  badgeTextPremium: { color: '#111827' },

  placeholderText: { marginTop: 10, fontSize: 12, color: '#6B7280' },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
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

  // Deck list card
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
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  sectionMeta: { fontSize: 12, color: '#6B7280' },
  sectionHint: { marginTop: 8, fontSize: 12, color: '#6B7280' },

  segmentThree: {
    marginTop: 10,
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
    backgroundColor: 'rgba(17,24,39,0.05)',
  },
  segmentThreeItem: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
  segmentThreeItemActive: { backgroundColor: 'rgba(79,70,229,0.14)' },
  segmentThreeText: { fontSize: 12, fontWeight: '800', color: '#111827' },
  segmentThreeTextActive: { color: '#4F46E5' },

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
  lockedPill: {
    marginLeft: 10,
    fontSize: 11,
    fontWeight: '900',
    color: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
  },

  // Month modal (opaque background)
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(17,24,39,0.25)',
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF', // opaque (requested)
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#111827' },
  modalSubtitle: { marginTop: 4, fontSize: 12, color: '#6B7280', fontWeight: '700' },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  modalCloseText: { fontSize: 16, fontWeight: '900', color: '#111827' },

  weekdayRow: { flexDirection: 'row', marginTop: 2, marginBottom: 8 },
  weekdayText: {
    width: '14.2857%',
    textAlign: 'center',
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '700',
  },

  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.2857%',
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 6,
  },
  dayCellPressed: { opacity: 0.92 },
  dayCellToday: { backgroundColor: 'rgba(79,70,229,0.10)' },
  dayCellOutMonth: { opacity: 0.65 },

  dayNumber: { fontSize: 12, fontWeight: '900', color: '#111827' },
  dayNumberToday: { color: '#4F46E5' },
  dayNumberOutMonth: { color: '#6B7280' },

  // Fixed meta box so row height stays identical even if count is 0
  dayMetaBox: { marginTop: 6, alignItems: 'center', height: 26, justifyContent: 'center' },
  dayDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  dayCount: { marginTop: 4, fontSize: 11, fontWeight: '800', color: '#111827' },

  modalLegend: { marginTop: 8, fontSize: 11, color: '#6B7280' },

  // Toast
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    alignItems: 'center',
  },
  toastCard: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.88)',
  },
  toastText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});