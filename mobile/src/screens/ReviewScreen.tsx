// mobile/src/screens/ReviewScreen.tsx
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import CodeBlock from '../components/CodeBlock'; // 路径按你放的位置改

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import type { DeckExport, CardExport } from '../types/deckExport';

// ✅ Step 4: async resolver (prefer downloaded deck)
import { resolveDeckBySlug, listManifestDecks } from '../content/deckRepository';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';

import type { CardProgress, ReviewRating } from '../review/model';
import { scheduleNextReview, formatDateKey } from '../review/model';

import {
  loadDeckProgress,
  saveDeckProgress,
  loadOrInitDailyStats,
  type DailyStats,
} from '../review/storage';

import { syncDailyReminders } from '../notifications/reminders';

type Props = NativeStackScreenProps<RootStackParamList, 'Review'>;
type UiRating = ReviewRating;

interface CurrentCard {
  card: CardExport;
  progress: CardProgress;
}

function buildCardMap(deck: DeckExport): Map<string, CardExport> {
  const map = new Map<string, CardExport>();
  for (const c of deck.Cards) map.set(c.StableUid, c);
  return map;
}

function sortCards(deck: DeckExport): CardExport[] {
  return [...deck.Cards].sort((a, b) => a.OrderInDeck - b.OrderInDeck);
}

function startOfToday(now: Date) {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function isLearned(p: CardProgress): boolean {
  return typeof p.lastReviewedAt === 'number' && p.lastReviewedAt > 0;
}

function isNewCard(p: CardProgress): boolean {
  return !isLearned(p);
}

function isScheduled(p: CardProgress): boolean {
  return isLearned(p) && typeof p.nextReviewAt === 'number' && p.nextReviewAt > 0;
}

/**
 * Due-today bucket (overdue -> today). IMPORTANT: only learned cards.
 * This matches Home/Deck "Due today".
 */
function isDueTodayBucket(p: CardProgress, now: Date): boolean {
  if (!isScheduled(p)) return false;

  const today0 = startOfToday(now);
  const todayKey = formatDateKey(today0);

  const next = new Date(p.nextReviewAt);
  const effective = next.getTime() < today0.getTime() ? today0 : next;

  return formatDateKey(effective) === todayKey;
}

function countDueToday(progress: CardProgress[], now: Date): number {
  let c = 0;
  for (const p of progress) {
    if (isDueTodayBucket(p, now)) c += 1;
  }
  return c;
}

// ✅ Phase 3 helpers: updated card detection (Revision > lastSeenRevision)
function getCardRevision(card: any): number {
  const r = card?.Revision;
  return typeof r === 'number' && r > 0 ? r : 1;
}

function getSeenRevision(p: CardProgress): number {
  const seen = (p as any).lastSeenRevision;
  if (typeof seen === 'number') return seen;
  return isLearned(p) ? 1 : 0;
}

function isUpdatedCard(card: any, p: CardProgress): boolean {
  if (!isLearned(p)) return false;
  return getCardRevision(card) > getSeenRevision(p);
}

function pickNextCard(
  deck: DeckExport,
  progress: CardProgress[],
  now: Date,
  mode: 'review-due' | 'learn-new' | 'mixed',
  avoidUid?: string | null,
): CurrentCard | null {
  const cardMap = buildCardMap(deck);
  const cards = sortCards(deck);
  const pMap = new Map(progress.map(p => [p.stableUid, p]));

  const pickWith = (predicate: (card: CardExport, p: CardProgress) => boolean) => {
    // pass 1: avoid immediate repeat
    for (const card of cards) {
      if (avoidUid && card.StableUid === avoidUid) continue;
      const p = pMap.get(card.StableUid);
      if (!p) continue;
      if (predicate(card, p)) return { card: cardMap.get(card.StableUid)!, progress: p };
    }

    // pass 2: allow repeat if nothing else
    if (avoidUid) {
      for (const card of cards) {
        const p = pMap.get(card.StableUid);
        if (!p) continue;
        if (predicate(card, p)) return { card: cardMap.get(card.StableUid)!, progress: p };
      }
    }

    return null;
  };

  const pickDue = () => pickWith((_card, p) => isDueTodayBucket(p, now));
  const pickUpdated = () => pickWith((card, p) => isUpdatedCard(card, p));
  const pickNew = () => pickWith((_card, p) => isNewCard(p));

  if (mode === 'review-due') return pickDue();
  if (mode === 'learn-new') return pickNew();

  // ✅ mixed: due first, then updated, then new
  return pickDue() ?? pickUpdated() ?? pickNew();
}

function modeLabel(mode: string) {
  if (mode === 'review-due') return 'Review Due';
  if (mode === 'learn-new') return 'Learn';
  return 'Mixed';
}

function normalizeCodeLanguage(lang?: string | null): string {
  const l = (lang ?? '').trim().toLowerCase();
  if (!l) return 'text';

  // common aliases
  if (l === 'ts') return 'typescript';
  if (l === 'tsx') return 'tsx';
  if (l === 'js') return 'javascript';
  if (l === 'jsx') return 'jsx';
  if (l === 'py') return 'python';
  if (l === 'rb') return 'ruby';
  if (l === 'sh' || l === 'shell') return 'bash';
  if (l === 'yml') return 'yaml';
  if (l === 'c++') return 'cpp';
  if (l === 'c#' || l === 'cs' || l === 'csharp') return 'csharp';

  return l;
}

/** tiny markdown-ish renderer: supports "- " bullets and paragraphs */
function renderSimpleMarkdown(text: string, stylesObj: any) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, idx) => {
    const raw = line.trimEnd();
    if (raw.trim().length === 0) {
      nodes.push(<View key={`sp-${idx}`} style={{ height: 8 }} />);
      return;
    }

    const bullet = raw.startsWith('- ') || raw.startsWith('* ') ? raw.slice(2).trim() : null;

    if (bullet !== null) {
      nodes.push(
        <View key={`b-${idx}`} style={stylesObj.mdBulletRow}>
          <Text style={stylesObj.mdBullet}>•</Text>
          <Text style={stylesObj.mdText}>{bullet}</Text>
        </View>,
      );
      return;
    }

    nodes.push(
      <Text key={`p-${idx}`} style={stylesObj.mdText}>
        {raw}
      </Text>,
    );
  });

  return nodes;
}

