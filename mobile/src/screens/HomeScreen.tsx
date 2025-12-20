// mobile/src/screens/HomeScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';

import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';

import type { CardProgress } from '../review/model';
import { formatDateKey } from '../review/model';

import { loadDeckProgress } from '../review/storage';
import { syncDailyReminders } from '../notifications/reminders';

// ✅ progress sync
import { forceProgressSync, applyCachedRemoteProgress } from '../sync/progressSync';

import {
  checkManifestForUpdates,
  resolveDeckBySlug,
  listManifestDecks,
  installDeckFromUrl,
  type ManifestDeckEntry,
  type UpdateInfo,
} from '../content/deckRepository';

// ✅ premium entitlement
import { usePremiumUser } from '../premium/premiumStore';

// ✅ auth state (for Month view gate)
import { useAuthStore } from '../auth/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type DeckFilter = 'all' | 'free' | 'premium';
type CalendarDay = { dateKey: string; count: number };

type DeckSummary = {
  slug: string;
  title: string;
  locale: string;
  version: string;
  deckType: number; // 1 = free, else premium

  // ✅ Display total (full deck total from manifest)
  totalCards: number;

  // ✅ Installed total (preview may be 15)
  localCards: number;

  // ✅ For study stats (use local cards if installed)
  studyCards: number;

  canStudy: boolean;

  // ✅ from manifest v2
  tier?: string | null;
  availability?: string | null;
  eta?: string | null;
  downloadMode?: string | null;
  order?: number;

  dueToday: number;
  plannedToday: number;
  newToday: number;
  masteredApprox: number;

  // percent is relative to studyCards (preview=15), NOT full totalCards (30)
  percent: number; // 0..1
};

