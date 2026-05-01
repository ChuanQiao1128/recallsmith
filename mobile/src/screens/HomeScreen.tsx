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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';

import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';

import { formatDateKey } from '../review/model';

import type { CalendarDay, DeckSummary } from '../features/gacha/contracts';
import { buildHomeVM } from '../features/gacha/selectors/homeSelectors';
import { buildUpcoming, clamp01, isLearnedProgress, isScheduledProgress, startOfToday } from '../features/gacha/selectors/progressSelectors';
import TodayPressureCard from '../features/gacha/components/TodayPressureCard';


import { fetchPremiumDeckUrl, fetchServerPremium } from '../features/gacha/home/homeRemote';
import { loadRewardWalletState, type RewardWalletState } from '../features/gacha/rewards/rewardWallet';

import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { MOCK_HOME_STATES } from '../mock/home';
import { resolveHomeState } from '../features/gacha/home/homeStateMachine';

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

// ✅ premium entitlement (local store cache only)
import { usePremiumUser, setIsPremiumUser } from '../premium/premiumStore';

// ✅ auth state
import { useAuthStore } from '../auth/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type DeckFilter = 'all' | 'free' | 'premium';

type HomeState = {
  loading: boolean;
  asOfISO: string;

  deckSummaries: DeckSummary[];
  updates: Record<string, UpdateInfo>;

  allUpcoming30: CalendarDay[];
  monthCounts: Record<string, number>;
};

