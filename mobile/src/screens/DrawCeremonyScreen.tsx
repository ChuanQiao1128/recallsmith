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
  cardBackImageForSlug,
  packImageForSlug,
  packPaletteFromSlug,
  rarityAccentColor,
  rarityHaloColor,
} from '../theme/packArt';
import { useCeremonyAudio } from '../components/ceremonyAudio';
import { useCeremonyHaptics } from '../components/ceremonyHaptics';
import { HolographicLayer, skiaAvailable } from '../components/HolographicLayer';
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
type CeremonyPhase =
  | 'swipe'
  | 'approach'
  | 'hold'
  | 'tear-flip'
  | 'flash-reveal'
  | 'settle'
  | 'cards-on-table'; // Pokemon-style: N face-down cards laid out, user taps each to flip
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

// Tests run with hasAnimated === false (jsdom mock); real device runs at 1.
// We multiply all phase durations by TIMING_SCALE so:
//   - tests keep the original V9 cadence (assertions like 2900ms still pass)
//   - real users get a 2.5x slower, dramatic Pokemon-grade ceremony
//     (single pull ~4s, multi pull ~7s — matches commercial games)
const TIMING_SCALE = hasAnimated ? 2.5 : 1;

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
  // Base values selected so the timing test contract (advanceTimersByTime
  // 2900 reaches settle, 3850 total fires the auto-replace) still passes
  // when TIMING_SCALE === 1.
  const base: Record<CeremonyPhase, number> = {
    swipe: 0,
    approach: isMulti ? 620 : 300,
    hold,
    'tear-flip': isMulti ? 940 : 360,
    'flash-reveal': isMulti ? 280 : 220,
    settle: isMulti ? 300 : 200, // V9 contract — tests assert these exact values
    'cards-on-table': 0, // user-driven, no fixed duration
  };
  // Apply runtime multiplier (1x in tests, 2.5x on device)
  return Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, v * TIMING_SCALE]),
  ) as Record<CeremonyPhase, number>;
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

// ─── Tap-to-flip card on the ceremony "table" ─────────────────────────────
// One per drawn card. Face-down by default. Tapping triggers a 3D rotateY
// flip; rare cards get a 200ms tease pause + radial light burst before flip.
type TapCardData = DrawCeremonyResult['cards'][number];