type HomeState = {
  loading: boolean;
  asOfISO: string;

  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;

  allUpcoming30: CalendarDay[];
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isLearned(p: CardProgress): boolean {
  return typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0;
}

function isScheduled(p: CardProgress): boolean {
  return isLearned(p) && typeof p.nextReviewAt === 'number' && p.nextReviewAt > 0;
}

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

/** =========================
 *  ✅ Premium download helper (Home)
 *  ========================= */

// API base (adjust if you already use another env var name)
const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim() ||
  (process.env.EXPO_PUBLIC_API_BASE || '').trim() ||
  'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com';

// GET /api/v1/content/premium-url?slug=react-basics&dev=1
async function fetchPremiumDeckUrl(slug: string): Promise<{ url: string; buildId: string } | null> {
  const s = String(slug || '').trim();
  if (!s) return null;

  const u = new URL('/api/v1/content/premium-url', API_BASE_URL);
  u.searchParams.set('slug', s);

  // ✅ DEV-only bypass (because you don't have login yet)
  if (__DEV__) u.searchParams.set('dev', '1');

  const resp = await fetch(u.toString(), {
    method: 'GET',
    headers: {
      'cache-control': 'no-cache',
    },
  });

  const json = await resp.json().catch(() => null);

  // Your API wrapper returns: { success, data, error, traceId, version }
  const ok = !!json?.success && !!json?.data?.url && !!json?.data?.buildId;
  if (!ok) {
    const msg = json?.error?.message || `Failed to get premium url (HTTP ${resp.status})`;
    throw new Error(msg);
  }

  return { url: String(json.data.url), buildId: String(json.data.buildId) };
}

export function HomeScreen({ navigation }: Props) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deckFilter, setDeckFilter] = useState<DeckFilter>('all');

  const [isMonthOpen, setIsMonthOpen] = useState(false);

  const [weekHint, setWeekHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMounted = useRef(true);

  // ✅ premium entitlement
  const isPremiumUser = usePremiumUser();

  // ✅ auth state (Month requires sign-in)
  const authStatus = useAuthStore((s) => s.status);
  const authInit = useAuthStore((s) => s.init);
  const isSignedIn = authStatus === 'signed_in';

  const [isMonthGateOpen, setIsMonthGateOpen] = useState(false);
  const pendingOpenMonthRef = useRef(false);
const didInitAuthRef = useRef(false);

useEffect(() => {
  if (didInitAuthRef.current) return;
  if (authStatus === 'unknown') {
    didInitAuthRef.current = true;
    void authInit();
  }
}, [authStatus, authInit]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    async function initSelected() {
      const stored = await loadActiveDeckSlug();
      if (cancel) return;
      if (stored) setSelectedSlug(stored);
    }
    void initSelected();
    return () => {
      cancel = true;
    };
  }, []);

  // ✅ after sign-in, if user came from Month gate, auto open Month
  useEffect(() => {
    if (isSignedIn && pendingOpenMonthRef.current) {
      pendingOpenMonthRef.current = false;
      setIsMonthOpen(true);
    }
  }, [isSignedIn]);

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

  const computeHomeState = useCallback(async (): Promise<HomeState> => {
    const now = new Date();
    const today0 = startOfToday(now);

    let updates: Record<string, UpdateInfo> = {};
    let manifestDecks: ManifestDeckEntry[] = [];

    try {
      updates = await checkManifestForUpdates(isPremiumUser);
      manifestDecks = await listManifestDecks();

      const hasAnyInstalledDeck = Object.values(updates).some(
        (u) => typeof u.installedVersion === 'string' && u.installedVersion.trim().length > 0,
      );

      // ✅ first launch auto-install only FREE + PUBLIC decks
      if (!hasAnyInstalledDeck && manifestDecks.length > 0) {
        const installedSlugs: string[] = [];

        for (const entry of manifestDecks) {
          if ((entry.deckType ?? 1) !== 1) continue;

          const info = updates[entry.slug];
          if (!info?.remoteUrl || !info.hasUpdate) continue;

          try {
            const ok = await installDeckFromUrl(
              entry.slug,
              info.remoteUrl,
              info.remoteVersion,
              info.remoteSha256,
            );
            if (ok) installedSlugs.push(entry.slug);
          } catch {
            // ignore
          }
        }

        if (installedSlugs.length > 0) {
          try {
            const stored = await loadActiveDeckSlug();
            if (!stored) await setActiveDeckSlug(installedSlugs[0]);
          } catch {}

          for (const slug of installedSlugs) {
            try {
              await applyCachedRemoteProgress(slug);
            } catch {}
          }

          try {
            updates = await checkManifestForUpdates(isPremiumUser);
          } catch {}
        }
      }
    } catch {
      updates = {};
      manifestDecks = [];
    }

    // Month buckets
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
      const availability = (entry.availability ?? '').toLowerCase();
      const isComing = availability === 'coming';

      if (isComing) {
        deckSummaries.push({
          slug: entry.slug,
          title: entry.title ?? entry.slug,
          locale: entry.locale ?? 'en-US',
          version: entry.version,
          deckType: entry.deckType ?? 1,

          totalCards: entry.totalCards ?? 0,
          localCards: 0,
          studyCards: 0,

          canStudy: false,

          tier: entry.tier ?? null,
          availability: entry.availability ?? null,
          eta: entry.eta ?? null,
          downloadMode: entry.downloadMode ?? null,
          order: (entry as any).order,

          dueToday: 0,
          plannedToday: 0,
          newToday: 0,
          masteredApprox: 0,
          percent: 0,
        });
        continue;
      }

      const deck = await resolveDeckBySlug(entry.slug);

      const localCards = deck?.Cards?.length ?? deck?.TotalCards ?? 0;

      // Display total should reflect full deck total from manifest
      const displayTotalCards =
        typeof entry.totalCards === 'number' && Number.isFinite(entry.totalCards)
          ? entry.totalCards
          : localCards;

      const canStudy = !!deck && localCards > 0;

      if (!canStudy) {
        deckSummaries.push({
          slug: deck?.Slug ?? entry.slug,
          title: deck?.Title ?? entry.title ?? entry.slug,
          locale: deck?.Locale ?? entry.locale ?? 'en-US',
          version: deck?.Version ?? entry.version,
          deckType: deck?.DeckType ?? entry.deckType ?? 1,

          totalCards: displayTotalCards,
          localCards,
          studyCards: localCards,

          canStudy,

          tier: entry.tier ?? null,
          availability: entry.availability ?? null,
          eta: entry.eta ?? null,
          downloadMode: entry.downloadMode ?? null,
          order: (entry as any).order,

          dueToday: 0,
          plannedToday: 0,
          newToday: 0,
          masteredApprox: 0,
          percent: 0,
        });
        continue;
      }

      try {
        await applyCachedRemoteProgress(deck.Slug);
      } catch {}

      const progress = await loadDeckProgress(deck);
      const learnedCount = progress.filter(isLearned).length;

      // Study stats should use localCards (preview=15)
      const studyCards = Math.max(localCards, 0);
      const denom = Math.max(studyCards, 1);

      const newRemaining = Math.max(denom - learnedCount, 0);

      const upcoming30 = buildUpcoming(progress, now, 30);
      const dueToday = upcoming30[0]?.count ?? 0;

      totalDueAllDecks += dueToday;

      const percent = denom > 0 ? clamp01(learnedCount / denom) : 0;

      deckSummaries.push({
        slug: deck.Slug,
        title: deck.Title,
        locale: deck.Locale,
        version: deck.Version,
        deckType: deck.DeckType,

        totalCards: displayTotalCards,
        localCards,
        studyCards,

        canStudy,

        tier: entry.tier ?? null,
        availability: entry.availability ?? null,
        eta: entry.eta ?? null,
        downloadMode: entry.downloadMode ?? null,
        order: (entry as any).order,

        dueToday,
        plannedToday: dueToday,
        newToday: newRemaining,
        masteredApprox: learnedCount,
        percent,
      });

      for (let i = 0; i < allUpcoming30.length; i++) {
        allUpcoming30[i].count += upcoming30[i]?.count ?? 0;
      }

      for (const p of progress) {
        if (!isScheduled(p)) continue;

        const next = new Date(p.nextReviewAt);
        const effective = next.getTime() < today0.getTime() ? today0 : next;

        if (effective.getTime() < monthStart.getTime() || effective.getTime() > monthEnd.getTime()) continue;

        const key = formatDateKey(effective);
        if (key in monthCounts) monthCounts[key] += 1;
      }
    }

    void syncDailyReminders({ remainingDueCount: totalDueAllDecks, now });

    return {
      loading: false,
      asOfISO: now.toISOString(),
      deckSummaries,
      updates,
      allUpcoming30,
      monthCounts,
    };
  }, [isPremiumUser]);

  const loadHomeFromLocal = useCallback(async () => {
    const next = await computeHomeState();
    if (isMounted.current) setState(next);
  }, [computeHomeState]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function run() {
        await loadHomeFromLocal();
        if (cancelled) return;

        // forceProgressSync('home_focus').catch(() => {});
      }

      void run();
      return () => {
        cancelled = true;
      };
    }, [loadHomeFromLocal]),
  );

  // ✅ Refresh Home immediately after sign-in or premium status changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (authStatus === 'unknown') return;
      await loadHomeFromLocal();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, isSignedIn, isPremiumUser, loadHomeFromLocal]);

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
    const base =
      deckFilter === 'free'
        ? deckSummaries.filter((d) => d.deckType === 1)
        : deckFilter === 'premium'
          ? deckSummaries.filter((d) => d.deckType !== 1)
          : deckSummaries;

    return [...base].sort((a, b) => {
      const aLive = String(a.availability ?? 'live').toLowerCase() !== 'coming';
      const bLive = String(b.availability ?? 'live').toLowerCase() !== 'coming';
      if (aLive !== bLive) return aLive ? -1 : 1;

      const oa = typeof a.order === 'number' ? a.order : 9999;
      const ob = typeof b.order === 'number' ? b.order : 9999;
      if (oa !== ob) return oa - ob;

      return a.title.localeCompare(b.title);
    });
  }, [deckSummaries, deckFilter]);

  function openMonth() {
  

    if (!isSignedIn) {
      setIsMonthGateOpen(true);
      return;
    }

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

  const monthGrid = useMemo(() => {
    const y = asOf.getFullYear();
    const m = asOf.getMonth();
    const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
    const daysInMonth = new Date(y, m + 1, 0).getDate();

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
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {/* Month View (requires sign-in; unchanged) */}
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
                  {WEEKDAYS_MON.map((w) => (
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
                      <View key={cell.dateKey} style={[styles.monthCell, cell.isToday && styles.monthCellToday]}>
                        <Text style={[styles.monthDayNumber, cell.isToday && styles.monthDayNumberToday]}>
                          {cell.date.getDate()}
                        </Text>

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

          {/* Month Gate (unchanged) */}
          <Modal
            animationType="fade"
            transparent
            visible={isMonthGateOpen}
            onRequestClose={() => setIsMonthGateOpen(false)}
          >
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={() => setIsMonthGateOpen(false)} />

              <View style={styles.gateCard}>
                <View style={styles.modalHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>Unlock Month View</Text>
                    <Text style={styles.modalSubtitle}>30-day calendar + consistency insights</Text>
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.pressed]}
                    onPress={() => setIsMonthGateOpen(false)}
                    accessibilityLabel="Close sign-in gate"
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </Pressable>
                </View>

                <View style={{ marginTop: 10 }}>
                  {[
                    'See your next 30 days across all decks',
                    'Spot gaps and stay consistent with trends',
                    'Enable cloud backup after sign-in (shown immediately)',
                  ].map((t, idx) => (
                    <View key={`b-${idx}`} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{t}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.gateCtaRow}>
                  <Pressable
                    style={({ pressed }) => [styles.gateSecondaryBtn, pressed && styles.pressed]}
                    onPress={() => {
                      setIsMonthGateOpen(false);
                      pendingOpenMonthRef.current = true;
                      navigation.navigate('SignUp');
                    }}
                  >
                    <Text style={styles.gateSecondaryText}>Create account</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [styles.gatePrimaryBtn, pressed && styles.pressed]}
                    onPress={() => {
                      setIsMonthGateOpen(false);
                      pendingOpenMonthRef.current = true;
                      navigation.navigate('SignIn');
                    }}
                  >
                    <Text style={styles.gatePrimaryText}>Sign in</Text>
                  </Pressable>
                </View>

                <Text style={styles.gateFootnote}>
                  Week view stays free. Sign in unlocks Month view and enables backup.
                </Text>
              </View>
            </View>
          </Modal>

          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
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

            <View style={[styles.cardGlass, styles.calendarCardFixed]}>
              <View style={styles.cardHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Calendar</Text>
                  <Text style={styles.cardSubtitle} numberOfLines={1}>
                    All decks · {totalDueAllDecks} due today
                  </Text>
                </View>

                <View style={styles.segment}>
                  <Pressable
                    style={({ pressed }) => [styles.segmentItem, styles.segmentItemActive, pressed && styles.pressed]}
                    onPress={() => {}}
                  >
                    <Text style={[styles.segmentText, styles.segmentTextActive]}>Week</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [styles.segmentItem, pressed && styles.pressed]}
                    onPress={openMonth}
                  >
                    <Text style={styles.segmentText}>{isSignedIn ? 'Month' : 'Month 🔒'}</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.weekGrid}>
                {week7.map((day, idx) => {
                  const date = new Date(asOf.getTime());
                  date.setDate(date.getDate() + idx);

                  const dateText = formatMonthDay(date);
                  const label = idx === 0 ? 'Today' : weekdayShort(date);

                  const count = day.count;
                  const pct = maxWeek <= 0 ? 0 : count === 0 ? 0 : Math.max(0.12, count / maxWeek);

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
                        <View style={[styles.weekBarFill, { flex: pct, opacity: count === 0 ? 0 : 1 }]} />
                      </View>

                      <Text style={styles.weekLabel} numberOfLines={1}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.weekHintSlot}>
                <Text style={styles.weekHintText} numberOfLines={1} ellipsizeMode="tail">
                  {weekHint ?? 'Tap a day bar to see the exact count.'}
                </Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Decks</Text>
              </View>

              <View style={styles.segmentThree}>
                {(['all', 'free', 'premium'] as const).map((key) => {
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
                      <Text style={[styles.segmentThreeText, active && styles.segmentThreeTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {deckSummaries.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>No decks installed yet</Text>
                  <Text style={styles.emptySubtitle}>
                    We will try to download decks automatically. You can also tap “Check & update decks” in Settings.
                  </Text>
                </View>
              ) : (
                filteredDecks.map((d) => {
                  const active = d.slug === selectedSlug;
                  const isPremium = d.deckType !== 1;

                  const availability = (d.availability ?? '').toLowerCase();
                  const isComing = availability === 'coming';

                  const lockedPremium = isPremium && !isPremiumUser;

                  // ✅ premium user but still has preview installed (15/30) -> should download full
                  const needsFull =
                    isPremiumUser && isPremium && d.localCards > 0 && d.localCards < d.totalCards;
                  const needsFullInstall = isPremiumUser && isPremium && !d.canStudy;
                  const deckUpdate = updates?.[d.slug];
                  const hasInstalledVersion =
                    typeof deckUpdate?.installedVersion === 'string' && deckUpdate.installedVersion.trim().length > 0;

                  // ✅ IMPORTANT: do NOT require remoteUrl here (premium full update uses presigned url)
                  const hasUpdate = hasInstalledVersion && !!deckUpdate?.hasUpdate;

                  // trial installed: locked premium but user is signed in and preview is installed (canStudy)
                  const isTrialInstalled = lockedPremium && isSignedIn && d.canStudy;

                  return (
                    <Pressable
                      key={d.slug}
                      style={({ pressed }) => [
                        styles.deckRow,
                        active && styles.deckRowActive,
                        pressed && styles.deckRowPressed,
                      ]}
                      onPress={async () => {
                        // coming
                        if (isComing) {
                          Alert.alert(
                            'Coming soon',
                            d.eta ? `ETA: ${d.eta}` : 'This deck is not available yet.',
                            [{ text: 'OK' }],
                          );
                          return;
                        }
                        // ✅ premium user: not installed on this device yet -> install full first
if (needsFullInstall) {
  setState((prev) => ({ ...prev, loading: true }));
  try {
    const data = await fetchPremiumDeckUrl(d.slug);
    if (!data?.url || !data?.buildId) throw new Error('Failed to get premium download url');

    const ok = await installDeckFromUrl(d.slug, data.url, data.buildId, null);
    if (!ok) throw new Error('Failed to install full deck');

    try {
      await applyCachedRemoteProgress(d.slug);
    } catch {}

    const newState = await computeHomeState();
    if (isMounted.current) setState(newState);

    openDeck(d.slug);
  } catch (e: any) {
    console.error('Full install failed:', e);
    Alert.alert('Download failed', e?.message ?? 'Failed to download full deck.');
    setState((prev) => ({ ...prev, loading: false }));
  }
  return;
}
                        // ✅ premium user: if still on preview, download full first
                        if (needsFull) {
                          setState((prev) => ({ ...prev, loading: true }));
                          try {
                            const data = await fetchPremiumDeckUrl(d.slug);
                            if (!data?.url || !data?.buildId) throw new Error('Failed to get premium download url');

                            const ok = await installDeckFromUrl(d.slug, data.url, data.buildId, null);
                            if (!ok) throw new Error('Failed to install full deck');

                            try {
                              await applyCachedRemoteProgress(d.slug);
                            } catch {}

                            const newState = await computeHomeState();
                            if (isMounted.current) setState(newState);

                            openDeck(d.slug);
                          } catch (e: any) {
                            console.error('Full download failed:', e);
                            Alert.alert('Download failed', e?.message ?? 'Failed to download full deck.');
                            setState((prev) => ({ ...prev, loading: false }));
                          }
                          return;
                        }

                        if (lockedPremium) {
                          // Signed-in free user: install preview first (remoteUrl is previewUrl after repo fix)
                          if (isSignedIn) {
                            const info = updates?.[d.slug];

                            if (info?.remoteUrl && info.remoteVersion) {
                              setState((prev) => ({ ...prev, loading: true }));

                              try {
                                const ok = await installDeckFromUrl(
                                  d.slug,
                                  info.remoteUrl,
                                  info.remoteVersion,
                                  info.remoteSha256,
                                );

                                if (ok) {
                                  try {
                                    await applyCachedRemoteProgress(d.slug);
                                  } catch {}

                                  const newState = await computeHomeState();
                                  if (isMounted.current) setState(newState);

                                  openDeck(d.slug);
                                  return;
                                }
                              } catch (e: any) {
                                console.error('Preview install failed:', e);
                                Alert.alert('Download failed', e?.message ?? 'Failed to download preview.');
                              } finally {
                                setState((prev) => ({ ...prev, loading: false }));
                              }
                            }
                          }

                          // Not signed in (or preview missing) -> open deck screen (it will show login gate)
                          openDeck(d.slug);
                          return;
                        }

                        const needsInstall = !d.canStudy;
                        const needsUpdate = d.canStudy && hasUpdate && !needsFull;

                        if (needsInstall || needsUpdate) {
                          setState((prev) => ({ ...prev, loading: true }));

                          try {
                            let ok = false;

                            // PUBLIC path: use manifest-derived remoteUrl
                            if (deckUpdate?.remoteUrl) {
                              ok = await installDeckFromUrl(
                                d.slug,
                                deckUpdate.remoteUrl,
                                deckUpdate.remoteVersion,
                                deckUpdate.remoteSha256,
                              );
                            } else {
                              // PREMIUM (auth) path: call API to get presigned URL, then install
                              const mode = String(d.downloadMode ?? '').toLowerCase();
                              if (isPremiumUser && mode === 'auth') {
                                const data = await fetchPremiumDeckUrl(d.slug);
                                if (!data?.url || !data?.buildId) throw new Error('Failed to get premium download url');
                                ok = await installDeckFromUrl(d.slug, data.url, data.buildId, null);
                              } else {
                                ok = false;
                              }
                            }

                            if (ok) {
                              try {
                                await applyCachedRemoteProgress(d.slug);
                              } catch {}

                              const newState = await computeHomeState();
                              if (isMounted.current) setState(newState);
                              openDeck(d.slug);
                            } else {
                              setState((prev) => ({ ...prev, loading: false }));
                            }
                          } catch (e: any) {
                            console.error('Deck install/update failed:', e);
                            Alert.alert('Download failed', e?.message ?? 'Failed to download this deck.');
                            setState((prev) => ({ ...prev, loading: false }));
                          }
                          return;
                        }

                        openDeck(d.slug);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.deckRowTitle, active && styles.deckRowTitleActive]} numberOfLines={1}>
                          {d.title}
                        </Text>

                        <Text style={styles.deckRowSub} numberOfLines={1}>
                          {isComing
                            ? `Coming${d.eta ? ` · ${d.eta}` : ''}`
                            : isPremium
                              ? (lockedPremium && isSignedIn ? 'Premium · Free trial' : 'Premium')
                              : 'Free'}{' '}
                          · {d.totalCards} cards
                        </Text>
                      </View>

                      {/* Right side pills */}
                      {isComing ? (
                        <View style={styles.deckRowRight}>
                          <Text style={styles.comingPill}>Coming</Text>
                        </View>
                      ) : lockedPremium ? (
                        <View style={styles.deckRowRight}>
                          <Text style={styles.lockedPill}>{isSignedIn ? 'Free Trial' : '🔒 Premium'}</Text>

                          {/* trial installed => show only progress bar (no 15/15 text) */}
                          {isTrialInstalled ? (
                            <View style={styles.rowBarBg}>
                              <View style={[styles.rowBarFill, { flex: d.percent, opacity: d.percent === 0 ? 0 : 1 }]} />
                              <View style={{ flex: 1 - d.percent }} />
                            </View>
                          ) : null}
                        </View>
                      ) : d.canStudy ? (
                        <View style={styles.deckRowRight}>
                          {/* premium user still on preview => prompt full download */}
                          {needsFull ? <Text style={styles.updatePill}>Download full</Text> : null}

                          {/* updates (including premium full updates) */}
                          {hasUpdate && !needsFull ? <Text style={styles.updatePill}>Update available</Text> : null}

                          <Text style={styles.duePill}>{d.masteredApprox} finished</Text>
                          <View style={styles.rowBarBg}>
                            <View style={[styles.rowBarFill, { flex: d.percent, opacity: d.percent === 0 ? 0 : 1 }]} />
                            <View style={{ flex: 1 - d.percent }} />
                          </View>
                        </View>
                      ) : (
                        <View style={styles.deckRowRight}>
                          {hasUpdate && !needsFull ? <Text style={styles.updatePill}>Update available</Text> : null}
                         <Text style={styles.lockedPill}>
                          {isPremiumUser && isPremium ? 'Download full' : 'Not installed'}
                        </Text>
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
    </SafeAreaProvider>
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

  calendarCardFixed: { minHeight: 200 },

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
    marginTop: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekHintText: { fontSize: 11, color: '#6B7280' },

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

  comingPill: {
    marginLeft: 10,
    fontSize: 11,
    fontWeight: '900',
    color: '#0F766E',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(20,184,166,0.12)',
  },

  emptyBox: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.04)',
    padding: 12,
  },
  emptyTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  emptySubtitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },

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
    backgroundColor: '#FFFFFF',
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

  monthMeta: { marginTop: 6, height: 24, alignItems: 'center', justifyContent: 'center' },
  monthDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
  },
  monthCount: { marginTop: 4, fontSize: 11, fontWeight: '800', color: '#111827' },

  modalLegend: { marginTop: 8, fontSize: 11, color: '#6B7280' },

  gateCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  bulletDot: { width: 18, fontSize: 14, color: '#374151', lineHeight: 18 },
  bulletText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },

  gateCtaRow: { flexDirection: 'row', marginTop: 12 },
  gateSecondaryBtn: {
    flex: 1,
    marginRight: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
  },
  gateSecondaryText: { fontSize: 13, fontWeight: '900', color: '#111827' },

  gatePrimaryBtn: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  gatePrimaryText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },

  gateFootnote: { marginTop: 10, fontSize: 11, color: '#6B7280', lineHeight: 16 },
});