function weekdayShort(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function formatMonthDay(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const WEEKDAYS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function HomeScreen({ navigation, route }: Props) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deckFilter, setDeckFilter] = useState<DeckFilter>('all');
  const [drawWallet, setDrawWallet] = useState<RewardWalletState>({ availablePulls: 0, reservePulls: 0 });
  const [streakSnapshot, setStreakSnapshot] = useState<StreakSnapshot | null>(null);

  const [isMonthOpen, setIsMonthOpen] = useState(false);
  const [isMonthGateOpen, setIsMonthGateOpen] = useState(false);
  const pendingOpenMonthRef = useRef(false);

  const [weekHint, setWeekHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMounted = useRef(true);

  // ✅ auth
  const authStatus = useAuthStore((s) => s.status);
  const accessToken = useAuthStore((s) => s.accessToken);
  const authInit = useAuthStore((s) => s.init);
  const authUserSub = useAuthStore((s) => s.userSub);
  const isSignedIn = authStatus === 'signed_in';

  /**
   * ✅ Premium truth model
   * - serverPremium: 唯一“放行 premium 下载/安装”的真相
   * - premiumStore: 仅作为缓存/展示（不会再用于放行）
   */
  const cachedPremium = usePremiumUser(authUserSub); // cache only
  const [serverPremium, setServerPremium] = useState(false);

  // ✅ EFFECTIVE premium used for gating actions (downloads, full install)
  const isPremiumUser = serverPremium;

  // ✅ debug log only when relevant values change
  const lastDbgRef = useRef<string>('');
  useEffect(() => {
    const cur = JSON.stringify({
      apiBase: 'managed-in-homeRemote',
      authStatus,
      isSignedIn,
      hasAccessToken: !!accessToken,
      cachedPremium,
      serverPremium,
      effectivePremium: isPremiumUser,
      userSub: authUserSub ?? null,
    });
    if (cur !== lastDbgRef.current) {
      lastDbgRef.current = cur;
      console.log('[Home] state', cur);
    }
  }, [authStatus, isSignedIn, accessToken, cachedPremium, serverPremium, isPremiumUser, authUserSub]);

  // ✅ Always init auth once on mount
  useEffect(() => {
    void authInit();
  }, [authInit]);

  /**
   * ✅ Refresh server premium whenever token/user changes
   * SECURITY FIX:
   * - 每次 user/token 变化先立刻 setServerPremium(false)，杜绝串号“残留 premium”
   * - 再拉取服务端真相
   * - 同步写回 premiumStore（覆盖你手动改过的 premium）
   */
  useEffect(() => {
    let cancelled = false;

    // ✅ reset immediately to avoid stale premium when switching accounts
    setServerPremium(false);

    (async () => {
      // signed out / no token => definitely not premium
      if (!accessToken || !accessToken.trim()) {
        try {
          await setIsPremiumUser(false, authUserSub);
        } catch {}
        return;
      }

      try {
        const p = await fetchServerPremium(accessToken);
        if (cancelled) return;
        setServerPremium(p);

        // ✅ keep local cache aligned with server truth
        try {
          await setIsPremiumUser(p, authUserSub);
        } catch {}
      } catch {
        if (cancelled) return;
        setServerPremium(false);
        try {
          await setIsPremiumUser(false, authUserSub);
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, authUserSub]);

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

  // after sign-in, if user came from Month gate, auto open Month
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

  // =========================
  // First launch bootstrap (auto download decks)
  // =========================
  const bootstrapAttemptedKeyRef = useRef<string | null>(null);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [bootstrapText, setBootstrapText] = useState('自动下载题库中…');
  const [bootstrapProgress, setBootstrapProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const computeHomeState = useCallback(async (): Promise<HomeState> => {
    const now = new Date();
    const today0 = startOfToday(now);

    // If manifest isn't available yet (fresh install), fall back to the updates map so we can
    // still show a deck list and bootstrap-install public decks.
    const buildFallbackDeckEntries = (m: Record<string, UpdateInfo>): any[] => {
      try {
        const rows = Object.entries(m ?? {}).map(([slug, info]) => {
          const deckType = Number((info as any)?.deckType ?? 2);
          const downloadMode = (info as any)?.downloadMode ?? (deckType === 1 ? 'public' : 'auth');
          const title = (info as any)?.title ?? slug.replace(/[-_]+/g, ' ');
          const locale = (info as any)?.locale ?? 'en-US';
          const totalCards =
            (info as any)?.remoteCardCount ??
            (info as any)?.remoteTotalCards ??
            (info as any)?.totalCards ??
            null;

          const requiresPremium =
            (info as any)?.requiresPremium ?? ((info as any)?.lockedPremium ?? deckType !== 1);

          return {
            slug,
            title,
            locale,
            deckType,
            downloadMode,
            totalCards,
            requiresPremium,
            availability: (info as any)?.availability ?? null,
            tier: (info as any)?.tier ?? null,
            eta: (info as any)?.eta ?? null,
            order: (info as any)?.order,
          };
        });

        // stable order
        rows.sort((a, b) => {
          const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : 9999;
          const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : 9999;
          if (ao !== bo) return ao - bo;
          return String(a.title).localeCompare(String(b.title));
        });

        return rows;
      } catch {
        return [];
      }
    };

    let updates: Record<string, UpdateInfo> = {};
    let manifestDecks: ManifestDeckEntry[] = [];

    try {
      updates = await checkManifestForUpdates(isPremiumUser);
      manifestDecks = await listManifestDecks();

      // ✅ 原来只靠 updates.installedVersion 判定 “是否安装过”
      // 这里加一个“本地 deck 是否真实存在”的二次校验：
      // - 避免 updates 异常/为空时误判，导致反复 bootstrap 或漏 bootstrap
      let hasAnyInstalledDeck = Object.values(updates).some(
        (u) => typeof (u as any)?.installedVersion === 'string' && String((u as any).installedVersion).trim().length > 0,
      );

      if (!hasAnyInstalledDeck) {
        const probeEntries: any[] =
          manifestDecks.length > 0 ? (manifestDecks as any[]) : buildFallbackDeckEntries(updates);

        for (const e of probeEntries) {
          try {
            const deck = await resolveDeckBySlug(e.slug);
            const localCards = deck?.Cards?.length ?? (deck as any)?.TotalCards ?? 0;
            if (deck && localCards > 0) {
              hasAnyInstalledDeck = true;
              break;
            }
          } catch {
            // ignore
          }
        }
      }

      // first launch bootstrap: auto-install only FREE + PUBLIC decks
      if (!hasAnyInstalledDeck) {
        const entriesForBootstrap: any[] =
          manifestDecks.length > 0 ? (manifestDecks as any[]) : buildFallbackDeckEntries(updates);

        const candidates: Array<{
          slug: string;
          remoteUrl: string;
          remoteVersion: string;
          remoteSha256: string | null;
        }> = [];

        for (const entry of entriesForBootstrap) {
          const info: any = updates?.[entry.slug];

          // ✅ 更稳：remoteUrl / remoteVersion / sha 可以来自 updates 或 manifest entry
          const remoteUrl: string | null =
            (info?.remoteUrl as string | undefined) ??
            (entry as any)?.remoteUrl ??
            (entry as any)?.url ??
            null;

          const remoteVersion: string | null =
            (info?.remoteVersion as string | undefined) ??
            (entry as any)?.remoteVersion ??
            (entry as any)?.version ??
            null;

          const remoteSha256: string | null =
            (info?.remoteSha256 as string | undefined) ??
            (entry as any)?.remoteSha256 ??
            (entry as any)?.sha256 ??
            null;

          const hasUpdate: boolean = info?.hasUpdate ?? true;

          if (!remoteUrl || !remoteVersion || !hasUpdate) continue;

          const deckType = Number((entry as any)?.deckType ?? info?.deckType ?? 2);
          const downloadModeRaw =
            (info?.downloadMode as string | undefined) ??
            (entry as any)?.downloadMode ??
            (deckType === 1 ? 'public' : 'auth');
          const downloadMode = String(downloadModeRaw).toLowerCase().trim();

          // Only bootstrap-install PUBLIC + FREE decks.
          if (deckType !== 1) continue;
          if (downloadMode !== 'public') continue;

          candidates.push({
            slug: entry.slug,
            remoteUrl,
            remoteVersion,
            remoteSha256,
          });
        }

        const bootstrapKey = authUserSub ?? 'anon';
        const alreadyAttempted = bootstrapAttemptedKeyRef.current === bootstrapKey;

        if (candidates.length > 0 && !alreadyAttempted) {
          bootstrapAttemptedKeyRef.current = bootstrapKey;

          setBootstrapOpen(true);
          setBootstrapText('Auto downloading…');
          setBootstrapProgress({ done: 0, total: candidates.length });

          const installedSlugs: string[] = [];

          for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            setBootstrapText(`Auto downloading… (${i + 1}/${candidates.length})`);
            setBootstrapProgress({ done: i, total: candidates.length });

            try {
              const ok = await installDeckFromUrl(c.slug, c.remoteUrl, c.remoteVersion, c.remoteSha256);
              if (ok) installedSlugs.push(c.slug);
            } catch {
              // ignore single failure
            }
          }

          setBootstrapProgress({ done: candidates.length, total: candidates.length });
          setBootstrapText('Now initializing…');

          if (installedSlugs.length > 0) {
            // set active deck if missing
            try {
              const stored = await loadActiveDeckSlug();
              if (!stored) await setActiveDeckSlug(installedSlugs[0]);
            } catch {
              // ignore
            }

            // apply cached remote progress (if any) for the decks we installed
            for (const slug of installedSlugs) {
              try {
                await applyCachedRemoteProgress(slug);
              } catch {
                // ignore
              }
            }

            // recompute updates after installs
            try {
              updates = await checkManifestForUpdates(isPremiumUser);
            } catch {
              // ignore
            }
          }

          // try to read manifest again after bootstrap (some impls cache on first update)
          try {
            if (manifestDecks.length === 0) {
              manifestDecks = await listManifestDecks();
            }
          } catch {
            // ignore
          }

          setBootstrapOpen(false);
          setBootstrapProgress(null);
        }
      }
    } catch {
      updates = {};
      manifestDecks = [];
    }

    const deckEntries: any[] =
      manifestDecks.length > 0 ? (manifestDecks as any[]) : buildFallbackDeckEntries(updates);

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

    for (const entry of deckEntries) {
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
      const localCards = deck?.Cards?.length ?? (deck as any)?.TotalCards ?? 0;

      const displayTotalCards =
        typeof entry.totalCards === 'number' && Number.isFinite(entry.totalCards)
          ? entry.totalCards
          : localCards;

      const canStudy = !!deck && localCards > 0;

      if (!canStudy) {
        deckSummaries.push({
          slug: (deck as any)?.Slug ?? entry.slug,
          title: (deck as any)?.Title ?? entry.title ?? entry.slug,
          locale: (deck as any)?.Locale ?? entry.locale ?? 'en-US',
          version: (deck as any)?.Version ?? entry.version,
          deckType: (deck as any)?.DeckType ?? entry.deckType ?? 1,
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
        await applyCachedRemoteProgress((deck as any).Slug);
      } catch {}

      const progress = await loadDeckProgress(deck as any);
      const learnedCount = progress.filter(isLearnedProgress).length;

      const studyCards = Math.max(localCards, 0);
      const denom = Math.max(studyCards, 1);

      const newRemaining = Math.max(denom - learnedCount, 0);

      const upcoming30 = buildUpcoming(progress, now, 30);
      const dueToday = upcoming30[0]?.count ?? 0;

      totalDueAllDecks += dueToday;

      const percent = denom > 0 ? clamp01(learnedCount / denom) : 0;

      deckSummaries.push({
        slug: (deck as any).Slug,
        title: (deck as any).Title,
        locale: (deck as any).Locale,
        version: (deck as any).Version,
        deckType: (deck as any).DeckType,
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
        if (!isScheduledProgress(p)) continue;

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
  }, [isPremiumUser, authUserSub]);

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
        const [wallet, streak] = await Promise.all([loadRewardWalletState(), loadStreakSnapshot()]);
        if (!cancelled) {
          setDrawWallet(wallet);
          setStreakSnapshot(streak);
        }
      }
      void run();
      return () => {
        cancelled = true;
      };
    }, [loadHomeFromLocal]),
  );

  // Refresh Home after auth/premium changes
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // show spinner while switching account / syncing
      setState((prev) => ({ ...prev, loading: true }));

      if (isSignedIn) {
        try {
          await forceProgressSync('home_auth_changed');
        } catch {}
      }

      if (cancelled) return;
      await loadHomeFromLocal();
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, authUserSub, isSignedIn, isPremiumUser, loadHomeFromLocal]);

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

  const selectedDeckSummary = useMemo(
    () => deckSummaries.find((deck) => deck.slug === selectedSlug) ?? deckSummaries[0] ?? null,
    [deckSummaries, selectedSlug],
  );

  const homeVm = useMemo(
    () => buildHomeVM({ deckSummaries, selectedSlug, hasSignedInUser: isSignedIn }),
    [deckSummaries, selectedSlug, isSignedIn],
  );

  const firstDrawCoach = route.params?.firstDrawCoach ?? false;
  const mockHomeStateOverride = route.params?.mockState;

  const v6HomeState = useMemo(() => {
    if (mockHomeStateOverride) return mockHomeStateOverride;
    return resolveHomeState({
      dueCount: homeVm.counts.selectedDue,
      newCount: homeVm.counts.selectedNew,
      wallet: drawWallet,
      streakCount: streakSnapshot?.currentDailyStreak ?? 0,
    });
  }, [drawWallet, streakSnapshot, homeVm, mockHomeStateOverride]);

  function startTodayChallenge() {
    if (!selectedDeckSummary) {
      return;
    }

    if (homeVm.hero.ctaAction === 'none') {
      return;
    }

    if (homeVm.hero.ctaAction === 'deck' || !selectedDeckSummary.canStudy) {
      openDeck(selectedDeckSummary.slug);
      return;
    }

    void setActiveDeckSlug(selectedDeckSummary.slug);
    setSelectedSlug(selectedDeckSummary.slug);
    navigation.navigate('DailyDose', {
      slug: selectedDeckSummary.slug,
    });
  }

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

  function showDeckInstallFailure(deckTitle: string) {
    Alert.alert(
      'Download failed',
      `The deck package for "${deckTitle}" could not be installed. Please try again after republishing the deck or updating the app.`,
    );
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

  // ✅ FIX: loading 分支也要渲染 bootstrap Modal，否则首次启动弹窗不会出现
  if (loading) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <LinearGradient
            colors={['#FAF3E0', '#F3E8C8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradient}
          >
            {/* First launch bootstrap modal (also render during loading!) */}
            <Modal transparent animationType="fade" visible={bootstrapOpen}>
              <View style={styles.modalOverlay}>
                <View style={styles.modalCardOpaque}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <ActivityIndicator />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.modalTitle}>Now initializing</Text>
                      <Text style={styles.modalSubtitle}>{bootstrapText}</Text>
                      {bootstrapProgress ? (
                        <Text style={[styles.modalSubtitle, { marginTop: 8 }]}>
                          {bootstrapProgress.done}/{bootstrapProgress.total}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            </Modal>

            <View style={styles.center}>
              <ActivityIndicator size="large" color="#6366F1" />
              <Text style={styles.loadingText}>Loading home…</Text>
            </View>
          </LinearGradient>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const totalDueAllDecks = deckSummaries.reduce((sum, d) => sum + (d.canStudy ? d.dueToday : 0), 0);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#FAF3E0', '#F3E8C8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {/* First launch bootstrap modal */}
          <Modal transparent animationType="fade" visible={bootstrapOpen}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCardOpaque}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <ActivityIndicator />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.modalTitle}>Now initializing</Text>
                    <Text style={styles.modalSubtitle}>{bootstrapText}</Text>
                    {bootstrapProgress ? (
                      <Text style={[styles.modalSubtitle, { marginTop: 8 }]}>
                        {bootstrapProgress.done}/{bootstrapProgress.total}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>
          </Modal>

          {/* Month View */}
          <Modal animationType="fade" transparent visible={isMonthOpen} onRequestClose={closeMonth}>
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={closeMonth} />
              <View style={styles.modalCardOpaque}>
                <View style={styles.modalHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{monthGrid.monthLabel}</Text>
                    <Text style={styles.modalSubtitle}>{totalDueAllDecks} due today across all decks · use this as support planning, not your main start point</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.pressed]}
                    onPress={closeMonth}
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

          {/* Month Gate */}
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
                    <Text style={styles.modalTitle}>Unlock Month support</Text>
                    <Text style={styles.modalSubtitle}>30-day planning view + consistency insights</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.pressed]}
                    onPress={() => setIsMonthGateOpen(false)}
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </Pressable>
                </View>

                <View style={{ marginTop: 10 }}>
                  {[
                    'See your next 30 days across all decks',
                    'Use it as a planning surface after you know today’s route',
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
                  Week view stays free. Sign in unlocks Month support and backup.
                </Text>
              </View>
            </View>
          </Modal>

          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.headingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.homeKicker}>COLD START HOME · {selectedDeckSummary?.slug ?? 'NO-DECK'}</Text>
                <Text style={styles.appTitle}>RecallSmith</Text>
                <Text style={styles.appSubtitle}>Draw first, then keep today’s study route compact and deliberate.</Text>

                <Pressable style={({ pressed }) => [styles.activeDeckPill, pressed && styles.pressed]} onPress={() => navigation.navigate('PoolPicker', { activePoolId: selectedDeckSummary?.slug })}>
                    <Text style={styles.activeDeckPillText}>{selectedDeckSummary?.title ?? 'Choose a deck'}</Text>
                </Pressable>
              </View>

              <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]} onPress={() => navigation.navigate('Settings')}>
                <Text style={styles.iconButtonText}>⚙︎</Text>
              </Pressable>
            </View>

            <View style={styles.heroGiftCard}>
              <View style={styles.heroGlowOrb} />
              <View style={styles.heroBadgeRow}>
                <Text style={styles.heroGiftIcon}>🎁</Text>
                <Text style={styles.heroBadge}>FIRST GIFT CARD</Text>
              </View>
              <Text style={styles.heroTitle}>{homeVm.hero.title}</Text>
              <Text style={styles.heroSubtitle}>{homeVm.hero.subtitle}</Text>
              <Text style={styles.heroMeta}>{selectedDeckSummary?.title ?? 'Install a deck to begin'} · {drawWallet.availablePulls} pull token{drawWallet.availablePulls === 1 ? '' : 's'} · {drawWallet.reservePulls} reserve</Text>
              <Pressable
                style={({ pressed }) => [styles.heroPrimaryButton, (homeVm.hero.ctaDisabled || !selectedDeckSummary) && styles.buttonDisabled, pressed && styles.pressed]}
                disabled={homeVm.hero.ctaDisabled || !selectedDeckSummary}
                onPress={startTodayChallenge}
              >
                <Text style={styles.heroPrimaryButtonText}>{homeVm.hero.ctaLabel}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.heroSecondaryButton, pressed && styles.pressed]}
                onPress={() => navigation.navigate('Draw', { slug: selectedDeckSummary?.slug ?? undefined, rewardPending: true })}
              >
                <Text style={styles.heroSecondaryButtonText}>{firstDrawCoach ? 'Open first draw route' : 'Peek at reward draw'}</Text>
              </Pressable>
            </View>

            {firstDrawCoach ? (
              <View style={[styles.sectionCard, styles.secondarySectionCard, styles.amberSectionCard]}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitleSecondary}>First draw coach</Text>
                </View>
                <Text style={styles.sectionSubtitleCompact}>Your first product loop starts here: draw first, then study the revealed cards. The rest of Home can stay secondary for now.</Text>
                <Pressable
                  style={({ pressed }) => [styles.secondaryInlineButton, pressed && styles.pressed]}
                  onPress={() => navigation.navigate('Draw', { slug: selectedDeckSummary?.slug ?? undefined, rewardPending: true })}
                >
                  <Text style={styles.secondaryInlineButtonText}>Start first draw</Text>
                </Pressable>
              </View>
            ) : null}

            {v6HomeState !== 'active' ? (
              <View style={[styles.sectionCard, styles.secondarySectionCard, styles.stateHintCard]}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitleSecondary}>{MOCK_HOME_STATES[v6HomeState].title}</Text>
                </View>
                <Text style={styles.sectionSubtitleCompact}>{MOCK_HOME_STATES[v6HomeState].helper}</Text>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Today pressure</Text>
              <Text style={styles.sectionSubtitleCompact}>A clearer view of the active deck before you commit.</Text>
              <View style={styles.embeddedCardSlot}>
                <TodayPressureCard counts={homeVm.counts} selectedDeckTitle={homeVm.selectedDeckTitle} />
              </View>
            </View>

            <View style={{ height: 8 }} />
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default HomeScreen;

const GLASS = 'rgba(255,249,240,0.72)';
const BORDER = 'rgba(140,122,91,0.18)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 112 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 10, color: '#8C7A5B' },

  pressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.45 },

  headingRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  homeKicker: { fontSize: 11, fontWeight: '800', color: '#8C7A5B', letterSpacing: 1.1, fontFamily: 'Courier' },
  appTitle: { marginTop: 6, fontSize: 28, fontWeight: '900', color: '#2A2218' },
  appSubtitle: { marginTop: 4, fontSize: 12, lineHeight: 18, color: '#6B5A45' },

  headingSupportRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  activeDeckPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(200,136,58,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.18)',
  },
  activeDeckPillText: {
    color: '#7A603D',
    fontSize: 11,
    fontWeight: '800',
  },
  supportLinkChip: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: 'rgba(42,34,24,0.05)',
  },
  supportLinkText: {
    color: '#5A4B38',
    fontSize: 11,
    fontWeight: '700',
  },

  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,249,240,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(140,122,91,0.14)',
    shadowColor: '#9A7A42',
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  iconButtonPressed: { opacity: 0.92 },
  iconButtonText: { fontSize: 18, color: '#2A2218' },

  heroGiftCard: {
    borderRadius: 28,
    paddingVertical: 22,
    paddingHorizontal: 20,
    backgroundColor: '#E9BF6A',
    borderWidth: 1,
    borderColor: 'rgba(166,111,38,0.22)',
    shadowColor: '#C8883A',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    marginBottom: 14,
    overflow: 'hidden',
  },
  heroGlowOrb: {
    position: 'absolute',
    top: -36,
    right: -18,
    width: 136,
    height: 136,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  heroGiftIcon: { fontSize: 20, marginRight: 8 },
  heroBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(58,38,8,0.88)',
    letterSpacing: 1.2,
    fontFamily: 'Courier',
    backgroundColor: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  heroTitle: { fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  heroSubtitle: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#4A3822' },
  heroMeta: { marginTop: 10, fontSize: 11, lineHeight: 16, color: '#6A532C', fontWeight: '700', fontFamily: 'Courier' },
  heroPrimaryButton: {
    marginTop: 18,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: '#3A2608',
  },
  heroPrimaryButtonText: { color: '#FFF7E9', fontSize: 15, fontWeight: '900' },
  heroSecondaryButton: {
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: 'rgba(58,38,8,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(58,38,8,0.12)',
  },
  heroSecondaryButtonText: { color: '#3A2608', fontSize: 13, fontWeight: '800' },

  subduedRouteCard: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255,249,240,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(140,122,91,0.14)',
    marginBottom: 14,
  },
  subduedRouteKicker: { fontSize: 11, fontWeight: '800', color: '#8C7A5B', letterSpacing: 1, fontFamily: 'Courier' },
  subduedRouteTitle: { marginTop: 8, fontSize: 18, lineHeight: 24, fontWeight: '800', color: '#2A2218' },
  subduedRouteBody: { marginTop: 8, fontSize: 12, lineHeight: 18, color: '#6B5A45' },
  subduedRouteButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(42,34,24,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.08)',
  },
  subduedRouteButtonText: { fontSize: 12, fontWeight: '800', color: '#2A2218' },

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
  calendarSupportCard: {
    backgroundColor: 'rgba(255,249,240,0.82)',
    shadowOpacity: 0.07,
  },

  cardHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  cardSubtitle: { marginTop: 4, fontSize: 12, color: '#8C7A5B' },

  segment: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
    backgroundColor: 'rgba(255,249,240,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(140,122,91,0.14)',
    marginLeft: 12,
  },
  segmentItem: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  segmentItemActive: { backgroundColor: 'rgba(200,136,58,0.14)' },
  segmentText: { fontSize: 12, fontWeight: '700', color: '#2A2218' },
  segmentTextActive: { color: '#A66F26' },

  weekGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  weekCell: { flex: 1, alignItems: 'center' },
  weekDate: { fontSize: 10, color: '#8C7A5B' },
  weekLabel: { marginTop: 6, fontSize: 10, color: '#8C7A5B' },

  weekBarBg: {
    marginTop: 8,
    height: 38,
    width: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(140,122,91,0.12)',
    overflow: 'hidden',
  },
  weekBarFill: {
    width: 12,
    borderRadius: 999,
    backgroundColor: '#C8883A',
  },

  weekHintSlot: {
    marginTop: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekHintText: { fontSize: 11, color: '#8C7A5B' },

  sectionCard: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,249,240,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(140,122,91,0.12)',
    shadowColor: '#9A7A42',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    marginBottom: 14,
  },
  secondarySectionCard: {
    backgroundColor: 'rgba(255,249,240,0.72)',
    shadowOpacity: 0.05,
  },
  supportSummaryCard: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(42,34,24,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.08)',
    marginBottom: 14,
  },
  supportSummaryKicker: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8C7A5B',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: 'Courier',
  },
  supportSummaryTitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    color: '#2A2218',
  },
  supportSummaryBody: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#6B5A45',
  },
  stateHintCard: {
    borderColor: 'rgba(79,70,229,0.18)',
    backgroundColor: 'rgba(79,70,229,0.06)',
  },
  amberSectionCard: {
    borderColor: 'rgba(200,136,58,0.28)',
  },
  embeddedCardSlot: { marginTop: 12 },
  momentumCard: {
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(200,136,58,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.18)',
    marginBottom: 14,
  },
  momentumLabel: { fontSize: 11, fontWeight: '800', color: '#A66F26', textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: 'Courier' },
  momentumTitle: { marginTop: 6, fontSize: 16, fontWeight: '800', color: '#4A3822' },
  momentumBody: { marginTop: 6, fontSize: 12, lineHeight: 17, color: '#6B5A45' },
  momentumHint: { marginTop: 8, fontSize: 11, color: '#8C7A5B' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  sectionTitleSecondary: { fontSize: 13, fontWeight: '800', color: '#6B5A45' },
  sectionSubtitleCompact: { marginTop: 6, fontSize: 11, lineHeight: 16, color: '#8C7A5B' },
  v6ShellRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  v6ShellChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(200,136,58,0.10)',
  },
  v6ShellChipText: { fontSize: 11, fontWeight: '700', color: '#A66F26' },
  secondaryInlineButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(200,136,58,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.16)',
  },
  secondaryInlineButtonText: { fontSize: 12, fontWeight: '800', color: '#A66F26' },

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
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17,24,39,0.03)',
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
  monthDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: '#4F46E5' },
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
