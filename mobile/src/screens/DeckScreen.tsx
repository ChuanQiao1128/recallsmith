// mobile/src/screens/DeckScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList, StudyMode } from '../navigation/types';

import type { DeckExport } from '../types/deckExport';
import { setActiveDeckSlug, loadActiveDeckSlug } from '../content/activeDeck';

// ✅ Step 4: async resolver (prefer downloaded deck)
import { resolveDeckBySlug, listManifestDecks } from '../content/deckRepository';

import type { CardProgress } from '../review/model';
import { formatDateKey } from '../review/model';
import { loadDeckProgress, loadOrInitDailyStats, type DailyStats } from '../review/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Deck'>;

interface DeckState {
  loading: boolean;
  deck: DeckExport | null;
  progress: CardProgress[];
  dailyStats: DailyStats | null;
  error: string | null;
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

// ✅ Phase 3: detect “updated” cards (card.Revision > progress.lastSeenRevision)
// Fallbacks keep old decks/progress safe.
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
  const pMap = new Map(progress.map(p => [p.stableUid, p]));
  let count = 0;

  for (const card of cards) {
    const p = pMap.get(card?.StableUid);
    if (!p) continue;
    if (!isLearned(p)) continue; // 只有学过的才可能“更新”
    if (getCardRevision(card) > getSeenRevision(p)) count += 1;
  }

  return count;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function DeckScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug;
  const [slug, setSlug] = useState<string | null>(slugFromRoute ?? null);

  // 初始化 slug：优先 route，其次上次活跃 deck，再退到 manifest 首项
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
  });

  const [sessionCount, setSessionCount] = useState(20);

  useFocusEffect(
    useCallback(() => {
      if (!slug) {
        setState({
          loading: false,
          deck: null,
          progress: [],
          dailyStats: null,
          error: 'No deck available. Please install a deck from Settings.',
        });
        return;
      }

      let cancelled = false;

      async function load() {
        setState(prev => ({ ...prev, loading: true, error: null }));

        try {
          // ✅ Step 4: 先 resolve deck（本地下载版优先）
          const deck = await resolveDeckBySlug(slug!);
          if (!deck) throw new Error('Deck not found');
          if (cancelled) return;

          // 进入本页后，把它设为 active（保证 Review/Home 等同步）
          void setActiveDeckSlug(deck.Slug);

          const progress = await loadDeckProgress(deck);
          if (cancelled) return;

          const dailyStats = await loadOrInitDailyStats(deck, progress);
          if (cancelled) return;

          setState({ loading: false, deck, progress, dailyStats, error: null });
        } catch (e: any) {
          if (cancelled) return;
          setState({
            loading: false,
            deck: null,
            progress: [],
            dailyStats: null,
            error: e?.message ?? 'Failed to load deck.',
          });
        }
      }

      void load();
      return () => {
        cancelled = true;
      };
    }, [slug]),
  );

  const { loading, deck, progress, dailyStats, error } = state;

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

  if (loading || !dailyStats || !deck) {
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

  const canStudy = (deck.Cards?.length ?? 0) > 0;
  const totalCards = (deck.TotalCards ?? deck.Cards?.length ?? 0) || 0;

  const now = new Date();

  // ✅ Due = 只统计已学过且安排在“今天桶”的卡
  const dueToday = countDueToday(progress, now);

  // ✅ New = 没学过的数量
  const learnedCount = progress.filter(isLearned).length;
  const newRemaining = Math.max(totalCards - learnedCount, 0);

  const updatedCount = canStudy ? countUpdatedCards(deck.Cards ?? [], progress) : 0;

  const overallPercent = totalCards > 0 ? clamp01(learnedCount / totalCards) : 0;

  const minSession = 5;
  const maxSession = 50;

  function changeSession(delta: number) {
    setSessionCount(prev => Math.min(maxSession, Math.max(minSession, prev + delta)));
  }
  function setPreset(count: number) {
    setSessionCount(count);
  }

  function startMode(mode: StudyMode) {
    if (!canStudy || !deck) return;

    // ✅ 确保 Review 用同一个 deck
    void setActiveDeckSlug(deck.Slug);

    navigation.navigate('Review', {
      slug: deck.Slug,
      mode,
      limit: sessionCount,
    });
  }

  const deckTypeLabel = deck.DeckType === 1 ? 'Starter deck' : 'Premium deck';

  const disableReviewDue = !canStudy || dueToday === 0;
  const disableLearn = !canStudy || newRemaining === 0;

  // ✅ mixed：允许 “updated cards” 也能开跑（ReviewScreen 里 mixed 会包含 updated）
  const disableMixed = !canStudy || (dueToday === 0 && newRemaining === 0 && updatedCount === 0);

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
          {/* 顶部 header */}
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={() => navigation.goBack()}
            >
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

          {/* 玻璃进度卡片（Due / New / Learned） */}
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Study overview</Text>

            {!canStudy ? (
              <Text style={styles.sectionSubTitle}>
                This deck is a placeholder in this build. Content will be available later.
              </Text>
            ) : (
              <>
                <View style={styles.heroTopRow}>
                  <Text style={styles.heroTotal}>
                    {learnedCount}/{totalCards}
                  </Text>
                  <Text style={styles.heroTotalLabel}>learned (approx)</Text>
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

                {updatedCount > 0 ? (
                  <View style={styles.updatePill}>
                    <Text style={styles.updatePillText}>
                      ✨ {updatedCount} card{updatedCount === 1 ? '' : 's'} updated since you last reviewed.
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>

          {/* 本次学习张数 */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Cards for this session</Text>
            <Text style={styles.sectionSubTitle}>
              Start small and keep consistency. 20–30 cards per run is a good default.
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
              {[10, 20, 30, 50].map(v => (
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

          {/* 模式选择 */}
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
                disableLearn && styles.modeCardDisabled,
              ]}
              disabled={disableLearn}
              onPress={() => startMode('learn-new')}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>Learn</Text>
                <Text style={styles.modeSubtitle}>Add new concepts for today.</Text>
              </View>
              <Text style={styles.modeCount}>{newRemaining} new</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.modeCard,
                styles.modeCardMixed,
                pressed && styles.modeCardPressed,
                disableMixed && styles.modeCardDisabled,
              ]}
              disabled={disableMixed}
              onPress={() => startMode('mixed')}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.modeTitle}>Mixed</Text>
                <Text style={styles.modeSubtitle}>Balanced run (due + updated + a few new).</Text>
              </View>
              <Text style={styles.modeCount}>up to {sessionCount}</Text>
            </Pressable>

            <View style={styles.tipBox}>
              <Text style={styles.tipTitle}>Tip</Text>
              <Text style={styles.tipBody}>
                Review due cards first, then learn new ones. This keeps the calendar manageable.
              </Text>
            </View>
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 10, color: '#6B7280' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
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
});
