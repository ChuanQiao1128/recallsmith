// TapCard — the tap-to-flip ceremony card, extracted from DrawCeremonyScreen and
// rebuilt on the B02 guard. Each tap runs lift → flip → land with rarity-scaled
// durations, queued 90ms apart; RAR/LEG cards fly to the centre when focused and
// carry a GH Pan-driven foil. Under the guard fallback (tests, unprebuilt clients)
// every animation collapses to its final value and the card renders statically.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as RN from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureHandler, Reanimated, motionAvailable, type SharedValue } from './reanimatedGuard';
import { FoilLayer } from './FoilLayer';
import { ceremonyStyles } from './ceremonyStyles';
import { rarityAccentColor } from '../../theme/packArt';
import { getCeremonyHaptics } from '../ceremonyHaptics';
import type { PeakRarity, ResolvedCeremonyTimings } from '../../features/gacha/draw/ceremonyTimings';

const { useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, cancelAnimation, runOnJS, interpolate, Easing } = Reanimated;
const { PanHost, Gesture } = GestureHandler;
const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

// The integration test's react-native mock exports no Image, so read it
// defensively (a missing ESM namespace member throws under vitest) and only
// take the image branch when it is present.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);

export type TapCardData = { stableUid: string; question: string; difficulty: number; rarity: PeakRarity; tag?: string };

export const TAP_QUEUE_GAP_MS = 90;
export const FLIP_EASING = [0.05, 0.7, 0.1, 1] as const;
export const FOCUS_MS = 320;
export const LIFT_TRANSLATE_Y = -10;
export const LIFT_SCALE = 1.08;

/** Pure FIFO used by the table: enqueue(uid) returns the ms delay at which that flip may start. */
export function createTapQueue(gapMs: number = TAP_QUEUE_GAP_MS, now: () => number = Date.now): { enqueue(uid: string): number; clear(): void } {
  let lastStartAt = Number.NEGATIVE_INFINITY;
  return {
    enqueue(_uid: string): number {
      const t = now();
      const startAt = Math.max(t, lastStartAt + gapMs);
      lastStartAt = startAt;
      return startAt - t;
    },
    clear(): void {
      lastStartAt = Number.NEGATIVE_INFINITY;
    },
  };
}

// One shared queue for the whole table (only one table exists at a time; a stale
// lastStartAt from a previous ceremony is harmlessly in the past).
const tableTapQueue = createTapQueue();

export function rarityLabel(rarity: PeakRarity): 'Legendary' | 'Rare' | 'Common' {
  if (rarity === 'LEG') return 'Legendary';
  if (rarity === 'RAR') return 'Rare';
  return 'Common';
}

// Fanned-hand geometry (centre card lowest/straight, edges tilt ±14° and arc up).
export function arcTransform(index: number, total: number): { rotateDeg: number; liftY: number; t: number } {
  const centre = (total - 1) / 2;
  const t = total > 1 ? (index - centre) / Math.max(centre, 1) : 0;
  return { rotateDeg: t * 14, liftY: t * t * 28, t };
}

export type TapCardProps = {
  card: TapCardData; index: number; total: number; width: number; height: number;
  /** true outside 'cards-on-table' — a disabled card never flips and reports accessibilityState.disabled. */
  disabled: boolean;
  flipped: boolean;
  onTapStart?: (card: TapCardData) => void;
  onFlipped: (uid: string) => void;
  cardBackImage?: ImageSourcePropType; frameImage?: ImageSourcePropType;
  reduceMotion: boolean;
  focused?: boolean; onFocusToggle?: (uid: string) => void;   // RAR/LEG focus fly-in
  timings: Pick<ResolvedCeremonyTimings, 'flipMs' | 'rimSettleMs' | 'liftMs' | 'landMs'>;
};

