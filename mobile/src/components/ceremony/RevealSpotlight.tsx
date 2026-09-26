// RevealSpotlight — the full-screen single-pull reveal (I04). A dark scrim, a big 5:7 card
// that flips on tap (RevealCardFace on the front, the deck card back on the reverse), a
// rarity glow / rays / particle burst (Skia, idle-safe), a "Rare"/"Legendary" banner, and a
// read-full sheet. The screen renders it at its root and passes the CTA as the footer.
//
// The spotlight NEVER calls audio or haptics — the screen owns cues (spotlightFlipCues), so a
// preview or a test can mount this in isolation. Motion goes through the guard: real Reanimated
// on device, the deterministic fallback (every `with*` collapses to its target) under tests.

import React from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import * as RN from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Reanimated, SkiaModule, skiaAvailable } from './reanimatedGuard';
import { rarityLabel } from './TapCard';
import { RevealCardFace, type RevealCardFaceCard } from './RevealCardFace';
import { haloColorForTell } from './useCeremonyTimeline';
import {
  PARTICLE_COUNT,
  PARTICLE_LIFE_MS,
  burstParticleElapsed,
  particlePose,
  poseToRSXform,
  rayStops,
} from './StageCanvas';
import { rarityAccentColor, rarityHaloColor, PARTICLE_SHEET, type PackPalette } from '../../theme/packArt';
import {
  SPOTLIGHT_COPY,
  SPOTLIGHT_RM_FADE_MS,
  SPOTLIGHT_SCRIM,
  SPOTLIGHT_SCRIM_OPACITY,
  spotlightCardSize,
  spotlightFlipPlan,
  type SpotlightFlipPlan,
} from '../../features/gacha/draw/spotlightPlan';

const {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  withRepeat,
  cancelAnimation,
  interpolate,
  Easing,
} = Reanimated;

// The test react-native mocks expose neither Image nor ScrollView — read both defensively and
// fall back (no card-back image / a plain View sheet) when absent, like TapCard's facade.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);
const RNScrollView: any = readRN('ScrollView', View);

const FLIP_EASING = [0.05, 0.7, 0.1, 1] as const;
const PARTICLE_SPRITE_SIZE = 64;
const PARTICLE_SHEET_COLUMNS = 4;
const MAX_PARTICLES = 120;
const RAY_REVOLUTION_MS = 14000;
const RAYS_CANCEL_AFTER_LAND_MS = 1500;

export const REVEAL_SPOTLIGHT_TESTID = 'reveal-spotlight';

type FaceState = 'down' | 'flipping' | 'up';

export type RevealSpotlightProps = {
  card: RevealCardFaceCard;
  index: number;
  total: number;
  visible: boolean;
  interactive: boolean;
  initialFaceUp?: boolean;
  autoFlip?: boolean;
  reduceMotion: boolean;
  cardBackImage?: ImageSourcePropType;
  packArt?: ImageSourcePropType;
  packPaletteCover: PackPalette['cover'];
  serialText?: string;
  footer?: React.ReactNode;
  onFlipStart?: (plan: SpotlightFlipPlan) => void;
  onLanded?: () => void;
  onPressFaceUp?: () => void;
  testID?: string;
};

