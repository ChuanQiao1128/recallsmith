// mobile/src/screens/DeckScreen.tsx
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList, StudyMode } from '../navigation/types';

import type { DeckExport } from '../types/deckExport';
import { setActiveDeckSlug, loadActiveDeckSlug } from '../content/activeDeck';
import { fetchPremiumDeckUrl } from '../content/premiumDeckApi';
// resolver + manifest + installer
import {
  resolveDeckBySlug,
  listManifestDecks,
  checkManifestForUpdates,
  installDeckFromUrl,
  type ManifestDeckEntry,
} from '../content/deckRepository';

import type { CardProgress } from '../review/model';
import { loadDeckProgress, loadOrInitDailyStats, type DailyStats } from '../review/storage';
import { buildLibraryCardRows, buildLibraryVM, countUpdatedCards } from '../features/gacha/library/libraryMapper';
import { clamp01, isLearnedProgress } from '../features/gacha/selectors/progressSelectors';
import { countDueToday } from '../features/gacha/planner/sessionPlanner';

// premium entitlement
import { usePremiumUser, setIsPremiumUser } from '../premium/premiumStore';
import { rcGetCustomerInfoSafe, isPremiumActive } from '../premium/revenuecat';

// auth (Amplify + Zustand)
import { useAuthUser, useAuthStore } from '../auth/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Deck'>;

interface DeckState {
  loading: boolean;
  deck: DeckExport | null;
  progress: CardProgress[];
  dailyStats: DailyStats | null;
  error: string | null;

  manifestEntry?: ManifestDeckEntry | null;
  lockedReason?: 'coming' | 'login' | 'trial' | null;
}

function showTrialUpsellDialog(opts: {
  deckTitle: string;
  previewCount: number;
  totalCards: number;
  onUpgrade: () => void;
}) {
  const { deckTitle, previewCount, totalCards, onUpgrade } = opts;

  Alert.alert(
    'Free trial completed',
    `You’ve finished the free trial for “${deckTitle}” (${previewCount} cards out of ${totalCards}).\n\nYou can still review these ${previewCount} cards forever.\nUpgrade to Premium to unlock the rest and continue your progress.`,
    [
      { text: 'Keep reviewing', style: 'cancel' },
      { text: 'Upgrade', onPress: onUpgrade },
    ],
  );
}

function lower(s: any): string {
  return String(s ?? '').toLowerCase();
}

function getPreviewLimit(deck: DeckExport | null, entry?: ManifestDeckEntry | null): number {
  const raw =
    (deck as any)?.PreviewCards ??
    (deck as any)?.previewCards ??
    (entry as any)?.previewCards ??
    15;

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
}

function buildPreviewDeck(deck: DeckExport, previewLimit: number): DeckExport {
  const cards = deck.Cards ?? [];
  const take = Math.max(0, Math.min(previewLimit, cards.length));
  return {
    ...deck,
    Cards: cards.slice(0, take),
    TotalCards: Math.min(deck.TotalCards ?? cards.length, take),
  };
}

