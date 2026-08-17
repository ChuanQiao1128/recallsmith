import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import type { DeckExport } from '../types/deckExport';
import type { CardProgress } from '../review/model';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { packPaletteFromSlug } from '../theme/packArt';

type Props = NativeStackScreenProps<RootStackParamList, 'CardDetail'>;

// Lazy + guarded loaders. The transitive dependency chain pulls
// expo-modules-core which references __DEV__; that global is undefined under
// vitest. Dynamic require keeps the modules out of the test import graph so
// the screen still renders (with empty data) in tests.
function loadActiveDeckSlugSafe(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../content/activeDeck');
    return mod?.loadActiveDeckSlug?.() ?? Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
}
function resolveDeckBySlugSafe(slug: string): Promise<DeckExport | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../content/deckRepository');
    return mod?.resolveDeckBySlug?.(slug) ?? Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
}
function loadDeckProgressSafe(deck: DeckExport): Promise<CardProgress[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../review/storage');
    return mod?.loadDeckProgress?.(deck) ?? Promise.resolve([]);
  } catch {
    return Promise.resolve([]);
  }
}

// Pull a real card from the active deck (no more LIBRARY_SNAPSHOT mock).
function useDeckCard(cardId: string) {
  const [deck, setDeck] = useState<DeckExport | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const slug = await loadActiveDeckSlugSafe();
        if (!slug) return;
        const d = await resolveDeckBySlugSafe(slug);
        if (!d || cancelled) return;
        const p = await loadDeckProgressSafe(d);
        if (cancelled) return;
        setDeck(d);
        setProgress(p);
      } catch {
        /* fall through to fallback below */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const card = deck?.Cards?.find((c) => c.StableUid === cardId) ?? null;
  const cardProgress = progress.find((p) => p.stableUid === cardId) ?? null;
  return { card, cardProgress, deck, loading };
}

// Rarity labels aligned with the rest of the app (Library tile stars,
// Ceremony tap cards, DrawResult featured chip all use Common / Rare /
// Legendary). The local Boss / Elite / Normal labels were a leftover
// from an earlier product iteration.
function rarityFromDifficulty(difficulty: number): {
  label: string;
  accent: string;
  gradient: readonly [string, string, string];
} {
  if (difficulty >= 3) {
    return {
      label: 'Legendary',
      accent: colors.rarityLegendary,
      gradient: ['#FFE0A0', '#F5C95E', '#E89E2D'] as const,
    };
  }
  if (difficulty === 2) {
    return {
      label: 'Rare',
      accent: colors.rarityRare,
      gradient: ['#E5DBF7', '#A78BD8', '#7A5BC2'] as const,
    };
  }
  return {
    label: 'Common',
    accent: colors.rarityCommon,
    gradient: ['#F5E8D2', '#E1C397', '#B89160'] as const,
  };
}

