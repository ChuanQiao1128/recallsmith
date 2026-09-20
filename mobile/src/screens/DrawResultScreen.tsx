import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as RN from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { loadRewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { clearPermissionPromptPending, isPermissionPromptPending } from './PermissionPromptScreen';
import { colors } from '../theme/colors';
import {
  PAGE_GRADIENT_LIGHT,
  cardFrameForRarity,
  GLOW_9SLICE,
  GLOW_9SLICE_INSET,
  packPaletteFromSlug,
  rarityAccentColor,
  rarityHaloColor,
} from '../theme/packArt';
import { CEREMONY_COPY_V10 } from '../features/gacha/draw/ceremonyCopy';
import { drawResultStyles as styles } from '../features/gacha/components/drawResultStyles';
import { SHARE_DRAW_TESTID, shareDrawImage, type ShareDrawResult } from '../features/gacha/share/shareDraw';
import { RATING_PROMPT_DELAY_MS, maybeRequestRating, resolveRatingTrigger } from '../features/gacha/milestones/ratingPrompt';
import { loadStreakSnapshot } from '../features/gacha/streaks/streakTracker';

// ─── react-native facade ────────────────────────────────────────────────────
// Vitest mocks use a strict Proxy that throws on missing exports — wrap access.
// Image is absent from the test mocks, so it is read through the facade and
// only rendered when non-null.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const A: any = readRN('Animated', {});
const RNImage: any = readRN('Image', null);
const AnimatedView: any = A.View ?? View;
const hasAnimated = typeof A.Value === 'function';

type Props = NativeStackScreenProps<RootStackParamList, 'DrawResult'>;
type DrawResultRouteParams = RootStackParamList['DrawResult'] & {
  stateOverride?: 'loading' | 'error';
  errorMessage?: string;
};
type DrawResultCard = NonNullable<RootStackParamList['DrawResult']['drawResult']>['cards'][number];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function deckLabel(params: DrawResultRouteParams): string {
  return normalizeText(params.deckTitle) || normalizeText(params.drawResult?.poolId) || params.slug;
}

function rarityLabel(rarity: 'COM' | 'RAR' | 'LEG'): string {
  if (rarity === 'LEG') return 'Legendary';
  if (rarity === 'RAR') return 'Rare';
  return 'Common';
}

// Gold ★ count for rarity — visual aligned with Library tile language.
// COM = nothing (kept clean), RAR = 1, LEG = 3.
function rarityStars(rarity: 'COM' | 'RAR' | 'LEG'): string {
  if (rarity === 'LEG') return '★★★';
  if (rarity === 'RAR') return '★';
  return '';
}

function cardTagText(card: DrawResultCard): string {
  return typeof card.tag === 'string' && card.tag.trim() ? card.tag.trim() : '';
}

const FEATURED_GRADIENT_BY_RARITY: Record<
  'COM' | 'RAR' | 'LEG',
  readonly [string, string, string]
> = {
  LEG: [colors.softCream, colors.rarityLegendary, colors.glowGold],
  RAR: [colors.softLavender, colors.rarityRare, colors.pokeBlue],
  COM: [colors.softPeach, colors.rarityCommon, colors.gold],
} as const;

const localStyles = StyleSheet.create({
  featuredFrame: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  unrevealedChip: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(58,35,5,0.10)' },
  unrevealedChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: colors.inkMuted },
  featuredUnrevealedChip: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.85)' },
});

