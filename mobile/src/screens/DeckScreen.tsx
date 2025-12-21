// mobile/src/screens/DeckScreen.tsx
import React, { useState, useCallback } from 'react';
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
import { formatDateKey } from '../review/model';
import { loadDeckProgress, loadOrInitDailyStats, type DailyStats } from '../review/storage';

// premium entitlement
import { usePremiumUser } from '../premium/premiumStore';

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

function startOfToday(now: Date) {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function isLearned(p: CardProgress): boolean {
  return typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0;
}

function isScheduled(p: CardProgress): boolean {
  return isLearned(p) && typeof p.nextReviewAt === 'number' && p.nextReviewAt > 0;
}

function countDueToday(progress: CardProgress[], now: Date): number {
  const today0 = startOfToday(now);
  const todayKey = formatDateKey(today0);
  let count = 0;

  for (const p of progress) {
    if (!isScheduled(p)) continue;

    const next = new Date(p.nextReviewAt);
    const effective = next.getTime() < today0.getTime() ? today0 : next;
    if (formatDateKey(effective) === todayKey) count += 1;
  }

  return count;
}

function getCardRevision(card: any): number {
  const r = card?.Revision;
  return typeof r === 'number' && r > 0 ? r : 1;
}

function getSeenRevision(p: CardProgress): number {
  const seen = (p as any).lastSeenRevision;
  if (typeof seen === 'number') return seen;
  return isLearned(p) ? 1 : 0;
}

function countUpdatedCards(cards: any[], progress: CardProgress[]): number {
  const pMap = new Map(progress.map((p) => [p.stableUid, p]));
  let count = 0;

  for (const card of cards) {
    const p = pMap.get(card?.StableUid);
    if (!p) continue;
    if (!isLearned(p)) continue;
    if (getCardRevision(card) > getSeenRevision(p)) count += 1;
  }

  return count;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
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

  // Ensure auth status is loaded (if app didn’t init auth store elsewhere)
  useFocusEffect(
    useCallback(() => {
      if (authStatus === 'unknown') {
        void authInit();
      }
    }, [authStatus, authInit]),
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

          // coming soon
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
            ? lower(entry.tier) === 'premium' || lower(entry.downloadMode) === 'auth'
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

          // resolve local deck (preview URL / signed URL flow to be added later)
          let deck = await resolveDeckBySlug(slugStr);
          if (cancelled) return;
          // ✅ DEV: premium 用户优先安装 full deck（private bucket presigned url）
          if (__DEV__ && entry && premiumByManifest && isLoggedIn && isPremiumUser) {
          const fullVersion = entry.version; // manifest full version（比如 1766273311935）
          const needFull = !deck || deck.Version !== fullVersion;

          if (needFull) {
            try {
              const r = await fetchPremiumDeckUrl(slugStr);
              if (cancelled) return;

              const ok = await installDeckFromUrl(
                slugStr,
                r.url,
                r.buildId,          // ✅ 用后端返回的 buildId 当 remoteVersion
                entry.sha256 ?? null
              );
              if (cancelled) return;

              if (ok) {
                deck = await resolveDeckBySlug(slugStr);
                if (cancelled) return;
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

            const info = updates[slugStr];
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
    }, [slug, isPremiumUser, isLoggedIn, isPremiumUser]),
  );

  const { loading, deck, progress, dailyStats, error, manifestEntry, lockedReason } = state;

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
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
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
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
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          <View style={styles.center}>
            <Text style={styles.title}>⏳ Coming soon</Text>
            <Text style={styles.subtitle} numberOfLines={3}>
              “{manifestEntry.title ?? manifestEntry.slug}” is not available yet.
              {manifestEntry.eta ? `\nETA: ${manifestEntry.eta}` : ''}
            </Text>

            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed, { marginTop: 10 }]}
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
    const title = manifestEntry?.title ?? manifestEntry?.slug ?? 'Premium Deck';
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
          <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
                      <Text style={[styles.presetChipText, sessionCount === v && styles.presetChipTextActive]}>
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
                    <Text style={styles.modeSubtitle}>Sign in to study the first {previewCount} cards for free.</Text>
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

                <Pressable style={({ pressed }) => [styles.upgradeButton, pressed && { opacity: 0.9 }]} onPress={promptLogin}>
                  <Text style={styles.upgradeButtonText}>Start free trial</Text>
                </Pressable>
              </View>
            </ScrollView>

            <Modal transparent visible={authModalOpen} animationType="fade" onRequestClose={() => setAuthModalOpen(false)}>
              <View style={styles.modalOverlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setAuthModalOpen(false)} />
                <View style={styles.modalCard}>
                  <Pressable style={styles.modalClose} onPress={() => setAuthModalOpen(false)} accessibilityLabel="Close">
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
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
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
  const previewTotal = isTrial ? Math.min(previewLimit, totalCardsFull || (deck.Cards?.length ?? 0)) : 0;

  const now = new Date();
  const dueToday = countDueToday(progress, now);
  const learnedCount = progress.filter(isLearned).length;

  const newRemaining = isTrial ? Math.max(previewTotal - learnedCount, 0) : Math.max(totalCardsFull - learnedCount, 0);
  const previewDone = isTrial && previewTotal > 0 && learnedCount >= previewTotal;

  const updatedCount = canStudy
    ? countUpdatedCards(isTrial ? (deck.Cards ?? []).slice(0, previewTotal) : (deck.Cards ?? []), progress)
    : 0;

  const overallPercent = totalCardsFull > 0 ? clamp01(learnedCount / totalCardsFull) : 0;

  const deckTypeLabel = deck.DeckType === 1 ? 'Starter deck' : isTrial ? 'Premium deck · Free trial' : 'Premium deck';

  const disableReviewDue = !canStudy || dueToday === 0;

  const lockLearn = isTrial && previewDone;
  const lockMixed = isTrial && previewDone;

  const disableLearn = isTrial ? !canStudy : (!canStudy || newRemaining === 0);
  const disableMixed = isTrial ? !canStudy : (!canStudy || (dueToday === 0 && newRemaining === 0 && updatedCount === 0));

  function startMode(mode: StudyMode) {
    if (!canStudy) return;

    const d = deck;
    if (!d) return;

    void setActiveDeckSlug(d.Slug);

    if (isTrial) {
      if ((mode === 'learn-new' || mode === 'mixed') && previewDone) {
        showTrialUpsellDialog({
          deckTitle: d.Title,
          previewCount: previewTotal,
          totalCards: totalCardsFull,
          onUpgrade: () => navigation.navigate('Paywall'),
        });
        return;
      }

      navigation.navigate(
        'Review',
        {
          slug: d.Slug,
          mode,
          limit: sessionCount,
          previewLimit: previewTotal,
        } as any,
      );
      return;
    }

    navigation.navigate('Review', {
      slug: d.Slug,
      mode,
      limit: sessionCount,
    });
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]} onPress={() => navigation.goBack()}>
                <Text style={styles.backText}>← Home</Text>
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {deck.Title}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {deck.Locale} · {deckTypeLabel}
                </Text>
              </View>
            </View>

            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Study overview</Text>

              {!canStudy ? (
                <Text style={styles.sectionSubTitle}>This deck is a placeholder in this build. Content will be available later.</Text>
              ) : (
                <>
                  <View style={styles.heroTopRow}>
                    <Text style={styles.heroTotal}>
                      {learnedCount}/{totalCardsFull}
                    </Text>
                    <Text style={styles.heroTotalLabel}>learned (approx)</Text>
                  </View>

                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { flex: overallPercent, opacity: overallPercent === 0 ? 0 : 1 }]} />
                    <View style={{ flex: Math.max(0, 1 - overallPercent) }} />
                  </View>

                  <View style={styles.heroStatsRow}>
                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatLabel}>Due today</Text>
                      <Text style={[styles.heroStatValue, { color: '#EF4444' }]}>{dueToday}</Text>
                    </View>

                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatLabel}>New cards</Text>
                      <Text style={[styles.heroStatValue, { color: '#0EA5E9' }]}>{newRemaining}</Text>
                    </View>

                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatLabel}>Have learned</Text>
                      <Text style={[styles.heroStatValue, { color: '#22C55E' }]}>{learnedCount}</Text>
                    </View>
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

                  {!isTrial && updatedCount > 0 ? (
                    <View style={styles.updatePill}>
                      <Text style={styles.updatePillText}>
                        ✨ {updatedCount} card{updatedCount === 1 ? '' : 's'} updated since you last reviewed.
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Cards for this session</Text>
              <Text style={styles.sectionSubTitle}>Start small and keep consistency. 5–15 cards per run is a good default.</Text>

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
                  <Pressable key={v} style={[styles.presetChip, sessionCount === v && styles.presetChipActive]} onPress={() => setPreset(v)}>
                    <Text style={[styles.presetChipText, sessionCount === v && styles.presetChipTextActive]}>{v}</Text>
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
                onPress={() => startMode('review-due')}
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
                onPress={() => startMode('learn-new')}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeTitle}>Learn</Text>
                  <Text style={styles.modeSubtitle}>{lockLearn ? 'Locked — Upgrade to continue.' : 'Add new concepts for today.'}</Text>
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
                onPress={() => startMode('mixed')}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeTitle}>Mixed</Text>
                  <Text style={styles.modeSubtitle}>{lockMixed ? 'Locked — Upgrade to continue.' : 'Balanced run (due + updated + a few new).'}</Text>
                </View>
                <Text style={styles.modeCount}>{lockMixed ? '🔒' : `up to ${sessionCount}`}</Text>
              </Pressable>

              <View style={styles.tipBox}>
                <Text style={styles.tipTitle}>Tip</Text>
                <Text style={styles.tipBody}>Review due cards first, then learn new ones. This keeps the calendar manageable.</Text>
              </View>

              {isTrial ? (
                <Pressable style={({ pressed }) => [styles.upgradeButton, pressed && { opacity: 0.9 }]} onPress={() => navigation.navigate('Paywall')}>
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

  heroStatsRow: { flexDirection: 'row', marginTop: 4 },
  heroStat: { flex: 1 },
  heroStatLabel: { fontSize: 11, color: '#9CA3AF' },
  heroStatValue: { marginTop: 2, fontSize: 16, fontWeight: '600' },

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
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
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