function RevealSpotlightImpl(props: RevealSpotlightProps): React.JSX.Element {
  const {
    card, index, total, visible, interactive, initialFaceUp = false, autoFlip = false, reduceMotion,
    cardBackImage, packArt, packPaletteCover, serialText, footer,
    onFlipStart, onLanded, onPressFaceUp, testID,
  } = props;

  const win = useWindowDimensions();
  const size = spotlightCardSize(win);
  const plan = React.useMemo(() => spotlightFlipPlan(card.rarity, reduceMotion), [card.rarity, reduceMotion]);
  const accent = rarityAccentColor(card.rarity);

  const [face, setFace] = React.useState<FaceState>(initialFaceUp ? 'up' : 'down');
  const [revealed, setRevealed] = React.useState<boolean>(initialFaceUp);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const faceRef = React.useRef<FaceState>(face);
  faceRef.current = face;
  const flipRequestedRef = React.useRef(initialFaceUp);
  const timersRef = React.useRef<number[]>([]);

  // Motion state.
  const appear = useSharedValue(visible ? 1 : 0);
  const scale = useSharedValue(1);
  const shakeX = useSharedValue(0);
  const flip = useSharedValue(initialFaceUp ? 1 : 0);
  const glow = useSharedValue(initialFaceUp ? 1 : 0);
  const raysAngle = useSharedValue(0);

  // Guard-fallback mirror: under the fallback useAnimatedStyle(fn) is fn() in place, so mirror
  // the controlled state onto the shared values synchronously (never runs under real Reanimated).
  if (!skiaAvailable) {
    appear.value = visible ? 1 : 0;
    flip.value = face === 'down' ? 0 : 1;
    scale.value = 1;
    shakeX.value = 0;
  }

  const startFlipAnimation = React.useCallback(() => {
    if (reduceMotion) {
      flip.value = withTiming(1, { duration: SPOTLIGHT_RM_FADE_MS, easing: Easing.linear });
      return;
    }
    if (plan.shakeMs > 0) {
      const s = Math.max(1, Math.round(plan.shakeMs / 6));
      shakeX.value = withSequence(
        withTiming(-6, { duration: s }), withTiming(6, { duration: s }), withTiming(-6, { duration: s }),
        withTiming(6, { duration: s }), withTiming(-3, { duration: s }), withTiming(0, { duration: s }),
      );
      glow.value = withTiming(1, { duration: plan.shakeMs, easing: Easing.linear });
    } else {
      glow.value = withDelay(plan.midpointMs, withTiming(1, { duration: Math.max(1, plan.flipMs - plan.midpointMs) }));
    }
    const flipEase = Easing.bezier(...FLIP_EASING);
    if (plan.edgePauseMs > 0) {
      // LEG: half-flip to edge-on, hold the pause, then finish (the two-step "it went gold").
      flip.value = withDelay(
        plan.flipStartMs,
        withSequence(
          withTiming(0.5, { duration: Math.round(plan.flipMs / 2), easing: flipEase }),
          withDelay(plan.edgePauseMs, withTiming(1, { duration: Math.round(plan.flipMs / 2), easing: flipEase })),
        ),
      );
    } else {
      flip.value = withDelay(plan.flipStartMs, withTiming(1, { duration: plan.flipMs, easing: flipEase }));
    }
    // Landing settle overshoot 1 → 1.04 → 1.
    scale.value = withDelay(plan.landMs, withSequence(withTiming(1.04, { duration: 90 }), withTiming(1, { duration: 120 })));
  }, [reduceMotion, plan, flip, glow, shakeX, scale]);

  const requestFlip = React.useCallback(() => {
    if (faceRef.current !== 'down' || flipRequestedRef.current) return;
    flipRequestedRef.current = true;
    faceRef.current = 'flipping';
    setFace('flipping');
    onFlipStart?.(plan);
    startFlipAnimation();
    const midId = setTimeout(() => setRevealed(true), plan.midpointMs) as unknown as number;
    const landId = setTimeout(() => {
      faceRef.current = 'up';
      setFace('up');
      onLanded?.();
    }, plan.landMs) as unknown as number;
    timersRef.current.push(midId, landId);
  }, [plan, onFlipStart, onLanded, startFlipAnimation]);

  // Keep a live handle so the autoFlip timer never fires a stale closure.
  const requestFlipRef = React.useRef(requestFlip);
  requestFlipRef.current = requestFlip;

  // Entrance + autoFlip: both keyed on the spotlight first becoming visible.
  React.useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      appear.value = withTiming(1, { duration: SPOTLIGHT_RM_FADE_MS, easing: Easing.linear });
    } else {
      appear.value = withTiming(1, { duration: 260 });
      scale.value = withSequence(withTiming(1.1, { duration: 260 }), withSpring(1));
    }
    if (autoFlip && faceRef.current === 'down' && !flipRequestedRef.current) {
      const id = setTimeout(() => requestFlipRef.current(), plan.entranceMs) as unknown as number;
      timersRef.current.push(id);
    }
    // eslint rules satisfied: appear/scale are stable shared values, plan/autoFlip are the trigger.
  }, [visible, autoFlip, reduceMotion, plan.entranceMs, appear, scale]);

  // Rays: one linear revolution per 14 s while lit, cancelled 1.5 s after landing (idle-safe).
  React.useEffect(() => {
    if (!visible || reduceMotion || !skiaAvailable) return;
    raysAngle.value = withRepeat(withTiming(2 * Math.PI, { duration: RAY_REVOLUTION_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(raysAngle);
  }, [visible, reduceMotion, raysAngle]);
  React.useEffect(() => {
    if (face !== 'up') return;
    const id = setTimeout(() => cancelAnimation(raysAngle), RAYS_CANCEL_AFTER_LAND_MS) as unknown as number;
    timersRef.current.push(id);
  }, [face, raysAngle]);

  React.useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current = [];
    };
  }, []);

  const onCardPress = React.useCallback(() => {
    if (faceRef.current === 'down') {
      if (interactive) requestFlip();
    } else if (faceRef.current === 'up') {
      onPressFaceUp?.();
    }
  }, [interactive, requestFlip, onPressFaceUp]);

  const flipRequested = face !== 'down';
  const accessibilityLabel = flipRequested
    ? `Card ${index + 1} of ${total}, ${rarityLabel(card.rarity)} revealed`
    : `Card ${index + 1} of ${total}, face down`;

  // Animated styles (fallback: fn() in place, `with*` already at target).
  const columnStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: reduceMotion ? [] : [{ scale: scale.value }],
  }));
  const cardMotionStyle = useAnimatedStyle(() => ({
    transform: reduceMotion ? [] : [{ translateX: shakeX.value }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flip.value, [0, 0.49, 0.5, 1], [1, 1, 0, 0]),
    transform: reduceMotion ? [] : [{ perspective: 1000 }, { rotateY: `${flip.value * 180}deg` }],
  }));
  const frontStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flip.value, [0, 0.49, 0.5, 1], [0, 0, 1, 1]),
    transform: reduceMotion ? [] : [{ perspective: 1000 }, { rotateY: `${180 + flip.value * 180}deg` }],
  }));
  const bannerStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: reduceMotion ? [] : [{ translateY: interpolate(flip.value, [0.5, 1], [-24, 0]) }],
  }));

  const rootHidden = !visible;
  const showStaticHalo = revealed && card.rarity !== 'COM' && (!skiaAvailable || reduceMotion);

  return (
    <View
      testID={testID ?? REVEAL_SPOTLIGHT_TESTID}
      style={[styles.root, rootHidden ? styles.hidden : null]}
      pointerEvents={rootHidden ? 'none' : 'auto'}
      accessibilityElementsHidden={rootHidden}
      importantForAccessibility={rootHidden ? 'no-hide-descendants' : undefined}
    >
      <View testID="reveal-spotlight-scrim" pointerEvents="none" style={[styles.scrim, { backgroundColor: SPOTLIGHT_SCRIM, opacity: SPOTLIGHT_SCRIM_OPACITY }]} />

      {skiaAvailable && SkiaModule && !reduceMotion ? (
        <SpotlightCanvas
          width={win.width}
          height={win.height}
          rarity={card.rarity}
          glow={glow}
          raysAngle={raysAngle}
          revealed={revealed}
          center={{ x: win.width / 2, y: win.height / 2 }}
        />
      ) : null}

      {showStaticHalo ? (
        <View pointerEvents="none" style={[styles.staticHalo, { width: size.width * 1.2, height: size.width * 1.2, borderRadius: size.width * 1.2, backgroundColor: rarityHaloColor(card.rarity) }]} />
      ) : null}

      <Reanimated.View style={[styles.column, columnStyle]}>
        {revealed ? (
          <Reanimated.View style={bannerStyle}>
            <Text testID="reveal-spotlight-banner" style={[styles.banner, { color: accent }]} numberOfLines={1}>
              {rarityLabel(card.rarity)}
            </Text>
          </Reanimated.View>
        ) : (
          <View style={styles.bannerSpacer} />
        )}

        <AnimatedPressable
          testID="reveal-spotlight-card"
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: !interactive }}
          onPress={onCardPress}
          style={[{ width: size.width, height: size.height }, cardMotionStyle]}
        >
          {/* BACK */}
          <Reanimated.View style={[styles.side, backStyle]}>
            {cardBackImage && RNImage ? (
              <View style={styles.back}>
                <RNImage source={cardBackImage} style={styles.backImage} resizeMode="cover" />
              </View>
            ) : (
              <LinearGradient colors={['#1A1F4A', '#10143A', '#1A1F4A'] as const} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.back}>
                <View style={styles.backInnerRing} />
                <Text style={styles.backMonogram}>R</Text>
              </LinearGradient>
            )}
          </Reanimated.View>

          {/* FRONT — the shared card face, mounted only once a flip has been requested. */}
          <Reanimated.View style={[styles.side, frontStyle]} pointerEvents="none">
            {flipRequested ? (
              <RevealCardFace
                testIDPrefix="reveal-spotlight-face"
                card={card}
                width={size.width}
                packArt={packArt}
                packPaletteCover={packPaletteCover}
                serialText={serialText}
              />
            ) : null}
          </Reanimated.View>
        </AnimatedPressable>

        {revealed ? (
          <Pressable testID="reveal-spotlight-read-full" accessibilityRole="button" style={styles.readFull} onPress={() => setSheetOpen(true)}>
            <Text style={styles.readFullText} numberOfLines={1}>{SPOTLIGHT_COPY.readFull}</Text>
          </Pressable>
        ) : null}

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </Reanimated.View>

      {sheetOpen ? (
        <View testID="reveal-spotlight-full-question" style={styles.sheet}>
          <RNScrollView style={styles.sheetScroll}>
            <Text style={styles.sheetText}>{card.question}</Text>
          </RNScrollView>
          <Pressable testID="reveal-spotlight-full-close" accessibilityRole="button" style={styles.sheetClose} onPress={() => setSheetOpen(false)}>
            <Text style={styles.sheetCloseText} numberOfLines={1}>{SPOTLIGHT_COPY.close}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export const RevealSpotlight = React.memo(RevealSpotlightImpl);

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);

// ── Skia light: one window-sized canvas behind the card (device only; never mounts under the
// guard fallback or Reduce Motion). Radial glow + rotating rays + a one-shot particle burst. ──
type SpotlightCanvasProps = {
  width: number;
  height: number;
  rarity: 'COM' | 'RAR' | 'LEG';
  glow: { value: number };
  raysAngle: { value: number };
  revealed: boolean;
  center: { x: number; y: number };
};

function SpotlightCanvas(props: SpotlightCanvasProps): React.JSX.Element | null {
  if (!skiaAvailable || !SkiaModule) return null;
  const { width, height, rarity, glow, raysAngle, revealed, center } = props;
  const { Canvas, Rect, Atlas, SweepGradient, RadialGradient, useImage, useRSXformBuffer, vec, rect } = SkiaModule;

  const stops = rayStops();
  const spread = width * 0.35;
  const life = PARTICLE_LIFE_MS[rarity];
  const count = PARTICLE_COUNT[rarity];

  const burstElapsed = useSharedValue(-1);
  const firedRef = React.useRef(false);
  React.useEffect(() => {
    if (!revealed || firedRef.current) return;
    firedRef.current = true;
    burstElapsed.value = 0;
    burstElapsed.value = withTiming(life, { duration: life, easing: Easing.linear });
  }, [revealed, life, burstElapsed]);

  const glowColors = useDerivedValue(() => {
    'worklet';
    return [haloColorForTell(glow.value, rarity), 'rgba(255,247,236,0)'];
  });
  const rayTransform = useDerivedValue(() => {
    'worklet';
    return [{ rotate: raysAngle.value }];
  });

  const transforms = useRSXformBuffer(MAX_PARTICLES, (val: { set: (a: number, b: number, c: number, d: number) => void }, i: number) => {
    'worklet';
    const elapsed = burstParticleElapsed(burstElapsed.value, life);
    if (i >= count || elapsed < 0) {
      val.set(0, 0, 0, 0);
      return;
    }
    const pose = particlePose(i, elapsed, life, center, spread);
    const r = poseToRSXform(pose, PARTICLE_SPRITE_SIZE);
    val.set(r.scos, r.ssin, r.tx, r.ty);
  });
  const sprites = React.useMemo(
    () => Array.from({ length: MAX_PARTICLES }, (_, i) => rect((i % PARTICLE_SHEET_COLUMNS) * PARTICLE_SPRITE_SIZE, 0, PARTICLE_SPRITE_SIZE, PARTICLE_SPRITE_SIZE)),
    [rect],
  );
  const particleImage = useImage(PARTICLE_SHEET);

  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} opacity={glow} transform={rayTransform} origin={vec(center.x, center.y)}>
        <SweepGradient c={vec(center.x, center.y)} colors={stops.colors} positions={stops.positions} />
      </Rect>
      <Rect x={0} y={0} width={width} height={height} opacity={glow}>
        <RadialGradient c={vec(center.x, center.y)} r={width * 0.6} colors={glowColors} />
      </Rect>
      {particleImage ? <Atlas image={particleImage} sprites={sprites} transforms={transforms} blendMode="plus" /> : null}
    </Canvas>
  );
}

