import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import * as RN from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { loadRewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { colors } from '../theme/colors';
import {
  PAGE_GRADIENT_LIGHT,
  rarityAccentColor,
  rarityHaloColor,
} from '../theme/packArt';
import { drawResultStyles as styles } from '../features/gacha/components/drawResultStyles';

// ─── Animated guard ─────────────────────────────────────────────────────────
// Vitest mocks use a strict Proxy that throws on missing exports — wrap access.
function readAnimated(): any {
  try {
    return (RN as any).Animated ?? {};
  } catch {
    return {};
  }
}
const A: any = readAnimated();
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

export function DrawResultScreen({ navigation, route }: Props) {
  const params = route.params as DrawResultRouteParams;
  const drawResult = params.drawResult ?? null;
  const [remainingPulls, setRemainingPulls] = useState<number | null>(null);
  const [detailUid, setDetailUid] = useState<string | null>(null);
  const [isAllCardsOpen, setIsAllCardsOpen] = useState(false);
  const [registerVisible, setRegisterVisible] = useState(true);

  const cards = drawResult?.cards ?? [];
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

  const isWalletLoading = remainingPulls === null;
  const primaryLabel = isWalletLoading
    ? 'Checking pulls...'
    : remainingPulls > 0
      ? 'Continue draw'
      : 'Go to Library';

  const handlePrimary = () => {
    if (isWalletLoading) {
      return;
    }
    if (remainingPulls > 0) {
      navigation.navigate('Draw', { slug: params.slug });
      return;
    }
    navigation.navigate('Library', { focusSlug: params.slug, scrollToNew: true });
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
            <Text style={styles.registerText} numberOfLines={1}>
              {`圖鑑登錄 +${cards.length}  ·  Pokedex +${cards.length}`}
            </Text>
          </AnimatedView>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header} testID="draw-result-header">
            <Text style={styles.headerTitle} numberOfLines={1}>
              {deckLabel(params)}
            </Text>
            <View style={styles.collectionBar} testID="draw-result-collection-bar">
              <Text style={styles.collectionText} numberOfLines={1}>
                {`${ownedAfter}/${totalCards}`}
              </Text>
            </View>
          </View>

          {/* Featured card — rarity-themed gradient + glow */}
          {featured ? (
            <AnimatedView
              style={[
                styles.featuredHaloWrap,
                hasAnimated
                  ? { transform: [{ scale: featuredScale }], opacity: featuredOpacity }
                  : null,
              ]}
            >
              <View
                pointerEvents="none"
                style={[styles.featuredHalo, { backgroundColor: featuredHalo }]}
              />
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
                  {/* NEW stamp */}
                  <View style={styles.newBadgeWrap}>
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText} numberOfLines={1}>
                        NEW
                      </Text>
                    </View>
                  </View>

                  {/* Rarity chip */}
                  <View style={[styles.featuredRarityChip, { backgroundColor: featuredAccent }]}>
                    <Text style={styles.featuredRarity} numberOfLines={1}>
                      ★ {rarityLabel(featured.rarity)}
                    </Text>
                  </View>

                  {/* Question text on white slab */}
                  <View style={styles.featuredQuestionSlab}>
                    <Text style={styles.featuredQuestion} numberOfLines={3}>
                      {featured.question}
                    </Text>
                  </View>

                  {/* Decorative shine */}
                  <View pointerEvents="none" style={styles.featuredShine} />
                </LinearGradient>
              </Pressable>
            </AnimatedView>
          ) : null}

          {/* Summary chips */}
          <View style={styles.summaryStrip} testID="draw-result-summary-strip">
            <View style={[styles.summaryChip, styles.summaryChipCom]}>
              <Text style={styles.summaryChipText} numberOfLines={1}>
                {`${summary.COM} COM`}
              </Text>
            </View>
            <View style={[styles.summaryChip, styles.summaryChipRar]}>
              <Text style={styles.summaryChipText} numberOfLines={1}>
                {`${summary.RAR} RAR`}
              </Text>
            </View>
            <View style={[styles.summaryChip, styles.summaryChipLeg]}>
              <Text style={styles.summaryChipText} numberOfLines={1}>
                {`${summary.LEG} LEG`}
              </Text>
            </View>
          </View>

          {cards.length > 1 ? (
            <>
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
              testID="draw-result-done-link"
              accessibilityRole="button"
              accessibilityLabel="Done. Back to home."
              style={({ pressed }) => [styles.doneLink, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Home')}
            >
              <Text style={styles.doneText} numberOfLines={1}>
                Done
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* Confetti overlay for legendary */}
        {hasLegendary ? <View testID="draw-result-confetti" style={styles.confetti} /> : null}

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
