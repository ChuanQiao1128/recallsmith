import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as RN from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { CEREMONY_COPY_V9, getCeremonyPhaseCopy } from '../features/gacha/draw/ceremonyCopy';
import {
  PAGE_GRADIENT_CEREMONY,
  packImageForSlug,
  packPaletteFromSlug,
  rarityAccentColor,
  rarityHaloColor,
} from '../theme/packArt';
import {
  buildParticles,
  CeremonyLottie,
  ceremonyLottieAvailable,
  ceremonyStyles as styles,
  MultiPackFlyIn,
  ParticleBurst,
  RevealCard,
  SparkleField,
  type CeremonyLottieHandle,
  type CeremonyPeakRarity,
} from '../components/CeremonyLottie';

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

type Props = NativeStackScreenProps<RootStackParamList, 'DrawCeremony'>;

type DrawCeremonyResult = NonNullable<RootStackParamList['DrawCeremony']['drawResult']>;
type CeremonyPhase = 'swipe' | 'approach' | 'hold' | 'tear-flip' | 'flash-reveal' | 'settle';
type PeakRarity = CeremonyPeakRarity;

const SWIPE_TRIGGER_DISTANCE = 72;
const REDUCED_MOTION_FLASH_MS = 180;
const REDUCED_MOTION_SETTLE_MS = 240;

function rarityRank(rarity: PeakRarity): number {
  if (rarity === 'LEG') return 2;
  if (rarity === 'RAR') return 1;
  return 0;
}

function resolvePeakRarity(drawResult: DrawCeremonyResult): PeakRarity {
  if (drawResult.cards.length === 0) {
    return drawResult.highlightedRarity ?? 'COM';
  }
  let peak: PeakRarity = 'COM';
  for (const card of drawResult.cards) {
    if (rarityRank(card.rarity) > rarityRank(peak)) {
      peak = card.rarity;
    }
  }
  return peak;
}

function phaseDurations(isMulti: boolean, peakRarity: PeakRarity): Record<CeremonyPhase, number> {
  const hold = isMulti
    ? peakRarity === 'LEG'
      ? 300
      : peakRarity === 'RAR'
        ? 260
        : 220
    : peakRarity === 'LEG'
      ? 220
      : peakRarity === 'RAR'
        ? 180
        : 140;
  return {
    swipe: 0,
    approach: isMulti ? 620 : 300,
    hold,
    'tear-flip': isMulti ? 940 : 360,
    'flash-reveal': isMulti ? 280 : 220,
    settle: isMulti ? 300 : 200,
  };
}

function flashColor(rarity: PeakRarity): string {
  if (rarity === 'LEG') return 'rgba(245,201,94,0.95)';
  if (rarity === 'RAR') return 'rgba(201,173,247,0.95)';
  return 'rgba(255,255,255,0.88)';
}

function pickFeaturedCard(cards: DrawCeremonyResult['cards']) {
  return (
    cards.find((card) => card.rarity === 'LEG') ??
    cards.find((card) => card.rarity === 'RAR') ??
    cards[0] ??
    null
  );
}

