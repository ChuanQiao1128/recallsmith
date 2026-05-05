import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { loadRewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

const SPARKS = Array.from({ length: 18 }, (_, index) => ({
  left: `${8 + ((index * 21) % 82)}%`,
  top: `${4 + ((index * 13) % 64)}%`,
  size: index % 3 === 0 ? 6 : 3,
  amber: index % 4 === 0,
}));

const DRAW_RESULT_COLOR = {
  gradientMid: 'rgba(17,23,61,1)',
  sparkLilac: 'rgba(201,173,247,1)',
  copyMuted: 'rgba(214,199,154,1)',
  copyPrimary: 'rgba(248,239,210,1)',
  heroShell: 'rgba(11,16,48,0.92)',
  heroBorder: 'rgba(245,236,196,0.12)',
  afterglowShell: 'rgba(245,236,196,0.08)',
  afterglowBorder: 'rgba(245,236,196,0.14)',
  legText: 'rgba(245,213,122,1)',
  rarText: 'rgba(201,173,247,1)',
  comText: 'rgba(214,199,154,1)',
  black: 'rgba(0,0,0,1)',
  whiteSoft: 'rgba(255,249,241,1)',
  whiteSoftMuted: 'rgba(255,249,241,0.82)',
  featuredRar: 'rgba(76,62,128,1)',
  featuredCom: 'rgba(106,90,67,1)',
  featuredBadgeBg: 'rgba(255,255,255,0.18)',
  featuredBadgeText: 'rgba(255,245,230,1)',
  summaryLegBg: 'rgba(249,232,196,1)',
  summaryLegText: 'rgba(166,111,38,1)',
  summaryRarBg: 'rgba(232,224,240,1)',
  summaryRarText: 'rgba(110,76,159,1)',
  summaryComBg: 'rgba(239,230,204,1)',
  summaryComText: 'rgba(140,122,91,1)',
  cardRarity: 'rgba(90,70,48,1)',
  cardTag: 'rgba(140,122,91,1)',
  cardMeta: 'rgba(107,90,69,1)',
  secondaryBg: 'rgba(255,255,255,0.72)',
  secondaryBorder: 'rgba(42,34,24,0.08)',
  modalOverlay: 'rgba(0,0,0,0.5)',
  modalCopy: 'rgba(90,75,56,1)',
  primaryText: 'rgba(255,255,255,1)',
  comCardBg: 'rgba(239,230,204,0.94)',
  comCardBorder: 'rgba(140,122,91,0.18)',
  rarCardBg: 'rgba(232,224,240,0.96)',
  rarCardBorder: 'rgba(110,76,159,0.16)',
  legCardBg: 'rgba(249,232,196,0.98)',
  legCardBorder: 'rgba(200,136,58,0.18)',
} as const;
const DRAW_RESULT_GRADIENT = [colors.cosmicBg, DRAW_RESULT_COLOR.gradientMid, colors.parchmentBg] as const;
const drawResultColors = DRAW_RESULT_COLOR;

type Props = NativeStackScreenProps<RootStackParamList, 'DrawResult'>;
type DrawResultRouteParams = RootStackParamList['DrawResult'] & {
  stateOverride?: 'loading' | 'error';
  errorMessage?: string;
};
type DrawResultCard = NonNullable<RootStackParamList['DrawResult']['drawResult']>['cards'][number];

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function buildStarRow(difficulty: number) {
  return Array.from({ length: 5 }, (_, index) => (index < difficulty ? '★' : '☆')).join('');
}

function joinMeta(segments: string[]) {
  return segments.filter((segment) => segment.trim().length > 0).join(' · ');
}

function getCardTag(card: DrawResultCard | null | undefined) {
  return normalizeText(card?.tag);
}

function getCardMeta(card: DrawResultCard) {
  return joinMeta([getCardTag(card), buildStarRow(card.difficulty)]);
}

function getDeckLabel(params: DrawResultRouteParams, slug: string) {
  return normalizeText(params.deckTitle) || normalizeText(params.drawResult?.poolId) || slug;
}

function getRarityLabel(rarity: 'COM' | 'RAR' | 'LEG') {
  if (rarity === 'LEG') return 'Legendary';
  if (rarity === 'RAR') return 'Rare';
  return 'Common';
}

export function DrawResultScreen({ navigation, route }: Props) {
  const params = route.params as DrawResultRouteParams;
  const slug = params.slug;
  const drawResult = params.drawResult ?? null;
  const ceremonyEcho = params.ceremonyEcho ?? null;
  const stateOverride = params.stateOverride;
  const errorMessage = params.errorMessage ?? 'Draw result is unavailable right now.';
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [remainingPulls, setRemainingPulls] = useState(0);
  const cards = drawResult?.cards ?? [];
  const isSinglePull = cards.length === 1;
  const ownedAfter = typeof params.ownedAfter === 'number' ? params.ownedAfter : cards.length;
  const totalCards = typeof params.totalCards === 'number' ? params.totalCards : cards.length;

  useEffect(() => {
    let cancelled = false;
    loadRewardWalletState()
      .then((wallet) => {
        if (cancelled) return;
        const total = Math.max(0, Number(wallet.availablePulls ?? 0)) + Math.max(0, Number(wallet.reservePulls ?? 0));
        setRemainingPulls(total);
      })
      .catch(() => {
        if (!cancelled) setRemainingPulls(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const raritySummary = useMemo(() => {
    const leg = cards.filter((card) => card.rarity === 'LEG').length;
    const rar = cards.filter((card) => card.rarity === 'RAR').length;
    const com = cards.filter((card) => card.rarity === 'COM').length;
    return { leg, rar, com };
  }, [cards]);

  const featuredCard = useMemo(() => {
    return cards.find((card) => card.rarity === 'LEG') ?? cards.find((card) => card.rarity === 'RAR') ?? cards[0] ?? null;
  }, [cards]);

  const selectedCard = cards.find((card) => card.stableUid === selectedCardId) ?? null;

  const deckLabel = getDeckLabel(params, slug);

  if (stateOverride === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
        <LinearGradient colors={DRAW_RESULT_GRADIENT} locations={[0, 0.42, 1]} style={styles.gradient}>
          <View style={styles.stateCenter}>
            <View style={styles.stateCard}>
              <ActivityIndicator size="large" color={colors.glowGold} />
              <Text style={styles.stateTitle} numberOfLines={2}>
                Preparing draw result
              </Text>
              <Text style={styles.stateBody} numberOfLines={2}>
                Finalizing rarity spread and card details for your next study loop.
              </Text>
              <Pressable
                testID="screen-draw-result-primary-cta"
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Back to draw"
                accessibilityHint="Returns to the draw screen."
                onPress={() => navigation.navigate('Draw', { slug })}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>
                  Back to Draw
                </Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (stateOverride === 'error' || !drawResult) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
        <LinearGradient colors={DRAW_RESULT_GRADIENT} locations={[0, 0.42, 1]} style={styles.gradient}>
          <View style={styles.stateCenter}>
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle} numberOfLines={2}>
                Draw result unavailable
              </Text>
              <Text style={styles.stateBody} numberOfLines={2}>
                {errorMessage}
              </Text>
              <Pressable
                testID="screen-draw-result-primary-cta"
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Back to draw"
                accessibilityHint="Returns to the draw screen."
                onPress={() => navigation.navigate('Draw', { slug })}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>
                  Back to Draw
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Back to home"
                accessibilityHint="Returns to the home screen."
                onPress={() => navigation.navigate('Home')}
              >
                <Text style={styles.secondaryButtonText} numberOfLines={1}>
                  Back to Home
                </Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (drawResult.cards.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
        <LinearGradient colors={DRAW_RESULT_GRADIENT} locations={[0, 0.42, 1]} style={styles.gradient}>
          <View style={styles.stateCenter}>
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle} numberOfLines={2}>
                No cards were drawn
              </Text>
              <Text style={styles.stateBody} numberOfLines={2}>
                Return to Draw and open another pull to continue your study path.
              </Text>
              <Pressable
                testID="screen-draw-result-primary-cta"
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Back to draw"
                accessibilityHint="Returns to the draw screen."
                onPress={() => navigation.navigate('Draw', { slug })}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>
                  Back to Draw
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="View library first"
                accessibilityHint="Opens your library before starting study."
                onPress={() => navigation.navigate('Library')}
              >
                <Text style={styles.secondaryButtonText} numberOfLines={1}>
                  View library first
                </Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-result-root">
      <LinearGradient colors={DRAW_RESULT_GRADIENT} locations={[0, 0.42, 1]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.heroShell}>
            <View pointerEvents="none" style={styles.sparkLayer}>
              {SPARKS.map((spark, index) => (
                <View
                  key={`spark-${index}`}
                  style={[
                    styles.spark,
                    {
                      left: spark.left as any,
                      top: spark.top as any,
                      width: spark.size,
                      height: spark.size,
                      borderRadius: spark.size,
                      backgroundColor: spark.amber ? colors.glowGold : drawResultColors.sparkLilac,
                      shadowColor: spark.amber ? colors.glowGold : drawResultColors.sparkLilac,
                    },
                  ]}
                />
              ))}
            </View>

            <Text style={styles.eyebrow} numberOfLines={1}>
              {joinMeta([isSinglePull ? 'Single pull result' : 'Reward draw result', normalizeText(drawResult.seedLabel)])}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {isSinglePull ? 'Single pull secured' : `${drawResult.cards.length} drawn cards ready for your next study loop`}
            </Text>
            <View style={styles.collectionBar} testID="draw-result-collection-bar">
              <Text style={styles.collectionBarLabel} numberOfLines={1}>
                Collection {ownedAfter}/{totalCards}
              </Text>
            </View>
            <Text style={styles.body} numberOfLines={1}>
              {isSinglePull
                ? `1 drawn card ready for your next study loop. ${deckLabel} · ${raritySummary.leg} LEG · ${raritySummary.rar} RAR · ${raritySummary.com} COM · pity now at ${drawResult.pityAfter}/10.`
                : `${deckLabel} · ${raritySummary.leg} LEG · ${raritySummary.rar} RAR · ${raritySummary.com} COM · pity now at ${drawResult.pityAfter}/10.`}
            </Text>
            {ceremonyEcho ? (
              <View style={styles.afterglowPill}>
                <Text style={styles.afterglowLabel} numberOfLines={1}>
                  Reward ready
                </Text>
                <Text
                  style={[styles.afterglowValue, ceremonyEcho.rarity === 'LEG' ? styles.afterglowLeg : ceremonyEcho.rarity === 'RAR' ? styles.afterglowRar : styles.afterglowCom]}
                  numberOfLines={1}
                >
                  {getRarityLabel(ceremonyEcho.rarity)} · just drawn
                </Text>
              </View>
            ) : null}

            {featuredCard ? (
              <Pressable
                testID="screen-draw-result-featured-card"
                style={({ pressed }) => [
                  styles.featuredCard,
                  isSinglePull && styles.featuredSingle,
                  featuredCard.rarity === 'LEG' ? styles.featuredLeg : featuredCard.rarity === 'RAR' ? styles.featuredRar : styles.featuredCom,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Open featured reward detail: ${featuredCard.question}`}
                accessibilityHint="Opens a detailed view for the featured reward card."
                onPress={() => setSelectedCardId(featuredCard.stableUid)}
              >
                <Text style={styles.featuredBadge} numberOfLines={1}>
                  {isSinglePull
                    ? 'Single-pull reward'
                    : featuredCard.rarity === 'LEG'
                      ? 'Top reward'
                      : featuredCard.rarity === 'RAR'
                        ? 'Highlighted reward'
                        : 'First reward'}
                </Text>
                <Text style={styles.featuredQuestion} numberOfLines={2}>
                  {featuredCard.question}
                </Text>
                <Text style={styles.featuredMeta} numberOfLines={1}>
                  {joinMeta([getCardMeta(featuredCard), 'tap for closer detail'])}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.summaryRow}>
            <Text style={[styles.summaryChip, styles.summaryChipLeg]} numberOfLines={1}>
              {raritySummary.leg} LEG
            </Text>
            <Text style={[styles.summaryChip, styles.summaryChipRar]} numberOfLines={1}>
              {raritySummary.rar} RAR
            </Text>
            <Text style={[styles.summaryChip, styles.summaryChipCom]} numberOfLines={1}>
              {raritySummary.com} COM
            </Text>
          </View>

          <View style={styles.gridWrap}>
            {drawResult.cards.map((card, index) => (
              <Pressable
                key={`${card.stableUid}-${card.question}`}
                testID={`screen-draw-result-grid-card-${index}`}
                onPress={() => setSelectedCardId(card.stableUid)}
                style={[
                  styles.card,
                  (index === 0 || isSinglePull) && styles.cardTall,
                  card.rarity === 'LEG' ? styles.legCard : card.rarity === 'RAR' ? styles.rarCard : styles.comCard,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Open reward detail: ${card.question}`}
                accessibilityHint="Opens detailed information for this reward card."
              >
                <Text style={styles.cardRarity} numberOfLines={1}>
                  {card.rarity}
                </Text>
                {getCardTag(card) ? (
                  <Text style={styles.cardTag} numberOfLines={1}>
                    {getCardTag(card)}
                  </Text>
                ) : null}
                <Text style={styles.cardTitle} numberOfLines={isSinglePull || index === 0 ? 3 : 2}>{card.question}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {buildStarRow(card.difficulty)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.buttonStack}>
            <Pressable
              testID="screen-draw-result-primary-cta"
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={remainingPulls > 0 ? 'Continue draw' : 'Go to Library'}
              accessibilityHint={remainingPulls > 0 ? 'Returns to Draw to open more cards.' : 'Opens Library for this deck.'}
              onPress={() => {
                if (remainingPulls > 0) {
                  navigation.navigate('Draw', { slug });
                  return;
                }
                navigation.navigate('Library', { focusSlug: slug, scrollToNew: true });
              }}
            >
              <Text style={styles.primaryButtonText} numberOfLines={1}>
                {remainingPulls > 0 ? 'Continue draw' : 'Go to Library'}
              </Text>
            </Pressable>

            <Pressable
              testID="draw-result-done-link"
              style={({ pressed }) => [styles.doneLink, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Done"
              accessibilityHint="Returns to Home."
              onPress={() => navigation.navigate('Home')}
            >
              <Text style={styles.doneLinkText} numberOfLines={1}>
                Done
              </Text>
            </Pressable>

          </View>
        </ScrollView>

        <Modal transparent animationType="fade" visible={!!selectedCard} onRequestClose={() => setSelectedCardId(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text
                style={[styles.modalRarity, selectedCard?.rarity === 'LEG' ? styles.modalRarityLeg : selectedCard?.rarity === 'RAR' ? styles.modalRarityRar : styles.modalRarityCom]}
                numberOfLines={1}
              >
                {selectedCard?.rarity}
              </Text>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {selectedCard?.question}
              </Text>
              <Text style={styles.modalBody} numberOfLines={3}>
                {selectedCard ? getCardMeta(selectedCard) : ''}
              </Text>
              <Pressable
                testID="screen-draw-result-detail-close"
                style={styles.primaryButton}
                accessibilityRole="button"
                accessibilityLabel="Close detail"
                accessibilityHint="Closes the reward detail modal."
                onPress={() => setSelectedCardId(null)}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.cosmicBgDeep },
  gradient: { flex: 1 },
  container: { paddingHorizontal: spacing.screenPadding, paddingTop: spacing.md, paddingBottom: spacing.xl + 2 },
  stateCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.screenPadding },
  stateCard: {
    borderRadius: spacing.lg,
    padding: spacing.md + 2,
    backgroundColor: drawResultColors.heroShell,
    borderWidth: 1,
    borderColor: drawResultColors.afterglowBorder,
  },
  stateTitle: { color: colors.cosmicInk, fontSize: typography.title2, lineHeight: 28, fontWeight: '900', textAlign: 'center' },
  stateBody: { marginTop: spacing.xs, color: drawResultColors.copyMuted, fontSize: typography.bodySmall, lineHeight: 18, textAlign: 'center' },
  heroShell: {
    borderRadius: 28,
    padding: spacing.md + 4,
    backgroundColor: drawResultColors.heroShell,
    borderWidth: 1,
    borderColor: drawResultColors.heroBorder,
    overflow: 'hidden',
  },
  sparkLayer: { ...StyleSheet.absoluteFillObject },
  spark: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  eyebrow: { color: colors.glowGold, fontSize: typography.caption, fontWeight: '800', letterSpacing: 1.4, fontFamily: 'Courier' },
  title: { marginTop: spacing.sm - 2, fontSize: 30, lineHeight: 36, fontWeight: '900', color: drawResultColors.copyPrimary },
  collectionBar: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: drawResultColors.afterglowShell,
    borderWidth: 1,
    borderColor: drawResultColors.afterglowBorder,
  },
  collectionBarLabel: { color: drawResultColors.copyPrimary, fontSize: typography.caption, fontWeight: '800' },
  body: { marginTop: spacing.sm - 2, fontSize: typography.bodySmall, lineHeight: 19, color: drawResultColors.copyMuted },
  afterglowPill: {
    marginTop: spacing.sm + 2,
    borderRadius: 18,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    backgroundColor: drawResultColors.afterglowShell,
    borderWidth: 1,
    borderColor: drawResultColors.afterglowBorder,
  },
  afterglowLabel: { color: colors.glowGold, fontSize: typography.caption, fontWeight: '900', letterSpacing: 1.1, fontFamily: 'Courier' },
  afterglowValue: { marginTop: spacing.xs, fontSize: typography.bodySmall, fontWeight: '900' },
  afterglowLeg: { color: drawResultColors.legText },
  afterglowRar: { color: drawResultColors.rarText },
  afterglowCom: { color: drawResultColors.comText },
  featuredCard: {
    marginTop: spacing.sm + 6,
    borderRadius: 24,
    padding: spacing.sm + 6,
    minHeight: 220,
    justifyContent: 'flex-end',
    shadowColor: drawResultColors.black,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  featuredSingle: {
    minHeight: 260,
    justifyContent: 'space-between',
  },
  featuredLeg: { backgroundColor: colors.gold },
  featuredRar: { backgroundColor: drawResultColors.featuredRar },
  featuredCom: { backgroundColor: drawResultColors.featuredCom },
  featuredBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 5,
    backgroundColor: drawResultColors.featuredBadgeBg,
    color: drawResultColors.featuredBadgeText,
    fontSize: typography.caption,
    fontWeight: '900',
    overflow: 'hidden',
  },
  featuredQuestion: { marginTop: spacing.sm + 2, fontSize: typography.title1, lineHeight: 34, fontWeight: '900', color: drawResultColors.whiteSoft },
  featuredMeta: { marginTop: spacing.sm - 2, fontSize: 12, color: drawResultColors.whiteSoftMuted, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm + 2, marginBottom: spacing.sm + 2 },
  summaryChip: {
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    borderRadius: 999,
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 6,
    fontSize: typography.caption,
    fontWeight: '900',
    overflow: 'hidden',
  },
  summaryChipLeg: { backgroundColor: drawResultColors.summaryLegBg, color: drawResultColors.summaryLegText },
  summaryChipRar: { backgroundColor: drawResultColors.summaryRarBg, color: drawResultColors.summaryRarText },
  summaryChipCom: { backgroundColor: drawResultColors.summaryComBg, color: drawResultColors.summaryComText },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48%',
    borderRadius: 20,
    padding: spacing.sm + 2,
    minHeight: 126,
    marginBottom: spacing.sm,
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  cardTall: { width: '100%', minHeight: 150 },
  comCard: { backgroundColor: drawResultColors.comCardBg, borderColor: drawResultColors.comCardBorder },
  rarCard: { backgroundColor: drawResultColors.rarCardBg, borderColor: drawResultColors.rarCardBorder },
  legCard: { backgroundColor: drawResultColors.legCardBg, borderColor: drawResultColors.legCardBorder },
  cardRarity: { fontSize: typography.caption, fontWeight: '900', color: drawResultColors.cardRarity },
  cardTag: { marginTop: 6, fontSize: 10, fontWeight: '800', color: drawResultColors.cardTag, letterSpacing: 0.7 },
  cardTitle: { marginTop: spacing.xs + 2, fontSize: 14, lineHeight: 19, fontWeight: '800', color: colors.ink },
  cardMeta: { marginTop: spacing.xs + 2, fontSize: typography.caption, color: drawResultColors.cardMeta },
  buttonStack: { marginTop: spacing.sm - 2 },
  primaryButton: {
    borderRadius: 16,
    minHeight: a11y.minTouch,
    backgroundColor: colors.gold,
    paddingHorizontal: spacing.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.gold,
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonText: { color: drawResultColors.primaryText, fontSize: typography.button, fontWeight: '900' },
  secondaryButton: {
    marginTop: spacing.sm - 2,
    borderRadius: 16,
    minHeight: a11y.minTouch,
    backgroundColor: drawResultColors.secondaryBg,
    paddingHorizontal: spacing.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: drawResultColors.secondaryBorder,
  },
  secondaryButtonText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  doneLink: { marginTop: spacing.sm - 2, minHeight: a11y.minTouch, alignItems: 'center', justifyContent: 'center' },
  doneLinkText: { color: colors.parchmentBgDeep, fontSize: typography.bodySmall, fontWeight: '800' },
  pressed: { opacity: 0.92 },
  modalOverlay: {
    flex: 1,
    backgroundColor: drawResultColors.modalOverlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: { width: '100%', borderRadius: spacing.lg, padding: spacing.md + 4, backgroundColor: colors.parchmentBg },
  modalRarity: { fontSize: typography.caption, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  modalRarityLeg: { color: drawResultColors.summaryLegText },
  modalRarityRar: { color: drawResultColors.summaryRarText },
  modalRarityCom: { color: drawResultColors.summaryComText },
  modalTitle: { marginTop: spacing.sm - 2, fontSize: typography.title2, lineHeight: 28, fontWeight: '900', color: colors.ink },
  modalBody: { marginTop: spacing.xs, fontSize: typography.bodySmall, lineHeight: 19, color: drawResultColors.modalCopy },
});
