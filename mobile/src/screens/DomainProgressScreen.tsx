import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { getCachedDeck } from '../content/deckCache';
import { loadDeckProgress } from '../review/storage';
import { resolveEffectiveOwned } from '../features/gacha/draw/effectiveOwned';
import { activeMistakes, loadMistakeBook } from '../features/gacha/mistakes/mistakeBook';
import { computeDomainProgress, type DomainProgress } from '../features/domains/domainProgress';
import { pickDomainPracticeUids } from '../features/domains/domainPractice';
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { CHROME_MAX_FONT_SCALE } from '../theme/dynamicType';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'DomainProgress'>;

export const DOMAIN_PROGRESS_TITLE = 'Progress by domain';
/** Under the list, word for word (R24 contract §1): counts of studied cards, never a prediction. */
export const DOMAIN_PROGRESS_FOOTER =
  'Cards you have studied, not an exam score. DeveloperCards is not an exam simulator.';
/** Shown under a disabled Practice button. */
export const PRACTICE_DISABLED_TEXT = 'Learn a card in this domain first';

/** One domain row plus the focus cards its Practice button starts with (empty = disabled). */
type Row = { domain: DomainProgress; practiceUids: string[] };
type Loaded = { deckTitle: string; rows: Row[] } | 'missing';

async function loadRows(slug: string): Promise<Loaded> {
  const deck = await getCachedDeck(slug);
  if (!deck) return 'missing';
  const now = new Date();
  const progress = await loadDeckProgress(deck);
  const owned = await resolveEffectiveOwned(slug, progress);
  const mistakes = activeMistakes(await loadMistakeBook(), { deckSlug: slug, now: now.getTime() });
  const domains = computeDomainProgress(slug, deck.Cards ?? [], progress, owned, mistakes, now);
  return {
    deckTitle: deck.Title,
    rows: domains.map((domain) => ({
      domain,
      practiceUids: pickDomainPracticeUids({
        slug,
        uids: domain.uids,
        progress,
        owned,
        activeMistakes: mistakes,
        now,
      }),
    })),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DomainProgressScreen({ navigation, route }: Props) {
  const slug = route.params.slug;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // Load at mount and again on every focus: a Practice session changes the counts.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let next: Loaded;
      try {
        next = await loadRows(slug);
      } catch {
        next = 'missing';
      }
      if (!cancelled) setLoaded(next);
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.softCream, colors.softPeach, colors.softLavender]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              testID="domain-progress-back"
              style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backChipText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>← Back</Text>
            </Pressable>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {DOMAIN_PROGRESS_TITLE}
          </Text>
          {loaded !== null && loaded !== 'missing' ? (
            <Text style={styles.subtitle}>{loaded.deckTitle}</Text>
          ) : null}

          {loaded === null ? (
            <View
              testID="domain-progress-loading"
              accessible
              accessibilityLabel="Loading progress by domain"
              accessibilityState={{ busy: true }}
            >
              <View style={styles.skeletonRow} />
              <View style={styles.skeletonRow} />
            </View>
          ) : loaded === 'missing' || loaded.rows.length === 0 ? (
            <View testID="domain-progress-empty" style={styles.card}>
              <Text style={styles.emptyTitle}>No cards here yet</Text>
              <Text style={styles.emptyBody}>Open this pack in the Library first, then come back.</Text>
            </View>
          ) : (
            loaded.rows.map(({ domain, practiceUids }) => {
              const canPractice = practiceUids.length > 0;
              return (
                <View key={domain.key} testID={`domain-row-${domain.key}`} style={styles.card}>
                  <Text style={styles.domainTitle} accessibilityRole="header">
                    {domain.title}
                  </Text>
                  {domain.examWeight ? (
                    <Text testID={`domain-weight-${domain.key}`} style={styles.weight}>
                      {`${domain.examWeight} of the exam`}
                    </Text>
                  ) : null}
                  <Text testID={`domain-counts-${domain.key}`} style={styles.counts}>
                    {`${domain.learned} of ${domain.total} learned · ${domain.mastered} mastered`}
                  </Text>
                  {/* Bar only, no number: flex shares keep the learned part to learned/total. */}
                  <View
                    testID={`domain-bar-${domain.key}`}
                    style={styles.barTrack}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <View style={[styles.barFill, { flex: domain.learned }]} />
                    <View style={{ flex: domain.total - domain.learned }} />
                  </View>
                  {domain.dueNow > 0 || domain.mistakes > 0 ? (
                    <View style={styles.chips}>
                      {domain.dueNow > 0 ? (
                        <Text testID={`domain-due-${domain.key}`} style={styles.chip}>
                          {`${domain.dueNow} due`}
                        </Text>
                      ) : null}
                      {domain.mistakes > 0 ? (
                        <Text testID={`domain-mistakes-${domain.key}`} style={styles.chip}>
                          {plural(domain.mistakes, 'mistake')}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  <Pressable
                    testID={`domain-practice-${domain.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Practice ${domain.title}`}
                    accessibilityHint={
                      canPractice ? `Starts a session with ${plural(practiceUids.length, 'card')}` : PRACTICE_DISABLED_TEXT
                    }
                    disabled={!canPractice}
                    accessibilityState={{ disabled: !canPractice }}
                    style={({ pressed }) => [
                      styles.practice,
                      !canPractice && styles.practiceDisabled,
                      pressed && canPractice && styles.pressed,
                    ]}
                    onPress={() => {
                      if (!canPractice) return;
                      navigation.navigate('SessionCard', { slug, focusUids: practiceUids });
                    }}
                  >
                    <Text style={styles.practiceText}>Practice</Text>
                  </Pressable>
                  {canPractice ? null : (
                    <Text testID={`domain-practice-note-${domain.key}`} style={styles.practiceNote}>
                      {PRACTICE_DISABLED_TEXT}
                    </Text>
                  )}
                </View>
              );
            })
          )}

          <Text testID="domain-progress-footer" style={styles.footer}>
            {DOMAIN_PROGRESS_FOOTER}
          </Text>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DomainProgressScreen;

const cardShadow = {
  shadowColor: colors.shadowSoft,
  shadowOpacity: 1,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

// Text colours follow MistakeBookScreen: inkSoft and inkSecondary clear WCAG AA on white and on the gradient.
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
  subtitle: {
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  skeletonRow: {
    height: 96,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.55)',
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...cardShadow,
  },
  emptyTitle: { color: colors.inkSoft, fontSize: typography.title3, fontWeight: '900', marginBottom: spacing.sm },
  emptyBody: { color: colors.inkSecondary, fontSize: typography.body, lineHeight: 22, fontWeight: '600' },
  domainTitle: { color: colors.inkSoft, fontSize: typography.body, lineHeight: 21, fontWeight: '900' },
  weight: { color: colors.inkSecondary, fontSize: typography.caption, fontWeight: '700', marginTop: 2 },
  counts: { color: colors.inkSoft, fontSize: typography.bodySmall, fontWeight: '800', marginTop: spacing.xs },
  barTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.pokeBlueFaint,
    marginTop: 6,
  },
  barFill: { backgroundColor: colors.pokeBlue },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.xs },
  chip: {
    color: colors.inkSoft,
    fontSize: typography.caption,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.pokeBlueFaint,
    overflow: 'hidden',
  },
  practice: {
    marginTop: spacing.sm,
    minHeight: a11y.minTouch,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  practiceDisabled: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.hairline },
  practiceText: { color: colors.inkSoft, fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  practiceNote: { color: colors.inkSecondary, fontSize: typography.caption, fontWeight: '700', marginTop: 6 },
  footer: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    lineHeight: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