const StyleSheet: any = readRN('StyleSheet', { create: (s: any) => s, absoluteFillObject: {} });

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  hidden: { opacity: 0 },
  scrim: { ...StyleSheet.absoluteFillObject },
  staticHalo: { position: 'absolute', opacity: 0.5 },
  column: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  side: { ...StyleSheet.absoluteFillObject, borderRadius: 18, overflow: 'hidden', backfaceVisibility: 'hidden' },
  back: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(218,180,90,0.55)', borderRadius: 18, overflow: 'hidden' },
  backImage: { width: '100%', height: '100%' },
  backInnerRing: { position: 'absolute', width: '70%', height: '70%', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(218,180,90,0.30)' },
  backMonogram: { color: 'rgba(218,180,90,0.85)', fontSize: 64, fontWeight: '900', letterSpacing: 1, fontStyle: 'italic' },
  banner: { fontSize: 34, fontWeight: '900', letterSpacing: 1, marginBottom: 18, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  bannerSpacer: { height: 52, marginBottom: 18 },
  readFull: { marginTop: 20, minHeight: 44, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  readFullText: { color: '#F5ECC4', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  footer: { marginTop: 22, width: '100%', alignItems: 'stretch' },
  sheet: { position: 'absolute', left: 20, right: 20, top: '18%', bottom: '18%', borderRadius: 20, backgroundColor: '#141024', padding: 20, zIndex: 60 },
  sheetScroll: { flex: 1 },
  sheetText: { color: '#F5ECC4', fontSize: 18, lineHeight: 26, fontWeight: '700' },
  sheetClose: { marginTop: 16, minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,236,196,0.16)' },
  sheetCloseText: { color: '#F5ECC4', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
});

export default RevealSpotlight;