export function ReviewScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug ?? null;
  const { mode = 'mixed', limit = 20 } = route.params ?? {};

  const [slug, setSlug] = useState<string | null>(slugFromRoute);
  const [deck, setDeck] = useState<DeckExport | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [current, setCurrent] = useState<CurrentCard | null>(null);

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

  // flip state
  const [showBack, setShowBack] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current; // 0 front, 180 back

  const [reviewing, setReviewing] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);
  const sessionLimit = limit;

  // avoid immediate repeat (especially for "again")
  const avoidUidRef = useRef<string | null>(null);

  const { height: winH } = useWindowDimensions();
  const flipHeight = useMemo(() => {
    // 预估头部（header + sessionCard + 上下间距）占掉的高度
    const reserved = 280;

    // 可用高度 = 整个窗口高度 - 头部
    const usable = winH - reserved;

    // 在一个合理范围里取值，避免太小或太夸张
    return Math.max(350, Math.min(usable, winH - 50));
  }, [winH]);

  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  // Extra safety on Android: swap opacity around 90deg
  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 89.9, 90, 180],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 89.9, 90, 180],
    outputRange: [0, 0, 1, 1],
  });

  function animateFlip(toBack: boolean) {
    Animated.spring(flipAnim, {
      toValue: toBack ? 180 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 90,
    }).start();
  }

  useEffect(() => {
    animateFlip(showBack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBack]);

  function resetToFront() {
    setShowBack(false);
    flipAnim.stopAnimation();
    flipAnim.setValue(0);
  }

  useFocusEffect(
    useCallback(() => {
      if (!slug) {
        setLoading(false);
        setLoadError('No deck available. Please install a deck from Settings.');
        setDeck(null);
        setProgress([]);
        setDailyStats(null);
        setCurrent(null);
        return;
      }

      let cancelled = false;

      async function load() {
        setLoading(true);
        setLoadError(null);
        resetToFront();
        setSessionDone(0);
        avoidUidRef.current = null;

        const now = new Date();

        try {
          // ✅ Step 4: resolve deck（本地下载版优先）
          if (!slug) throw new Error('No deck selected');
          const resolved = await resolveDeckBySlug(slug);
          if (!resolved) throw new Error('Deck not found');
          if (cancelled) return;

          setDeck(resolved);
          void setActiveDeckSlug(resolved.Slug); // ✅ 同步 active slug

          const p = await loadDeckProgress(resolved);
          if (cancelled) return;

          const stats = await loadOrInitDailyStats(resolved, p);
          if (cancelled) return;

          const next = pickNextCard(resolved, p, now, mode);

          setProgress(p);
          setDailyStats(stats);
          setCurrent(next);
          setLoading(false);

          // Sync reminder based on remaining due TODAY bucket (matches Home/Deck)
          const remainingDueCount = countDueToday(p, now);
          void syncDailyReminders({ remainingDueCount, now });
        } catch (e: any) {
          if (cancelled) return;
          setDeck(null);
          setProgress([]);
          setDailyStats(null);
          setCurrent(null);
          setLoadError(e?.message ?? 'Failed to load deck.');
          setLoading(false);
        }
      }

      void load();

      return () => {
        cancelled = true;
      };
    }, [slug, mode, limit]),
  );

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.center}>
            <Text style={styles.title}>Deck not available</Text>
            <Text style={styles.subtitle}>{loadError}</Text>
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
            <Text style={styles.loadingText}>Loading cards...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const now = new Date();
  const dueTodayCount = countDueToday(progress, now);
  const sessionPercent = sessionLimit > 0 ? Math.min(sessionDone / sessionLimit, 1) : 0;

  const PERSPECTIVE = 1000;

  async function handleRating(uiRating: UiRating) {
    if (!current || !dailyStats || !deck) return;
    if (reviewing) return;
    if (sessionLimit > 0 && sessionDone >= sessionLimit) return;

    setReviewing(true);
    try {
      // ✅ Phase 0: 记录“用户最后确认过的卡片内容版本”
      // deck.json 里没填 Revision 时默认按 1 处理，避免旧题库崩
      const seenRev =
        typeof (current.card as any).Revision === 'number' ? (current.card as any).Revision : 1;

      const updatedOne: CardProgress = {
        ...scheduleNextReview(current.progress, uiRating, new Date()),
        lastSeenRevision: seenRev,
      };

      const newProgress = progress.map(p => (p.stableUid === updatedOne.stableUid ? updatedOne : p));

      await saveDeckProgress(deck, newProgress);

      const nextDone = sessionDone + 1;
      setSessionDone(nextDone);

      const remaining = sessionLimit > 0 ? Math.max(sessionLimit - nextDone, 0) : Infinity;

      // avoid immediate repeat of the card you just answered
      avoidUidRef.current = updatedOne.stableUid;

      const next =
        remaining > 0
          ? pickNextCard(deck, newProgress, new Date(), mode, avoidUidRef.current)
          : null;

      setProgress(newProgress);
      setCurrent(next);

      // reset to front for next card
      resetToFront();

      // update reminders (today bucket)
      const now2 = new Date();
      const remainingDueCount = countDueToday(newProgress, now2);
      void syncDailyReminders({ remainingDueCount, now: now2 });
    } finally {
      setReviewing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.container}>
          {/* header */}
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Deck</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {deck.Title}
              </Text>
              <Text style={styles.subtitle}>
                Session {sessionDone}/{sessionLimit || '∞'} · {modeLabel(mode)}
              </Text>
            </View>
          </View>

          {/* session bar */}
          <View style={styles.sessionCard}>
            <View style={styles.sessionHeaderRow}>
              <Text style={styles.sessionLabel}>Session progress</Text>
              <Text style={styles.sessionValue}>
                {sessionDone} / {sessionLimit || '∞'}
              </Text>
            </View>

            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { flex: sessionPercent, opacity: sessionPercent === 0 ? 0 : 1 }]} />
              <View style={{ flex: 1 - sessionPercent }} />
            </View>

            <Text style={styles.sessionHint}>
              {dueTodayCount} card{dueTodayCount === 1 ? '' : 's'} due today in this deck.
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionTitle}>Now reviewing</Text>

            {!current ? (
              <View style={styles.doneCard}>
                <Text style={styles.doneTitle}>You are done for now 🎉</Text>
                <Text style={styles.doneBody}>
                  This session is complete. You can go back to the deck screen and start another run later.
                </Text>
              </View>
            ) : (
              <View style={styles.cardCard}>
                {/* Flip container */}
                <View style={[styles.flipWrap, { height: flipHeight }]}>
                  {/* FRONT */}
                  <Animated.View
                    pointerEvents={showBack ? 'none' : 'auto'}
                    style={[
                      styles.flipFace,
                      {
                        opacity: frontOpacity,
                        zIndex: showBack ? 0 : 2,
                        transform: [{ perspective: PERSPECTIVE }, { rotateY: frontRotate }],
                      },
                    ]}
                  >
                    <Pressable
                      style={styles.facePressable}
                      onPress={() => setShowBack(true)}
                      accessibilityLabel="Flip to see answer"
                    >
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardOrder}>#{current.card.OrderInDeck}</Text>
                        <Text style={styles.cardChip}>
                          {current.card.Difficulty === 1
                            ? 'Easy'
                            : current.card.Difficulty === 2
                            ? 'Medium'
                            : 'Hard'}
                        </Text>
                        {current.card.CodeLanguage ? (
                          <Text style={styles.cardChipSecondary}>{current.card.CodeLanguage}</Text>
                        ) : null}
                      </View>

                      <Text style={styles.cardQuestion}>{current.card.Question}</Text>

                      <View style={styles.flipHintBox}>
                        <Text style={styles.flipHintText}>Tap the card to reveal the back.</Text>
                      </View>
                    </Pressable>
                  </Animated.View>

                  {/* BACK */}
                  <Animated.View
                    pointerEvents={showBack ? 'auto' : 'none'}
                    style={[
                      styles.flipFace,
                      {
                        opacity: backOpacity,
                        zIndex: showBack ? 2 : 0,
                        transform: [{ perspective: PERSPECTIVE }, { rotateY: backRotate }],
                      },
                    ]}
                  >
                    <View style={styles.backFaceContainer}>
                      {/* 顶部：标题 + 翻回去 */}
                      <View style={styles.backTopRow}>
                        <Text style={styles.backTitle}>Answer</Text>

                        <Pressable
                          style={({ pressed }) => [styles.flipBackBtn, pressed && { opacity: 0.9 }]}
                          onPress={() => setShowBack(false)}
                          accessibilityLabel="Flip back to question"
                        >
                          <Text style={styles.flipBackBtnText}>↩︎</Text>
                        </Pressable>
                      </View>

                      {/* 中间：可滚动内容区域 */}
                      <View style={styles.backBody}>
                        <ScrollView
                          style={{ flex: 1 }}
                          contentContainerStyle={{ paddingBottom: 12 }}
                          showsVerticalScrollIndicator={false}
                        >
                          {/* Explanation */}
                          {current.card.Explanation ? (
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionHeader}>Explanation</Text>
                              <Text style={styles.sectionBody}>{current.card.Explanation}</Text>
                            </View>
                          ) : null}

                          {/* Coding Sample */}
                          {current.card.CodeSnippet ? (
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionHeader}>Coding Sample</Text>

                              <View style={styles.codeContainer}>
                                <CodeBlock
                                  code={current.card.CodeSnippet}
                                  language={normalizeCodeLanguage(
                                    current.card.CodeLanguage || 'javascript',
                                  )}
                                />
                              </View>
                            </View>
                          ) : null}

                          {/* Real Usage (markdown-ish) */}
                          {current.card.RealWorldUsage ? (
                            <View style={styles.sectionBlock}>
                              <Text style={styles.sectionHeader}>Real Usage</Text>
                              <View style={styles.mdContainer}>
                                {renderSimpleMarkdown(current.card.RealWorldUsage, styles)}
                              </View>
                            </View>
                          ) : null}
                        </ScrollView>
                      </View>

                      {/* 底部：固定评分区域 */}
                      <View style={styles.backRatingSection}>
                        <Text style={styles.ratingHint}>
                          Think about how well you recalled this before seeing the answer.
                        </Text>

                        <View style={styles.ratingGrid}>
                          <Pressable
                            style={({ pressed }) => [
                              styles.ratingButton,
                              styles.ratingAgain,
                              pressed && styles.ratingPressed,
                              reviewing && styles.ratingDisabled,
                            ]}
                            disabled={reviewing}
                            onPress={() => handleRating('again')}
                          >
                            <Text style={styles.ratingTitle}>Again</Text>
                            <Text style={styles.ratingSub}>Show very soon</Text>
                          </Pressable>

                          <Pressable
                            style={({ pressed }) => [
                              styles.ratingButton,
                              styles.ratingHard,
                              pressed && styles.ratingPressed,
                              reviewing && styles.ratingDisabled,
                            ]}
                            disabled={reviewing}
                            onPress={() => handleRating('hard')}
                          >
                            <Text style={styles.ratingTitle}>Hard</Text>
                            <Text style={styles.ratingSub}>Short interval</Text>
                          </Pressable>

                          <Pressable
                            style={({ pressed }) => [
                              styles.ratingButton,
                              styles.ratingGood,
                              pressed && styles.ratingPressed,
                              reviewing && styles.ratingDisabled,
                            ]}
                            disabled={reviewing}
                            onPress={() => handleRating('good')}
                          >
                            <Text style={styles.ratingTitle}>Good</Text>
                            <Text style={styles.ratingSub}>Normal interval</Text>
                          </Pressable>

                          <Pressable
                            style={({ pressed }) => [
                              styles.ratingButton,
                              styles.ratingEasy,
                              pressed && styles.ratingPressed,
                              reviewing && styles.ratingDisabled,
                            ]}
                            disabled={reviewing}
                            onPress={() => handleRating('easy')}
                          >
                            <Text style={styles.ratingTitle}>Easy</Text>
                            <Text style={styles.ratingSub}>Much later</Text>
                          </Pressable>
                        </View>
                      </View>

                      {/* AI coming soon notice（位置不变，只是文案更自然一点） */}
                      <View style={styles.aiNoticeBox}>
                        <Text style={styles.aiNoticeTitle}>
                          Need Help? AI assistance is coming soon.
                        </Text>
                      </View>
                    </View>
                  </Animated.View>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default ReviewScreen;

