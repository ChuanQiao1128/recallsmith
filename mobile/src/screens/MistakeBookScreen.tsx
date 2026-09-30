import React, { useCallback, useEffect, useState } from 'react';
import * as RN from 'react-native';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import type { DeckExport } from '../types/deckExport';
import { getCachedDeck } from '../content/deckCache';
import { loadDeckProgress } from '../review/storage';
import { resolveEffectiveOwned } from '../features/gacha/draw/effectiveOwned';
import {
  activeMistakes,
  isSameLocalDay,
  loadMistakeBook,
  localDaysBetween,
  MISTAKE_WINDOW_DAYS,
  RESOLVE_STREAK,
  resolveActiveMistakeRows,
  type MistakeEntry,
  type MistakeRow,
} from '../features/gacha/mistakes/mistakeBook';
import { pickRelatedCards, RELATED_REVIEW_COUNT } from '../features/gacha/mistakes/relatedReview';
import { useFeatureFlags } from '../config/featureFlags';
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { CHROME_MAX_FONT_SCALE } from '../theme/dynamicType';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'MistakeBook'>;

/** Mistakes handed to a focus run, newest first; related cards come after them. */
const FOCUS_MISTAKE_LIMIT = 10;
/** Shown instead of a focus run once every mistake of the deck got today's correct answer. */
export const DONE_FOR_TODAY_TEXT = 'Done for today, come back tomorrow.';
/** Review button text once every mistake of the deck got today's correct answer. */
export const REVIEW_DONE_LABEL = 'No mistakes due today';
/** Spoken hint of the review button in that done state. */
export const REVIEW_DONE_HINT = "Every mistake here already has today's correct answer. Come back tomorrow to keep clearing them.";
/** Spoken hint of the review button while a mistake is still open today. */
export const REVIEW_HINT = 'Starts a focus run with these mistakes';

/** openToday: the deck's mistakes that can still earn a correct answer today. */
type DeckGroup = { deck: DeckExport; rows: MistakeRow[]; openToday: number };

// Vitest supplies react-native without AccessibilityInfo — guarded lookup so tests don't crash (HomeScreen.tsx pattern).
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const AI: any = readRN('AccessibilityInfo', null);

/**
 * Relative "last wrong" label in local calendar days, the same days that resolution and the
 * subtitle's "different days" rule count. Every entry has a real timestamp, so it never reads as a dash.
 */