export function DrawResultScreen({ navigation, route }: Props) {
  const params = route.params as DrawResultRouteParams;
  const drawResult = params.drawResult ?? null;
  const [remainingPulls, setRemainingPulls] = useState<number | null>(null);
  const [detailUid, setDetailUid] = useState<string | null>(null);
  const [isAllCardsOpen, setIsAllCardsOpen] = useState(false);
  const [registerVisible, setRegisterVisible] = useState(true);
  const [permissionPromptPending, setPermissionPromptPending] = useState(false);
  const shareTargetRef = useRef<View>(null);
  const [shareStatus, setShareStatus] = useState<ShareDrawResult['status'] | 'idle' | 'sharing'>('idle');

  const cards = drawResult?.cards ?? [];
  // Absent = the ceremony left before the table (or an old caller): no reveal
  // information, so no chips. An empty array means "table reached, nothing flipped".
  const revealedUids = params.revealedUids;
  const hasRevealInfo = Array.isArray(revealedUids);
  const revealedSet = useMemo(() => new Set(revealedUids ?? []), [revealedUids]);
  const isUnrevealed = (uid: string) => hasRevealInfo && !revealedSet.has(uid);
  const featured = useMemo(
    () =>
      cards.find((card) => card.rarity === 'LEG') ??
      cards.find((card) => card.rarity === 'RAR') ??
      cards[0] ??
      null,
    [cards],
  );
  const hasLegendary = cards.some((card) => card.rarity === 'LEG');

  const summary = useMemo(() => {
    const LEG = cards.filter((card) => card.rarity === 'LEG').length;
    const RAR = cards.filter((card) => card.rarity === 'RAR').length;
    const COM = cards.filter((card) => card.rarity === 'COM').length;
    return { LEG, RAR, COM };
  }, [cards]);

  const ownedAfter = typeof params.ownedAfter === 'number' ? params.ownedAfter : cards.length;
  const totalCards =
    typeof params.totalCards === 'number' ? params.totalCards : Math.max(cards.length, 1);

  const detailCard = cards.find((card) => card.stableUid === detailUid) ?? null;

  // Pokedex registration toast — fades in/out at top
  const registerOpacityRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const featuredEntryRef = useRef<any>(hasAnimated ? new A.Value(0) : null);

  useEffect(() => {
    if (!hasAnimated) return;
    A.sequence([
      A.timing(registerOpacityRef.current, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      A.delay(2400),
      A.timing(registerOpacityRef.current, {
        toValue: 0,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start(() => setRegisterVisible(false));
    A.spring(featuredEntryRef.current, {
      toValue: 1,
      friction: 6,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadRewardWalletState()
      .then((wallet) => {
        if (cancelled) return;
        const pulls =
          Math.max(0, Number(wallet.availablePulls ?? 0) || 0) +
          Math.max(0, Number(wallet.reservePulls ?? 0) || 0);
        setRemainingPulls(pulls);
      })
      .catch(() => {
        if (!cancelled) setRemainingPulls(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    isPermissionPromptPending()
      .then((pending) => {
        if (!cancelled) setPermissionPromptPending(pending);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // R7: one store-review request per install, at a natural pause. First Legendary wins over the
  // streak trigger; ratingPrompt.ts guarantees once-ever, this effect only decides the moment.
  useEffect(() => {
    if (cards.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const snapshot = await loadStreakSnapshot();
        const trigger = resolveRatingTrigger({ hasLegendary, currentDailyStreak: snapshot.currentDailyStreak });
        if (!trigger || cancelled) return;
        await maybeRequestRating(trigger);
      })().catch(() => {});
    }, RATING_PROMPT_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const isWalletLoading = remainingPulls === null;
  // Substring "Continue draw" / "Go to Library" preserved (test contract);
  // we just append context so the user knows what'll happen.
  const primaryLabel = isWalletLoading
    ? 'Checking pulls...'
    : remainingPulls > 0
      ? `Continue draw  ·  ${remainingPulls} pull${remainingPulls === 1 ? '' : 's'} left`
      : 'Go to Library  ·  earn pulls in study';

  const handlePrimary = () => {
    if (isWalletLoading) {
      return;
    }
    if (remainingPulls > 0) {
      navigation.navigate('Draw', { slug: params.slug });
      return;
    }
    // Name the cards. Library's fallback is "scroll to the first card with
    // status 'new'", which is the first card the user has not *studied* --
    // in a fresh deck that is card #1 every time, so the highlight landed on
    // something the user did not just pull. The uids are right here; the
    // screen simply never passed them.
    navigation.navigate('Library', {
      focusSlug: params.slug,
      scrollToNew: true,
      highlightUids: cards.map((card) => card.stableUid),
    });
  };

  // The first pack the user walks away from is where we ask for
  // notifications (home-review §3.2 通知权限时机). Consumed once; Continue
  // draw / Library exits are left alone so the flag survives until a Done.
  const handleDone = () => {
    if (permissionPromptPending) {
      setPermissionPromptPending(false);
      void clearPermissionPromptPending();
      navigation.navigate('PermissionPrompt');
      return;
    }
    navigation.navigate('Home');
  };

  const handleShare = async () => {
    if (shareStatus === 'sharing') return;
    setShareStatus('sharing');
    const result = await shareDrawImage(shareTargetRef, { slug: params.slug, deckTitle: params.deckTitle });
    setShareStatus(result.status === 'cancelled' ? 'idle' : result.status);
  };

  // Loading state override
  if (params.stateOverride === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
        <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
          <View style={styles.stateWrap}>
            <ActivityIndicator size="large" color={colors.pokeBlueDeep} />
            <Text style={styles.stateTitle} numberOfLines={2}>
              Preparing draw result
            </Text>
            <Pressable
              testID="screen-draw-result-primary-cta"
              style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Draw', { slug: params.slug })}
            >
              <Text style={styles.primaryCtaText} numberOfLines={1}>
                Back to draw
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // Error state
  if (params.stateOverride === 'error' || !drawResult) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
        <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
          <View style={styles.stateWrap}>
            <Text style={styles.stateTitle} numberOfLines={2}>
              Draw result unavailable
            </Text>
            <Text style={styles.stateBody} numberOfLines={2}>
              {params.errorMessage ?? 'Draw result is unavailable right now.'}
            </Text>
            <Pressable
              testID="screen-draw-result-primary-cta"
              style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Draw', { slug: params.slug })}
            >
              <Text style={styles.primaryCtaText} numberOfLines={1}>
                Back to draw
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // No cards drawn
  if (cards.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
        <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
          <View style={styles.stateWrap}>
            <Text style={styles.stateTitle} numberOfLines={2}>
              Nothing pulled
            </Text>
            <Text style={styles.stateBody} numberOfLines={2}>
              The draw did not return any cards. Try again.
            </Text>
            <Pressable
              testID="screen-draw-result-primary-cta"
              style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Draw', { slug: params.slug })}
            >
              <Text style={styles.primaryCtaText} numberOfLines={1}>
                Back to draw
              </Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const featuredAccent = featured ? rarityAccentColor(featured.rarity) : colors.rarityCommon;
  const featuredHalo = featured ? rarityHaloColor(featured.rarity) : colors.softPeach;
  const featuredScale =
    hasAnimated && featuredEntryRef.current
      ? featuredEntryRef.current.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] })
      : 1;
  const featuredOpacity =
    hasAnimated && featuredEntryRef.current
      ? featuredEntryRef.current.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })
      : 1;

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
      <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
        {/* Pokedex registration pill — fades in then out */}
        {registerVisible ? (
          <AnimatedView
            pointerEvents="none"
            style={[
              styles.registerPill,
              hasAnimated ? { opacity: registerOpacityRef.current } : null,
            ]}
          >
            <View style={styles.registerIcon}>
              <Text style={styles.registerIconText}>📘</Text>
            </View>
            {/* English-only app — registry pill is always Pokedex +N */}
            <Text style={styles.registerText} numberOfLines={1}>
              {`Pokedex +${cards.length}`}
            </Text>
          </AnimatedView>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          <View
            ref={shareTargetRef}
            collapsable={false}
            testID="draw-result-share-target"
            style={{ backgroundColor: PAGE_GRADIENT_LIGHT[0] }}
          >
          <View style={styles.header} testID="draw-result-header">
            <View style={styles.headerTitleColumn}>
              {/* Gold uppercase eyebrow — reinforces the +N feeling
                  persistently after the toast fades. */}
              <Text style={styles.headerEyebrow} numberOfLines={1}>
                {`+${cards.length} TO POKEDEX`}
              </Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {deckLabel(params)}
              </Text>
              {/* pityTriggered has ridden in the route params since the
                  ceremony was built and nothing ever showed it. A guarantee
                  the player cannot tell fired is a guarantee they never got.
                  Reuses the eyebrow style so no new visual language is
                  introduced for a one-line marker. */}
              {drawResult.pityTriggered ? (
                <Text
                  style={styles.headerEyebrow}
                  testID="draw-result-guarantee-badge"
                  numberOfLines={1}
                >
                  GUARANTEE PAID OUT
                </Text>
              ) : null}
            </View>
            <View style={styles.collectionBar} testID="draw-result-collection-bar">
              <Text style={styles.collectionText} numberOfLines={1}>
                {`${ownedAfter}/${totalCards}`}
              </Text>
            </View>
          </View>

          {/* Featured card v2 — pack-themed art window + prominent question
              + subtle serial. The stack of OFFICIAL stamp + NEW ribbon +
              concentric-ring emblem is gone; the card now leads with the
              actual question (the thing the user is going to study) and
              uses the pack's palette as authentic identity. */}
          {featured ? (
            <AnimatedView
              style={[
                styles.featuredHaloWrap,
                hasAnimated
                  ? { transform: [{ scale: featuredScale }], opacity: featuredOpacity }
                  : null,
              ]}
            >
              {RNImage ? (
                <RNImage
                  testID="draw-result-featured-glow"
                  pointerEvents="none"
                  source={GLOW_9SLICE}
                  resizeMode="stretch"
                  capInsets={{ top: GLOW_9SLICE_INSET, left: GLOW_9SLICE_INSET, bottom: GLOW_9SLICE_INSET, right: GLOW_9SLICE_INSET }}
                  style={[styles.featuredHalo, { tintColor: featuredHalo }]}
                />
              ) : (
                <View
                  pointerEvents="none"
                  style={[styles.featuredHalo, { backgroundColor: featuredHalo }]}
                />
              )}
              <Pressable
                testID="screen-draw-result-featured-card"
                style={({ pressed }) => [styles.featured, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Open featured card detail: ${featured.question}`}
                onPress={() => setDetailUid(featured.stableUid)}
              >
                <LinearGradient
                  colors={FEATURED_GRADIENT_BY_RARITY[featured.rarity]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={styles.featuredGradient}
                >
                  {/* Top: rarity chip only — no NEW ribbon, no OFFICIAL stamp */}
                  <View style={styles.featuredTopBar}>
                    <View style={[styles.featuredRarityChip, { backgroundColor: featuredAccent }]}>
                      <Text style={styles.featuredRarity} numberOfLines={1}>
                        ★ {rarityLabel(featured.rarity)}
                      </Text>
                    </View>
                    {cards.length === 1 && isUnrevealed(featured.stableUid) ? (
                      <View testID="draw-result-featured-unrevealed-chip" style={localStyles.featuredUnrevealedChip}>
                        <Text style={localStyles.unrevealedChipText} numberOfLines={1}>
                          {CEREMONY_COPY_V10.unrevealedChip}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Pack-themed art window — uses the pack's palette as a
                      gradient backdrop (authentic identity, not generic
                      rings). Inset slightly with a hairline ring. */}
                  <View style={styles.featuredArtWindow}>
                    <LinearGradient
                      colors={packPaletteFromSlug(params.slug).cover}
                      start={{ x: 0.1, y: 0 }}
                      end={{ x: 0.9, y: 1 }}
                      style={styles.featuredArtGradient}
                    />
                    <View pointerEvents="none" style={styles.featuredArtRing} />
                    <Text style={styles.featuredArtCode} numberOfLines={1}>
                      {(params.slug || 'A1').slice(0, 3).toUpperCase()}
                    </Text>
                  </View>

                  {/* Question area — leads the card now, full visibility */}
                  <View style={styles.featuredQuestionSlab}>
                    <Text style={styles.featuredQuestion} numberOfLines={4}>
                      {featured.question}
                    </Text>
                  </View>

                  {/* Subtle serial mark — reads as authentic registry, not
                      a sticker. "REG. 042 / 300" style: ownedAfter / total. */}
                  <Text style={styles.featuredSerial} numberOfLines={1}>
                    {`REG. ${String(ownedAfter).padStart(3, '0')} / ${totalCards}`}
                  </Text>

                  {/* Decorative diagonal shine */}
                  <View pointerEvents="none" style={styles.featuredShine} />

                  {/* B12 rarity frame PNG — transparent art window + lower slab,
                      stretched over the 260×364 (5:7) card. */}
                  {RNImage ? (
                    <RNImage
                      testID="draw-result-featured-frame"
                      pointerEvents="none"
                      source={cardFrameForRarity(featured.rarity)}
                      resizeMode="stretch"
                      style={localStyles.featuredFrame}
                    />
                  ) : null}
                </LinearGradient>
              </Pressable>
            </AnimatedView>
          ) : null}

          {/* Summary chips: only meaningful when multi-pull. For single-pull
              they'd always say "0 COM, 1 RAR, 0 LEG" or similar — pure noise.
              Hidden when length === 1 (kept in tree as 0×0 so testID stays). */}
          <View
            style={[styles.summaryStrip, cards.length <= 1 && styles.summaryStripHidden]}
            testID="draw-result-summary-strip"
          >
            <View style={[styles.summaryChip, styles.summaryChipCom]}>
              <View style={[styles.summaryChipDot, { backgroundColor: colors.rarityCommon }]} />
              <Text style={styles.summaryChipText} numberOfLines={1}>
                {`${summary.COM} COM`}
              </Text>
            </View>
            <View style={[styles.summaryChip, styles.summaryChipRar]}>
              <View style={[styles.summaryChipDot, { backgroundColor: colors.rarityRare }]} />
              <Text style={styles.summaryChipText} numberOfLines={1}>
                {`${summary.RAR} RAR`}
              </Text>
            </View>
            <View style={[styles.summaryChip, styles.summaryChipLeg]}>
              <View style={[styles.summaryChipDot, { backgroundColor: colors.rarityLegendary }]} />
              <Text style={styles.summaryChipText} numberOfLines={1}>
                {`${summary.LEG} LEG`}
              </Text>
            </View>
          </View>
          </View>

          {cards.length > 1 ? (
            <>
              {/* Always-visible compact horizontal strip — fills the bottom of
                  the page so the user immediately sees what they pulled. The
                  detailed grid remains behind the existing toggle below. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.miniStripContent}
                style={styles.miniStrip}
              >
                {cards.map((card, index) => {
                  const accent = rarityAccentColor(card.rarity);
                  const stars = rarityStars(card.rarity);
                  return (
                    <Pressable
                      key={`mini-${card.stableUid}-${index}`}
                      style={({ pressed }) => [styles.miniCard, pressed && styles.pressed]}
                      onPress={() => setDetailUid(card.stableUid)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open card ${index + 1}: ${card.question}`}
                    >
                      <View style={[styles.miniCardRarityBar, { backgroundColor: accent }]} />
                      <Text style={styles.miniCardSlot} numberOfLines={1}>
                        {String(index + 1).padStart(2, '0')}
                      </Text>
                      {/* Gold rarity stars — top-right, only visible for
                          RAR/LEG (matches Library tile language) */}
                      {stars ? (
                        <Text style={styles.miniCardStars} numberOfLines={1}>
                          {stars}
                        </Text>
                      ) : null}
                      <Text style={styles.miniCardQuestion} numberOfLines={3}>
                        {card.question}
                      </Text>
                      <View style={[styles.miniCardChip, { backgroundColor: accent }]}>
                        <Text style={styles.miniCardChipText} numberOfLines={1}>
                          {card.rarity}
                        </Text>
                      </View>
                      {isUnrevealed(card.stableUid) ? (
                        <View testID={`draw-result-unrevealed-chip-${index}`} style={localStyles.unrevealedChip}>
                          <Text style={localStyles.unrevealedChipText} numberOfLines={1}>
                            {CEREMONY_COPY_V10.unrevealedChip}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable
                testID="draw-result-open-all-cards"
                style={({ pressed }) => [styles.sheetToggleButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={
                  isAllCardsOpen
                    ? `Hide all ${cards.length} cards from this draw`
                    : `View all ${cards.length} cards from this draw`
                }
                onPress={() => setIsAllCardsOpen((prev) => !prev)}
              >
                <Text style={styles.sheetToggleText} numberOfLines={1}>
                  {isAllCardsOpen ? 'Hide all cards' : `View all cards (${cards.length})`}
                </Text>
              </Pressable>
              {isAllCardsOpen ? (
                <View
                  {...({
                    testID: 'draw-result-all-cards-sheet',
                    snapPoints: ['92%'],
                  } as any)}
                  style={styles.sheetWrap}
                >
                  {cards.map((card, index) => {
                    const accent = rarityAccentColor(card.rarity);
                    const stars = rarityStars(card.rarity);
                    return (
                      <Pressable
                        key={`${card.stableUid}-${index}`}
                        testID={`screen-draw-result-grid-card-${index}`}
                        style={({ pressed }) => [styles.gridCard, pressed && styles.pressed]}
                        onPress={() => setDetailUid(card.stableUid)}
                        accessibilityRole="button"
                      >
                        <Text style={styles.gridSlotNumber} numberOfLines={1}>
                          {String(index + 1).padStart(3, '0')}
                        </Text>
                        {/* Gold rarity stars — appears next to slot # */}
                        {stars ? (
                          <Text style={styles.gridStars} numberOfLines={1}>
                            {stars}
                          </Text>
                        ) : null}
                        <View style={[styles.gridRarityDot, { backgroundColor: accent }]}>
                          <Text style={styles.gridRarityDotText} numberOfLines={1}>
                            {card.rarity}
                          </Text>
                        </View>
                        <View style={styles.gridBody}>
                          {cardTagText(card) ? (
                            <Text style={styles.gridTag} numberOfLines={1}>
                              {cardTagText(card)}
                            </Text>
                          ) : null}
                          <Text style={styles.gridQuestion} numberOfLines={2}>
                            {card.question}
                          </Text>
                        </View>
                        <View style={[styles.gridNewRibbon, { backgroundColor: accent }]}>
                          <Text style={styles.gridNewRibbonText} numberOfLines={1}>
                            NEW
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : null}

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable
              testID="screen-draw-result-primary-cta"
              accessibilityRole="button"
              accessibilityLabel={
                isWalletLoading
                  ? 'Checking remaining pulls'
                  : remainingPulls > 0
                  ? `Continue drawing from ${deckLabel(params)}`
                  : 'Go to library, scroll to new cards'
              }
              accessibilityState={{ disabled: isWalletLoading }}
              disabled={isWalletLoading}
              style={({ pressed }) => [
                styles.primaryCta,
                isWalletLoading ? { opacity: 0.72 } : null,
                pressed && styles.pressed,
              ]}
              onPress={handlePrimary}
            >
              <Text style={styles.primaryCtaText} numberOfLines={1}>
                {primaryLabel}
              </Text>
            </Pressable>
            <Pressable
              testID={SHARE_DRAW_TESTID}
              accessibilityRole="button"
              accessibilityLabel={CEREMONY_COPY_V10.shareCta}
              accessibilityState={{ disabled: shareStatus === 'sharing' }}
              disabled={shareStatus === 'sharing'}
              style={({ pressed }) => [styles.earnPullsPill, pressed && styles.pressed]}
              onPress={() => void handleShare()}
            >
              <Text style={styles.earnPullsText} numberOfLines={1}>
                {shareStatus === 'sharing' ? 'Preparing image…' : CEREMONY_COPY_V10.shareCta}
              </Text>
            </Pressable>
            {shareStatus === 'unavailable' || shareStatus === 'failed' ? (
              <Text testID="draw-result-share-status" style={styles.doneText} numberOfLines={1}>
                {shareStatus === 'unavailable' ? 'Sharing is not available on this device' : 'Could not prepare the image'}
              </Text>
            ) : null}
            {/* Secondary action — only visible when wallet hit zero
                (primary now suggests Library). Gives the user a direct
                path back to earning more pulls instead of bouncing
                through the deck list. */}
            {!isWalletLoading && remainingPulls === 0 ? (
              <Pressable
                testID="draw-result-earn-pulls-link"
                accessibilityRole="button"
                accessibilityLabel="Earn more pulls by studying"
                style={({ pressed }) => [styles.earnPullsPill, pressed && styles.pressed]}
                onPress={() =>
                  navigation.navigate('SessionCard', { slug: params.slug })
                }
              >
                <Text style={styles.earnPullsText} numberOfLines={1}>
                  Earn more pulls →
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              testID="draw-result-done-link"
              accessibilityRole="button"
              accessibilityLabel="Done. Back to home."
              style={({ pressed }) => [styles.doneLink, pressed && styles.pressed]}
              onPress={handleDone}
            >
              <Text style={styles.doneText} numberOfLines={1}>
                Done
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* Confetti overlay for legendary — pointerEvents="none" is CRITICAL,
            otherwise this absoluteFill View captures every tap on the page. */}
        {hasLegendary ? (
          <View
            testID="draw-result-confetti"
            pointerEvents="none"
            style={styles.confetti}
          />
        ) : null}

        {/* Detail modal */}
        <Modal
          visible={!!detailCard}
          transparent
          animationType="fade"
          onRequestClose={() => setDetailUid(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              {detailCard ? (
                <View
                  style={[
                    styles.modalRarityChip,
                    { backgroundColor: rarityAccentColor(detailCard.rarity) },
                  ]}
                >
                  <Text style={styles.modalRarity} numberOfLines={1}>
                    ★ {rarityLabel(detailCard.rarity)}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.modalTitle} numberOfLines={3}>
                {detailCard?.question ?? ''}
              </Text>
              <Pressable
                testID="screen-draw-result-detail-close"
                style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
                onPress={() => setDetailUid(null)}
              >
                <Text style={styles.primaryCtaText} numberOfLines={1}>
                  Close detail
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawResultScreen;
