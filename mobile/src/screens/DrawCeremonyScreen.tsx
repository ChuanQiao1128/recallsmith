import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { a11y } from '../theme/a11y';
import { animation } from '../theme/animation';
import { colors } from '../theme/colors';
import {
  CEREMONY_COPY,
  getCeremonyRarityLabel,
  type CeremonyPhase,
  type CeremonyRarity,
  type MultiCeremonyPhase,
} from '../features/gacha/draw/ceremonyCopy';

const STAR_FIELD = Array.from({ length: 40 }, (_, index) => ({
  left: `${5 + ((index * 13) % 90)}%`,
  top: `${8 + ((index * 19) % 76)}%`,
  size: index % 3 === 0 ? 5 : index % 2 === 0 ? 3 : 2,
  amber: index % 6 === 0,
  opacity: index % 4 === 0 ? 0.85 : 0.45,
}));
const CODE_GLYPHS = ['{', '}', '()', '=>', ';', '0', '1'] as const;
const GLYPH_PARTICLES = Array.from({ length: 18 }, (_, index) => ({
  glyph: CODE_GLYPHS[index % CODE_GLYPHS.length],
  left: `${8 + ((index * 17) % 82)}%`,
  top: `${12 + ((index * 9) % 68)}%`,
  size: index % 3 === 0 ? 16 : index % 2 === 0 ? 14 : 12,
  amber: index % 5 === 0,
  opacity: index % 4 === 0 ? 0.55 : 0.28,
}));
const STACK_ROTATIONS = [-14, -7, 0, 7, 14];
const MULTI_PULL_DURATION = 2200;
const REDUCED_MOTION_DURATION = 420;
const CEREMONY_GRADIENT = [colors.cosmicBg, colors.cosmicBgDeep] as const;
const CEREMONY_COLOR = {
  dustLilac: 'rgba(201,173,247,1)',
  copyMuted: 'rgba(214,199,154,1)',
  copySoft: 'rgba(245,236,196,0.72)',
  copyFaint: 'rgba(245,236,196,0.2)',
  glowVeil: 'rgba(232,184,90,0.2)',
  shellStrong: 'rgba(24,29,74,1)',
  shellHero: 'rgba(36,26,76,1)',
  shellReveal: 'rgba(42,33,72,1)',
  legShell: 'rgba(83,55,26,1)',
  rarShell: 'rgba(47,37,85,1)',
  whiteBadge: 'rgba(255,255,255,0.16)',
  textBright: 'rgba(255,247,232,1)',
  textSoft: 'rgba(255,247,232,0.8)',
  beamLeg: 'rgba(245,213,122,0.9)',
  beamCommon: 'rgba(214,199,154,0.48)',
  particleGold: 'rgba(245,213,122,1)',
  goldBorderStrong: 'rgba(232,184,90,0.92)',
  goldBorderSoft: 'rgba(232,184,90,0.6)',
  goldBorderBright: 'rgba(232,184,90,0.9)',
  goldCardBorder: 'rgba(245,213,122,0.92)',
  creamBorderFaint: 'rgba(245,236,196,0.18)',
  creamGlyph: 'rgba(245,236,196,0.2)',
  footerBg: 'rgba(245,236,196,0.06)',
  footerBorder: 'rgba(245,236,196,0.12)',
  buttonBg: 'rgba(245,236,196,0.1)',
  buttonBorder: 'rgba(245,236,196,0.18)',
} as const;

type Props = NativeStackScreenProps<RootStackParamList, 'DrawCeremony'>;
type DrawCeremonyResult = NonNullable<RootStackParamList['DrawCeremony']['drawResult']>;
type DrawCeremonyCard = DrawCeremonyResult['cards'][number];

function selectFeaturedCeremonyCard(cards: DrawCeremonyCard[]): DrawCeremonyCard | null {
  return cards.find((card) => card.rarity === 'LEG') ?? cards.find((card) => card.rarity === 'RAR') ?? cards[0] ?? null;
}

