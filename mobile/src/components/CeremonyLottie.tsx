// CeremonyLottie — a thin wrapper around lottie-react-native.
//
// IMPORTANT: lottie-react-native is OPTIONAL. The package is not in
// dependencies by default — until the user runs:
//
//     npx expo install lottie-react-native
//     npx expo prebuild
//     # rebuild the dev client
//
// ...this component renders nothing, and DrawCeremonyScreen falls back to its
// hand-rolled Animated visuals. After install it auto-picks up the JSON in
// assets/lottie/pack-opening.json.
//
// Once Lottie is wired, swap the placeholder JSON with anything from
// https://lottiefiles.com (search "card pack opening" / "booster pack" / "loot
// box"). Keep the duration close to ~3s so it lines up with the ceremony
// state-machine timings (560+400+1300+420+460 ≈ 3140 ms).

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as RN from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

// ─── Optional dependency — guarded require so tests + un-installed builds
// don't crash. The require is intentionally inside a try so Metro / Vitest
// don't fail to resolve the module.
function loadLottie(): { LottieView: any | null; source: any | null } {
  let LottieView: any = null;
  let source: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('lottie-react-native');
    LottieView = mod.default ?? mod.LottieView ?? null;
  } catch {
    LottieView = null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    source = require('../../assets/lottie/pack-opening.json');
  } catch {
    source = null;
  }
  return { LottieView, source };
}

const { LottieView, source: defaultSource } = loadLottie();

export const ceremonyLottieAvailable = !!LottieView && !!defaultSource;

export type CeremonyLottieHandle = {
  play: () => void;
  reset: () => void;
};

type Props = {
  /** Override the default placeholder animation. Pass another require()'d JSON. */
  source?: any;
  /** Called when the animation finishes (only fires when Lottie is loaded). */
  onAnimationFinish?: () => void;
  /** Loop the animation. Default false. */
  loop?: boolean;
  /** Width / height. Default fills parent. */
  size?: number;
  /**
   * Playback speed multiplier. Pokemon TCG Pocket's ceremony is snappier than
   * stock Lottie pack-opening animations — default 1.2× lines them up better.
   */
  speed?: number;
};

export const CeremonyLottie = forwardRef<CeremonyLottieHandle, Props>(function CeremonyLottie(
  { source, onAnimationFinish, loop = false, size, speed = 1.2 },
  ref,
) {
  const lottieRef = useRef<any>(null);

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        try {
          lottieRef.current?.play?.();
        } catch {
          /* noop */
        }
      },
      reset: () => {
        try {
          lottieRef.current?.reset?.();
        } catch {
          /* noop */
        }
      },
    }),
    [],
  );

  const animationSource = source ?? defaultSource;
  if (!LottieView || !animationSource) {
    // Lottie not installed — render nothing. Caller should already be showing
    // the hand-rolled fallback.
    return null;
  }

  return (
    <View pointerEvents="none" style={lottieStyles.wrap}>
      <LottieView
        ref={lottieRef}
        source={animationSource}
        autoPlay
        loop={loop}
        speed={speed}
        onAnimationFinish={onAnimationFinish}
        resizeMode="contain"
        style={size ? { width: size, height: size } : lottieStyles.fill}
      />
    </View>
  );
});

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
const PARTICLE_COUNT = 30;

export type CeremonyPeakRarity = 'COM' | 'RAR' | 'LEG';

type CeremonyPackPalette = {
  cover: readonly [string, string, string, string];
  ring: string;
};

type CeremonyFlyInLane = {
  driver: any;
  fromX: number;
  fromY: number;
  fromRot: string;
  toX: number;
  toY: number;
  toRot: string;
  finalScale: number;
  finalOpacity: number;
  zIndex: number;
};

export type CeremonyParticle = {
  angle: number;
  distance: number;
  size: number;
  color: string;
  delay: number;
  driver: any;
};

export function buildParticles(accent: string, peakRarity: CeremonyPeakRarity): CeremonyParticle[] {
  const palette =
    peakRarity === 'LEG'
      ? [accent, colors.shine, colors.parchmentBgDeep]
      : peakRarity === 'RAR'
        ? [accent, colors.shine, colors.softLavender]
        : [accent, colors.shine, colors.softPeach];
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (i % 3) * 0.18;
    const distance = 70 + ((i * 37) % 110);
    const size = 4 + ((i * 13) % 7);
    return {
      angle,
      distance,
      size,
      color: palette[i % palette.length],
      delay: (i * 6) % 80,
      driver: hasAnimated ? new A.Value(0) : null,
    };
  });
}

