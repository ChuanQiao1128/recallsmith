import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import type { CardExport, DeckExport } from '../types/deckExport';
import type { CardProgress } from '../review/model';
import { colors } from '../theme/colors';
import { CHROME_MAX_FONT_SCALE } from '../theme/dynamicType';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { packPaletteFromSlug } from '../theme/packArt';
import { formatRank, rankCardsByOrder } from '../features/gacha/library/cardRank';
import { getFeatureFlags } from '../config/featureFlags';
import { mcqRequiredCount, resolveMcq } from '../features/gacha/mcq/normalizeMcq';
import { MCQ_COPY } from '../features/gacha/mcq/mcqConstants';
import { CardAnswerSections } from '../features/gacha/components/CardAnswerSections';
import { cardDetailStatus } from '../features/gacha/library/cardDetailStatus';
import { findCardAcrossDecks } from '../features/gacha/library/findCardAcrossDecks';

type Props = NativeStackScreenProps<RootStackParamList, 'CardDetail'>;

// Lazy + guarded loaders. The transitive dependency chain reaches
// expo-file-system, expo-crypto and aws-amplify, none of which this screen
// needs in order to render; deferring them keeps a card page from paying for
// the whole content stack at import time, and the guards keep an environment
// that cannot load them (a test runner) rendering an empty card instead of
// throwing.
//
// `import()`, not `require()`. The require form looked equivalent and was not:
// under the test runner it threw on every call and the catch swallowed it, so
// the screen silently had no deck, no progress and no way to observe the
// difference -- three loaders that could never load. Dynamic import defers the
// same way and stays a real module reference the runner can resolve.
async function loadActiveDeckSlugSafe(): Promise<string | null> {
  try {
    const mod = await import('../content/activeDeck');
    return (await mod?.loadActiveDeckSlug?.()) ?? null;
  } catch {
    return null;
  }
}
async function getCachedDeckSafe(slug: string): Promise<DeckExport | null> {
  try {
    const mod = await import('../content/deckCache');
    return (await mod?.getCachedDeck?.(slug)) ?? null;
  } catch {
    return null;
  }
}
// The installed decks' slugs, for the cross-deck lookup: a deep link can point
// at a card that lives in a deck other than the active one. Same lazy, guarded
// shape as the loaders above so the content stack stays out of import time.
async function listManifestSlugsSafe(): Promise<string[]> {
  try {
    const mod = await import('../content/deckRepository');
    const decks = (await mod?.listManifestDecks?.()) ?? [];
    return decks.map((d) => d.slug);
  } catch {
    return [];
  }
}
async function loadDeckProgressSafe(deck: DeckExport): Promise<CardProgress[]> {
  try {
    const mod = await import('../review/storage');
    return (await mod?.loadDeckProgress?.(deck)) ?? [];
  } catch {
    return [];
  }
}
async function resolveEffectiveOwnedSafe(
  slug: string,
  progress: CardProgress[],
): Promise<Set<string> | null> {
  try {
    const mod = await import('../features/gacha/draw/effectiveOwned');
    return (await mod?.resolveEffectiveOwned?.(slug, progress)) ?? null;
  } catch {
    // null is "this screen could not find out", which renders the card the way
    // 1.4.0 did. Failing the other way -- treating an unreadable collection as
    // an empty one -- would lock a user out of cards they own because one
    // storage read went wrong.
    return null;
  }
}

// Pull a real card from any installed deck (active first, then the rest — no
// more LIBRARY_SNAPSHOT mock, and no more active-deck-only blind spot).
type CardLoadStatus = 'loading' | 'ready' | 'not-found';