export function DeckScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug;
  const [slug, setSlug] = useState<string | null>(slugFromRoute ?? null);

  const isPremiumUser = usePremiumUser();

  const authInit = useAuthStore((s) => s.init);
  const { status: authStatus, isSignedIn } = useAuthUser();
  const isLoggedIn = isSignedIn;

  const [authModalOpen, setAuthModalOpen] = useState(false);

  // 防止连点重复 navigate
  const startingRef = useRef(false);

  // Ensure auth status is loaded (if app didn’t init auth store elsewhere)
  useFocusEffect(
    useCallback(() => {
      if (authStatus === 'unknown') {
        void authInit();
      }
    }, [authStatus, authInit]),
  );

  // ✅ whenever entering this screen (and logged in), refresh RevenueCat entitlement
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function refreshPremium() {
        if (!isLoggedIn) return;

        try {
          const info = await rcGetCustomerInfoSafe();
          if (cancelled) return;

          const active = isPremiumActive(info);
          setIsPremiumUser(active);
        } catch {
          // ignore
        }
      }

      void refreshPremium();
      return () => {
        cancelled = true;
      };
    }, [isLoggedIn]),
  );

  useFocusEffect(
    useCallback(() => {
      if (slugFromRoute) {
        setSlug(slugFromRoute);
        void setActiveDeckSlug(slugFromRoute);
        return;
      }

      let cancelled = false;
      async function initSlug() {
        const stored = await loadActiveDeckSlug();
        if (cancelled) return;
        if (stored) {
          setSlug(stored);
          return;
        }

        const manifest = await listManifestDecks();
        if (cancelled) return;
        if (manifest[0]?.slug) setSlug(manifest[0].slug);
      }
      void initSlug();

      return () => {
        cancelled = true;
      };
    }, [slugFromRoute]),
  );

  const [state, setState] = useState<DeckState>({
    loading: true,
    deck: null,
    progress: [],
    dailyStats: null,
    error: null,
    manifestEntry: null,
    lockedReason: null,
  });

  const [sessionCount, setSessionCount] = useState(10);
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'new' | 'learning' | 'mastered'>('all');

  const minSession = 5;
  const maxSession = 50;

  function changeSession(delta: number) {
    setSessionCount((prev) => Math.min(maxSession, Math.max(minSession, prev + delta)));
  }
  function setPreset(count: number) {
    setSessionCount(count);
  }

  useFocusEffect(
    useCallback(() => {
      if (!slug) {
        setState({
          loading: false,
          deck: null,
          progress: [],
          dailyStats: null,
          error: 'No deck available. Please install a deck from Settings.',
          manifestEntry: null,
          lockedReason: null,
        });
        return;
      }

      let cancelled = false;

      async function load() {
        const slugStr = slug;
        if (!slugStr) return;

        setState((prev) => ({ ...prev, loading: true, error: null, lockedReason: null }));

        try {
          const manifest = await listManifestDecks();
          const entry = manifest.find((x) => x.slug === slugStr) ?? null;

          if (cancelled) return;

          if (entry && lower(entry.availability) === 'coming') {
            setState({
              loading: false,
              deck: null,
              progress: [],
              dailyStats: null,
              error: null,
              manifestEntry: entry,
              lockedReason: 'coming',
            });
            return;
          }

          // identify premium deck from manifest (tier/downloadMode)
          const premiumByManifest = entry
            ? lower((entry as any).tier) === 'premium' || lower((entry as any).downloadMode) === 'auth'
            : false;

          // not logged in: show login-gated deck UI
          if (premiumByManifest && !isLoggedIn) {
            setState({
              loading: false,
              deck: null,
              progress: [],
              dailyStats: null,
              error: null,
              manifestEntry: entry,
              lockedReason: 'login',
            });
            return;
          }

          // resolve local deck
          let deck = await resolveDeckBySlug(slugStr);
          if (cancelled) return;

          // ✅ DEV: premium 用户优先安装 full deck（private bucket presigned url）
          if (__DEV__ && entry && premiumByManifest && isLoggedIn && isPremiumUser) {
            const fullVersion = (entry as any).version;
            const needFull = !deck || deck.Version !== fullVersion;

            if (needFull) {
              try {
                const r = await fetchPremiumDeckUrl(slugStr);
                if (cancelled) return;

                const ok = await installDeckFromUrl(
                  slugStr,
                  r.url,
                  r.buildId,
                  (entry as any).sha256 ?? null,
                );
                if (cancelled) return;

                if (ok) {
                  deck = await resolveDeckBySlug(slugStr);
                  if (cancelled) return;
                } else {
                  throw new Error('The deck package could not be installed. Please republish the deck or update the app.');
                }
              } catch (e: any) {
                console.warn('[premium] fetch/upgrade full deck failed:', e?.message ?? e);
              }
            }
          }

          // if not installed, try auto-install (only works for public URLs)
          if (!deck) {
            const updates = await checkManifestForUpdates();
            if (cancelled) return;

            const info = (updates as any)[slugStr];
            const canDownload = !!info?.remoteUrl && !!info?.remoteVersion;

            if (canDownload) {
              const ok = await installDeckFromUrl(
                slugStr,
                info.remoteUrl!,
                info.remoteVersion!,
                info.remoteSha256 ?? null,
              );
              if (cancelled) return;

              if (ok) {
                deck = await resolveDeckBySlug(slugStr);
                if (cancelled) return;
              } else {
                throw new Error('The deck package could not be installed. Please republish the deck or update the app.');
              }
            }
          }

          if (!deck) throw new Error('Deck not found');

          void setActiveDeckSlug(deck.Slug);

          const premiumByDeck = deck.DeckType !== 1;
          const isPremiumDeck = premiumByManifest || premiumByDeck;

          // defensive: premium deck but not logged in
          if (isPremiumDeck && !isLoggedIn) {
            setState({
              loading: false,
              deck: null,
              progress: [],
              dailyStats: null,
              error: null,
              manifestEntry: entry,
              lockedReason: 'login',
            });
            return;
          }

          // trial: logged in but not premium
          const isTrial = isPremiumDeck && isLoggedIn && !isPremiumUser;

          if (isTrial) {
            const previewLimit = getPreviewLimit(deck, entry);
            const previewDeck = buildPreviewDeck(deck, previewLimit);

            const progress = await loadDeckProgress(previewDeck);
            if (cancelled) return;

            const dailyStats = await loadOrInitDailyStats(previewDeck, progress);
            if (cancelled) return;

            setState({
              loading: false,
              deck, // full deck for totals
              progress, // preview-only progress
              dailyStats,
              error: null,
              manifestEntry: entry,
              lockedReason: 'trial',
            });
            return;
          }

          // normal (starter or premium user)
          const progress = await loadDeckProgress(deck);
          if (cancelled) return;

          const dailyStats = await loadOrInitDailyStats(deck, progress);
          if (cancelled) return;

          setState({
            loading: false,
            deck,
            progress,
            dailyStats,
            error: null,
            manifestEntry: entry,
            lockedReason: null,
          });
        } catch (e: any) {
          if (cancelled) return;
          setState({
            loading: false,
            deck: null,
            progress: [],
            dailyStats: null,
            error: e?.message ?? 'Failed to load deck.',
            manifestEntry: null,
            lockedReason: null,
          });
        }
      }

      void load();
      return () => {
        cancelled = true;
      };
    }, [slug, isPremiumUser, isLoggedIn]),
  );

  const { loading, deck, progress, dailyStats, error, manifestEntry, lockedReason } = state;

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <Text style={styles.title}>Deck not found</Text>
            <Text style={styles.subtitle}>{error}</Text>
            <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

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
            <Text style={styles.loadingText}>Loading deck...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (lockedReason === 'coming' && manifestEntry) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <Text style={styles.title}>⏳ Coming soon</Text>
            <Text style={styles.subtitle} numberOfLines={3}>
              “{manifestEntry.title ?? manifestEntry.slug}” is not available yet.
              {(manifestEntry as any).eta ? `\nETA: ${(manifestEntry as any).eta}` : ''}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
                { marginTop: 10 },
              ]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // Not logged in: show deck-like screen + Sign In / Sign Up modal
  if (lockedReason === 'login') {
    const title = (manifestEntry as any)?.title ?? (manifestEntry as any)?.slug ?? 'Premium Deck';
    const locale = (manifestEntry as any)?.locale ?? 'en-US';
    const previewCount = getPreviewLimit(null, manifestEntry);

    const totalCardsFull = Number.isFinite((manifestEntry as any)?.totalCards)
      ? Number((manifestEntry as any)?.totalCards)
      : 0;

    const dueToday = 0;
    const learnedCount = 0;
    const newRemaining = previewCount;
    const overallPercent = 0;

    const promptLogin = () => setAuthModalOpen(true);

    // Try common route names; fallback to Paywall
    const navHas = (name: string) => {
      const s = (navigation as any).getState?.();
      if (s?.routeNames?.includes(name)) return true;

      const p1 = (navigation as any).getParent?.();
      const s1 = p1?.getState?.();
      if (s1?.routeNames?.includes(name)) return true;

      const p2 = p1?.getParent?.();
      const s2 = p2?.getState?.();
      if (s2?.routeNames?.includes(name)) return true;

      return false;
    };

    const goSignIn = () => {
      setAuthModalOpen(false);

      if (navHas('SignIn')) return (navigation as any).navigate('SignIn');
      if (navHas('Login')) return (navigation as any).navigate('Login');

      if (navHas('Auth')) return (navigation as any).navigate('Auth', { screen: 'SignIn' });

      (navigation as any).navigate('Paywall');
    };

    const goSignUp = () => {
      setAuthModalOpen(false);

      if (navHas('SignUp')) return (navigation as any).navigate('SignUp');
      if (navHas('Register')) return (navigation as any).navigate('Register');

      if (navHas('Auth')) return (navigation as any).navigate('Auth', { screen: 'SignUp' });

      (navigation as any).navigate('Paywall');
    };

    return (
      <SafeAreaProvider>
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
              <View style={styles.headerRow}>
                <Pressable
                  style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                  onPress={() => navigation.goBack()}
                >
                  <Text style={styles.backText}>← Home</Text>
                </Pressable>

                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {locale} · Premium deck
                  </Text>
                </View>
              </View>

              <View style={styles.updatePill}>
                <Text style={styles.updatePillText}>
                  Sign in to unlock a free trial of the first {previewCount} cards
                  {totalCardsFull ? ` (out of ${totalCardsFull})` : ''}.
                </Text>
              </View>

              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Study overview</Text>

                <View style={styles.heroTopRow}>
                  <Text style={styles.heroTotal}>
                    {learnedCount}/{totalCardsFull || '—'}
                  </Text>
                  <Text style={styles.heroTotalLabel}>learned (preview)</Text>
                </View>

                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { flex: overallPercent, opacity: 0 }]} />
                  <View style={{ flex: 1 }} />
                </View>

                <View style={styles.heroStatsRow}>
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>Due today</Text>
                    <Text style={[styles.heroStatValue, { color: '#EF4444' }]}>{dueToday}</Text>
                  </View>

                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>Trial cards</Text>
                    <Text style={[styles.heroStatValue, { color: '#0EA5E9' }]}>{newRemaining}</Text>
                  </View>

                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>Have learned</Text>
                    <Text style={[styles.heroStatValue, { color: '#22C55E' }]}>{learnedCount}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Cards for this session</Text>
                <Text style={styles.sectionSubTitle}>Sign in to start your free trial.</Text>

                <View style={styles.sessionRow}>
                  <Pressable style={styles.sessionButton} onPress={() => changeSession(-5)}>
                    <Text style={styles.sessionButtonText}>−</Text>
                  </Pressable>

                  <View style={styles.sessionCenter}>
                    <Text style={styles.sessionNumber}>{sessionCount}</Text>
                    <Text style={styles.sessionLabel}>cards</Text>
                  </View>

                  <Pressable style={styles.sessionButton} onPress={() => changeSession(+5)}>
                    <Text style={styles.sessionButtonText}>+</Text>
                  </Pressable>
                </View>

                <View style={styles.sessionPresetRow}>
                  {[5, 10, 15, 20].map((v) => (
                    <Pressable
                      key={v}
                      style={[styles.presetChip, sessionCount === v && styles.presetChipActive]}
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

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Choose a mode</Text>
                <Text style={styles.sectionSubTitle}>Sign in to begin your free trial.</Text>

                <Pressable
                  style={({ pressed }) => [
                    styles.modeCard,
                    styles.modeCardReview,
                    pressed && styles.modeCardPressed,
                    styles.modeCardDisabled,
                  ]}
                  onPress={promptLogin}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modeTitle}>Review Due</Text>
                    <Text style={styles.modeSubtitle}>A review plan appears after you sign in.</Text>
                  </View>
                  <Text style={styles.modeCount}>🔒</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.modeCard,
                    styles.modeCardNew,
                    pressed && styles.modeCardPressed,
                    styles.modeCardDisabled,
                  ]}
                  onPress={promptLogin}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modeTitle}>Learn</Text>
                    <Text style={styles.modeSubtitle}>
                      Sign in to study the first {previewCount} cards for free.
                    </Text>
                  </View>
                  <Text style={styles.modeCount}>🔒</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.modeCard,
                    styles.modeCardMixed,
                    pressed && styles.modeCardPressed,
                    styles.modeCardDisabled,
                  ]}
                  onPress={promptLogin}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modeTitle}>Mixed</Text>
                    <Text style={styles.modeSubtitle}>Sign in to start your trial session.</Text>
                  </View>
                  <Text style={styles.modeCount}>🔒</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.upgradeButton, pressed && { opacity: 0.9 }]}
                  onPress={promptLogin}
                >
                  <Text style={styles.upgradeButtonText}>Start free trial</Text>
                </Pressable>
              </View>
            </ScrollView>

            <Modal
              transparent
              visible={authModalOpen}
              animationType="fade"
              onRequestClose={() => setAuthModalOpen(false)}
            >
              <View style={styles.modalOverlay}>
                <Pressable
                  style={StyleSheet.absoluteFillObject}
                  onPress={() => setAuthModalOpen(false)}
                />
                <View style={styles.modalCard}>
                  <Pressable
                    style={styles.modalClose}
                    onPress={() => setAuthModalOpen(false)}
                    accessibilityLabel="Close"
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </Pressable>

                  <Text style={styles.modalTitle}>Start your free trial</Text>
                  <Text style={styles.modalBody}>
                    Sign in to study the first {previewCount} cards for free.{'\n\n'}
                    After the trial, you can still review these {previewCount} cards forever.{'\n'}
                    Upgrade to Premium to unlock the full deck.
                  </Text>

                  <View style={styles.modalBtnRow}>
                    <Pressable style={styles.modalSecondaryBtn} onPress={goSignIn}>
                      <Text style={styles.modalSecondaryText}>Sign In</Text>
                    </Pressable>

                    <Pressable style={styles.modalPrimaryBtn} onPress={goSignUp}>
                      <Text style={styles.modalPrimaryText}>Sign Up</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          </LinearGradient>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!deck || !dailyStats) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <Text style={styles.title}>Deck not ready</Text>
            <Text style={styles.subtitle}>Please try again.</Text>
            <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const isTrial = lockedReason === 'trial';

  const canStudy = (deck.Cards?.length ?? 0) > 0;
  const totalCardsFull = (deck.TotalCards ?? deck.Cards?.length ?? 0) || 0;

  const previewLimit = isTrial ? getPreviewLimit(deck, manifestEntry) : 0;
  const previewTotal = isTrial
    ? Math.min(previewLimit, totalCardsFull || (deck.Cards?.length ?? 0))
    : 0;

  const now = new Date();
  const dueToday = countDueToday(progress, now);
  const learnedCount = progress.filter(isLearnedProgress).length;

  const newRemaining = isTrial
    ? Math.max(previewTotal - learnedCount, 0)
    : Math.max(totalCardsFull - learnedCount, 0);

  const previewDone = isTrial && previewTotal > 0 && learnedCount >= previewTotal;

  const updatedCount = canStudy
    ? countUpdatedCards(
        isTrial ? (deck.Cards ?? []).slice(0, previewTotal) : (deck.Cards ?? []),
        progress,
      )
    : 0;

  const overallPercent = totalCardsFull > 0 ? clamp01(learnedCount / totalCardsFull) : 0;

  const libraryVm = buildLibraryVM({
    deck,
    progress,
    now,
    isTrial,
    previewTotal,
  });
  const libraryRows = buildLibraryCardRows({
    deck,
    progress,
    now,
    isTrial,
    previewTotal,
  });
  const filteredLibraryRows = libraryRows.filter((row) => inventoryFilter === 'all' || row.status === inventoryFilter);

  const disableReviewDue = !canStudy || dueToday === 0;

  const lockLearn = isTrial && previewDone;
  const lockMixed = isTrial && previewDone;

  const disableLearn = isTrial ? !canStudy : !canStudy || newRemaining === 0;
  const disableMixed = isTrial
    ? !canStudy
    : !canStudy || (dueToday === 0 && newRemaining === 0 && updatedCount === 0);

  async function maybeRefreshPremiumOnce(): Promise<boolean> {
    if (!isLoggedIn) return false;
    try {
      const info = await rcGetCustomerInfoSafe();
      const active = isPremiumActive(info);
      setIsPremiumUser(active);
      return active;
    } catch {
      return isPremiumUser;
    }
  }

  async function startMode(mode: StudyMode) {
    if (startingRef.current) return;
    startingRef.current = true;

    try {
      if (!canStudy) return;

      const d = deck;
      if (!d) return;

      void setActiveDeckSlug(d.Slug);

      const premiumByDeck = d.DeckType !== 1;
      const premiumByManifest = manifestEntry
        ? lower((manifestEntry as any).tier) === 'premium' ||
          lower((manifestEntry as any).downloadMode) === 'auth'
        : false;

      const isPremiumDeck = premiumByDeck || premiumByManifest;

      /**
       * ✅ FIX 核心：
       * Trial 用户点击 Learn/Mixed 不应该立刻跳 Paywall。
       * 先处理 trial 分支，再考虑 premium hard guard。
       */
      if (isTrial) {
        if ((mode === 'learn-new' || mode === 'mixed') && previewDone) {
          showTrialUpsellDialog({
            deckTitle: d.Title,
            previewCount: previewTotal,
            totalCards: totalCardsFull,
            onUpgrade: () => navigation.navigate('Paywall' as any),
          });
          return;
        }

        navigation.navigate(
          'SessionCard',
          {
            slug: d.Slug,
            mode,
            limit: sessionCount,
            previewLimit: previewTotal,
          } as any,
        );
        return;
      }

      /**
       * Premium deck 但本地 store 还没变成 premium：
       * - 先尝试即时 refresh 一次（避免“已买但还被当成非会员”）
       * - 如果刷新后仍不是 premium => 去 Paywall
       */
      if (isPremiumDeck && isLoggedIn && !isPremiumUser) {
        const active = await maybeRefreshPremiumOnce();
        if (!active) {
          navigation.navigate('Paywall' as any);
          return;
        }
        // 如果 refresh 后变成 premium，继续走正常流程
      }

      navigation.navigate('SessionCard', {
        slug: d.Slug,
        mode,
        limit: sessionCount,
      } as any);
    } finally {
      startingRef.current = false;
    }
  }

  return (
    <SafeAreaProvider>
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
              <View style={styles.headerRow}>
                <Pressable
                  style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                  onPress={() => navigation.goBack()}
                >
                  <Text style={styles.backText}>← Home</Text>
                </Pressable>

                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {libraryVm.title}
                  </Text>
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {deck.Locale} · {libraryVm.subtitle}
                  </Text>
                </View>
              </View>

            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Library overview</Text>

              {!canStudy ? (
                <Text style={styles.sectionSubTitle}>
                  This track is not live in the current release yet. Keep moving through the available pools for now, and we will surface it here once it opens.
                </Text>
              ) : (
                <>
                  <View style={styles.heroTopRow}>
                    <Text style={styles.heroTotal}>
                      {learnedCount}/{totalCardsFull}
                    </Text>
                    <Text style={styles.heroTotalLabel}>seen in library</Text>
                  </View>

                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { flex: overallPercent, opacity: overallPercent === 0 ? 0 : 1 },
                      ]}
                    />
                    <View style={{ flex: Math.max(0, 1 - overallPercent) }} />
                  </View>

                  <View style={styles.heroStatsRow}>
                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatLabel}>Due today</Text>
                      <Text style={[styles.heroStatValue, { color: '#EF4444' }]}>{libraryVm.counts.dueTodayCount}</Text>
                    </View>

                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatLabel}>Learning</Text>
                      <Text style={[styles.heroStatValue, { color: '#0EA5E9' }]}>{libraryVm.counts.learningCount}</Text>
                    </View>

                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatLabel}>Mastered</Text>
                      <Text style={[styles.heroStatValue, { color: '#22C55E' }]}>{libraryVm.counts.masteredCount}</Text>
                    </View>
                  </View>

                  <View style={styles.updatePill}>
                    <Text style={styles.updatePillText}>{libraryVm.drawStatusLabel}</Text>
                  </View>

                  {isTrial ? (
                    <View style={styles.updatePill}>
                      <Text style={styles.updatePillText}>
                        {previewDone
                          ? `Free trial completed: ${previewTotal}/${totalCardsFull}. Upgrade to unlock the rest.`
                          : `Free trial: first ${previewTotal} cards. Learned ${learnedCount}/${previewTotal}.`}
                      </Text>
                    </View>
                  ) : null}

                  {!isTrial && libraryVm.counts.updatedCount > 0 ? (
                    <View style={styles.updatePill}>
                      <Text style={styles.updatePillText}>
                        ✨ {libraryVm.counts.updatedCount} card{libraryVm.counts.updatedCount === 1 ? '' : 's'} updated since you last reviewed.
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Library status</Text>
              <Text style={styles.sectionSubTitle}>This is your secondary workspace: browse owned cards here after your main daily run, not before it.</Text>

              <View style={styles.libraryStatusRow}>
                <View style={[styles.libraryStatusCard, styles.libraryStatusCardNew]}>
                  <Text style={styles.libraryStatusValue}>{libraryVm.counts.newCount}</Text>
                  <Text style={styles.libraryStatusLabel}>New</Text>
                </View>
                <View style={[styles.libraryStatusCard, styles.libraryStatusCardLearning]}>
                  <Text style={styles.libraryStatusValue}>{libraryVm.counts.learningCount}</Text>
                  <Text style={styles.libraryStatusLabel}>Learning</Text>
                </View>
                <View style={[styles.libraryStatusCard, styles.libraryStatusCardMastered]}>
                  <Text style={styles.libraryStatusValue}>{libraryVm.counts.masteredCount}</Text>
                  <Text style={styles.libraryStatusLabel}>Mastered</Text>
                </View>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Owned cards</Text>
              <Text style={styles.sectionSubTitle}>Filter the inventory without changing today’s due-review priority.</Text>

              <View style={styles.inventoryFilterRow}>
                {([
                  { key: 'all', label: 'All' },
                  { key: 'new', label: 'New' },
                  { key: 'learning', label: 'Learning' },
                  { key: 'mastered', label: 'Mastered' },
                ] as const).map((item) => {
                  const active = inventoryFilter === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      style={[styles.inventoryFilterChip, active && styles.inventoryFilterChipActive]}
                      onPress={() => setInventoryFilter(item.key)}
                    >
                      <Text style={[styles.inventoryFilterText, active && styles.inventoryFilterTextActive]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {filteredLibraryRows.length === 0 ? (
                <Text style={styles.sectionSubTitle}>No cards in this slice yet.</Text>
              ) : (
                filteredLibraryRows.map((row) => (
                  <View key={row.stableUid} style={styles.libraryRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.libraryRowQuestion} numberOfLines={2}>{row.question}</Text>
                      <Text style={styles.libraryRowMeta}>#{row.orderInDeck} · {row.statusLabel} · Difficulty {row.difficulty}{row.isDueToday ? ' · Due today' : ''}{row.isUpdated ? ' · Updated' : ''}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={[styles.sectionCard, styles.sessionSetupCard]}>
              <Text style={styles.sectionTitleSecondary}>Quick session setup</Text>
              <Text style={styles.sectionSubTitle}>
                Optional launch controls if you want to open this deck directly. Your main daily run still starts from Home.
              </Text>

              <View style={styles.sessionRow}>
                <Pressable style={styles.sessionButton} onPress={() => changeSession(-5)}>
                  <Text style={styles.sessionButtonText}>−</Text>
                </Pressable>

                <View style={styles.sessionCenter}>
                  <Text style={styles.sessionNumber}>{sessionCount}</Text>
                  <Text style={styles.sessionLabel}>cards</Text>
                </View>

                <Pressable style={styles.sessionButton} onPress={() => changeSession(+5)}>
                  <Text style={styles.sessionButtonText}>+</Text>
                </Pressable>
              </View>

              <View style={styles.sessionPresetRow}>
                {[5, 10, 15, 30].map((v) => (
                  <Pressable
                    key={v}
                    style={[styles.presetChip, sessionCount === v && styles.presetChipActive]}
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

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Choose a mode</Text>
              <Text style={styles.sectionSubTitle}>Quick pick based on what you want to achieve today.</Text>

              <Pressable
                style={({ pressed }) => [
                  styles.modeCard,
                  styles.modeCardReview,
                  pressed && styles.modeCardPressed,
                  disableReviewDue && styles.modeCardDisabled,
                ]}
                disabled={disableReviewDue}
                onPress={() => void startMode('review-due')}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeTitle}>Review Due</Text>
                  <Text style={styles.modeSubtitle}>Clear today&apos;s reviews first.</Text>
                </View>
                <Text style={styles.modeCount}>{dueToday} due</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modeCard,
                  styles.modeCardNew,
                  pressed && styles.modeCardPressed,
                  (disableLearn || lockLearn) && styles.modeCardDisabled,
                ]}
                disabled={disableLearn}
                onPress={() => void startMode('learn-new')}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeTitle}>Learn</Text>
                  <Text style={styles.modeSubtitle}>
                    {lockLearn ? 'Locked — Upgrade to continue.' : 'Add new concepts for today.'}
                  </Text>
                </View>
                <Text style={styles.modeCount}>{lockLearn ? '🔒' : `${newRemaining} new`}</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modeCard,
                  styles.modeCardMixed,
                  pressed && styles.modeCardPressed,
                  (disableMixed || lockMixed) && styles.modeCardDisabled,
                ]}
                disabled={disableMixed}
                onPress={() => void startMode('mixed')}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeTitle}>Mixed</Text>
                  <Text style={styles.modeSubtitle}>
                    {lockMixed ? 'Locked — Upgrade to continue.' : 'Balanced run (due + updated + a few new).'}
                  </Text>
                </View>
                <Text style={styles.modeCount}>{lockMixed ? '🔒' : `up to ${sessionCount}`}</Text>
              </Pressable>

              <View style={styles.tipBox}>
                <Text style={styles.tipTitle}>Tip</Text>
                <Text style={styles.tipBody}>
                  Review due cards first, then learn new ones. This keeps the calendar manageable.
                </Text>
              </View>

              {isTrial ? (
                <Pressable
                  style={({ pressed }) => [styles.upgradeButton, pressed && { opacity: 0.9 }]}
                  onPress={() => navigation.navigate('Paywall' as any)}
                >
                  <Text style={styles.upgradeButtonText}>Unlock Premium</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default DeckScreen;

const CARD_BG = 'rgba(255,255,255,0.18)';
const CARD_BORDER = 'rgba(255,255,255,0.55)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 24 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  loadingText: { marginTop: 10, color: '#6B7280' },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 16 },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.7)',
    marginRight: 10,
  },
  backButtonPressed: { opacity: 0.9 },
  backText: { fontSize: 13, color: '#111827' },

  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  subtitle: { marginTop: 2, fontSize: 12, color: '#6B7280' },

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
  heroLabel: { fontSize: 12, color: '#4338CA', fontWeight: '600', marginBottom: 6 },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6 },
  heroTotal: { fontSize: 28, fontWeight: '700', color: '#111827', marginRight: 6 },
  heroTotalLabel: { fontSize: 12, color: '#6B7280' },

  progressBarBg: {
    marginTop: 4,
    marginBottom: 10,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: { backgroundColor: '#6366F1', borderRadius: 999 },

  heroStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatLabel: { fontSize: 11, color: '#6B7280' },
  heroStatValue: { marginTop: 4, fontSize: 18, fontWeight: '700' },
  libraryStatusRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  libraryStatusCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(17,24,39,0.04)',
    alignItems: 'center',
  },
  libraryStatusCardNew: { backgroundColor: 'rgba(14,165,233,0.08)' },
  libraryStatusCardLearning: { backgroundColor: 'rgba(79,70,229,0.08)' },
  libraryStatusCardMastered: { backgroundColor: 'rgba(34,197,94,0.10)' },
  libraryStatusValue: { fontSize: 22, fontWeight: '800', color: '#111827' },
  libraryStatusLabel: { marginTop: 4, fontSize: 11, fontWeight: '700', color: '#6B7280' },
  inventoryFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  inventoryFilterChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(17,24,39,0.04)',
  },
  inventoryFilterChipActive: { backgroundColor: 'rgba(79,70,229,0.12)' },
  inventoryFilterText: { fontSize: 12, fontWeight: '700', color: '#111827' },
  inventoryFilterTextActive: { color: '#4F46E5' },
  libraryRow: {
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17,24,39,0.03)',
  },
  libraryRowQuestion: { fontSize: 13, fontWeight: '700', color: '#111827' },
  libraryRowMeta: { marginTop: 4, fontSize: 11, color: '#6B7280' },
 
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
  sessionSetupCard: {
    backgroundColor: 'rgba(255,255,255,0.74)',
    shadowOpacity: 0.04,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  sectionTitleSecondary: { fontSize: 13, fontWeight: '700', color: '#4B5563' },
  sectionSubTitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },

  sessionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
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
  sessionButtonText: { fontSize: 22, color: '#111827', fontWeight: '600' },
  sessionCenter: { flex: 1, alignItems: 'center' },
  sessionNumber: { fontSize: 30, fontWeight: '700', color: '#4F46E5' },
  sessionLabel: { fontSize: 12, color: '#6B7280' },

  sessionPresetRow: { flexDirection: 'row', marginTop: 10, justifyContent: 'space-between' },
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
  presetChipActive: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  presetChipText: { fontSize: 13, color: '#111827' },
  presetChipTextActive: { color: '#FFFFFF', fontWeight: '600' },

  modeCard: {
    marginTop: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  modeCardReview: { backgroundColor: '#FEE2E2' },
  modeCardNew: { backgroundColor: '#DBEAFE' },
  modeCardMixed: { backgroundColor: '#E0E7FF' },
  modeCardPressed: { opacity: 0.9 },
  modeCardDisabled: { opacity: 0.55 },

  modeTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  modeSubtitle: { marginTop: 2, fontSize: 12, color: '#4B5563', maxWidth: 220 },
  modeCount: { fontSize: 13, color: '#111827', fontWeight: '500' },

  tipBox: { marginTop: 12, borderRadius: 14, backgroundColor: '#F5F3FF', padding: 10 },
  tipTitle: { fontSize: 13, fontWeight: '600', color: '#4F46E5', marginBottom: 4 },
  tipBody: { fontSize: 12, color: '#4B5563' },

  updatePill: {
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(79,70,229,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.18)',
  },
  updatePillText: { fontSize: 12, color: '#4F46E5', fontWeight: '600' },

  upgradeButton: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  upgradeButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    width: '100%',
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  modalClose: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(17,24,39,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: { fontSize: 16, fontWeight: '900', color: '#111827' },

  modalTitle: { fontSize: 16, fontWeight: '800', color: '#111827', paddingLeft: 40 },
  modalBody: { marginTop: 8, fontSize: 12, color: '#4B5563', lineHeight: 18 },

  modalBtnRow: { flexDirection: 'row', marginTop: 14 },
  modalSecondaryBtn: {
    flex: 1,
    marginRight: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
  },
  modalSecondaryText: { fontSize: 13, fontWeight: '800', color: '#111827' },

  modalPrimaryBtn: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalPrimaryText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
});