const CARD_GLASS = 'rgba(255,255,255,0.18)';
const CARD_BORDER = 'rgba(255,255,255,0.5)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 10, color: '#6B7280' },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backButtonPressed: { opacity: 0.9 },
  backText: { fontSize: 13, color: '#111827' },

  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 12, color: '#6B7280' },

  sessionCard: {
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: CARD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  sessionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sessionLabel: { fontSize: 13, color: '#111827', fontWeight: '500' },
  sessionValue: { fontSize: 13, color: '#4F46E5', fontWeight: '600' },

  progressBarBg: {
    marginTop: 6,
    marginBottom: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.35)',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: { backgroundColor: '#4F46E5', borderRadius: 999 },

  sessionHint: { fontSize: 11, color: '#6B7280' },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },

  cardCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },

  // Flip
  flipWrap: {
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.96)',
    overflow: 'hidden',
  },
  flipFace: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backfaceVisibility: 'hidden',
  },

  facePressable: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },

  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardOrder: { fontSize: 12, color: '#6B7280', marginRight: 6 },
  cardChip: {
    fontSize: 11,
    color: '#111827',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    marginRight: 4,
  },
  cardChipSecondary: {
    fontSize: 11,
    color: '#4B5563',
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },

  cardQuestion: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginTop: 6,
  },

  flipHintBox: {
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(79,70,229,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.14)',
  },
  flipHintText: { fontSize: 12, color: '#6B7280' },

  // Back
  backTopRow: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backTitle: { fontSize: 13, fontWeight: '800', color: '#111827', flex: 1 },
  flipBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(17,24,39,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipBackBtnText: { fontSize: 16, fontWeight: '900', color: '#111827' },
  backFaceContainer: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBody: {
    flex: 1,
    marginTop: 4,
  },
  backRatingSection: {
    paddingTop: 4,
    paddingHorizontal: 0,
  },

  sectionBlock: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  sectionHeader: { fontSize: 12, fontWeight: '900', color: '#4F46E5', marginBottom: 6 },
  sectionBody: { fontSize: 13, color: '#374151', lineHeight: 18 },

  codeContainer: {
    borderRadius: 10,
    backgroundColor: '#1E1E1E',
    paddingVertical: 8,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  syntaxHighlighter: {
    backgroundColor: 'transparent',
    padding: 0,
    margin: 0,
  },
  syntaxCode: {
    fontFamily: 'Menlo',
    fontSize: 12,
    lineHeight: 18,
  },

  mdContainer: {
    paddingTop: 2,
    paddingBottom: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(243,244,246,0.95)', // 类 gray-100
  },
  mdBulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  mdBullet: { width: 18, fontSize: 14, color: '#374151', lineHeight: 18 },
  mdText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },

  // AI notice（位置保持在评分区下面，只做左对齐+小字提示）
  aiNoticeBox: {
    paddingHorizontal: 10,
    marginTop: 4,
    marginBottom: 4,
    alignItems: 'flex-start',
  },
  aiNoticeTitle: {
    fontSize: 12,
    color: '#6B7280', // slate-500
    textAlign: 'left',
  },
  aiNoticeSub: {
    marginTop: 2,
    fontSize: 11,
    color: '#9CA3AF', // gray-400
    textAlign: 'left',
  },

  ratingHint: {
    marginTop: 6,
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },

  ratingGrid: {
    paddingHorizontal: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  ratingButton: {
    width: '48%',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  ratingAgain: { backgroundColor: '#FEE2E2' },
  ratingHard: { backgroundColor: '#FFEDD5' },
  ratingGood: { backgroundColor: '#DCFCE7' },
  ratingEasy: { backgroundColor: '#DBEAFE' },
  ratingPressed: { opacity: 0.9 },
  ratingDisabled: { opacity: 0.5 },
  ratingTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  ratingSub: { fontSize: 11, color: '#4B5563', marginTop: 2 },

  doneCard: {
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#ECFDF5',
  },
  doneTitle: { fontSize: 16, fontWeight: '600', color: '#166534', marginBottom: 4 },
  doneBody: { fontSize: 13, color: '#166534' },
});