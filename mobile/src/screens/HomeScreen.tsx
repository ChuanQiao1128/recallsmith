// mobile/src/screens/HomeScreen.tsx
// Plan A Home:
// - Top: Calendar = aggregated (all decks) week preview + month modal (full month)
// - Bottom: ONE deck list card with ALL / Free / Premium filter
// - Tap a deck => setActiveDeckSlug(slug) and navigate to Deck (deck-specific modes live there)
//
// ✅ Step 2/3: Home 聚合时顺便做 manifest update check + install（先打通链路）
// ✅ Step 4: Home 统计/展示使用 resolveDeckBySlug（优先本地下载版）
//
// Style: keep light gradient + glass card.

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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';

import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';

import type { CardProgress } from '../review/model';
import { formatDateKey } from '../review/model';

import { loadDeckProgress } from '../review/storage';

import { syncDailyReminders } from '../notifications/reminders';

// ✅ Step 2/3/4 entry points
import {
  checkManifestForUpdates,
  resolveDeckBySlug,
  listManifestDecks,
  installDeckFromUrl,
  type ManifestDeckEntry,
  type UpdateInfo,
} from '../content/deckRepository';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type DeckFilter = 'all' | 'free' | 'premium';

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
};

type HomeState = {
  loading: boolean;
  asOfISO: string;

  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;

  // Aggregated schedule buckets for next 30 days (today..today+29) across all decks
  allUpcoming30: CalendarDay[];

  // Aggregated counts for the current month: YYYY-MM-DD -> count
  monthCounts: Record<string, number>;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function startOfToday(now: Date) {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekdayShort(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function formatMonthDay(d: Date) {
  // "Aug 12"
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isLearned(p: CardProgress): boolean {
  return typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0;
}

function isScheduled(p: CardProgress): boolean {
  return isLearned(p) && typeof p.nextReviewAt === 'number' && p.nextReviewAt > 0;
}

/**
 * Build upcoming schedule buckets (today -> today+(days-1)).
 * UX rule: overdue (nextReviewAt < today) counts into “today” so backlog is visible.
 * IMPORTANT: only learned cards are included.
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
    if (!isScheduled(p)) continue;

    const next = new Date(p.nextReviewAt);
    const effective = next.getTime() < today0.getTime() ? today0 : next;
    const key = formatDateKey(effective);
    const idx = index.get(key);
    if (idx !== undefined) out[idx].count += 1;
  }

  return out;
}

const WEEKDAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function HomeScreen({ navigation }: Props) {
  // Keep a “last active deck” (used when user taps into Deck screen)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const [deckFilter, setDeckFilter] = useState<DeckFilter>('all');

  // Month modal
  const [isMonthOpen, setIsMonthOpen] = useState(false);

  // Lightweight “toast” for week-tap
  const [weekHint, setWeekHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initSelected() {
      const stored = await loadActiveDeckSlug();
      if (cancelled) return;
      if (stored) setSelectedSlug(stored);
    }
    void initSelected();
    return () => {
      cancelled = true;
    };
  }, []);

  function showWeekHint(msg: string) {
    setWeekHint(msg);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setWeekHint(null), 1400);
  }

  const [state, setState] = useState<HomeState>({
    loading: true,
    asOfISO: new Date().toISOString(),
    deckSummaries: [],
    updates: {},
    allUpcoming30: buildUpcoming([], new Date(), 30),
    monthCounts: {},
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        setState(prev => ({ ...prev, loading: true }));

        const now = new Date();
        const today0 = startOfToday(now);

        // ✅ Step 2/3: 检查 manifest；启动时自动安装缺失或有更新的 deck
        let updates: Record<string, UpdateInfo> = {};
        let manifestDecks: ManifestDeckEntry[] = [];
        try {
          updates = await checkManifestForUpdates();
          manifestDecks = await listManifestDecks();

          // 自动安装（缺失 or 有更新）
          let installedAny = false;
          for (const entry of manifestDecks) {
            if (cancelled) return;
            const info = updates[entry.slug];
            if (info?.remoteUrl && info.hasUpdate) {
              try {
                const ok = await installDeckFromUrl(
                  entry.slug,
                  info.remoteUrl,
                  info.remoteVersion,
                  info.remoteSha256,
                );
                if (ok) installedAny = true;
              } catch {
                // 单个失败忽略，继续后续 deck
              }
            }
          }

          // 安装后再刷新一次更新状态（避免已安装仍提示更新）
          if (installedAny) {
            try {
              updates = await checkManifestForUpdates();
            } catch {
              // ignore
            }
          }
        } catch {
          updates = {};
          manifestDecks = [];
        }

        // Month range (current month)
        const year = now.getFullYear();
        const month = now.getMonth();
        const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const monthCounts: Record<string, number> = {};
        for (let day = 1; day <= daysInMonth; day++) {
          const d = new Date(year, month, day, 0, 0, 0, 0);
          monthCounts[formatDateKey(d)] = 0;
        }

        const allUpcoming30 = buildUpcoming([], now, 30);
        const deckSummaries: DeckSummary[] = [];

        let totalDueAllDecks = 0;

        for (const entry of manifestDecks) {
          if (cancelled) return;

          // ✅ 优先使用本地下载版 deck-content:${slug}，没有就标记为未安装
          const deck = await resolveDeckBySlug(entry.slug);
          if (cancelled) return;

          const totalCards = deck?.TotalCards ?? deck?.Cards?.length ?? entry.totalCards ?? 0;
          const canStudy = !!deck && (deck.Cards?.length ?? 0) > 0;

          if (!canStudy) {
            // 未安装或占位 deck：不可学习，但在列表里展示
            deckSummaries.push({
              slug: deck?.Slug ?? entry.slug,
              title: deck?.Title ?? entry.title ?? entry.slug,
              locale: deck?.Locale ?? entry.locale ?? 'en-US',
              version: deck?.Version ?? entry.version,
              deckType: deck?.DeckType ?? entry.deckType ?? 1,
              totalCards,
              canStudy,
              dueToday: 0,
              plannedToday: 0,
              newToday: 0,
              masteredApprox: 0,
              percent: 0,
            });
            continue;
          }

          const progress = await loadDeckProgress(deck);
          if (cancelled) return;

          const learnedCount = progress.filter(isLearned).length;
          const newRemaining = Math.max(totalCards - learnedCount, 0);

          const upcoming30 = buildUpcoming(progress, now, 30);
          const dueToday = upcoming30[0]?.count ?? 0;

          totalDueAllDecks += dueToday;

          // For Home list: keep fields but make them consistent with new semantics.
          const percent = totalCards > 0 ? clamp01(learnedCount / totalCards) : 0;

          deckSummaries.push({
            slug: deck.Slug,
            title: deck.Title,
            locale: deck.Locale,
            version: deck.Version, // ✅ 显示已安装版本（来自下载版或 mock）
            deckType: deck.DeckType,
            totalCards,
            canStudy,
            dueToday,
            plannedToday: dueToday, // "planned today" = reviews due today
            newToday: newRemaining, // "new cards" remaining
            masteredApprox: learnedCount, // learned count
            percent,
          });

          // Aggregate next-30 schedule
          for (let i = 0; i < allUpcoming30.length; i++) {
            allUpcoming30[i].count += upcoming30[i]?.count ?? 0;
          }

          // Aggregate CURRENT MONTH counts (overdue -> today)
          for (const p of progress) {
            if (!isScheduled(p)) continue;

            const next = new Date(p.nextReviewAt);
            const effective = next.getTime() < today0.getTime() ? today0 : next;

            if (effective.getTime() < monthStart.getTime() || effective.getTime() > monthEnd.getTime()) {
              continue;
            }

            const key = formatDateKey(effective);
            if (key in monthCounts) monthCounts[key] += 1;
          }
        }

        // Reminder logic uses total due across all decks (today bucket)
        void syncDailyReminders({ remainingDueCount: totalDueAllDecks, now });

        if (cancelled) return;
        setState({
          loading: false,
          asOfISO: now.toISOString(),
          deckSummaries,
          updates,
          allUpcoming30,
          monthCounts,
        });
      }

      void load();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const { loading, asOfISO, deckSummaries, updates, allUpcoming30, monthCounts } = state;
  const asOf = useMemo(() => new Date(asOfISO), [asOfISO]);

  useEffect(() => {
    if (!selectedSlug && deckSummaries.length > 0) {
      setSelectedSlug(deckSummaries[0].slug);
    }
  }, [selectedSlug, deckSummaries]);

  const week7 = useMemo(() => allUpcoming30.slice(0, 7), [allUpcoming30]);

  const maxWeek = useMemo(() => {
    let m = 0;
    for (const d of week7) m = Math.max(m, d.count);
    return m;
  }, [week7]);

  const maxMonth = useMemo(() => {
    let m = 0;
    for (const k of Object.keys(monthCounts)) m = Math.max(m, monthCounts[k] ?? 0);
    return m;
  }, [monthCounts]);

  const filteredDecks = useMemo(() => {
    const sorted = [...deckSummaries].sort((a, b) => {
      // Free first, then Premium; then title
      const ta = a.deckType === 1 ? 0 : 1;
      const tb = b.deckType === 1 ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return a.title.localeCompare(b.title);
    });

    if (deckFilter === 'free') return sorted.filter(d => d.deckType === 1);
    if (deckFilter === 'premium') return sorted.filter(d => d.deckType !== 1);
    return sorted;
  }, [deckSummaries, deckFilter]);

  function openMonth() {
    setIsMonthOpen(true);
  }
  function closeMonth() {
    setIsMonthOpen(false);
  }

  function openDeck(slug: string) {
    void setActiveDeckSlug(slug);
    setSelectedSlug(slug);
    navigation.navigate('Deck', { slug });
  }

  // Build month grid (full current month)
  const monthGrid = useMemo(() => {
    const y = asOf.getFullYear();
    const m = asOf.getMonth();
    const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    // Monday start
    const lead = (monthStart.getDay() + 6) % 7;
    const rows = Math.ceil((lead + daysInMonth) / 7);
    const totalCells = rows * 7;

    const todayKey = formatDateKey(startOfToday(asOf));

    const cells: Array<null | { date: Date; dateKey: string; count: number; isToday: boolean }> =
      Array(totalCells).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(y, m, day, 0, 0, 0, 0);
      const key = formatDateKey(date);
      const idx = lead + (day - 1);
      cells[idx] = {
        date,
        dateKey: key,
        count: monthCounts[key] ?? 0,
        isToday: key === todayKey,
      };
    }

    return {
      monthLabel: asOf.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      cells,
    };
  }, [asOf, monthCounts]);

  if (loading) {
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

  const totalDueAllDecks = deckSummaries.reduce((sum, d) => sum + (d.canStudy ? d.dueToday : 0), 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {/* Month modal */}
        <Modal animationType="fade" transparent visible={isMonthOpen} onRequestClose={closeMonth}>
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={closeMonth} />

            <View style={styles.modalCardOpaque}>
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{monthGrid.monthLabel}</Text>
                  <Text style={styles.modalSubtitle}>{totalDueAllDecks} due today across all decks</Text>
                </View>

                <Pressable
                  style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.pressed]}
                  onPress={closeMonth}
                  accessibilityLabel="Close month view"
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
                {monthGrid.cells.map((cell, idx) => {
                  if (!cell) return <View key={`empty-${idx}`} style={styles.monthCell} />;

                  const intensity = maxMonth <= 0 ? 1 : 0.55 + 0.45 * clamp01(cell.count / maxMonth);
                  const hidden = cell.count === 0;

                  return (
                    <View
                      key={cell.dateKey}
                      style={[styles.monthCell, cell.isToday && styles.monthCellToday]}
                    >
                      <Text
                        style={[
                          styles.monthDayNumber,
                          cell.isToday && styles.monthDayNumberToday,
                        ]}
                      >
                        {cell.date.getDate()}
                      </Text>

                      {/* Meta keeps height consistent; 0 is visually hidden */}
                      <View style={styles.monthMeta}>
                        <View style={[styles.monthDot, { opacity: hidden ? 0 : intensity }]} />
                        <Text style={[styles.monthCount, { opacity: hidden ? 0 : 1 }]} numberOfLines={1}>
                          {cell.count}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              <Text style={styles.modalLegend}>
                Only days with &gt;0 show dots/counts (0 is hidden, layout stays aligned).
              </Text>
            </View>
          </View>
        </Modal>

        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.headingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.appTitle}>DevCards</Text>
              <Text style={styles.appSubtitle}>A clean way to stay consistent.</Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.iconButtonText}>⚙︎</Text>
            </Pressable>
          </View>

          {/* Calendar card (fixed height) */}
          <View style={[styles.cardGlass, styles.calendarCardFixed]}>
            <View style={styles.cardHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Calendar</Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  All decks · {totalDueAllDecks} due today
                </Text>
              </View>

              {/* Week / Month toggle (Month opens modal) */}
              <View style={styles.segment}>
                <Pressable
                  style={({ pressed }) => [
                    styles.segmentItem,
                    styles.segmentItemActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => {
                    // Week is in-card preview (no-op)
                  }}
                >
                  <Text style={[styles.segmentText, styles.segmentTextActive]}>Week</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.segmentItem, pressed && styles.pressed]}
                  onPress={openMonth}
                >
                  <Text style={styles.segmentText}>Month</Text>
                </Pressable>
              </View>
            </View>

            {/* Week 7-day bars */}
            <View style={styles.weekGrid}>
              {week7.map((day, idx) => {
                const date = new Date(asOf.getTime());
                date.setDate(date.getDate() + idx);

                const dateText = formatMonthDay(date);
                const label = idx === 0 ? 'Today' : weekdayShort(date);

                const count = day.count;

                const pct =
                  maxWeek <= 0 ? 0 : count === 0 ? 0 : Math.max(0.12, count / maxWeek);

                return (
                  <Pressable
                    key={day.dateKey}
                    style={({ pressed }) => [styles.weekCell, pressed && styles.pressed]}
                    onPress={() => showWeekHint(`${dateText} · ${count} card${count === 1 ? '' : 's'}`)}
                    accessibilityLabel={`${dateText}, ${count} cards`}
                  >
                    <Text style={styles.weekDate} numberOfLines={1}>
                      {dateText}
                    </Text>

                    <View style={styles.weekBarBg}>
                      <View style={{ flex: 1 - pct }} />
                      <View
                        style={[
                          styles.weekBarFill,
                          { flex: pct, opacity: count === 0 ? 0 : 1 },
                        ]}
                      />
                    </View>

                    <Text style={styles.weekLabel} numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Week tap hint slot */}
            <View style={styles.weekHintSlot}>
              <Text style={styles.weekHintText} numberOfLines={1} ellipsizeMode="tail">
                {weekHint ?? 'Tap a day bar to see the exact count.'}
              </Text>
            </View>
          </View>

          {/* Deck list card */}
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
                      pressed && styles.pressed,
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
              Tap a deck to open it (modes + deck‑specific plan live inside).
            </Text>

            {deckSummaries.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No decks installed yet</Text>
                <Text style={styles.emptySubtitle}>
                  We will try to download decks automatically. You can also tap “Check & update decks” in Settings.
                </Text>
              </View>
            ) : (
              filteredDecks.map(d => {
                const active = d.slug === selectedSlug;
                const isPremium = d.deckType !== 1;
                const deckUpdate = updates?.[d.slug];
                const hasUpdate = !!(deckUpdate?.hasUpdate && deckUpdate.remoteUrl);

                return (
                  <Pressable
                    key={d.slug}
                    style={({ pressed }) => [
                      styles.deckRow,
                      active && styles.deckRowActive,
                      pressed && styles.deckRowPressed,
                    ]}
                    onPress={() => {
                      if (!d.canStudy) return;
                      openDeck(d.slug);
                    }}
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
                        {hasUpdate ? <Text style={styles.updatePill}>Update available</Text> : null}
                        <Text style={styles.duePill}>{d.masteredApprox} finished</Text>
                        <View style={styles.rowBarBg}>
                          <View
                            style={[
                              styles.rowBarFill,
                              { flex: d.percent, opacity: d.percent === 0 ? 0 : 1 },
                            ]}
                          />
                          <View style={{ flex: 1 - d.percent }} />
                        </View>
                      </View>
                    ) : (
                      <View style={styles.deckRowRight}>
                        {hasUpdate ? <Text style={styles.updatePill}>Update available</Text> : null}
                        <Text style={styles.lockedPill}>Not installed</Text>
                      </View>
                    )}
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

  pressed: { opacity: 0.9 },

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

  // Calendar fixed sizing: no layout jump
  calendarCardFixed: { minHeight: 220 },

  cardHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  cardSubtitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },

  segment: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
    marginLeft: 12,
  },
  segmentItem: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  segmentItemActive: { backgroundColor: 'rgba(79,70,229,0.14)' },
  segmentText: { fontSize: 12, fontWeight: '700', color: '#111827' },
  segmentTextActive: { color: '#4F46E5' },

  // Week view
  weekGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  weekCell: { flex: 1, alignItems: 'center' },
  weekDate: { fontSize: 10, color: '#6B7280' },
  weekLabel: { marginTop: 6, fontSize: 10, color: '#6B7280' },

  weekBarBg: {
    marginTop: 8,
    height: 38,
    width: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.08)',
    overflow: 'hidden',
  },
  weekBarFill: {
    width: 12,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },

  weekHintSlot: {
    marginTop: 12,
    height: 18, // fixed height => no jump
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekHintText: { fontSize: 11, color: '#6B7280' },

  // Deck list (one card)
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
  segmentThreeItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
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
  updatePill: {
    marginBottom: 6,
    fontSize: 11,
    fontWeight: '900',
    color: '#92400E',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(234,179,8,0.18)',
  },
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
  emptyBox: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.04)',
    padding: 12,
  },
  emptyTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  emptySubtitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },

  // Modal styles (opaque month background)
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(17,24,39,0.25)',
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },

  modalCardOpaque: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF', // opaque
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
  monthCell: {
    width: '14.2857%',
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 6,
  },
  monthCellToday: { backgroundColor: 'rgba(79,70,229,0.10)' },
  monthDayNumber: { fontSize: 12, fontWeight: '900', color: '#111827' },
  monthDayNumberToday: { color: '#4F46E5' },

  // Keep consistent cell height while hiding 0s
  monthMeta: { marginTop: 6, height: 24, alignItems: 'center', justifyContent: 'center' },
  monthDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  monthCount: { marginTop: 4, fontSize: 11, fontWeight: '800', color: '#111827' },

  modalLegend: { marginTop: 8, fontSize: 11, color: '#6B7280' },
});