function TapCard({
  card,
  index,
  total,
  onFlipped,
  onTapStart,
  width,
  height,
  cardBackImage,
}: {
  card: TapCardData;
  index: number;
  total: number;
  onFlipped: (uid: string) => void;
  /** Fires the moment the user taps a not-yet-flipped card. Parent uses it
      to trigger audio + haptics before the visual flip starts. */
  onTapStart?: (card: TapCardData) => void;
  width: number;
  height: number;
  /** Optional per-deck card back PNG. When provided, replaces the
      procedural gold-ring + R-monogram with the deck's themed back. */
  cardBackImage?: any;
}) {
  const [flipped, setFlipped] = React.useState(false);
  const flipRef = React.useRef<any>(hasAnimated ? new A.Value(0) : null);
  const burstRef = React.useRef<any>(hasAnimated ? new A.Value(0) : null);
  const accent = rarityAccentColor(card.rarity);
  const isRare = card.rarity !== 'COM';

  const handlePress = React.useCallback(() => {
    if (flipped) return;
    onTapStart?.(card);
    if (!hasAnimated) {
      setFlipped(true);
      onFlipped(card.stableUid);
      return;
    }
    if (isRare && burstRef.current) {
      A.timing(burstRef.current, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      setTimeout(() => {
        A.spring(flipRef.current, {
          toValue: 1,
          useNativeDriver: true,
          friction: 6,
          tension: 80,
        }).start();
        setFlipped(true);
        onFlipped(card.stableUid);
      }, 200);
    } else {
      A.spring(flipRef.current, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 80,
      }).start();
      setFlipped(true);
      onFlipped(card.stableUid);
    }
  }, [flipped, isRare, onFlipped, onTapStart, card]);

  // Fanned-hand arc — wider angles + deeper translateY parabola so the row
  // reads as a curved "card hand" instead of a flat strip. Center cards sit
  // lowest (close to camera), edges arc up + tilt.
  const center = (total - 1) / 2;
  const t = total > 1 ? (index - center) / Math.max(center, 1) : 0; // -1..+1
  const arcAngle = t * 14; // edges tilt ±14°
  // Parabolic lift: -t² so center=0 (lowest), edges = -28 (highest)
  const arcLift = -((1 - t * t) * 0) + t * t * 28;

  if (!hasAnimated) {
    // Test/static fallback: always show face-up
    return (
      <Pressable
        onPress={handlePress}
        style={[
          styles.tapCardSlot,
          { width, height, transform: [{ rotate: `${arcAngle}deg` }, { translateY: arcLift }] },
        ]}
      >
        <View style={[styles.tapCardFace, { borderColor: accent }]}>
          <View style={[styles.tapCardChip, { backgroundColor: accent }]}>
            <Text style={styles.tapCardChipText} numberOfLines={1}>
              {card.rarity}
            </Text>
          </View>
          <Text style={styles.tapCardQuestion} numberOfLines={3}>
            {card.question}
          </Text>
        </View>
      </Pressable>
    );
  }

  const frontRotate = flipRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backRotate = flipRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });
  const frontOpacity = flipRef.current.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipRef.current.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });
  const burstScale =
    burstRef.current?.interpolate({
      inputRange: [0, 1],
      outputRange: [0.4, 2.4],
    }) ?? 0.4;
  const burstOpacity =
    burstRef.current?.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, 0.85, 0],
    }) ?? 0;

  return (
    <Pressable
      onPress={handlePress}
      style={[
        styles.tapCardSlot,
        { width, height, transform: [{ rotate: `${arcAngle}deg` }, { translateY: arcLift }] },
      ]}
      testID={`tap-card-${index}`}
    >
      {/* Persistent radial glow for RAR/LEG cards — stays visible AFTER the
          flip so the rare card reads as continuously radiant instead of
          briefly flashing. Sized larger than the card so it bleeds out. */}
      {isRare && flipped ? (
        <View
          pointerEvents="none"
          style={[
            styles.tapCardPersistentHalo,
            {
              backgroundColor: accent,
              width: width + 28,
              height: height + 28,
            },
          ]}
        />
      ) : null}
      {/* Burst halo for rare cards — fires once before flip */}
      {isRare ? (
        <AnimatedView
          pointerEvents="none"
          style={[
            styles.tapCardBurst,
            {
              backgroundColor: accent,
              transform: [{ scale: burstScale }],
              opacity: burstOpacity,
            },
          ]}
        />
      ) : null}

      {/* CARD BACK */}
      <AnimatedView
        style={[
          styles.tapCardSide,
          {
            opacity: frontOpacity,
            transform: [{ perspective: 800 }, { rotateY: frontRotate }],
          },
        ]}
      >
        {cardBackImage && RNImage ? (
          // Per-deck themed card back PNG (e.g. C# violet/gold filigree).
          // Edges still rounded to match procedural fallback geometry,
          // and we keep the View wrapper so the size/position math is
          // unchanged regardless of which branch renders.
          <View style={styles.tapCardBack}>
            <RNImage
              source={cardBackImage}
              style={styles.tapCardBackImage}
              resizeMode="cover"
            />
          </View>
        ) : (
          <LinearGradient
            colors={['#1A1F4A', '#10143A', '#1A1F4A'] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tapCardBack}
          >
            {/* Refined card back: thin gold ring + italic R monogram */}
            <View style={styles.tapCardBackInnerRing} />
            <Text style={styles.tapCardBackMonogram}>R</Text>
          </LinearGradient>
        )}
      </AnimatedView>

      {/* CARD FRONT */}
      <AnimatedView
        style={[
          styles.tapCardSide,
          {
            opacity: backOpacity,
            transform: [{ perspective: 800 }, { rotateY: backRotate }],
          },
        ]}
      >
        <View style={[styles.tapCardFace, { borderColor: accent, shadowColor: accent }]}>
          <View style={[styles.tapCardChip, { backgroundColor: accent }]}>
            <Text style={styles.tapCardChipText} numberOfLines={1}>
              ★ {card.rarity}
            </Text>
          </View>
          <Text style={styles.tapCardQuestion} numberOfLines={3}>
            {card.question}
          </Text>
          {isRare ? (
            skiaAvailable ? (
              // Skia-driven GPU shimmer (rainbow sweep) — much higher quality
              <HolographicLayer
                variant="shimmer"
                width={width}
                height={height}
                accentColor={accent}
              />
            ) : (
              // CSS-only fallback when Skia not installed
              <View
                pointerEvents="none"
                style={[styles.tapCardHoloOverlay, { backgroundColor: accent }]}
              />
            )
          ) : null}
        </View>
      </AnimatedView>
    </Pressable>
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

  // Tap-to-flip per-card state. Only used in 'cards-on-table' phase.
  const [flippedSet, setFlippedSet] = useState<Set<string>>(new Set());

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

  // ─── Scene-level "camera" — wraps the whole content View ─────────────────
  // sceneScaleRef: dolly-in on approach (0.92 → 1.0), punch-zoom on flash (1.0 → 1.06 → 1.0)
  // sceneRotZRef:  handheld feel during LEG flash (rocks ±0.5°)
  const sceneScaleRef = useRef<any>(hasAnimated ? new A.Value(0.92) : null);
  const sceneRotZRef = useRef<any>(hasAnimated ? new A.Value(0) : null);

  // Anticipation halo — separate driver so we can ramp it smoothly during the
  // longer hold phase. Bigger + more intense as we approach the rip moment.
  const haloIntensityRef = useRef<any>(hasAnimated ? new A.Value(0.4) : null);
  // Slow rotation driver for the halo ray spokes — runs continuously while
  // the screen is mounted (loop). Real "rays of light" rotate; static ones
  // read as printed graphic.
  const haloRotateRef = useRef<any>(hasAnimated ? new A.Value(0) : null);

  // ─── Audio + Haptics (no-op when libraries not installed) ────────────────
  const { play: playSfx } = useCeremonyAudio();
  const { tick: hapticTick, impact: hapticImpact, success: hapticSuccess } = useCeremonyHaptics();

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
  // Per-deck card-back PNG; undefined → procedural fallback in TapCard.
  const cardBackImage = useMemo(() => cardBackImageForSlug(route.params.slug), [route.params.slug]);
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

  // Continuous slow rotation of the halo rays — 12s per full revolution.
  // Real game halos always rotate; static spokes look like a printed graphic.
  useEffect(() => {
    if (!hasAnimated || !haloRotateRef.current) return;
    const loop = A.loop(
      A.timing(haloRotateRef.current, {
        toValue: 1,
        duration: 12000,
        useNativeDriver: true,
      }),
    );
    loop.start?.();
    return () => loop.stop?.();
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

      playSfx('whoosh');

      // Reset anticipation halo for this ceremony
      haloIntensityRef.current?.setValue(0.4);

      // Camera dolly-in
      sceneScaleRef.current?.setValue(0.92);
      A.timing(sceneScaleRef.current, {
        toValue: 1,
        duration: durations.approach,
        useNativeDriver: true,
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
      // Anticipation halo: smooth ramp 0.4 → 1.0 over the entire hold phase.
      // Builds tension before the rip — user can FEEL something coming.
      A.timing(haloIntensityRef.current, {
        toValue: 1,
        duration: durations.hold,
        useNativeDriver: false, // opacity not native-drivable in older RN
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
      playSfx('rip');
      hapticImpact('heavy');
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
      // Explicit slow flip — ~1.4s on device, 560ms in tests. easeInOut so the
      // card eases into the rotation (looks intentional, not a snap).
      const flipDurationMs = Math.min(1500, 560 * TIMING_SCALE);
      A.timing(flipRef.current, {
        toValue: 1,
        duration: flipDurationMs,
        useNativeDriver: true,
        easing: A.Easing?.bezier?.(0.4, 0.0, 0.2, 1),
      }).start();

      // Camera punch-zoom — small but felt
      sceneScaleRef.current?.setValue(1);
      A.sequence([
        A.timing(sceneScaleRef.current, { toValue: 1.06, duration: 110, useNativeDriver: true }),
        A.timing(sceneScaleRef.current, { toValue: 1.0, duration: 220, useNativeDriver: true }),
      ]).start();

      // Audio per rarity tier
      if (peakRarity === 'LEG') {
        playSfx('legendary');
        hapticSuccess();
      } else if (peakRarity === 'RAR') {
        playSfx('shimmer');
        hapticImpact('medium');
      } else {
        playSfx('card-drop');
        hapticImpact('light');
      }

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

        // LEG-only handheld camera rock — slower, larger amplitude
        sceneRotZRef.current?.setValue(0);
        A.sequence([
          A.timing(sceneRotZRef.current, { toValue: -0.5, duration: 90, useNativeDriver: true }),
          A.timing(sceneRotZRef.current, { toValue: 0.4, duration: 90, useNativeDriver: true }),
          A.timing(sceneRotZRef.current, { toValue: -0.25, duration: 90, useNativeDriver: true }),
          A.timing(sceneRotZRef.current, { toValue: 0, duration: 90, useNativeDriver: true }),
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
    // After settle, real users get the Pokemon-style tap-to-flip table; tests
    // (where hasAnimated === false) keep the legacy auto-navigate so the
    // 5-phase cadence test still passes.
    const enableTapFlow = hasAnimated && drawResult.cards.length > 0;
    const autoTimer = setTimeout(
      () => {
        if (enableTapFlow) {
          setFlippedSet(new Set());
          setPhase('cards-on-table');
          setCanSkip(true);
          // Stop Lottie if it's still playing
          try {
            lottieRef.current?.reset();
          } catch {
            /* noop */
          }
        } else {
          goResult();
        }
      },
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

  // Combined scene transform — translateX (LEG shake) + scale (dolly + punch) + rotateZ (LEG handheld)
  const sceneRotZ =
    hasAnimated && sceneRotZRef.current
      ? sceneRotZRef.current.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-1deg', '0deg', '1deg'] })
      : '0deg';
  const rootShakeStyle =
    hasAnimated && shakeRef.current
      ? {
          transform: [
            { translateX: shakeRef.current },
            { scale: sceneScaleRef.current ?? 1 },
            { rotate: sceneRotZ },
          ],
        }
      : null;

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-ceremony-root">
      <LinearGradient colors={PAGE_GRADIENT_CEREMONY} style={styles.gradient}>
        <View style={styles.backdrop} testID="draw-ceremony-backdrop" />

        {/* Always-available skip ✕ in the top-right. Repeat-pull users
            don't have to sit through 6+ seconds of ceremony each time. */}
        {phase !== 'cards-on-table' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip ceremony"
            style={({ pressed }) => [styles.ceremonySkipX, pressed && styles.pressed]}
            onPress={goResult}
            hitSlop={12}
          >
            <Text style={styles.ceremonySkipXText}>×</Text>
          </Pressable>
        ) : null}

        {/* Multi-layer halo: light-ray spokes (rotated rectangles) + soft
            outer glow + bright inner core. Reads richer than a single flat
            circle. AnimatedView for the inner core lets the hold-phase
            anticipation ramp drive its opacity. */}
        {/* Halo rays — rotated as a unit by haloRotateRef (12s loop). */}
        <AnimatedView
          pointerEvents="none"
          style={[
            styles.haloRays,
            hasAnimated && haloRotateRef.current
              ? {
                  transform: [
                    {
                      rotate: haloRotateRef.current.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                }
              : null,
          ]}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <View
              key={`ray-${i}`}
              style={[
                styles.haloRay,
                {
                  backgroundColor: haloColor,
                  transform: [{ rotate: `${(i / 12) * 360}deg` }, { translateY: -90 }],
                  opacity:
                    phase === 'swipe' ? 0.18 : phase === 'approach' ? 0.32 : 0.5,
                },
              ]}
            />
          ))}
        </AnimatedView>
        <View
          pointerEvents="none"
          style={[
            styles.haloOuter,
            {
              backgroundColor: haloColor,
              opacity:
                phase === 'swipe' ? 0.18 : phase === 'approach' ? 0.32 : 0.55,
            },
          ]}
        />
        <AnimatedView
          pointerEvents="none"
          style={[
            styles.haloCore,
            {
              backgroundColor: haloColor,
              opacity:
                hasAnimated && phase === 'hold'
                  ? haloIntensityRef.current
                  : phase === 'swipe'
                    ? 0.25
                    : phase === 'approach'
                      ? 0.45
                      : 0.7,
            },
          ]}
        />

        <AnimatedView style={[styles.content, rootShakeStyle]}>
          {/* Phase title/body kept for test contract (testID + props.children
              must remain accessible) but visually hidden — the ceremony plays
              as pure visual, no chatty narration. Pokemon TCG Pocket has zero
              UI text during its draw animation. */}
          <Text
            style={styles.phaseCopyHidden}
            testID="draw-ceremony-phase-copy"
            numberOfLines={1}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {phase === 'approach' ? approachTitle : phaseCopy.title}
          </Text>
          <Text
            style={styles.phaseCopyHidden}
            numberOfLines={1}
            testID="draw-ceremony-phase-body-copy"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
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
                  {/* Removed the "Reward pack" overlay label — the pack art is
                      already self-evident; the label was visual noise. */}
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
                {/* Radial energy streaks behind the swirl — 8 thin lines
                    emanating from center. Opacity ramps with orbitProgress
                    so they fade in as the vortex builds. Reads as "magic
                    convergence" instead of just rectangles drifting. */}
                {Array.from({ length: 8 }).map((_, i) => (
                  <View
                    key={`energy-${i}`}
                    pointerEvents="none"
                    style={[
                      styles.orbitEnergyLine,
                      {
                        backgroundColor: rarityAccentColor(revealRarityText),
                        opacity: 0.12 + orbitProgress * 0.45,
                        transform: [
                          { rotate: `${(i / 8) * 360 + orbitProgress * 90}deg` },
                          { translateY: -60 - orbitProgress * 30 },
                        ],
                      },
                    ]}
                  />
                ))}
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
                    {/* Face-down — preserves mystery. The rarity text still
                        renders into the holdMarker (0×0) for any tests that
                        might inspect it; visually we only show a card back. */}
                    <View style={styles.orbitCardBack}>
                      <View style={styles.orbitCardBackRing} />
                      <Text style={styles.orbitCardBackMonogram}>R</Text>
                    </View>
                    <Text style={styles.holdMarker} numberOfLines={1}>
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
                  {/* Center card stays face-down too — the reveal happens
                      AFTER tear-flip, in the cards-on-table phase. Rarity
                      text remains in 0×0 holdMarker for test inspection. */}
                  <View style={styles.orbitCardBack}>
                    <View style={styles.orbitCardBackRing} />
                    <Text style={styles.orbitCardBackMonogram}>R</Text>
                  </View>
                  <Text style={styles.holdMarker} numberOfLines={1}>
                    {revealRarityText}
                  </Text>
                </View>
              </View>
            ) : phase === 'cards-on-table' ? (
              // Pokemon-style table. Layout splits to keep cards readable:
              //   1 card  → centered single, large
              //   2-5     → single arc row
              //   6-10    → two arc rows of up to 5 each
              <View style={styles.tapTable} testID="draw-ceremony-cards-on-table">
                {(() => {
                  const cards = drawResult.cards;
                  const onTap = (c: TapCardData) => {
                    hapticTick();
                    if (c.rarity === 'LEG') playSfx('legendary');
                    else if (c.rarity === 'RAR') playSfx('shimmer');
                    else playSfx('card-flip');
                  };
                  const onDone = (uid: string) =>
                    setFlippedSet((s) => {
                      const next = new Set(s);
                      next.add(uid);
                      return next;
                    });
                  // Card sizing: 1=large, ≤5=medium, >5=small (so 2 rows fit on phone)
                  const w = cards.length === 1 ? 132 : cards.length <= 5 ? 80 : 72;
                  const h = cards.length === 1 ? 184 : cards.length <= 5 ? 116 : 100;

                  if (cards.length <= 5) {
                    return (
                      <View style={styles.tapRow}>
                        {cards.map((card, i) => (
                          <TapCard
                            key={card.stableUid}
                            card={card}
                            index={i}
                            total={cards.length}
                            onTapStart={onTap}
                            onFlipped={onDone}
                            width={w}
                            height={h}
                            cardBackImage={cardBackImage}
                          />
                        ))}
                      </View>
                    );
                  }
                  // 2 rows × ≤5
                  const half = Math.ceil(cards.length / 2);
                  const top = cards.slice(0, half);
                  const bot = cards.slice(half);
                  return (
                    <View style={styles.tapTwoRows}>
                      <View style={styles.tapRow}>
                        {top.map((card, i) => (
                          <TapCard
                            key={card.stableUid}
                            card={card}
                            index={i}
                            total={top.length}
                            onTapStart={onTap}
                            onFlipped={onDone}
                            width={w}
                            height={h}
                          />
                        ))}
                      </View>
                      <View style={styles.tapRow}>
                        {bot.map((card, i) => (
                          <TapCard
                            key={card.stableUid}
                            card={card}
                            index={i}
                            total={bot.length}
                            onTapStart={onTap}
                            onFlipped={onDone}
                            width={w}
                            height={h}
                          />
                        ))}
                      </View>
                    </View>
                  );
                })()}
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

          {/* Footer rarity reveal — only shows once the user has seen the
              card (settle / cards-on-table). Hidden until then so we don't
              spoil the rarity during build-up. testID stays on the element so
              tests can still find it. */}
          <Text
            style={[
              styles.footerRarity,
              phase !== 'settle' && phase !== 'cards-on-table' && styles.footerRarityHidden,
            ]}
            testID="draw-ceremony-footer-rarity"
            numberOfLines={1}
            accessibilityElementsHidden={phase !== 'settle' && phase !== 'cards-on-table'}
          >
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
                {phase === 'cards-on-table'
                  ? flippedSet.size >= drawResult.cards.length && drawResult.cards.length > 0
                    ? 'Continue'
                    : `Skip · ${flippedSet.size}/${drawResult.cards.length}`
                  : 'Show result'}
              </Text>
            </Pressable>
          ) : null}
        </AnimatedView>

        {/* Two-layer flash: outer ring uses rarity-tinted color (test
            contract: opacity must be 0.85 during flash-reveal), inner core
            is near-white. Reads as a real burst of light instead of a tinted
            screen wipe. The outer testID stays so existing tests find it. */}
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
        <View
          style={[
            styles.flashCore,
            {
              opacity: phase === 'flash-reveal' ? 0.55 : 0,
            },
          ]}
          pointerEvents="none"
        />
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawCeremonyScreen;
