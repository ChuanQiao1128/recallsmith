// BurstCanvas (I06) — ONE Skia Canvas for the full-screen rarity-tinted burst that fires at
// the flash on the Skia path. Modelled on StageCanvas: a full-window rarity-tinted radial flash
// rect driven by the timeline's `flash` shared value, and ONE Atlas particle burst that fires
// once when `flash` crosses 0.4 upward and never replays. It reads no `.value` during render,
// never mounts without Skia, and never mounts under Reduce Motion (the fallback renderer keeps
// its own RN flash; this canvas owns the full-screen flash on the Skia path).

import React, { useMemo } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { Reanimated, SkiaModule, skiaAvailable, type SharedValue } from './reanimatedGuard';
import type { PeakRarity } from '../../features/gacha/draw/ceremonyTimings';

const { useSharedValue, useAnimatedReaction, withTiming, Easing } = Reanimated;

export const BURST_CANVAS_TESTID = 'draw-ceremony-burst-canvas';
export const BURST_PARTICLE_COUNT = Object.freeze({ COM: 60, RAR: 120, LEG: 200 });
export const BURST_PARTICLE_LIFE_MS = Object.freeze({ COM: 700, RAR: 900, LEG: 1200 });
export const BURST_TINT = Object.freeze({ COM: '#FFE3A3', RAR: '#B79BFF', LEG: '#FFD166' });
export const BURST_SPREAD_FRACTION = 0.6;

// The widest live burst (LEG) needs this many quads; the buffer is fixed so the hook count
// never changes and idle sprites are zeroed.
const BURST_MAX_PARTICLES = 200;
const BURST_SPRITE_SIZE = 64;
const BURST_SHEET_COLUMNS = 4;
// The golden angle spreads successive indices evenly around the full circle.
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Deterministic per-sprite pose for the 360° burst: the golden-angle sequence fans the sprites
 * over the whole circle, each travels out with an ease-out up to `spread`, with a light gravity
 * pull and a fading scale/alpha. Zeroed (invisible) outside `[0, lifeMs)` so a finished burst
 * never draws.
 */
export function burstParticlePose360(
  index: number,
  elapsedMs: number,
  lifeMs: number,
  origin: { x: number; y: number },
  spread: number,
): { x: number; y: number; scale: number; rotation: number; alpha: number } {
  'worklet';
  if (lifeMs <= 0 || elapsedMs < 0 || elapsedMs >= lifeMs) {
    return { x: origin.x, y: origin.y, scale: 0, rotation: 0, alpha: 0 };
  }
  const seed = ((index * 7919 + 104729) % 233280) / 233280;
  const angle = index * GOLDEN_ANGLE;
  const t = elapsedMs / lifeMs;
  const ease = 1 - (1 - t) * (1 - t); // ease-out travel
  const speed = spread * (0.5 + seed);
  const x = origin.x + Math.cos(angle) * speed * ease;
  const y = origin.y + Math.sin(angle) * speed * ease + 0.5 * spread * t * t; // light gravity
  const scale = (1 - t) * (0.5 + 0.5 * seed);
  const rotation = angle + t * Math.PI;
  const alpha = 1 - t;
  return { x, y, scale, rotation, alpha };
}

/** One-shot elapsed clamp: -1 before a burst fires, else min(elapsed, life) so it never replays. */
function burstElapsedClamp(elapsedMs: number, lifeMs: number): number {
  'worklet';
  if (!(elapsedMs >= 0)) return -1;
  return Math.min(elapsedMs, lifeMs);
}

function poseToQuad(
  pose: { x: number; y: number; scale: number; rotation: number },
  spriteSize: number,
): { scos: number; ssin: number; tx: number; ty: number } {
  'worklet';
  const scos = pose.scale * Math.cos(pose.rotation);
  const ssin = pose.scale * Math.sin(pose.rotation);
  const half = spriteSize / 2;
  const tx = pose.x - (scos * half - ssin * half);
  const ty = pose.y - (ssin * half + scos * half);
  return { scos, ssin, tx, ty };
}

export type BurstCanvasProps = {
  width: number;
  height: number;
  peakRarity: PeakRarity;
  flash: SharedValue<number>;
  reduceMotion: boolean;
  particleSheet?: ImageSourcePropType;
  origin?: { x: number; y: number };
  testID?: string;
};

export const BurstCanvas: React.NamedExoticComponent<BurstCanvasProps> = React.memo(function BurstCanvas(
  props: BurstCanvasProps,
): React.JSX.Element | null {
  if (!skiaAvailable || !SkiaModule || props.reduceMotion) return null;

  const { width, height, peakRarity, flash, particleSheet, testID } = props;
  const { Canvas, Rect, Atlas, RadialGradient, BlendColor, useImage, useRSXformBuffer, vec, rect } = SkiaModule;

  const origin = props.origin ?? { x: width / 2, y: height * 0.45 };
  const tint = BURST_TINT[peakRarity];
  const life = BURST_PARTICLE_LIFE_MS[peakRarity];
  const count = BURST_PARTICLE_COUNT[peakRarity];
  const spread = BURST_SPREAD_FRACTION * width;

  // One-shot burst timebase: -1 while no burst is live, seeded straight from the flash crossing.
  const burstElapsed = useSharedValue(-1);
  useAnimatedReaction(
    () => flash.value,
    (v: number, prev: number | null) => {
      'worklet';
      if (prev !== null && prev < 0.4 && v >= 0.4) {
        burstElapsed.value = 0;
        burstElapsed.value = withTiming(life, { duration: life, easing: Easing.linear });
      }
    },
  );

  const transforms = useRSXformBuffer(BURST_MAX_PARTICLES, (val: { set: (a: number, b: number, c: number, d: number) => void }, i: number) => {
    'worklet';
    const elapsed = burstElapsedClamp(burstElapsed.value, life);
    if (i >= count || elapsed < 0) {
      val.set(0, 0, 0, 0);
      return;
    }
    const pose = burstParticlePose360(i, elapsed, life, origin, spread);
    const q = poseToQuad(pose, BURST_SPRITE_SIZE);
    val.set(q.scos, q.ssin, q.tx, q.ty);
  });

  const sprites = useMemo(
    () =>
      Array.from({ length: BURST_MAX_PARTICLES }, (_, i) =>
        rect((i % BURST_SHEET_COLUMNS) * BURST_SPRITE_SIZE, 0, BURST_SPRITE_SIZE, BURST_SPRITE_SIZE),
      ),
    [rect],
  );

  const particleImage = useImage(particleSheet ?? null);

  return (
    <Canvas
      style={{ position: 'absolute', left: 0, top: 0, width, height }}
      pointerEvents="none"
      testID={testID ?? BURST_CANVAS_TESTID}
    >
      {/* Full-screen rarity-tinted flash — bright at the origin, transparent at the edge. */}
      <Rect x={0} y={0} width={width} height={height} opacity={flash}>
        <RadialGradient
          c={vec(origin.x, origin.y)}
          r={Math.max(width, height) * 0.8}
          colors={[tint, `${tint}00`]}
        />
      </Rect>
      {/* ONE tinted particle atlas (plus-blended, one draw call), only once the image loads. */}
      {particleImage ? (
        <Atlas image={particleImage} sprites={sprites} transforms={transforms} blendMode="plus">
          {BlendColor ? <BlendColor color={tint} mode="modulate" /> : null}
        </Atlas>
      ) : null}
    </Canvas>
  );
});

export default BurstCanvas;