export function TapCard(props: TapCardProps): React.JSX.Element {
  const {
    card, index, total, width, height, disabled, flipped,
    onTapStart, onFlipped, cardBackImage, frameImage, reduceMotion,
    focused, onFocusToggle, timings,
  } = props;

  const flip = useSharedValue(flipped ? 1 : 0);
  const lift = useSharedValue(0);
  const focus = useSharedValue(0);
  const streak = useSharedValue(0);
  const tilt = useSharedValue<{ x: number; y: number }>({ x: 0, y: 0 });
  const flipDelay = React.useRef(0);

  // Guard-fallback mirror — MUST sit after the shared values and before any
  // useAnimatedStyle: under the fallback useAnimatedStyle(fn) is fn() evaluated
  // in place, so the controlled props are mirrored synchronously here for the
  // front face to show on the very render that sets flipped. Not a hook, so it
  // does not disturb hook order; never runs under real Reanimated.
  if (!motionAvailable) {
    flip.value = flipped ? 1 : 0;
    lift.value = 0;
    streak.value = 0;
    focus.value = focused ? 1 : 0;
  }

  const onLanded = React.useCallback(() => {
    // S6: LEG adds a Heavy impact at landing (B04 owns the rolling rate limit).
    // The literals below are the canonical copy in CEREMONY_COPY_V10 (B10).
    if (card.rarity === 'LEG') getCeremonyHaptics().impact('heavy');
  }, [card.rarity]);

  const handlePress = React.useCallback(() => {
    if (disabled) return;
    if (flipped) {
      if (card.rarity !== 'COM') onFocusToggle?.(card.stableUid);
      return;
    }
    flipDelay.current = tableTapQueue.enqueue(card.stableUid);
    onTapStart?.(card);
    onFlipped(card.stableUid);
  }, [disabled, flipped, card, onFocusToggle, onTapStart, onFlipped]);

  React.useEffect(() => {
    if (flipped) {
      if (reduceMotion) {
        flip.value = withTiming(1, { duration: 180, easing: Easing.linear });
        return;
      }
      const d = flipDelay.current;
      const flipMs = timings.flipMs[card.rarity];
      lift.value = withDelay(d, withSequence(
        withTiming(1, { duration: timings.liftMs, easing: Easing.bezier(...FLIP_EASING) }),
        withDelay(flipMs, withTiming(0, { duration: timings.landMs, easing: Easing.out(Easing.quad) }, (finished) => { if (finished) runOnJS(onLanded)(); })),
      ));
      flip.value = withDelay(d + timings.liftMs, withTiming(1, { duration: flipMs, easing: Easing.bezier(...FLIP_EASING) }));
      streak.value = withDelay(d + timings.liftMs + Math.round(flipMs / 2) - 40, withSequence(withTiming(1, { duration: 40 }), withTiming(0, { duration: 80 })));
    } else {
      cancelAnimation(flip); flip.value = 0;
      cancelAnimation(lift); lift.value = 0;
      cancelAnimation(streak); streak.value = 0;
      cancelAnimation(focus); focus.value = 0;
    }
  }, [flipped]);

  React.useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, { duration: reduceMotion ? 180 : FOCUS_MS, easing: Easing.bezier(...FLIP_EASING) });
  }, [focused]);

  const arc = arcTransform(index, total);

  const slotStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${arc.rotateDeg * (1 - focus.value)}deg` },
      { translateY: arc.liftY * (1 - focus.value) + LIFT_TRANSLATE_Y * lift.value - 40 * focus.value },
      { translateX: -(index - (total - 1) / 2) * (width - 4) * focus.value },
      { scale: 1 + (LIFT_SCALE - 1) * lift.value + 0.6 * focus.value },
    ],
    zIndex: focus.value > 0 ? 20 : 1,
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flip.value, [0, 0.49, 0.5, 1], [1, 1, 0, 0]),
    transform: reduceMotion ? [] : [{ perspective: 800 }, { rotateY: `${flip.value * 180}deg` }],
  }));
  const frontStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flip.value, [0, 0.49, 0.5, 1], [0, 0, 1, 1]),
    transform: reduceMotion ? [] : [{ perspective: 800 }, { rotateY: `${180 + flip.value * 180}deg` }],
  }));
  const streakStyle = useAnimatedStyle(() => ({
    opacity: streak.value,
    transform: [{ rotate: '18deg' }, { translateX: (streak.value - 0.5) * width * 1.6 }],
  }));

  const tiltGesture = React.useMemo(
    () => Gesture.Pan()
      .onUpdate((e: any) => { 'worklet'; tilt.value = { x: Math.max(-1, Math.min(1, e.translationX / 60)), y: Math.max(-1, Math.min(1, e.translationY / 60)) }; })
      .onEnd(() => { 'worklet'; tilt.value = { x: 0, y: 0 }; }),
    [],
  );

  const accent = rarityAccentColor(card.rarity);
  const isRare = card.rarity !== 'COM';
  // These two label literals are byte-identical to CEREMONY_COPY_V10.cardFaceDown /
  // cardRevealed (B00 §2.13); B10 lands after B08, so they are written here directly.
  const accessibilityLabel = flipped
    ? `Card ${index + 1} of ${total}, ${rarityLabel(card.rarity)} revealed`
    : `Card ${index + 1} of ${total}, face down`;

  return (
    <AnimatedPressable
      testID={`tap-card-${index}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      style={[ceremonyStyles.tapCardSlot, ceremonyStyles.tapCardShadow, { width, height }, slotStyle]}
    >
      {/* Persistent radial glow for RAR/LEG cards — stays visible after the flip. */}
      {isRare && flipped ? (
        <View
          pointerEvents="none"
          style={[ceremonyStyles.tapCardPersistentHalo, { backgroundColor: accent, width: width + 28, height: height + 28 }]}
        />
      ) : null}

      {/* CARD BACK */}
      <Reanimated.View style={[ceremonyStyles.tapCardSide, backStyle]}>
        {cardBackImage && RNImage ? (
          <View style={ceremonyStyles.tapCardBack}>
            <RNImage source={cardBackImage} style={ceremonyStyles.tapCardBackImage} resizeMode="cover" />
          </View>
        ) : (
          <LinearGradient
            colors={['#1A1F4A', '#10143A', '#1A1F4A'] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={ceremonyStyles.tapCardBack}
          >
            {/* Refined card back: thin gold ring + italic R monogram */}
            <View style={ceremonyStyles.tapCardBackInnerRing} />
            <Text style={ceremonyStyles.tapCardBackMonogram}>R</Text>
          </LinearGradient>
        )}
      </Reanimated.View>

      {/* CARD FRONT */}
      <Reanimated.View style={[ceremonyStyles.tapCardSide, frontStyle]}>
        <View style={[ceremonyStyles.tapCardFace, { borderColor: accent, shadowColor: accent }]}>
          {frameImage && RNImage ? (
            // With a rarity frame the face is laid out to the frame's windows (B12 geometry:
            // art window y 11–64 %, text slab y 68–95 %, both x 7–93 %) so nothing sits under
            // the frame's opaque bands. The chip lives inside the art window.
            <>
              <View style={ceremonyStyles.tapCardArtWindow}>
                <LinearGradient
                  colors={[accent, '#141737'] as const}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={ceremonyStyles.tapCardArtGradient}
                />
                <View style={[ceremonyStyles.tapCardChip, ceremonyStyles.tapCardChipInWindow, { backgroundColor: accent }]}>
                  <Text style={ceremonyStyles.tapCardChipText} numberOfLines={1}>★ {card.rarity}</Text>
                </View>
              </View>
              <View style={ceremonyStyles.tapCardSlab}>
                <Text style={ceremonyStyles.tapCardQuestion} numberOfLines={3}>{card.question}</Text>
              </View>
              <RNImage pointerEvents="none" source={frameImage} resizeMode="stretch" style={ceremonyStyles.tapCardFrame} />
            </>
          ) : (
            <>
              <View style={[ceremonyStyles.tapCardChip, { backgroundColor: accent }]}>
                <Text style={ceremonyStyles.tapCardChipText} numberOfLines={1}>★ {card.rarity}</Text>
              </View>
              <Text style={ceremonyStyles.tapCardQuestion} numberOfLines={3}>{card.question}</Text>
            </>
          )}
          <Reanimated.View pointerEvents="none" style={[ceremonyStyles.tapCardStreak, streakStyle]} />
          {focused && card.rarity !== 'COM' ? (
            <PanHost gesture={tiltGesture}>
              <View style={ceremonyStyles.tapCardFocusLayer}>
                <FoilLayer width={width} height={height} accentColor={accent} rarity={card.rarity} active tilt={tilt} />
              </View>
            </PanHost>
          ) : null}
        </View>
      </Reanimated.View>
    </AnimatedPressable>
  );
}