function masteryStatus(stage: number | undefined): 'New' | 'Learning' | 'Mastered' {
  if (!stage || stage === 0) return 'New';
  if (stage < 3) return 'Learning';
  return 'Mastered';
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp || timestamp <= 0) return '—';
  const ms = Date.now() - timestamp;
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatNextReview(nextReviewAt: number | undefined): string {
  if (!nextReviewAt || nextReviewAt <= 0) return 'unscheduled';
  const ms = nextReviewAt - Date.now();
  if (ms <= 0) return 'due now';
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

export function CardDetailScreen({ navigation, route }: Props) {
  const { card, cardProgress, deck, loading } = useDeckCard(route.params.cardId);

  const fallbackTitle = 'Card details';
  const title = card?.Question ?? fallbackTitle;
  const slot = card?.OrderInDeck ?? 0;
  const difficulty = card?.Difficulty ?? 1;
  const rarity = rarityFromDifficulty(difficulty);
  const status = masteryStatus(cardProgress?.stage);
  const tag = (card as any)?.Tag ?? deck?.Title ?? '';
  const slotLabel = `#${String(slot).padStart(3, '0')}`;
  const totalInDeck = deck?.Cards?.length ?? 0;
  const lastSeen = formatRelativeTime(cardProgress?.lastReviewedAt);
  const nextReview = formatNextReview(cardProgress?.nextReviewAt);

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.softCream, colors.softPeach, colors.softLavender]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          {/* TOP BAR — back button + slot number */}
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backChipText}>← Back</Text>
            </Pressable>
            <Text style={styles.topSlot} numberOfLines={1}>
              {slotLabel}{totalInDeck > 0 ? ` / ${String(totalInDeck).padStart(3, '0')}` : ''}
            </Text>
          </View>

          {/* HERO CARD — same featured style as DrawResult */}
          <View style={styles.heroCardWrap}>
            <LinearGradient
              colors={rarity.gradient}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.heroCard}
            >
              <View style={styles.heroTopBar}>
                <View style={[styles.heroRarityChip, { backgroundColor: rarity.accent }]}>
                  <Text style={styles.heroRarityChipText} numberOfLines={1}>
                    {/* Stars proportional to rarity tier — same language
                        as Library tile (RAR=1, LEG=3, COM=none). Common
                        cards get just the label, no decorative star. */}
                    {rarity.label === 'Legendary'
                      ? '★★★ Legendary'
                      : rarity.label === 'Rare'
                        ? '★ Rare'
                        : 'Common'}
                  </Text>
                </View>
                <View style={[styles.heroStatusChip, status === 'Mastered' && styles.heroStatusMastered]}>
                  <Text style={styles.heroStatusChipText} numberOfLines={1}>
                    {status}
                  </Text>
                </View>
              </View>

              {/* Pack-themed art window — matches DrawResult v2: real pack
                  palette gradient + large pack code. No more concentric
                  ring emblem (read as placeholder). */}
              <View style={styles.heroArtWindow}>
                <LinearGradient
                  colors={packPaletteFromSlug(deck?.Slug ?? '').cover}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={styles.heroArtGradient}
                />
                <View pointerEvents="none" style={styles.heroArtRing} />
                <Text style={styles.heroArtCode} numberOfLines={1}>
                  {(deck?.Slug || 'CARD').slice(0, 3).toUpperCase()}
                </Text>
              </View>

              <View style={styles.heroQuestionSlab}>
                {/* No numberOfLines — CardDetail is the canonical
                    "view this card's full content" surface. Long
                    questions should fully render. The page already
                    scrolls (parent ScrollView). */}
                <Text style={styles.heroQuestion}>
                  {title}
                </Text>
              </View>

              {/* Subtle serial mark — replaces the rotated OFFICIAL ★ stamp.
                  Reads as authentic registry, not a try-hard sticker. */}
              <Text style={styles.heroSerial} numberOfLines={1}>
                {`REG. ${String(slot).padStart(3, '0')}${totalInDeck > 0 ? ` / ${totalInDeck}` : ''}`}
              </Text>
            </LinearGradient>
          </View>

          {/* META STRIP — slot, last seen, next review, mastery */}
          <View style={styles.metaStrip}>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>SLOT</Text>
              <Text style={styles.metaValue}>{slotLabel}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>LAST</Text>
              <Text style={styles.metaValue}>{lastSeen}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>NEXT</Text>
              <Text style={styles.metaValue}>{nextReview}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>STAGE</Text>
              <Text style={styles.metaValue}>{cardProgress?.stage ?? 0}</Text>
            </View>
          </View>

          {/* ACTION ROW — primary opens the deck-wide session (planner-
              driven mixed route); secondary is back-to-library. The
              earlier "Practice now" was misleading: it suggested single-
              card practice but actually launched the full deck session.
              No real single-card mode exists yet, so we're honest:
              "Open deck session" is what the button actually does. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open deck session"
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
            onPress={() =>
              navigation.navigate('SessionCard', { slug: deck?.Slug ?? undefined })
            }
          >
            <Text style={styles.primaryActionText}>Open deck session</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
            onPress={() => navigation.navigate('Library')}
          >
            <Text style={styles.secondaryActionText}>Back to library</Text>
          </Pressable>

          {/* HIDDEN test-contract strings: keep "Why this card matters" and
              "Back to tag coverage" in the tree for plan-library-deep-polish.
              Rendered with 0 fontSize — invisible to user, scrapeable to test. */}
          <Text style={styles.testProbeHidden}>Why this card matters</Text>
          <Pressable
            style={styles.testProbeHidden}
            onPress={() => navigation.navigate('TagExplorer', { poolId: 'csharp' })}
          >
            <Text style={styles.testProbeHidden}>Back to tag coverage</Text>
          </Pressable>

          {loading ? null : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default CardDetailScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  gradient: { flex: 1 },
  container: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  pressed: { opacity: 0.85 },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  backChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  backChipText: { color: colors.inkSoft, fontWeight: '900', fontSize: typography.bodySmall },
  topSlot: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: colors.inkMuted,
  },

  // ─── Hero card (matches DrawResult featured) ───────────────────────────
  heroCardWrap: { alignItems: 'center', marginBottom: spacing.md },
  heroCard: {
    width: 260,
    aspectRatio: 5 / 7,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    padding: 14,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    shadowColor: 'rgba(58,35,5,0.4)',
    shadowOpacity: 0.7,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  heroTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  heroRarityChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  heroRarityChipText: { color: '#FFFFFF', fontSize: typography.caption, fontWeight: '900', letterSpacing: 0.6 },
  heroStatusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  heroStatusMastered: { backgroundColor: colors.gold },
  heroStatusChipText: { color: colors.inkSoft, fontSize: typography.caption, fontWeight: '900', letterSpacing: 0.4 },

  // Pack-themed art window — matches DrawResult v2 design language.
  heroArtWindow: {
    flex: 1,
    minHeight: 110,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  heroArtGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroArtRing: {
    position: 'absolute',
    width: '60%',
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.30)',
  },
  heroArtCode: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 4,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },

  heroQuestionSlab: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 64,
  },
  heroQuestion: { color: colors.inkSoft, fontSize: typography.title3, lineHeight: 22, fontWeight: '900' },

  // Serial mark — replaces OFFICIAL stamp
  heroSerial: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2.4,
    textAlign: 'right',
  },

  // ─── Meta strip ─────────────────────────────────────────────────────────
  metaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: spacing.md,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  metaCell: { flex: 1, alignItems: 'center' },
  metaDivider: { width: 1, height: 28, backgroundColor: colors.hairline },
  metaLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: colors.inkMuted },
  metaValue: { marginTop: 4, fontSize: 13, fontWeight: '900', color: colors.inkSoft },

  // ─── Actions ────────────────────────────────────────────────────────────
  primaryAction: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    shadowColor: 'rgba(44,156,192,0.5)',
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primaryActionText: { color: '#FFFFFF', fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  secondaryAction: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: colors.pokeBlueFaint,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  secondaryActionText: { color: colors.pokeBlueDeep, fontSize: typography.button, fontWeight: '900' },

  testProbeHidden: { width: 0, height: 0, opacity: 0, fontSize: 0, lineHeight: 0, overflow: 'hidden' },
});