export function SparkleField({ shown, color }: { shown: boolean; color: string }) {
  return (
    <View pointerEvents="none" style={ceremonyStyles.sparkleField}>
      {[...Array(12)].map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const radius = 95 + (i % 3) * 22;
        const left = 140 + Math.cos(angle) * radius;
        const top = 160 + Math.sin(angle) * radius;
        const size = i % 4 === 0 ? 10 : i % 3 === 0 ? 6 : 4;
        return (
          <View
            key={`sparkle-${i}`}
            style={[
              ceremonyStyles.sparkleDot,
              {
                left,
                top,
                width: size,
                height: size,
                borderRadius: size,
                backgroundColor: color,
                opacity: shown ? 0.85 : 0,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export function ParticleBurst({
  particles,
  active,
}: {
  particles: CeremonyParticle[];
  active: boolean;
}) {
  if (!hasAnimated || !active) return null;
  return (
    <View pointerEvents="none" style={ceremonyStyles.particleField}>
      {particles.map((p, i) => {
        const tx = p.driver.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.cos(p.angle) * p.distance],
        });
        const ty = p.driver.interpolate({
          inputRange: [0, 1],
          outputRange: [0, Math.sin(p.angle) * p.distance],
        });
        const opacity = p.driver.interpolate({
          inputRange: [0, 0.15, 1],
          outputRange: [0, 1, 0],
        });
        const scale = p.driver.interpolate({
          inputRange: [0, 0.4, 1],
          outputRange: [0, 1.4, 0.5],
        });
        return (
          <AnimatedView
            key={`particle-${i}`}
            style={[
              ceremonyStyles.particle,
              {
                width: p.size,
                height: p.size,
                borderRadius: p.size,
                backgroundColor: p.color,
                transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                opacity,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export function RevealCard({
  flipDriver,
  shown,
  accent,
  rarityText,
  questionText,
  packPaletteCover,
  reduceMotion,
  coverImage,
}: {
  flipDriver: any;
  shown: boolean;
  accent: string;
  rarityText: string;
  questionText: string;
  packPaletteCover: CeremonyPackPalette['cover'];
  reduceMotion: boolean;
  coverImage: any;
}) {
  if (!hasAnimated || reduceMotion) {
    return (
      <View
        style={[
          ceremonyStyles.flipCard,
          shown && [ceremonyStyles.flipCardRevealed, { borderColor: accent }],
        ]}
      >
        {shown ? (
          <View style={ceremonyStyles.flipFront}>
            <View style={[ceremonyStyles.cardRarityChip, { backgroundColor: accent }]}>
              <Text style={ceremonyStyles.cardRarity} testID="draw-ceremony-reveal-rarity" numberOfLines={1}>
                {rarityText}
              </Text>
            </View>
            <Text
              style={ceremonyStyles.cardQuestion}
              testID="draw-ceremony-reveal-question"
              numberOfLines={3}
            >
              {questionText}
            </Text>
          </View>
        ) : (
          <LinearGradient
            colors={packPaletteCover}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={ceremonyStyles.flipBackGradient}
          >
            <Text style={ceremonyStyles.cardBackText} numberOfLines={1}>
              Reward card
            </Text>
          </LinearGradient>
        )}
      </View>
    );
  }

  const frontRotate = flipDriver.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backRotate = flipDriver.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });
  const frontOpacity = flipDriver.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipDriver.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });
  const liftScale = flipDriver.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.06, 1],
  });

  return (
    <AnimatedView style={[ceremonyStyles.flipWrap, { transform: [{ scale: liftScale }] }]}>
      <AnimatedView
        style={[
          ceremonyStyles.flipFace,
          {
            opacity: frontOpacity,
            transform: [{ perspective: 1000 }, { rotateY: frontRotate }],
          },
        ]}
      >
        <LinearGradient
          colors={packPaletteCover}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[ceremonyStyles.flipBackGradient, { borderColor: accent }]}
        >
          {coverImage && RNImage ? (
            <RNImage
              source={coverImage}
              resizeMode="cover"
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          ) : null}
          <Text style={ceremonyStyles.cardBackText} numberOfLines={1}>
            Reward card
          </Text>
        </LinearGradient>
      </AnimatedView>

      <AnimatedView
        style={[
          ceremonyStyles.flipFace,
          ceremonyStyles.flipCardRevealed,
          {
            borderColor: accent,
            opacity: backOpacity,
            transform: [{ perspective: 1000 }, { rotateY: backRotate }],
          },
        ]}
      >
        <View style={ceremonyStyles.flipFront}>
          <View style={[ceremonyStyles.cardRarityChip, { backgroundColor: accent }]}>
            <Text style={ceremonyStyles.cardRarity} testID="draw-ceremony-reveal-rarity" numberOfLines={1}>
              {rarityText}
            </Text>
          </View>
          <Text
            style={ceremonyStyles.cardQuestion}
            testID="draw-ceremony-reveal-question"
            numberOfLines={3}
          >
            {questionText}
          </Text>
        </View>
      </AnimatedView>
    </AnimatedView>
  );
}

function FlyInPack({
  lane,
  palette,
  coverImage,
}: {
  lane: CeremonyFlyInLane;
  palette: CeremonyPackPalette;
  coverImage: any;
}) {
  const tx =
    hasAnimated && lane.driver
      ? lane.driver.interpolate({
          inputRange: [0, 1],
          outputRange: [lane.fromX, lane.toX],
        })
      : lane.toX;
  const ty =
    hasAnimated && lane.driver
      ? lane.driver.interpolate({
          inputRange: [0, 1],
          outputRange: [lane.fromY, lane.toY],
        })
      : lane.toY;
  const rot =
    hasAnimated && lane.driver
      ? lane.driver.interpolate({
          inputRange: [0, 1],
          outputRange: [lane.fromRot, lane.toRot],
        })
      : lane.toRot;
  const opacity =
    hasAnimated && lane.driver
      ? lane.driver.interpolate({
          inputRange: [0, 0.4, 1],
          outputRange: [0, lane.finalOpacity * 0.85, lane.finalOpacity],
        })
      : lane.finalOpacity;

  return (
    <AnimatedView
      style={[
        ceremonyStyles.flyInPack,
        {
          opacity,
          zIndex: lane.zIndex,
          transform: [
            { translateX: tx },
            { translateY: ty },
            { rotate: rot },
            { scale: lane.finalScale },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={palette.cover}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[ceremonyStyles.flyInPackInner, { borderColor: palette.ring }]}
      >
        {coverImage && RNImage ? (
          <RNImage
            source={coverImage}
            resizeMode="cover"
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
        ) : null}
      </LinearGradient>
    </AnimatedView>
  );
}

export function MultiPackFlyIn({
  leftRef,
  centerRef,
  rightRef,
  palette,
  coverImage,
  testID,
}: {
  leftRef: any;
  centerRef: any;
  rightRef: any;
  palette: CeremonyPackPalette;
  coverImage: any;
  testID?: string;
}) {
  const lanes: CeremonyFlyInLane[] = [
    {
      driver: leftRef,
      fromX: -260,
      fromY: -200,
      fromRot: '-32deg',
      toX: -88,
      toY: 18,
      toRot: '-9deg',
      finalScale: 0.78,
      finalOpacity: 0.55,
      zIndex: 1,
    },
    {
      driver: rightRef,
      fromX: 260,
      fromY: -200,
      fromRot: '32deg',
      toX: 88,
      toY: 18,
      toRot: '9deg',
      finalScale: 0.78,
      finalOpacity: 0.55,
      zIndex: 1,
    },
    {
      driver: centerRef,
      fromX: 0,
      fromY: -260,
      fromRot: '0deg',
      toX: 0,
      toY: 0,
      toRot: '0deg',
      finalScale: 1,
      finalOpacity: 1,
      zIndex: 3,
    },
  ];

  return (
    <View pointerEvents="none" style={ceremonyStyles.flyInStage} testID={testID}>
      {lanes.map((lane, idx) => (
        <FlyInPack key={`fly-${idx}`} lane={lane} palette={palette} coverImage={coverImage} />
      ))}
    </View>
  );
}

export const ceremonyStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  gradient: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  haloLarge: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 420,
    top: '20%',
    alignSelf: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  phaseTitle: {
    color: colors.inkSoft,
    fontSize: typography.title1,
    lineHeight: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  phaseBody: {
    marginTop: spacing.xs,
    color: colors.inkMuted,
    fontSize: typography.bodySmall,
    fontWeight: '700',
    textAlign: 'center',
  },
  stage: {
    marginTop: spacing.lg,
    width: 280,
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleField: {
    ...StyleSheet.absoluteFillObject,
  },
  sparkleDot: {
    position: 'absolute',
    shadowColor: colors.shine,
    shadowOpacity: 0.7,
    shadowRadius: 4,
  },
  particleField: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    shadowColor: colors.shine,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  swipePack: {
    width: 220,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipePackInner: {
    width: 200,
    minHeight: 240,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
    shadowColor: 'rgba(58,35,5,0.3)',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  swipeTrack: {
    marginTop: spacing.md,
    width: 156,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.softMist,
    paddingHorizontal: 4,
    alignItems: 'flex-start',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  swipeTrackShell: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: colors.pokeBlueFaint,
  },
  swipeThumb: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
  },
  swipeHint: {
    marginTop: spacing.sm,
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  holdMarker: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  stageCard: {
    width: 200,
    minHeight: 280,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: colors.softMist,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    shadowColor: 'rgba(58,35,5,0.32)',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
    overflow: 'hidden',
  },
  stageCardBack: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  stageCardTear: {
    transform: [{ rotate: '8deg' }],
  },
  flyInStage: {
    width: 280,
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flyInPack: {
    position: 'absolute',
    width: 160,
    height: 224,
    borderRadius: 22,
    shadowColor: 'rgba(58,35,5,0.4)',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  flyInPackInner: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 2,
    overflow: 'hidden',
  },
  flipWrap: {
    width: 200,
    height: 280,
  },
  flipFace: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: colors.softMist,
    overflow: 'hidden',
  },
  flipBackGradient: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  flipFront: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  flipCard: {
    width: 200,
    minHeight: 280,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: colors.softMist,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: 'rgba(58,35,5,0.32)',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  flipCardRevealed: {
    backgroundColor: colors.softMist,
    borderWidth: 4,
    shadowColor: 'rgba(58,35,5,0.4)',
    shadowOpacity: 0.6,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  orbitStage: {
    width: 248,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitCard: {
    position: 'absolute',
    width: 150,
    minHeight: 210,
    borderRadius: 20,
    borderWidth: 3,
    backgroundColor: colors.softMist,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    shadowColor: 'rgba(58,35,5,0.32)',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  orbitCardLeft: {
    transform: [{ translateX: -88 }, { rotate: '-10deg' }, { scale: 0.9 }],
    opacity: 0.55,
  },
  orbitCardCenter: {
    transform: [{ scale: 1 }],
    zIndex: 2,
  },
  orbitCardRight: {
    transform: [{ translateX: 88 }, { rotate: '10deg' }, { scale: 0.9 }],
    opacity: 0.55,
  },
  orbitCenterCard: {
    position: 'absolute',
    width: 168,
    minHeight: 232,
    borderRadius: 22,
    borderWidth: 4,
    backgroundColor: colors.softMist,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    zIndex: 30,
    shadowColor: 'rgba(58,35,5,0.38)',
    shadowOpacity: 0.56,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 9,
  },
  orbitRarity: {
    color: colors.inkSoft,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 1,
  },
  cardBackText: {
    color: colors.shine,
    fontSize: typography.bodySmall,
    fontWeight: '800',
  },
  cardRarityChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cardRarity: {
    color: colors.shine,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  cardQuestion: {
    marginTop: spacing.sm,
    color: colors.inkSoft,
    fontSize: typography.title3,
    lineHeight: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  footerRarity: {
    marginTop: spacing.md,
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  skipButton: {
    marginTop: spacing.md,
    minHeight: a11y.minTouch,
    minWidth: 140,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.softMist,
    borderWidth: 2,
    borderColor: colors.pokeBlueFaint,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  skipText: {
    color: colors.pokeBlueDeep,
    fontSize: typography.bodySmall,
    fontWeight: '900',
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
  },
  pressed: { opacity: 0.9 },
});

const lottieStyles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});

export default CeremonyLottie;