function useDeckCard(cardId: string) {
  const [deck, setDeck] = useState<DeckExport | null>(null);
  const [card, setCard] = useState<CardExport | null>(null);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [ownedSet, setOwnedSet] = useState<Set<string> | null>(null);
  const [status, setStatus] = useState<CardLoadStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setDeck(null);
    setCard(null);
    setProgress([]);
    setOwnedSet(null);
    (async () => {
      try {
        // Active deck first (usually already cached), then every other
        // installed deck in manifest order — a deep link can land on a card
        // that isn't in the active deck at all.
        const found = await findCardAcrossDecks(cardId, {
          activeSlug: await loadActiveDeckSlugSafe(),
          listSlugs: listManifestSlugsSafe,
          loadDeck: getCachedDeckSafe,
        });
        if (cancelled) return;
        if (!found) {
          setStatus('not-found');
          return;
        }
        // Progress and ownership belong to the deck the card was actually found
        // in, so a locked card in a non-active deck stays locked.
        const p = await loadDeckProgressSafe(found.deck);
        if (cancelled) return;
        // Resolved before the card is published to the tree, not alongside it.
        // Two setStates a tick apart would render one frame of the unlocked
        // card -- the question text of a card the user does not hold, which is
        // exactly the thing the lock exists to withhold. card and ownedSet are
        // set together so isLocked is never evaluated against a stale set.
        const owned = await resolveEffectiveOwnedSafe(found.deck.Slug, p);
        if (cancelled) return;
        setDeck(found.deck);
        setCard(found.card);
        setProgress(p);
        setOwnedSet(owned);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('not-found');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const cardProgress = progress.find((p) => p.stableUid === cardId) ?? null;
  // Three-valued, like the Library mapper: a null set means the question was
  // never answered, and an unanswered question is not a "no".
  const isLocked = !!card && ownedSet !== null && !ownedSet.has(card.StableUid);
  return { card, cardProgress, deck, status, isLocked };
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
  const { card, cardProgress, deck, status, isLocked } = useDeckCard(route.params.cardId);

  // The "Show answer" toggle is per-card: reset to closed whenever the route's
  // cardId changes so a new card never opens already-revealed.
  const [answerOpen, setAnswerOpen] = useState(false);
  useEffect(() => {
    setAnswerOpen(false);
  }, [route.params.cardId]);

  // While loading we cannot honestly draw the hero (#000 Common New) or claim
  // the card is missing — a neutral skeleton stands in until the lookup lands.
  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={[colors.softCream, colors.softPeach, colors.softLavender]} style={styles.gradient}>
          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.topBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.backChipText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>← Back</Text>
              </Pressable>
            </View>
            <View testID="card-detail-skeleton">
              <View style={styles.heroCardWrap}>
                <View style={styles.skeletonHero} />
              </View>
              <View style={styles.skeletonQuestion} />
              <View style={styles.skeletonMeta} />
            </View>
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // No installed deck holds this card (unknown uid, or its deck isn't on this
  // phone). Say so plainly instead of an empty page with a session button.
  if (status === 'not-found') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={[colors.softCream, colors.softPeach, colors.softLavender]} style={styles.gradient}>
          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.topBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.backChipText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>← Back</Text>
              </Pressable>
            </View>
            <View testID="card-detail-not-found" style={styles.notFoundCard}>
              <Text style={styles.notFoundTitle}>Card not found</Text>
              <Text style={styles.notFoundBody}>
                This card isn&apos;t on this phone. It may belong to a deck that isn&apos;t installed.
              </Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
                onPress={() => navigation.navigate('Library')}
              >
                <Text style={styles.primaryActionText}>Back to library</Text>
              </Pressable>
            </View>
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // A locked card shows its slot and nothing else it could be recognised by.
  // The Library's silhouette tile makes the same trade: the registry admits
  // the card exists, the pull is still the moment you learn what it says.
  const title = isLocked ? 'Not in your collection yet' : (card?.Question ?? '');
  // Rank in the deck, not OrderInDeck: the tile the user just tapped says
  // "#011" and this page has to say the same thing about the same card.
  const slot = card && deck ? (rankCardsByOrder(deck.Cards ?? []).get(card.StableUid) ?? 0) : 0;
  const difficulty = card?.Difficulty ?? 1;
  const rarity = rarityFromDifficulty(difficulty);
  const cardStatus = cardDetailStatus(cardProgress);
  // Read once per render, never as live policy (featureFlags.ts:57-62). A locked
  // card names no kind: the kind is one more thing the pull is supposed to reveal.
  const mcq = card && !isLocked ? resolveMcq(card, getFeatureFlags()) : null;
  const kindChip =
    mcq === null ? null : mcqRequiredCount(mcq) >= 2 ? MCQ_COPY.detailChipPick(mcqRequiredCount(mcq)) : MCQ_COPY.detailChip;
  const slotLabel = `#${formatRank(slot)}`;
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
              <Text style={styles.backChipText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>← Back</Text>
            </Pressable>
            <Text style={styles.topSlot} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
              {slotLabel}{totalInDeck > 0 ? ` / ${String(totalInDeck).padStart(3, '0')}` : ''}
            </Text>
          </View>

          {/* HERO CARD — same featured style as DrawResult */}
          <View style={styles.heroCardWrap}>
            <LinearGradient
              testID="card-detail-hero"
              colors={rarity.gradient}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.heroCard}
            >
              <View style={styles.heroTopBar}>
                <View style={[styles.heroRarityChip, { backgroundColor: rarity.accent }]}>
                  <Text style={styles.heroRarityChipText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                    {/* Stars proportional to rarity tier — same language
                        as Library tile (RAR=1, LEG=3, COM=none). Common
                        cards get just the label, no decorative star.
                        Locked cards name no tier at all: the Library tile
                        already withholds the stars, and a page that leaks
                        "Legendary" for an unowned slot turns the grid into a
                        map of where the good pulls are. */}
                    {isLocked
                      ? 'Locked'
                      : rarity.label === 'Legendary'
                        ? '★★★ Legendary'
                        : rarity.label === 'Rare'
                          ? '★ Rare'
                          : 'Common'}
                  </Text>
                </View>
                {kindChip ? (
                  <View testID="card-detail-kind-chip" style={styles.heroKindChip}>
                    <Text style={styles.heroKindChipText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                      {kindChip}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.heroStatusChip, !isLocked && cardStatus === 'Mastered' && styles.heroStatusMastered]}>
                  <Text style={styles.heroStatusChipText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                    {isLocked ? 'Missing' : cardStatus}
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

              {/* Subtle serial mark — replaces the rotated OFFICIAL ★ stamp.
                  Reads as authentic registry, not a try-hard sticker. */}
              <Text style={styles.heroSerial} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {`No. ${formatRank(slot)}${totalInDeck > 0 ? ` / ${totalInDeck}` : ''}`}
              </Text>
            </LinearGradient>
          </View>

          {/* QUESTION — the canonical "view this card's full content" surface.
              Moved out of the fixed overflow-hidden hero (MCORE-01): normal-flow
              text, no numberOfLines, no fixed height. The page already scrolls. */}
          <View testID="card-detail-question" style={styles.questionCard}>
            <Text style={styles.questionText}>{title}</Text>
          </View>

          {/* META STRIP — slot, last seen, next review, mastery */}
          <View style={styles.metaStrip}>
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>SLOT</Text>
              <Text style={styles.metaValue} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{slotLabel}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>LAST</Text>
              <Text style={styles.metaValue} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{lastSeen}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>NEXT</Text>
              <Text style={styles.metaValue} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{nextReview}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>STAGE</Text>
              <Text style={styles.metaValue} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>{cardProgress?.stage ?? 0}</Text>
            </View>
          </View>

          {/* SHOW ANSWER — owned cards only. Library's reason to exist is to
              re-read a card you already hold; a locked card reveals nothing new
              (no toggle, no options), exactly as its silhouette tile does. The
              body is the shared CardAnswerSections, so the explanation / code /
              usage read identically to the session reveal. For MCQ cards the
              correct option text is listed first, in stored order. */}
          {card && !isLocked ? (
            <View style={styles.answerSection}>
              <Pressable
                accessibilityRole="button"
                testID="card-detail-show-answer"
                style={({ pressed }) => [styles.showAnswerButton, pressed && styles.pressed]}
                onPress={() => setAnswerOpen((open) => !open)}
              >
                <Text style={styles.showAnswerText} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  {answerOpen ? 'Hide answer' : 'Show answer'}
                </Text>
              </Pressable>
              {answerOpen ? (
                <View testID="card-detail-answer" style={styles.answerBody}>
                  {mcq ? (
                    <View testID="card-detail-mcq-correct" style={styles.mcqCorrectBlock}>
                      <Text style={styles.mcqCorrectHeader} numberOfLines={1}>
                        CORRECT ANSWER
                      </Text>
                      {mcq.options
                        .filter((option) => option.correct)
                        .map((option) => (
                          <Text key={option.key} style={styles.mcqCorrectText}>
                            {option.text}
                          </Text>
                        ))}
                    </View>
                  ) : null}
                  <CardAnswerSections card={card} />
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ACTION ROW — primary opens the deck-wide session (planner-
              driven mixed route); secondary is back-to-library. The
              earlier "Practice now" was misleading: it suggested single-
              card practice but actually launched the full deck session.
              No real single-card mode exists yet, so we're honest:
              "Open deck session" is what the button actually does. */}
          {isLocked ? (
            // No study entry, and no disabled button either. A dead control is
            // a dead end; the draw is the one action that can actually change
            // this card's state, so it takes the primary slot. The label does
            // not promise this card: a pull grants what the pool grants.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open reward draw"
              testID="card-detail-locked-cta"
              style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Draw', { slug: deck?.Slug ?? undefined })}
            >
              <Text style={styles.primaryActionText}>Open reward draw</Text>
            </Pressable>
          ) : (
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
          )}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
            onPress={() => navigation.navigate('Library')}
          >
            <Text style={styles.secondaryActionText}>Back to library</Text>
          </Pressable>
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
  heroKindChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(20,23,55,0.72)' },
  heroKindChipText: { color: colors.softCream, fontSize: typography.caption, fontWeight: '900', letterSpacing: 0.4 },

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

  // ─── Question card (full stem, normal flow, below the hero) ──────────────
  questionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: spacing.md,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  questionText: { color: colors.inkSoft, fontSize: typography.title3, lineHeight: 24, fontWeight: '800' },

  // Serial mark — replaces OFFICIAL stamp
  heroSerial: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
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
  metaLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, color: colors.inkMuted },
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

  // ─── Loading skeleton ────────────────────────────────────────────────────
  // Neutral placeholder blocks — no rank, rarity, status or "Card details"
  // text — while the cross-deck lookup lands.
  skeletonHero: {
    width: 260,
    aspectRatio: 5 / 7,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  skeletonQuestion: {
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.55)',
    marginBottom: spacing.md,
  },
  skeletonMeta: {
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },

  // ─── Not found ───────────────────────────────────────────────────────────
  notFoundCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: spacing.lg,
    marginTop: spacing.md,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  notFoundTitle: {
    color: colors.inkSoft,
    fontSize: typography.title3,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  notFoundBody: {
    color: colors.inkMuted,
    fontSize: typography.body,
    lineHeight: 22,
    fontWeight: '600',
    marginBottom: spacing.md,
  },

  // ─── Show answer ─────────────────────────────────────────────────────────
  answerSection: { marginBottom: spacing.md },
  showAnswerButton: {
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
  showAnswerText: { color: colors.pokeBlueDeep, fontSize: typography.button, fontWeight: '900' },
  answerBody: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: spacing.sm,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  mcqCorrectBlock: { paddingVertical: spacing.sm },
  mcqCorrectHeader: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginBottom: 8,
  },
  mcqCorrectText: {
    fontSize: typography.body,
    lineHeight: 22,
    color: colors.inkSoft,
    fontWeight: '600',
    marginBottom: 6,
  },
});
