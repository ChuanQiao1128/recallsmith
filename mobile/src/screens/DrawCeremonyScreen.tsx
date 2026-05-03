import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { a11y } from '../theme/a11y';
import { animation } from '../theme/animation';
import { colors } from '../theme/colors';

type CeremonyPhase = 'warmup' | 'focus' | 'reveal';
type MultiPhase = 'orbit' | 'charge' | 'stabilize';

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
} as const;

type Props = NativeStackScreenProps<RootStackParamList, 'DrawCeremony'>;

export function DrawCeremonyScreen({ navigation, route }: Props) {
  const drawResult = route.params.drawResult ?? {
    poolId: route.params.slug,
    cards: [],
    pityBefore: 0,
    pityTriggered: false,
    pityAfter: 0,
    highlightedRarity: null,
  };
  const actualFeaturedRarity = useMemo(() => {
    if (drawResult.cards.some((card) => card.rarity === 'LEG')) return 'LEG';
    if (drawResult.cards.some((card) => card.rarity === 'RAR')) return 'RAR';
    return drawResult.highlightedRarity ?? null;
  }, [drawResult.cards, drawResult.highlightedRarity]);
  const featuredRarity = actualFeaturedRarity ?? (drawResult.pityTriggered ? 'RAR+' : 'COM+');
  const isSinglePull = drawResult.cards.length === 1;
  const featuredCard = drawResult.cards[0] ?? null;
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [phase, setPhase] = useState<CeremonyPhase>('warmup');
  const [multiPhase, setMultiPhase] = useState<MultiPhase>('orbit');

  const stageScale = useRef(new Animated.Value(0.94)).current;
  const stageGlow = useRef(new Animated.Value(0.35)).current;
  const cardLift = useRef(new Animated.Value(18)).current;
  const cardRotate = useRef(new Animated.Value(0)).current;

  const statsLine = useMemo(() => {
    const leg = drawResult.cards.filter((card) => card.rarity === 'LEG').length;
    const rar = drawResult.cards.filter((card) => card.rarity === 'RAR').length;
    const com = drawResult.cards.filter((card) => card.rarity === 'COM').length;
    return `${leg}⚡ · ${rar}🔷 · ${com}⚪ · pity ${drawResult.pityAfter}/10`;
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
        ceremonyEcho: {
          rarity: featuredRarity === 'LEG' || featuredRarity === 'RAR' ? featuredRarity : 'COM',
          phaseCue: isSinglePull ? 'Front face unlocked · Flip axis at 180°' : 'Center card revealed last · Flip axis at 180°',
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
  }, [cardLift, cardRotate, drawResult, featuredRarity, isSinglePull, navigation, reduceMotionEnabled, route.params.slug, stageGlow, stageScale]);

  const ceremonyTitle = isSinglePull
    ? phase === 'warmup'
      ? 'Single pull reveal warming up'
      : phase === 'focus'
        ? 'Single pull locking onto the center card'
        : 'Single pull reward revealed'
    : multiPhase === 'orbit'
      ? 'Cards entering orbit'
      : multiPhase === 'charge'
        ? 'Center card charging the reveal'
        : 'Result spread stabilizing';

  const ceremonyBody = isSinglePull
    ? phase === 'warmup'
      ? 'One reward card is charging before the reveal lands.'
      : phase === 'focus'
        ? 'Hold the center line for the flip.'
        : 'Reward locked. Result handoff is live.'
    : multiPhase === 'orbit'
      ? 'The ten-card fan settles before the center card takes over.'
      : multiPhase === 'charge'
        ? 'The center card owns the spotlight now.'
        : 'Rarity counts and the final spread are locking in.';
  const revealHint = isSinglePull && phase !== 'reveal' ? 'Think first. Tap to reveal.' : null;
  const motionHint = reduceMotionEnabled ? 'Reduced-motion ceremony enabled' : null;
  const phaseCue = isSinglePull
    ? phase === 'focus'
      ? 'Flip breach armed'
      : phase === 'reveal'
        ? 'Front face unlocked · Flip axis at 180°'
        : 'Single-card lock acquired'
    : multiPhase === 'charge'
      ? 'Final breach armed'
      : multiPhase === 'stabilize'
        ? 'Center card revealed last · Flip axis at 180°'
        : 'Deckfall in progress';
  const raritySignal = featuredRarity === 'LEG' ? 'LEG core breach' : featuredRarity === 'RAR' ? 'RAR resonance' : 'COM drift';

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

  const beamColor = featuredRarity === 'LEG' ? 'rgba(245,213,122,0.9)' : featuredRarity === 'RAR' ? CEREMONY_COLOR.dustLilac : 'rgba(214,199,154,0.48)';
  const beamPeakOpacity = reduceMotionEnabled ? 0.34 : featuredRarity === 'LEG' ? 0.95 : featuredRarity === 'RAR' ? 0.78 : 0.5;
  const beamPeakScale = reduceMotionEnabled ? 1.02 : featuredRarity === 'LEG' ? 1.35 : 1.08;
  const ringPeakOpacity = reduceMotionEnabled ? 0.3 : featuredRarity === 'LEG' ? 0.85 : 0.62;
  const ringPeakScale = reduceMotionEnabled ? 1.04 : featuredRarity === 'LEG' ? 1.28 : 1.1;
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
        <View pointerEvents="none" style={styles.starLayer}>
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
                  color: particle.amber ? 'rgba(245,213,122,1)' : CEREMONY_COLOR.dustLilac,
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
          <Text style={styles.metaLine} numberOfLines={1}>{isSinglePull ? 'Single pull ceremony' : 'Reward draw ceremony'} · {drawResult.seedLabel ?? 'seed #----'}</Text>
          <Text style={styles.glyphLegend} numberOfLines={1}>Glyph field online · {CODE_GLYPHS.join(' ')}</Text>
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
                    <Text style={styles.singleCardBadge}>{featuredCard.rarity}</Text>
                    <Text style={styles.singleCardQuestion} numberOfLines={3}>{featuredCard.question}</Text>
                    <Text style={styles.singleCardHint} numberOfLines={2}>One card only · hold the result for the next study run</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.cardBackCommand}>{'> recall.draw()'}</Text>
                    <Text style={styles.cardGlyphCenter}>◈</Text>
                  </>
                )}
              </View>
            ) : (
              <>
                {multiPhase === 'stabilize' && featuredCard ? (
                  <View style={styles.finalRevealCard}>
                    <Text style={styles.finalRevealBadge}>{featuredCard.rarity}</Text>
                    <Text style={styles.finalRevealQuestion} numberOfLines={3}>{featuredCard.question}</Text>
                    <Text style={styles.finalRevealHint} numberOfLines={2}>Center card flips last · the spread locks in behind it</Text>
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
                        borderColor: index === 2 ? 'rgba(232,184,90,0.92)' : 'rgba(245,236,196,0.18)',
                        shadowOpacity: index === 2 ? 0.45 : 0.12,
                        opacity: multiPhase === 'stabilize' && index === 2 ? 0.08 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.cardBackCommand}>{'> recall.draw()'}</Text>
                    <Text style={[styles.cardGlyph, index === 2 && styles.cardGlyphCenter]}>◈</Text>
                  </View>
                ))}
              </>
            )}
          </Animated.View>

          <View style={styles.footerBlock}>
            <Text style={[styles.raritySignal, featuredRarity === 'LEG' ? styles.raritySignalLeg : featuredRarity === 'RAR' ? styles.raritySignalRar : styles.raritySignalCom]}>{raritySignal}</Text>
            <Text style={styles.featuredText} numberOfLines={1}>{isSinglePull ? `Single-pull spotlight: ${featuredRarity}` : `Featured reward window: ${featuredRarity}`}</Text>
            {drawResult?.pityTriggered ? <Text style={styles.pityText} numberOfLines={1}>Pity triggered · RAR+ guaranteed in this reveal</Text> : null}
            <Text style={styles.statsText} numberOfLines={1}>{statsLine}</Text>
          </View>

          <Pressable
            testID="screen-draw-ceremony-primary-cta"
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
            onPress={() =>
              navigation.replace('DrawResult', {
                slug: route.params.slug,
                drawResult,
                ceremonyEcho: {
                  rarity: featuredRarity === 'LEG' || featuredRarity === 'RAR' ? featuredRarity : 'COM',
                  phaseCue: isSinglePull ? 'Front face unlocked · Flip axis at 180°' : 'Center card revealed last · Flip axis at 180°',
                },
              })
            }
          >
            <Text style={styles.skipText} numberOfLines={1}>{isSinglePull ? 'Skip to single-pull result' : 'Skip ceremony'}</Text>
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
  glyphLegend: {
    marginTop: 8,
    color: 'rgba(245,236,196,0.82)',
    fontSize: 11,
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
    color: 'rgba(245,236,196,0.20)',
    fontWeight: '700',
    fontFamily: 'Courier',
  },
  cardBackCommand: {
    position: 'absolute',
    top: 18,
    alignSelf: 'center',
    color: 'rgba(245,236,196,0.72)',
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
    borderColor: 'rgba(245,236,196,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    shadowColor: colors.glowGold,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
  },
  singleCardFocus: {
    borderColor: 'rgba(232,184,90,0.6)',
  },
  singleCardReveal: {
    borderColor: 'rgba(232,184,90,0.9)',
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
    backgroundColor: 'rgba(255,255,255,0.16)',
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
    color: 'rgba(255,247,232,0.8)',
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
    borderColor: 'rgba(245,213,122,0.92)',
    padding: 18,
    justifyContent: 'flex-end',
    shadowColor: 'rgba(245,213,122,1)',
    shadowOpacity: 0.42,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  finalRevealBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
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
    color: 'rgba(255,247,232,0.8)',
    fontSize: 12,
    lineHeight: 17,
  },
  footerBlock: {
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(245,236,196,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.12)',
  },
  raritySignal: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    fontFamily: 'Courier',
    textTransform: 'uppercase',
  },
  raritySignalLeg: { color: 'rgba(245,213,122,1)' },
  raritySignalRar: { color: CEREMONY_COLOR.dustLilac },
  raritySignalCom: { color: CEREMONY_COLOR.copyMuted },
  featuredText: { color: colors.cosmicInk, fontSize: 13, fontWeight: '800', marginTop: 8 },
  pityText: { marginTop: 8, fontSize: 12, fontWeight: '800', color: colors.glowGold, textAlign: 'center' },
  statsText: { marginTop: 8, fontSize: 11, color: 'rgba(245,236,196,0.72)', fontFamily: 'Courier' },
  skipButton: {
    marginTop: 22,
    minHeight: a11y.minTouch,
    minWidth: a11y.minTouch,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(245,236,196,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { color: colors.cosmicInk, fontWeight: '800', fontSize: 12 },
  pressed: { opacity: 0.92 },
});