export function formatLastWrong(lastWrongAt: number, now: number): string {
  const days = localDaysBetween(lastWrongAt, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** A mistake that already got today's correct answer waits for tomorrow: another one today would not count. */
function isOpenToday(entry: MistakeEntry, now: number): boolean {
  return entry.lastCorrectAt === undefined || !isSameLocalDay(entry.lastCorrectAt, now);
}

/**
 * Progress toward clearing a card that is one correct answer away, visual and spoken; null for
 * any other card. The next answer counts tomorrow when today's already landed.
 */
export function clearProgress(entry: MistakeEntry, now: number): { text: string; spoken: string } | null {
  if (entry.correctStreak !== RESOLVE_STREAK - 1) return null;
  const counted = `${entry.correctStreak} of ${RESOLVE_STREAK}`;
  return isOpenToday(entry, now)
    ? { text: `${counted} correct · 1 more clears it`, spoken: `${counted} correct answers, one more clears it` }
    : { text: `${counted} correct · next tomorrow`, spoken: `${counted} correct answers, the next one counts tomorrow` };
}

/** Spoken row label: explicit, so VoiceOver does not read the visual "Wrong ×2" shorthand. */
export function mistakeRowLabel(question: string, entry: MistakeEntry, now: number): string {
  const topic = entry.topic ? ` ${entry.topic}.` : '';
  const times = entry.wrongCount === 1 ? 'once' : `${entry.wrongCount} times`;
  const progress = clearProgress(entry, now);
  const cleared = progress ? `. ${progress.spoken}` : '';
  return `${question}.${topic} Wrong ${times}, last wrong ${formatLastWrong(entry.lastWrongAt, now)}${cleared}`;
}

/** Groups active mistakes per deck, decks ordered by their newest mistake (the input is newest first). */
async function loadGroups(slug: string | undefined): Promise<DeckGroup[]> {
  const book = await loadMistakeBook();
  const now = Date.now();
  const deckSlugs = new Set(activeMistakes(book, { deckSlug: slug, now }).map((entry) => entry.deckSlug));
  const groups: DeckGroup[] = [];
  for (const deckSlug of deckSlugs) {
    let deck: DeckExport | null = null;
    try {
      deck = await getCachedDeck(deckSlug);
    } catch {
      deck = null;
    }
    if (!deck) continue;
    // The same helper the Library pill counts with, so the pill and this list agree.
    const rows = resolveActiveMistakeRows(book, deck, now);
    const openToday = rows.filter((row) => isOpenToday(row.entry, now)).length;
    if (rows.length > 0) groups.push({ deck, rows, openToday });
  }
  return groups;
}

export function MistakeBookScreen({ navigation, route }: Props) {
  const slug = route.params?.slug;
  const flags = useFeatureFlags();
  const relatedCount = flags.mistakeBook?.relatedCount ?? RELATED_REVIEW_COUNT;
  const [groups, setGroups] = useState<DeckGroup[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [starting, setStarting] = useState<string | null>(null);
  const [doneToday, setDoneToday] = useState<ReadonlySet<string>>(() => new Set());

  // Load at mount and again on every focus: a focus run that clears mistakes returns here.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let next: DeckGroup[];
      try {
        next = await loadGroups(slug);
      } catch {
        next = [];
      }
      if (cancelled) return;
      setNow(Date.now());
      setDoneToday(new Set());
      setGroups(next);
    };
    void load();
    const unsubscribe = navigation.addListener?.('focus', () => {
      void load();
    });
    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigation, slug]);

  const startFocus = useCallback(
    async (group: DeckGroup) => {
      if (starting) return;
      const deck = group.deck;
      const deckMistakes = group.rows.map((row) => row.entry);
      // A mistake that already got today's correct answer waits for tomorrow: another one today
      // would not count toward resolving it, and dealing it again would only cram its schedule.
      const nowMs = Date.now();
      const openToday = deckMistakes.filter((entry) => isOpenToday(entry, nowMs));
      if (openToday.length === 0) {
        setDoneToday((prev) => new Set(prev).add(deck.Slug));
        AI?.announceForAccessibility?.(DONE_FOR_TODAY_TEXT);
        return;
      }
      setStarting(deck.Slug);
      const mistakeUids = openToday.map((entry) => entry.stableUid).slice(0, FOCUS_MISTAKE_LIMIT);
      let related: string[] = [];
      try {
        const progress = await loadDeckProgress(deck);
        const ownedSet = await resolveEffectiveOwned(deck.Slug, progress);
        related = pickRelatedCards({
          deck,
          progress,
          ownedSet,
          mistakes: deckMistakes,
          now: new Date(nowMs),
          count: relatedCount,
        });
      } catch {
        // Progress or ownership unreadable: review the mistakes alone.
        related = [];
      }
      setStarting(null);
      navigation.navigate('SessionCard', { slug: deck.Slug, focusUids: [...mistakeUids, ...related] });
    },
    [navigation, relatedCount, starting],
  );

  // "up to": pickRelatedCards can return fewer related cards than the flag asks for, or none
  // (no learned candidates, or progress unreadable), and the count is only known once a run starts.
  const reviewLabel = relatedCount > 0 ? `Review mistakes + up to ${relatedCount} related` : 'Review mistakes';

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.softCream, colors.softPeach, colors.softLavender]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              testID="mistake-book-back"
              style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backChipText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>← Back</Text>
            </Pressable>
          </View>
          <Text style={styles.title} accessibilityRole="header">Mistake Book</Text>
          <Text style={styles.subtitle}>
            {`Cards you missed in the last ${MISTAKE_WINDOW_DAYS} days. Two correct answers on different days clear a card.`}
          </Text>

          {groups === null ? (
            <View
              testID="mistake-book-loading"
              accessible
              accessibilityLabel="Loading mistakes"
              accessibilityState={{ busy: true }}
            >
              <View style={styles.skeletonRow} />
              <View style={styles.skeletonRow} />
            </View>
          ) : groups.length === 0 ? (
            <View testID="mistake-book-empty" style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No mistakes to review</Text>
              <Text style={styles.emptyBody}>
                Cards you rate Again or miss in a multiple-choice question show up here.
              </Text>
            </View>
          ) : (
            groups.map((group) => {
              // Known at load: every mistake of the deck already got today's correct answer.
              const done = group.openToday === 0 || doneToday.has(group.deck.Slug);
              return (
                <View key={group.deck.Slug} testID={`mistake-deck-${group.deck.Slug}`} style={styles.deckSection}>
                  <Text style={styles.deckTitle} accessibilityRole="header">
                    {group.deck.Title}
                  </Text>
                  <View style={styles.card}>
                    {group.rows.map(({ entry, card }) => {
                      const progress = clearProgress(entry, now);
                      return (
                        <Pressable
                          key={entry.stableUid}
                          testID={`mistake-row-${entry.stableUid}`}
                          accessibilityRole="button"
                          accessibilityLabel={mistakeRowLabel(card.Question, entry, now)}
                          accessibilityHint="Opens the card"
                          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                          onPress={() => navigation.navigate('CardDetail', { cardId: entry.stableUid })}
                        >
                          <Text style={styles.rowQuestion} numberOfLines={2}>
                            {card.Question}
                          </Text>
                          <View style={styles.rowMeta}>
                            {entry.topic ? <Text style={styles.rowTopic}>{entry.topic}</Text> : null}
                            <Text style={styles.rowMetaText}>{`Wrong ×${entry.wrongCount}`}</Text>
                            <Text style={styles.rowMetaText}>{`Last wrong ${formatLastWrong(entry.lastWrongAt, now)}`}</Text>
                            {progress ? <Text style={styles.rowMetaText}>{progress.text}</Text> : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    testID={`mistake-review-${group.deck.Slug}`}
                    accessibilityRole="button"
                    accessibilityHint={done ? REVIEW_DONE_HINT : REVIEW_HINT}
                    disabled={starting !== null}
                    accessibilityState={{ disabled: starting !== null, busy: starting === group.deck.Slug }}
                    style={({ pressed }) => [done ? styles.secondaryAction : styles.primaryAction, pressed && styles.pressed]}
                    onPress={() => {
                      void startFocus(group);
                    }}
                  >
                    {starting === group.deck.Slug ? (
                      <ActivityIndicator
                        testID={`mistake-review-busy-${group.deck.Slug}`}
                        color={colors.inkSoft}
                        style={styles.primaryActionBusy}
                      />
                    ) : null}
                    <Text style={styles.primaryActionText}>{done ? REVIEW_DONE_LABEL : reviewLabel}</Text>
                  </Pressable>
                  {done ? (
                    <Text
                      testID={`mistake-done-today-${group.deck.Slug}`}
                      style={styles.doneToday}
                      accessibilityLiveRegion="polite"
                    >
                      {DONE_FOR_TODAY_TEXT}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default MistakeBookScreen;

const cardShadow = {
  shadowColor: colors.shadowSoft,
  shadowOpacity: 1,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  gradient: { flex: 1 },
  container: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  pressed: { opacity: 0.85 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  backChip: {
    minHeight: a11y.minTouch,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    ...cardShadow,
  },
  backChipText: { color: colors.inkSoft, fontWeight: '900', fontSize: typography.bodySmall },
  title: { color: colors.inkSoft, fontSize: typography.title1, fontWeight: '900', marginBottom: spacing.xs },
  // Text colours on this screen clear WCAG AA 4.5:1: inkSecondary is 8.41:1 on white and at least
  // 6.61:1 on the cream-to-lavender gradient; inkSoft is 10.13:1 on pokeBlueFaint and 5.77:1 on pokeBlue.
  subtitle: {
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  skeletonRow: {
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.55)',
    marginBottom: spacing.sm,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    marginTop: spacing.sm,
    ...cardShadow,
  },
  emptyTitle: { color: colors.inkSoft, fontSize: typography.title3, fontWeight: '900', marginBottom: spacing.sm },
  emptyBody: { color: colors.inkSecondary, fontSize: typography.body, lineHeight: 22, fontWeight: '600' },
  deckSection: { marginBottom: spacing.lg },
  deckTitle: {
    color: colors.inkSoft,
    fontSize: typography.title3,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, marginBottom: spacing.sm, ...cardShadow },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowQuestion: { color: colors.inkSoft, fontSize: typography.body, lineHeight: 21, fontWeight: '800' },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 6, gap: 8 },
  rowTopic: {
    color: colors.inkSoft,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.pokeBlueFaint,
    overflow: 'hidden',
  },
  rowMetaText: { color: colors.inkSecondary, fontSize: typography.caption, fontWeight: '800' },
  primaryAction: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    shadowColor: 'rgba(44,156,192,0.5)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  // The done-for-today button: white fill, inkSoft text (13.46:1 on white).
  secondaryAction: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryActionBusy: { position: 'absolute', left: spacing.md },
  doneToday: {
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  primaryActionText: { color: colors.inkSoft, fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
});