export function DrawCeremonyScreen({ navigation, route }: Props) {
  const drawResult: DrawCeremonyResult = route.params.drawResult ?? {
    poolId: route.params.slug,
    cards: [],
    pityBefore: 0,
    pityAfter: 0,
    pityTriggered: false,
    highlightedRarity: null,
  };

  const [phase, setPhase] = useState<CeremonyPhase>('swipe');
  const [canSkip, setCanSkip] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [sequenceToken, setSequenceToken] = useState(0);
  const [orbitProgress, setOrbitProgress] = useState(0);
  const [orbitSamples, setOrbitSamples] = useState(0);
  const [particlesActive, setParticlesActive] = useState(false);

  const timers = useRef<number[]>([]);
  const swipeStartXRef = useRef<number | null>(null);
  const orbitTimerRef = useRef<number | null>(null);

  const bobRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const scaleRef = useRef<any>(hasAnimated ? new A.Value(1) : null);
  const rotateRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const flipRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const shakeRef = useRef<any>(hasAnimated ? new A.Value(0) : null);

  const lottieRef = useRef<CeremonyLottieHandle | null>(null);

  const flyInLeftRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const flyInCenterRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const flyInRightRef = useRef<any>(hasAnimated ? new A.Value(0) : null);

  const isMulti = drawResult.cards.length > 1;
  const peakRarity = resolvePeakRarity(drawResult);
  const featured = pickFeaturedCard(drawResult.cards);
  const durations = useMemo(() => phaseDurations(isMulti, peakRarity), [isMulti, peakRarity]);

  const phaseCopy = getCeremonyPhaseCopy(phase, isMulti);
  const approachTitle =
    phase === 'approach'
      ? peakRarity === 'LEG'
        ? CEREMONY_COPY_V9.approach.rareTitles.LEG
        : peakRarity === 'RAR'
          ? CEREMONY_COPY_V9.approach.rareTitles.RAR
          : CEREMONY_COPY_V9.approach.rareTitles.COM
      : phaseCopy.title;

  const palette = useMemo(() => packPaletteFromSlug(route.params.slug), [route.params.slug]);
  const coverImage = useMemo(() => packImageForSlug(route.params.slug), [route.params.slug]);
  const haloColor = rarityHaloColor(peakRarity);
  const accent = rarityAccentColor(peakRarity);

  const particles = useMemo(() => buildParticles(accent, peakRarity), [accent, peakRarity]);

  const goResult = useCallback(() => {
    navigation.replace('DrawResult', {
      slug: route.params.slug,
      drawResult,
      deckTitle: route.params.deckTitle,
      ownedAfter: route.params.ownedAfter,
      totalCards: route.params.totalCards,
      ceremonyEcho: {
        rarity: peakRarity,
        phaseCue: CEREMONY_COPY_V9.settle.body,
      },
    });
  }, [
    drawResult,
    navigation,
    peakRarity,
    route.params.deckTitle,
    route.params.ownedAfter,
    route.params.slug,
    route.params.totalCards,
  ]);

  const startSequence = useCallback(() => {
    setSwipeProgress(0);
    setSequenceToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(!!enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled: boolean) => {
        setReduceMotion(!!enabled);
      },
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (!hasAnimated || phase !== 'swipe' || !bobRef.current) return;
    const bob = A.loop(
      A.sequence([
        A.timing(bobRef.current, { toValue: 1, duration: 1400, useNativeDriver: true }),
        A.timing(bobRef.current, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    bob.start?.();
    return () => bob.stop?.();
  }, [phase]);

  useEffect(() => {
    if (!hasAnimated) return;
    if (phase === 'approach') {
      scaleRef.current?.setValue(0.7);
      rotateRef.current?.setValue(0);
      flipRef.current?.setValue(0);
      A.spring(scaleRef.current, {
        toValue: 1.05,
        useNativeDriver: true,
        friction: 5,
        tension: 80,
      }).start();

      [flyInLeftRef, flyInCenterRef, flyInRightRef].forEach((r) => {
        r.current?.setValue(0);
      });
      A.parallel([
        A.timing(flyInCenterRef.current, {
          toValue: 1,
          duration: 360,
          useNativeDriver: true,
        }),
        A.sequence([
          A.delay(80),
          A.timing(flyInLeftRef.current, {
            toValue: 1,
            duration: 320,
            useNativeDriver: true,
          }),
        ]),
        A.sequence([
          A.delay(140),
          A.timing(flyInRightRef.current, {
            toValue: 1,
            duration: 320,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    } else if (phase === 'hold') {
      A.timing(scaleRef.current, {
        toValue: 1.18,
        duration: durations.hold,
        useNativeDriver: true,
      }).start();
    } else if (phase === 'tear-flip') {
      A.parallel([
        A.timing(rotateRef.current, {
          toValue: 1,
          duration: durations['tear-flip'] * 0.7,
          useNativeDriver: true,
        }),
        A.timing(scaleRef.current, {
          toValue: 0.55,
          duration: durations['tear-flip'] * 0.7,
          useNativeDriver: true,
        }),
      ]).start();
      if (ceremonyLottieAvailable) {
        try {
          lottieRef.current?.reset();
          lottieRef.current?.play();
        } catch {
          /* noop */
        }
      }
    } else if (phase === 'flash-reveal') {
      setParticlesActive(true);
      particles.forEach((p) => {
        if (!p.driver) return;
        p.driver.setValue(0);
        A.sequence([
          A.delay(p.delay),
          A.timing(p.driver, {
            toValue: 1,
            duration: 720 + ((p.size * 47) % 220),
            useNativeDriver: true,
          }),
        ]).start();
      });

      flipRef.current?.setValue(0);
      A.timing(flipRef.current, {
        toValue: 1,
        duration: durations['flash-reveal'] + durations.settle * 0.4,
        useNativeDriver: true,
      }).start();

      if (peakRarity === 'LEG' && shakeRef.current) {
        shakeRef.current.setValue(0);
        A.sequence([
          A.timing(shakeRef.current, { toValue: -6, duration: 40, useNativeDriver: true }),
          A.timing(shakeRef.current, { toValue: 5, duration: 40, useNativeDriver: true }),
          A.timing(shakeRef.current, { toValue: -4, duration: 40, useNativeDriver: true }),
          A.timing(shakeRef.current, { toValue: 3, duration: 40, useNativeDriver: true }),
          A.timing(shakeRef.current, { toValue: -2, duration: 40, useNativeDriver: true }),
          A.timing(shakeRef.current, { toValue: 0, duration: 40, useNativeDriver: true }),
        ]).start();
      }
    } else if (phase === 'settle') {
      const t = setTimeout(() => setParticlesActive(false), 800) as unknown as number;
      timers.current.push(t);
    }
  }, [phase, durations, peakRarity, particles]);

  useEffect(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];
    if (orbitTimerRef.current != null) {
      clearInterval(orbitTimerRef.current);
      orbitTimerRef.current = null;
    }

    setCanSkip(false);
    setOrbitProgress(0);
    setOrbitSamples(0);

    if (reduceMotion) {
      setPhase('flash-reveal');
      setCanSkip(false);
      const settleCue = setTimeout(() => {
        setPhase('settle');
        setCanSkip(true);
      }, REDUCED_MOTION_FLASH_MS) as unknown as number;
      const done = setTimeout(() => {
        goResult();
      }, REDUCED_MOTION_FLASH_MS + REDUCED_MOTION_SETTLE_MS) as unknown as number;
      timers.current.push(settleCue, done);
      return () => {
        timers.current.forEach((timer) => clearTimeout(timer));
      };
    }

    if (sequenceToken === 0) {
      setPhase('swipe');
      return () => {
        timers.current.forEach((timer) => clearTimeout(timer));
      };
    }

    setPhase('approach');
    const holdTimer = setTimeout(() => setPhase('hold'), durations.approach) as unknown as number;
    const tearTimer = setTimeout(
      () => setPhase('tear-flip'),
      durations.approach + durations.hold,
    ) as unknown as number;
    const flashTimer = setTimeout(
      () => setPhase('flash-reveal'),
      durations.approach + durations.hold + durations['tear-flip'],
    ) as unknown as number;
    const settleTimer = setTimeout(
      () => {
        setPhase('settle');
        setCanSkip(true);
      },
      durations.approach +
        durations.hold +
        durations['tear-flip'] +
        durations['flash-reveal'],
    ) as unknown as number;

    const autoAdvanceTail = ceremonyLottieAvailable ? 4500 : 500;
    const autoTimer = setTimeout(
      () => goResult(),
      durations.approach +
        durations.hold +
        durations['tear-flip'] +
        durations['flash-reveal'] +
        durations.settle +
        autoAdvanceTail,
    ) as unknown as number;

    timers.current.push(holdTimer, tearTimer, flashTimer, settleTimer, autoTimer);

    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      if (orbitTimerRef.current != null) {
        clearInterval(orbitTimerRef.current);
        orbitTimerRef.current = null;
      }
    };
  }, [durations, goResult, reduceMotion, sequenceToken]);

  useEffect(() => {
    if (phase !== 'tear-flip' || !isMulti) return;
    const duration = Math.max(1, durations['tear-flip']);
    const startedAt = Date.now();
    setOrbitProgress(0);
    setOrbitSamples(0);
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const nextProgress = Math.min(1, elapsed / duration);
      setOrbitProgress(nextProgress);
      setOrbitSamples((count) => count + 1);
      if (nextProgress >= 1) {
        clearInterval(interval);
        orbitTimerRef.current = null;
      }
    }, 33) as unknown as number;
    orbitTimerRef.current = interval;
    return () => {
      clearInterval(interval);
      orbitTimerRef.current = null;
    };
  }, [durations, isMulti, phase, ceremonyLottieAvailable]);

  const revealRarityText = featured?.rarity ?? peakRarity;
  const revealQuestionText = featured?.question ?? 'Cards revealed';
  const orbitFocus = Math.min(1, orbitProgress * 1.35);
  const orbitCenterScale = 0.86 + orbitFocus * 0.24;
  const orbitCenterLift = -6 + orbitFocus * 6;
  const orbitCards =
    isMulti && drawResult.cards.length > 0
      ? Array.from({ length: Math.min(10, Math.max(6, drawResult.cards.length)) }, (_, index) => {
          const card = drawResult.cards[index % drawResult.cards.length];
          return {
            id: `${card.stableUid}-${index}`,
            rarity: card.rarity,
            angle: orbitProgress * Math.PI * 2 + (index / Math.min(10, Math.max(6, drawResult.cards.length))) * Math.PI * 2,
          };
        })
      : [];

  const bobTranslate =
    hasAnimated && bobRef.current
      ? bobRef.current.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] })
      : 0;
  const bobWobble =
    hasAnimated && bobRef.current
      ? bobRef.current.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: ['-1.6deg', '0deg', '1.6deg'],
        })
      : '0deg';
  const rotateValue =
    hasAnimated && rotateRef.current
      ? rotateRef.current.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] })
      : '0deg';

  const showSparkles = phase === 'hold' || phase === 'tear-flip';
  const showCard = reduceMotion
    ? phase === 'flash-reveal' || phase === 'settle'
    : ceremonyLottieAvailable
      ? phase === 'settle'
      : phase === 'flash-reveal' || phase === 'settle';

  const rootShakeStyle = hasAnimated && shakeRef.current ? { transform: [{ translateX: shakeRef.current }] } : null;

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-ceremony-root">
      <LinearGradient colors={PAGE_GRADIENT_CEREMONY} style={styles.gradient}>
        <View style={styles.backdrop} testID="draw-ceremony-backdrop" />

        <View
          pointerEvents="none"
          style={[
            styles.haloLarge,
            {
              backgroundColor: haloColor,
              opacity: phase === 'swipe' ? 0.35 : phase === 'approach' ? 0.6 : 0.85,
            },
          ]}
        />

        <AnimatedView style={[styles.content, rootShakeStyle]}>
          <Text style={styles.phaseTitle} testID="draw-ceremony-phase-copy" numberOfLines={1}>
            {phase === 'approach' ? approachTitle : phaseCopy.title}
          </Text>
          <Text style={styles.phaseBody} numberOfLines={1} testID="draw-ceremony-phase-body-copy">
            {phaseCopy.body}
          </Text>

          <View
            style={styles.stage}
            testID="draw-ceremony-stage"
            onStartShouldSetResponder={() => !reduceMotion && phase === 'swipe'}
            onMoveShouldSetResponder={() => !reduceMotion && phase === 'swipe'}
            onResponderGrant={(event) => {
              if (reduceMotion || phase !== 'swipe') return;
              const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
              swipeStartXRef.current = touchX;
            }}
            onResponderMove={(event) => {
              if (reduceMotion || phase !== 'swipe' || swipeStartXRef.current == null) return;
              const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
              const delta = Math.max(0, touchX - swipeStartXRef.current);
              setSwipeProgress(Math.min(1, delta / SWIPE_TRIGGER_DISTANCE));
            }}
            onResponderRelease={(event) => {
              if (reduceMotion || phase !== 'swipe') return;
              const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
              const startX = swipeStartXRef.current ?? touchX;
              swipeStartXRef.current = null;
              const delta = touchX - startX;
              if (delta >= SWIPE_TRIGGER_DISTANCE) {
                startSequence();
                return;
              }
              setSwipeProgress(0);
            }}
            onResponderTerminate={() => {
              swipeStartXRef.current = null;
              if (phase === 'swipe') {
                setSwipeProgress(0);
              }
            }}
          >
            <SparkleField shown={showSparkles} color={accent} />

            {!ceremonyLottieAvailable ? (
              <ParticleBurst particles={particles} active={particlesActive} />
            ) : null}

            {phase === 'hold' ? (
              <View testID="draw-ceremony-hold-marker" style={styles.holdMarker} />
            ) : null}

            {ceremonyLottieAvailable &&
            (phase === 'tear-flip' || phase === 'flash-reveal' || phase === 'settle') ? (
              <CeremonyLottie
                ref={lottieRef}
                onAnimationFinish={() => {
                  if (phase === 'settle') {
                    goResult();
                  }
                }}
              />
            ) : null}

            {phase === 'swipe' ? (
              <AnimatedView
                style={[
                  styles.swipePack,
                  hasAnimated
                    ? { transform: [{ translateY: bobTranslate }, { rotate: bobWobble }] }
                    : null,
                ]}
                testID="draw-ceremony-swipe-pack"
              >
                <LinearGradient
                  colors={palette.cover}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={[styles.swipePackInner, { borderColor: palette.ring }]}
                >
                  {coverImage && RNImage ? (
                    <RNImage
                      source={coverImage}
                      resizeMode="cover"
                      style={StyleSheet.absoluteFillObject}
                      pointerEvents="none"
                    />
                  ) : null}
                  <Text style={styles.cardBackText} numberOfLines={1}>
                    Reward pack
                  </Text>
                </LinearGradient>
                <View style={styles.swipeTrack}>
                  <View style={styles.swipeTrackShell} />
                  <View
                    style={[
                      styles.swipeThumb,
                      { transform: [{ translateX: swipeProgress * 110 }] },
                    ]}
                  />
                </View>
                <Text style={styles.swipeHint} numberOfLines={1}>
                  Swipe right to rip open
                </Text>
              </AnimatedView>
            ) : phase === 'tear-flip' && isMulti ? (
              <View style={styles.orbitStage} testID="draw-ceremony-orbit-stage">
                <Text style={styles.holdMarker} testID="draw-ceremony-orbit-progress">
                  {orbitProgress.toFixed(2)}
                </Text>
                <Text style={styles.holdMarker} testID="draw-ceremony-orbit-samples">
                  {orbitSamples}
                </Text>
                <Text style={styles.holdMarker} testID="draw-ceremony-orbit-focus">
                  {orbitFocus.toFixed(2)}
                </Text>
                <Text style={styles.holdMarker} testID="draw-ceremony-orbit-mode">
                  {ceremonyLottieAvailable ? 'lottie' : 'fallback'}
                </Text>
                {orbitCards.map((orbitCard) => {
                  const depth = (Math.sin(orbitCard.angle) + 1) / 2;
                  const translateX = Math.cos(orbitCard.angle) * 90;
                  const translateY = Math.sin(orbitCard.angle) * 38;
                  const scale = 0.62 + depth * 0.34;
                  const opacity = 0.26 + depth * 0.48;
                  return (
                  <View
                    key={orbitCard.id}
                    style={[
                      styles.orbitCard,
                      {
                        zIndex: Math.round(depth * 10) + 1,
                        opacity,
                        transform: [
                          { translateX },
                          { translateY },
                          { rotate: `${Math.cos(orbitCard.angle) * 12}deg` },
                          { scale },
                        ],
                      },
                      { borderColor: rarityAccentColor(orbitCard.rarity) },
                    ]}
                  >
                    <Text style={styles.orbitRarity} numberOfLines={1}>
                      {orbitCard.rarity}
                    </Text>
                  </View>
                  );
                })}
                <View
                  style={[
                    styles.orbitCenterCard,
                    {
                      borderColor: rarityAccentColor(revealRarityText),
                      transform: [{ translateY: orbitCenterLift }, { scale: orbitCenterScale }],
                    },
                  ]}
                  testID="draw-ceremony-orbit-center"
                >
                  <Text style={styles.orbitRarity} numberOfLines={1}>
                    {revealRarityText}
                  </Text>
                </View>
              </View>
            ) : showCard ? (
              <RevealCard
                flipDriver={flipRef.current}
                shown
                accent={accent}
                rarityText={revealRarityText}
                questionText={revealQuestionText}
                packPaletteCover={palette.cover}
                reduceMotion={reduceMotion}
                coverImage={coverImage}
              />
            ) : ceremonyLottieAvailable && phase === 'tear-flip' ? (
              <View />
            ) : phase === 'approach' || phase === 'hold' ? (
              isMulti ? (
                <MultiPackFlyIn
                  leftRef={flyInLeftRef.current}
                  centerRef={flyInCenterRef.current}
                  rightRef={flyInRightRef.current}
                  palette={palette}
                  coverImage={coverImage}
                  testID="draw-ceremony-multi-flyin"
                />
              ) : (
                <AnimatedView
                  testID="draw-ceremony-single-pack-flyin"
                  style={[
                    styles.stageCard,
                    hasAnimated
                      ? {
                          transform: [
                            { scale: scaleRef.current ?? 1 },
                            { rotate: rotateValue },
                          ],
                        }
                      : null,
                  ]}
                >
                  <LinearGradient
                    colors={palette.cover}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 0.9, y: 1 }}
                    style={styles.stageCardBack}
                  >
                    {coverImage && RNImage ? (
                      <RNImage
                        source={coverImage}
                        resizeMode="cover"
                        style={StyleSheet.absoluteFillObject}
                        pointerEvents="none"
                      />
                    ) : null}
                    <Text style={styles.cardBackText} numberOfLines={1}>
                      Reward card
                    </Text>
                  </LinearGradient>
                </AnimatedView>
              )
            ) : (
              <AnimatedView
                style={[
                  styles.stageCard,
                  hasAnimated
                    ? {
                        transform: [
                          { scale: scaleRef.current ?? 1 },
                          { rotate: rotateValue },
                        ],
                      }
                    : null,
                  phase === 'tear-flip' && !isMulti && styles.stageCardTear,
                ]}
              >
                <LinearGradient
                  colors={palette.cover}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={styles.stageCardBack}
                >
                  {coverImage && RNImage ? (
                    <RNImage
                      source={coverImage}
                      resizeMode="cover"
                      style={StyleSheet.absoluteFillObject}
                      pointerEvents="none"
                    />
                  ) : null}
                  <Text style={styles.cardBackText} numberOfLines={1}>
                    Reward card
                  </Text>
                </LinearGradient>
              </AnimatedView>
            )}
          </View>

          <Text style={styles.footerRarity} testID="draw-ceremony-footer-rarity" numberOfLines={1}>
            {peakRarity === 'LEG' ? 'Legendary' : peakRarity === 'RAR' ? 'Rare' : 'Common'}
          </Text>

          {canSkip ? (
            <Pressable
              testID="screen-draw-ceremony-primary-cta"
              nativeID="draw-ceremony-skip-hint"
              accessibilityRole="button"
              style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
              onPress={goResult}
            >
              <Text style={styles.skipText} numberOfLines={1}>
                Show result
              </Text>
            </Pressable>
          ) : null}
        </AnimatedView>

        <View
          testID="draw-ceremony-reveal-flash"
          style={[
            styles.flash,
            {
              backgroundColor: flashColor(peakRarity),
              opacity: phase === 'flash-reveal' ? 0.85 : 0,
            },
          ]}
          pointerEvents="none"
        />
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawCeremonyScreen;