export function DrawCeremonyScreen({ navigation, route }: Props) {
  const drawResult: DrawCeremonyResult = route.params.drawResult ?? {
    poolId: route.params.slug,
    cards: [],
    pityBefore: 0,
    pityTriggered: false,
    pityAfter: 0,
    highlightedRarity: null,
  };
  const featuredCard = useMemo(() => selectFeaturedCeremonyCard(drawResult.cards), [drawResult.cards]);
  const actualFeaturedRarity = featuredCard?.rarity ?? drawResult.highlightedRarity ?? null;
  const featuredRarity: CeremonyRarity = actualFeaturedRarity ?? (drawResult.pityTriggered ? 'RAR+' : 'COM+');
  const featuredTone = featuredRarity === 'LEG' ? 'leg' : featuredRarity === 'RAR' || featuredRarity === 'RAR+' ? 'rar' : 'com';
  const ceremonyEchoRarity = featuredCard?.rarity ?? drawResult.highlightedRarity ?? (drawResult.pityTriggered ? 'RAR' : 'COM');
  const isSinglePull = drawResult.cards.length === 1;
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [phase, setPhase] = useState<CeremonyPhase>('warmup');
  const [multiPhase, setMultiPhase] = useState<MultiCeremonyPhase>('orbit');

  const stageScale = useRef(new Animated.Value(0.94)).current;
  const stageGlow = useRef(new Animated.Value(0.35)).current;
  const cardLift = useRef(new Animated.Value(18)).current;
  const cardRotate = useRef(new Animated.Value(0)).current;

  const statsLine = useMemo(() => {
    const leg = drawResult.cards.filter((card) => card.rarity === 'LEG').length;
    const rar = drawResult.cards.filter((card) => card.rarity === 'RAR').length;
    const com = drawResult.cards.filter((card) => card.rarity === 'COM').length;
    return `${leg} Legendary, ${rar} Rare, ${com} Common, pity ${drawResult.pityAfter}/10`;
  }, [drawResult.cards, drawResult.pityAfter]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotionEnabled(!!enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotionEnabled(!!enabled);
    });
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    const totalDuration = reduceMotionEnabled ? REDUCED_MOTION_DURATION : isSinglePull ? animation.ceremony : MULTI_PULL_DURATION;
    const legHold = reduceMotionEnabled ? 0 : !isSinglePull && featuredRarity === 'LEG' ? 400 : 0;
    const focusAt = reduceMotionEnabled ? Math.round(totalDuration * 0.35) : isSinglePull ? Math.round(totalDuration * 0.35) : 700;
    const revealAt = reduceMotionEnabled ? Math.round(totalDuration * 0.72) : isSinglePull ? Math.round(totalDuration * 0.72) : 1400;
    const finishAt = totalDuration + legHold;
    const motionDuration = reduceMotionEnabled ? Math.round(animation.fast * a11y.reduceMotionFactor) : animation.normal;

    const animateTo = (toScale: number, toGlow: number, toLift: number, toRotate: number) => {
      Animated.parallel([
        Animated.timing(stageScale, { toValue: toScale, duration: motionDuration, useNativeDriver: true }),
        Animated.timing(stageGlow, { toValue: toGlow, duration: motionDuration, useNativeDriver: false }),
        Animated.timing(cardLift, { toValue: toLift, duration: motionDuration, useNativeDriver: true }),
        Animated.timing(cardRotate, { toValue: reduceMotionEnabled ? 0 : toRotate, duration: motionDuration, useNativeDriver: true }),
      ]).start();
    };

    animateTo(0.96, 0.45, 12, isSinglePull || reduceMotionEnabled ? 0 : 0.04);

    const focusTimer = setTimeout(() => {
      if (isSinglePull) {
        setPhase('focus');
        animateTo(1.02, reduceMotionEnabled ? 0.6 : 0.72, -6, 0.08);
      } else {
        setMultiPhase('charge');
        animateTo(1.01, reduceMotionEnabled ? 0.62 : 0.78, -4, 0.06);
      }
    }, focusAt);

    const revealTimer = setTimeout(() => {
      if (isSinglePull) {
        setPhase('reveal');
        animateTo(1.06, reduceMotionEnabled ? 0.68 : 1, -18, 0);
      } else {
        setMultiPhase('stabilize');
        animateTo(1.04, reduceMotionEnabled ? 0.7 : 1, -12, 0);
      }
    }, revealAt);

    const finishTimer = setTimeout(() => {
      navigation.replace('DrawResult', {
        slug: route.params.slug,
        drawResult,
        deckTitle: route.params.deckTitle,
        ceremonyEcho: {
          rarity: ceremonyEchoRarity,
          phaseCue: isSinglePull ? CEREMONY_COPY.handoffCue.single : CEREMONY_COPY.handoffCue.multi,
        },
      });
    }, finishAt);

    return () => {
      clearTimeout(focusTimer);
      clearTimeout(revealTimer);
      clearTimeout(finishTimer);
      stageScale.stopAnimation();
      stageGlow.stopAnimation();
      cardLift.stopAnimation();
      cardRotate.stopAnimation();
    };
  }, [cardLift, cardRotate, ceremonyEchoRarity, drawResult, featuredRarity, isSinglePull, navigation, reduceMotionEnabled, route.params.deckTitle, route.params.slug, stageGlow, stageScale]);

  const ceremonyTitle = isSinglePull
    ? CEREMONY_COPY.single.title[phase]
    : CEREMONY_COPY.multi.title[multiPhase];

  const ceremonyBody = isSinglePull
    ? CEREMONY_COPY.single.body[phase]
    : CEREMONY_COPY.multi.body[multiPhase];
  const revealHint = isSinglePull && phase !== 'reveal' ? CEREMONY_COPY.single.revealHint : null;
  const motionHint = reduceMotionEnabled ? CEREMONY_COPY.motionHint : null;
  const phaseCue = isSinglePull
    ? CEREMONY_COPY.single.phaseCue[phase]
    : CEREMONY_COPY.multi.phaseCue[multiPhase];
  const raritySignal = getCeremonyRarityLabel(featuredRarity);
  const metaSegments = [isSinglePull ? CEREMONY_COPY.single.meta : CEREMONY_COPY.multi.meta, drawResult.seedLabel].filter(Boolean);
  const metaLine = metaSegments.join(' - ');
  const featuredLine = `${isSinglePull ? CEREMONY_COPY.single.featuredPrefix : CEREMONY_COPY.multi.featuredPrefix} ${raritySignal}`;

  const stageTransform = {
    transform: [
      { scale: stageScale },
      { translateY: cardLift },
      {
        rotate: cardRotate.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', reduceMotionEnabled ? '0deg' : '8deg'],
        }),
      },
    ],
  };

  const centerGlowStyle = {
    opacity: stageGlow,
    transform: [
      {
        scale: stageGlow.interpolate({
          inputRange: [0, 1],
          outputRange: [0.88, 1.18],
        }),
      },
    ],
  };

  const beamColor = featuredTone === 'leg' ? CEREMONY_COLOR.beamLeg : featuredTone === 'rar' ? CEREMONY_COLOR.dustLilac : CEREMONY_COLOR.beamCommon;
  const beamPeakOpacity = reduceMotionEnabled ? 0.34 : featuredTone === 'leg' ? 0.95 : featuredTone === 'rar' ? 0.78 : 0.5;
  const beamPeakScale = reduceMotionEnabled ? 1.02 : featuredTone === 'leg' ? 1.35 : 1.08;
  const ringPeakOpacity = reduceMotionEnabled ? 0.3 : featuredTone === 'leg' ? 0.85 : 0.62;
  const ringPeakScale = reduceMotionEnabled ? 1.04 : featuredTone === 'leg' ? 1.28 : 1.1;
  const beamStyle = {
    opacity: stageGlow.interpolate({
      inputRange: [0, 1],
      outputRange: [0.18, beamPeakOpacity],
    }),
    transform: [
      {
        scaleY: stageGlow.interpolate({
          inputRange: [0, 1],
          outputRange: [0.65, beamPeakScale],
        }),
      },
    ],
  };
  const ringStyle = {
    opacity: stageGlow.interpolate({
      inputRange: [0, 1],
      outputRange: [0.14, ringPeakOpacity],
    }),
    transform: [
      {
        scale: stageGlow.interpolate({
          inputRange: [0, 1],
          outputRange: [0.72, ringPeakScale],
        }),
      },
    ],
  };

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-ceremony-root">
      <LinearGradient colors={CEREMONY_GRADIENT} style={styles.gradient}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.starLayer}>
          {STAR_FIELD.map((star, index) => (
            <View
              key={`star-${index}`}
              style={[
                styles.star,
                {
                  left: star.left as any,
                  top: star.top as any,
                  width: star.size,
                  height: star.size,
                  borderRadius: star.size,
                  opacity: star.opacity,
                  backgroundColor: star.amber ? colors.glowGold : CEREMONY_COLOR.dustLilac,
                  shadowColor: star.amber ? colors.glowGold : CEREMONY_COLOR.dustLilac,
                },
              ]}
            />
          ))}
          {GLYPH_PARTICLES.map((particle, index) => (
            <Text
              key={`glyph-${index}`}
              style={[
                styles.glyphParticle,
                {
                  left: particle.left as any,
                  top: particle.top as any,
                  fontSize: particle.size,
                  opacity: particle.opacity,
                  color: particle.amber ? CEREMONY_COLOR.particleGold : CEREMONY_COLOR.dustLilac,
                },
              ]}
            >
              {particle.glyph}
            </Text>
          ))}
          <Animated.View style={[styles.verticalBeam, { backgroundColor: beamColor }, beamStyle]} />
          <Animated.View style={[styles.outerRing, { borderColor: beamColor }, ringStyle]} />
          <Animated.View style={[styles.centerGlow, centerGlowStyle]} />
        </View>

        <View style={styles.content}>
          <Text style={styles.metaLine} numberOfLines={1}>{metaLine}</Text>
          {motionHint ? <Text style={styles.motionHint} numberOfLines={1}>{motionHint}</Text> : null}
          <Text style={styles.title} numberOfLines={2}>{ceremonyTitle}</Text>
          <Text style={styles.body} numberOfLines={2}>{ceremonyBody}</Text>
          <Text style={styles.phaseCue} numberOfLines={1}>{phaseCue}</Text>
          {revealHint ? <Text style={styles.revealHint} numberOfLines={1}>{revealHint}</Text> : null}

          <Animated.View style={[styles.stackStage, stageTransform]}>
            {isSinglePull ? (
              <View
                style={[
                  styles.singleCard,
                  phase === 'focus' ? styles.singleCardFocus : null,
                  phase === 'reveal' ? styles.singleCardReveal : null,
                  featuredCard?.rarity === 'LEG'
                    ? styles.singleCardLeg
                    : featuredCard?.rarity === 'RAR'
                      ? styles.singleCardRar
                      : null,
                ]}
              >
                {phase === 'reveal' && featuredCard ? (
                  <>
                    <Text style={styles.singleCardBadge} numberOfLines={1} testID="draw-ceremony-reveal-rarity">{featuredCard.rarity}</Text>
                    <Text style={styles.singleCardQuestion} numberOfLines={3} testID="draw-ceremony-reveal-question">{featuredCard.question}</Text>
                    <Text style={styles.singleCardHint} numberOfLines={2}>{CEREMONY_COPY.single.cardHint}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.cardBackCommand}>{CEREMONY_COPY.cardBackLabel}</Text>
                    <Text style={styles.cardGlyphCenter}>◈</Text>
                  </>
                )}
              </View>
            ) : (
              <>
                {multiPhase === 'stabilize' && featuredCard ? (
                  <View style={styles.finalRevealCard}>
                    <Text style={styles.finalRevealBadge} numberOfLines={1} testID="draw-ceremony-reveal-rarity">{featuredCard.rarity}</Text>
                    <Text style={styles.finalRevealQuestion} numberOfLines={3} testID="draw-ceremony-reveal-question">{featuredCard.question}</Text>
                    <Text style={styles.finalRevealHint} numberOfLines={2}>{CEREMONY_COPY.multi.finalHint}</Text>
                  </View>
                ) : null}
                {STACK_ROTATIONS.map((rotation, index) => (
                  <View
                    key={`back-${rotation}`}
                    style={[
                      styles.cardBack,
                      index === 2 && multiPhase !== 'orbit' ? styles.cardBackHero : null,
                      {
                        transform: [{ translateY: Math.abs(rotation) * 0.45 }, { rotate: `${rotation}deg` }],
                        borderColor: index === 2 ? CEREMONY_COLOR.goldBorderStrong : CEREMONY_COLOR.creamBorderFaint,
                        shadowOpacity: index === 2 ? 0.45 : 0.12,
                        opacity: multiPhase === 'stabilize' && index === 2 ? 0.08 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.cardBackCommand}>{CEREMONY_COPY.cardBackLabel}</Text>
                    <Text style={[styles.cardGlyph, index === 2 && styles.cardGlyphCenter]}>◈</Text>
                  </View>
                ))}
              </>
            )}
          </Animated.View>

          <View style={styles.footerBlock}>
            <Text
              style={[styles.raritySignal, featuredTone === 'leg' ? styles.raritySignalLeg : featuredTone === 'rar' ? styles.raritySignalRar : styles.raritySignalCom]}
              numberOfLines={1}
              testID="draw-ceremony-footer-rarity"
            >
              {raritySignal}
            </Text>
            <Text style={styles.featuredText} numberOfLines={1}>{featuredLine}</Text>
            {drawResult?.pityTriggered ? <Text style={styles.pityText} numberOfLines={1}>{CEREMONY_COPY.pityBonus}</Text> : null}
            <Text style={styles.statsText} numberOfLines={1}>{statsLine}</Text>
          </View>

          <Pressable
            testID="screen-draw-ceremony-primary-cta"
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Show draw result"
            accessibilityHint="Opens the completed draw result."
            onPress={() =>
              navigation.replace('DrawResult', {
                slug: route.params.slug,
                drawResult,
                deckTitle: route.params.deckTitle,
                ceremonyEcho: {
                  rarity: ceremonyEchoRarity,
                  phaseCue: isSinglePull ? CEREMONY_COPY.handoffCue.single : CEREMONY_COPY.handoffCue.multi,
                },
              })
            }
          >
            <Text style={styles.skipText} numberOfLines={1}>{CEREMONY_COPY.primaryCta}</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawCeremonyScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.cosmicBgDeep },
  gradient: { flex: 1 },
  starLayer: { ...StyleSheet.absoluteFillObject },
  star: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  glyphParticle: {
    position: 'absolute',
    fontFamily: 'Courier',
    fontWeight: '700',
  },
  centerGlow: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -130,
    marginTop: -130,
    width: 260,
    height: 260,
    borderRadius: 260,
    backgroundColor: CEREMONY_COLOR.glowVeil,
  },
  verticalBeam: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -12,
    marginTop: -170,
    width: 24,
    height: 340,
    borderRadius: 24,
  },
  outerRing: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -110,
    marginTop: -110,
    width: 220,
    height: 220,
    borderRadius: 220,
    borderWidth: 2,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  metaLine: {
    color: colors.glowGold,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: 'Courier',
  },
  title: {
    marginTop: 12,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    color: colors.cosmicInk,
    textAlign: 'center',
  },
  body: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: CEREMONY_COLOR.copyMuted,
    textAlign: 'center',
    maxWidth: 292,
  },
  phaseCue: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
    color: colors.glowGold,
    textAlign: 'center',
    fontFamily: 'Courier',
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  revealHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: colors.cosmicInk,
    textAlign: 'center',
    fontFamily: 'Courier',
  },
  motionHint: {
    marginTop: 8,
    color: colors.cosmicInk,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: 'Courier',
  },
  stackStage: {
    marginTop: 26,
    height: 270,
    width: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBack: {
    position: 'absolute',
    width: 156,
    height: 220,
    borderRadius: 22,
    backgroundColor: CEREMONY_COLOR.shellStrong,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.glowGold,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  cardBackHero: {
    backgroundColor: CEREMONY_COLOR.shellHero,
  },
  cardGlyph: {
    fontSize: 44,
    color: CEREMONY_COLOR.creamGlyph,
    fontWeight: '700',
    fontFamily: 'Courier',
  },
  cardBackCommand: {
    position: 'absolute',
    top: 18,
    alignSelf: 'center',
    color: CEREMONY_COLOR.copySoft,
    fontSize: 11,
    fontFamily: 'Courier',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  cardGlyphCenter: { color: colors.glowGold, fontSize: 44, fontWeight: '700', fontFamily: 'Courier' },
  singleCard: {
    width: 172,
    height: 238,
    borderRadius: 24,
    backgroundColor: CEREMONY_COLOR.shellStrong,
    borderWidth: 1.5,
    borderColor: CEREMONY_COLOR.creamBorderFaint,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    shadowColor: colors.glowGold,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
  },
  singleCardFocus: {
    borderColor: CEREMONY_COLOR.goldBorderSoft,
  },
  singleCardReveal: {
    borderColor: CEREMONY_COLOR.goldBorderBright,
    backgroundColor: CEREMONY_COLOR.shellReveal,
    shadowOpacity: 0.42,
  },
  singleCardLeg: { backgroundColor: CEREMONY_COLOR.legShell },
  singleCardRar: { backgroundColor: CEREMONY_COLOR.rarShell },
  singleCardBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: CEREMONY_COLOR.whiteBadge,
    color: CEREMONY_COLOR.textBright,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
  },
  singleCardQuestion: {
    marginTop: 14,
    color: CEREMONY_COLOR.textBright,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
  },
  singleCardHint: {
    marginTop: 12,
    color: CEREMONY_COLOR.textSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  finalRevealCard: {
    position: 'absolute',
    width: 172,
    minHeight: 238,
    borderRadius: 24,
    backgroundColor: CEREMONY_COLOR.shellReveal,
    borderWidth: 1.5,
    borderColor: CEREMONY_COLOR.goldCardBorder,
    padding: 18,
    justifyContent: 'flex-end',
    shadowColor: CEREMONY_COLOR.particleGold,
    shadowOpacity: 0.42,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  finalRevealBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: CEREMONY_COLOR.whiteBadge,
    color: CEREMONY_COLOR.textBright,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
  },
  finalRevealQuestion: {
    marginTop: 14,
    color: CEREMONY_COLOR.textBright,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
  },
  finalRevealHint: {
    marginTop: 12,
    color: CEREMONY_COLOR.textSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  footerBlock: {
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: CEREMONY_COLOR.footerBg,
    borderWidth: 1,
    borderColor: CEREMONY_COLOR.footerBorder,
  },
  raritySignal: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    fontFamily: 'Courier',
    textTransform: 'uppercase',
  },
  raritySignalLeg: { color: CEREMONY_COLOR.particleGold },
  raritySignalRar: { color: CEREMONY_COLOR.dustLilac },
  raritySignalCom: { color: CEREMONY_COLOR.copyMuted },
  featuredText: { color: colors.cosmicInk, fontSize: 13, fontWeight: '800', marginTop: 8 },
  pityText: { marginTop: 8, fontSize: 12, fontWeight: '800', color: colors.glowGold, textAlign: 'center' },
  statsText: { marginTop: 8, fontSize: 11, color: CEREMONY_COLOR.copySoft, fontFamily: 'Courier' },
  skipButton: {
    marginTop: 22,
    minHeight: a11y.minTouch,
    minWidth: a11y.minTouch,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: CEREMONY_COLOR.buttonBg,
    borderWidth: 1,
    borderColor: CEREMONY_COLOR.buttonBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { color: colors.cosmicInk, fontWeight: '800', fontSize: 12 },
  pressed: { opacity: 0.92 },
});
