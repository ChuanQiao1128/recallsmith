// StageCanvas (B05) — ONE Skia Canvas for the ceremony stage light.
//
// Layer order (bottom → top, B00 §2.8): vignette, 12-spoke SweepGradient rays,
// rarity-tell halo, seam light-leak (`plus` blend), face-down rarity rims,
// an Atlas particle burst, the flash rect. Every dynamic value is a shared
// value from the timeline passed straight to a Skia prop — this canvas reads no
// `.value` during render and never mounts under `!skiaAvailable`; the flash,
// rays and particles never mount under Reduce Motion.
//
// The pack itself is B06's PackTear in its own canvas layered on top (B00 §7.3:
// three canvases in the ceremony tree). This file exports the geometry
// (packRectInStage, packSlotInStage) B09 uses to drop that pack exactly under
// the stage's seam light-leak.
//
// Animation comes only from the guard (B00 §2.1): Skia primitives from
// SkiaModule, Reanimated hooks from the Reanimated surface — never the Skia
// clock hook, never a derived-value hook off SkiaModule (the crash designed out
// of the old holographic renderer).

import React, { useMemo } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { Reanimated, SkiaModule, skiaAvailable, type SharedValue } from './reanimatedGuard';
import type { PeakRarity } from '../../features/gacha/draw/ceremonyTimings';

// Destructured at module scope so worklet callbacks reference these functions
// directly and never the `Reanimated` namespace object (B00 §2.8 worklet rules).
const {
  useSharedValue,
  useDerivedValue,
  useAnimatedReaction,
  withTiming,
  interpolateColor,
  Easing,
} = Reanimated;

/** Structural subset of CeremonyTimeline (B00 §2.10) this canvas reads. */
export type StageTimeline = {
  tell: SharedValue<number>; dim: SharedValue<number>; leak: SharedValue<number>; flash: SharedValue<number>;
  rays: SharedValue<number>; raysAngle: SharedValue<number>; /* RADIANS, 0..2π per revolution (B07, B00 §2.10) — passed to Skia `rotate` unchanged */ halo: SharedValue<number>;
  rim: ReadonlyArray<SharedValue<number>>;
  spill: ReadonlyArray<{ x: SharedValue<number>; y: SharedValue<number>; rot: SharedValue<number> }>;  // x/y: pt offsets from the stage centre; rot: radians (B00 §2.10)
};

export type StageCanvasProps = {
  width: number; height: number;
  peakRarity: PeakRarity;
  timeline: StageTimeline;
  reduceMotion: boolean;
  particleSheet?: ImageSourcePropType;
  glowNineSlice?: ImageSourcePropType;
  cardCount: number;
  testID?: string;
};

export const STAGE_TESTID = 'draw-ceremony-stage-canvas';
export const RAY_COUNT = 12;
export const RAY_REVOLUTION_MS = 14000;
export const MAX_PARTICLES = 120;
export const STAGE_TELL_COLORS = { NEUTRAL: '#FFF7EC', COM: '#FFF3E0', RAR: '#A78BD8', LEG: '#F5C95E' } as const;
export const RIM_COLORS: Readonly<Record<PeakRarity, string>> = { COM: 'rgba(255,255,255,0)', RAR: '#A78BD8', LEG: '#F5C95E' };
export const FLASH_COLORS: Readonly<Record<PeakRarity, string>> = { COM: 'rgba(255,255,255,0.88)', RAR: 'rgba(201,173,247,0.95)', LEG: 'rgba(245,201,94,0.95)' }; // DrawCeremonyScreen.tsx:127-131
export const PARTICLE_COUNT: Readonly<Record<PeakRarity, number>> = { COM: 24, RAR: 64, LEG: 120 };
export const PARTICLE_LIFE_MS: Readonly<Record<PeakRarity, number>> = { COM: 600, RAR: 900, LEG: 1500 };
export const PARTICLE_SPRITE_SIZE = 64;
export const PARTICLE_SHEET_COLUMNS = 4;
export const LEAK_BAND_RATIO = 0.18;   // = packArt.SEAM_BAND_RATIO (B06); top 18 % of the pack rect
export const PACK_BODY_FRACTION = 0.7;      // mirrors PackTear.PACK_BODY_FRACTION (B06): pack body = 70 % of its slot (B00 §9 #18)

export type StageRect = { x: number; y: number; width: number; height: number };

// ── Pure helpers (unit-tested; all deterministic — "Honest tells only") ──

/**
 * The rarity tell colour for the current tell value: a warm neutral at 0 that
 * relaxes into the rarity hue as the tell climbs — LEG stepping neutral → violet
 * → gold (the two-step "it went gold"), RAR to violet, COM to warm.
 */
export function stageHaloColor(tell: number, peakRarity: PeakRarity): string {
  'worklet';
  if (peakRarity === 'LEG') {
    return interpolateColor(
      tell,
      [0, 0.4, 0.6, 1],
      [STAGE_TELL_COLORS.NEUTRAL, STAGE_TELL_COLORS.RAR, STAGE_TELL_COLORS.LEG, STAGE_TELL_COLORS.LEG],
    );
  }
  if (peakRarity === 'RAR') {
    return interpolateColor(tell, [0, 1], [STAGE_TELL_COLORS.NEUTRAL, STAGE_TELL_COLORS.RAR]);
  }
  return interpolateColor(tell, [0, 1], [STAGE_TELL_COLORS.NEUTRAL, STAGE_TELL_COLORS.COM]);
}

/** 2×count alternating warm-white stops (opaque, transparent, …) for the ray SweepGradient. */
export function rayStops(count: number = RAY_COUNT): { colors: string[]; positions: number[] } {
  const total = 2 * count;
  const colors: string[] = [];
  const positions: number[] = [];
  for (let i = 0; i < total; i += 1) {
    colors.push(i % 2 === 0 ? 'rgba(255,247,236,0.9)' : 'rgba(255,247,236,0)');
    positions.push(i / total);
  }
  return { colors, positions };
}

/** Face-down card size for the settle rims (mirrors DrawCeremonyScreen.tsx:1199-1200). */
export function tableCardSize(cardCount: number): { width: number; height: number } {
  if (cardCount === 1) return { width: 132, height: 184 };
  if (cardCount <= 5) return { width: 80, height: 116 };
  return { width: 72, height: 100 };
}

/** The pack BODY in stage px — what the leak band and the burst origin align to. */
export function packRectInStage(width: number, height: number): StageRect {
  const w = Math.min(width * 0.46, 200);
  const h = w * 1.5;
  const x = (width - w) / 2;
  const centreY = height * 0.45;
  const y = centreY - h / 2;
  return { x, y, width: w, height: h };
}

/** packRectInStage inflated by 1 / PACK_BODY_FRACTION about its centre (B09 mounts <PackTear> here). */
export function packSlotInStage(width: number, height: number): StageRect {
  const pack = packRectInStage(width, height);
  const sw = pack.width / PACK_BODY_FRACTION;
  const sh = pack.height / PACK_BODY_FRACTION;
  return {
    x: pack.x - (sw - pack.width) / 2,
    y: pack.y - (sh - pack.height) / 2,
    width: sw,
    height: sh,
  };
}

/**
 * The burst's elapsed time to feed `particlePose`, as a one-shot timeline (MGACHA-01): `-1`
 * before a burst has fired (`!(burstElapsedMs >= 0)`, so NaN also reads as "no burst"), otherwise
 * `Math.min(burstElapsedMs, lifeMs)` — a finished burst clamps at `lifeMs`, where `particlePose`
 * is already invisible, so it never restarts (the old `% RAY_REVOLUTION_MS` clock replayed it).
 */
export function burstParticleElapsed(burstElapsedMs: number, lifeMs: number): number {
  'worklet';
  if (!(burstElapsedMs >= 0)) return -1;
  return Math.min(burstElapsedMs, lifeMs);
}

/** Deterministic per-sprite pose in an upward cone with gravity; zeroed outside its life window. */
export function particlePose(
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
  const seed = ((index * 9301 + 49297) % 233280) / 233280;
  const seed2 = ((index * 7919 + 104729) % 233280) / 233280;
  const t = elapsedMs / lifeMs;
  const angle = -Math.PI / 2 + (seed - 0.5) * 1.2 * Math.PI;
  const speed = spread * (0.5 + seed2);
  const x = origin.x + Math.cos(angle) * speed * t;
  const y = origin.y + Math.sin(angle) * speed * t + 0.5 * spread * t * t;
  const scale = (1 - t) * (0.5 + 0.5 * seed2);
  const rotation = t * 2 * Math.PI * (seed - 0.5);
  const alpha = 1 - t;
  return { x, y, scale, rotation, alpha };
}

/** Pack a pose into an RSXform quad centred on the pose. */
export function poseToRSXform(
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

// ── Per-card rarity rim. One StageRim per card so the hook count stays fixed
// per render (no hook inside a .map). The rim's own transform is the card's
// offset-from-centre + rotation; the centre translate lives on the parent
// origin group (B00 §2.10 "Units" / §9 #16). ──

type StageRimProps = {
  index: number;
  x: SharedValue<number>;
  y: SharedValue<number>;
  rot: SharedValue<number>;
  alpha: SharedValue<number>;
  size: { width: number; height: number };
  color: string;
  glowImage: unknown;
};

function StageRim({ x, y, rot, alpha, size, color, glowImage }: StageRimProps): React.JSX.Element {
  const { Group, RoundedRect, Image } = SkiaModule;
  const transform = useDerivedValue(() => {
    'worklet';
    return [{ translateX: x.value }, { translateY: y.value }, { rotate: rot.value }];
  });
  return (
    <Group transform={transform} opacity={alpha}>
      {glowImage ? (
        <Image
          image={glowImage}
          x={-size.width / 2 - 12}
          y={-size.height / 2 - 12}
          width={size.width + 24}
          height={size.height + 24}
          fit="fill"
          opacity={0.6}
        />
      ) : null}
      <RoundedRect
        x={-size.width / 2}
        y={-size.height / 2}
        width={size.width}
        height={size.height}
        r={10}
        color={color}
        style="stroke"
        strokeWidth={2}
      />
    </Group>
  );
}

// Memoised (2026-09-21 perf): the screen re-renders on every phase change and every card
// flip, but none of this canvas's props change then (motion arrives through the timeline's
// shared values), so the Skia element tree is reconciled once per ceremony.
export const StageCanvas: React.NamedExoticComponent<StageCanvasProps> = React.memo(function StageCanvas(props: StageCanvasProps): React.JSX.Element | null {
  if (!skiaAvailable || !SkiaModule) return null;

  const {
    width,
    height,
    peakRarity,
    timeline,
    reduceMotion,
    particleSheet,
    glowNineSlice,
    cardCount,
    testID,
  } = props;

  const { Canvas, Group, Rect, Atlas, SweepGradient, RadialGradient, useImage, vec, rect } = SkiaModule;

  const { tell, raysAngle, dim, rays, halo, leak, flash, spill, rim } = timeline;

  // Geometry the light layers hang on.
  const pack = packRectInStage(width, height);
  const packCentreY = pack.y + pack.height / 2;
  const stops = rayStops();
  const rimSize = tableCardSize(cardCount);
  const rimColor = RIM_COLORS[peakRarity];
  const origin = { x: pack.x + pack.width / 2, y: pack.y + (pack.height * LEAK_BAND_RATIO) / 2 };
  const spread = width * 0.35;

  // Derived colours/transforms — each callback a worklet reading only shared
  // values, module constants and worklet helpers. The halo and the leak share one
  // derived stop list (identical inputs) so the tell colour is interpolated once per frame.
  const haloColors = useDerivedValue(() => {
    'worklet';
    return [stageHaloColor(tell.value, peakRarity), 'rgba(255,247,236,0)'];
  });
  const leakColors = haloColors;
  // raysAngle is already RADIANS (B07 drives it 0 → 2π once per revolution,
  // B00 §2.10 "Units") — passed to Skia rotate unchanged.
  const rayTransform = useDerivedValue(() => {
    'worklet';
    return [{ rotate: raysAngle.value }];
  });

  // Particle burst timebase: a one-shot elapsed ramp, -1 while no burst is live. It is driven
  // straight from the flash crossing (below) rather than a repeating clock, so a finished burst
  // clamps at its life and never replays every RAY_REVOLUTION_MS the way the old modulo did.
  const burstElapsed = useSharedValue(-1);

  // Fire a burst when the flash crosses its threshold on the way up (never under reduceMotion):
  // seed the elapsed ramp at 0, then run it linearly to the peak rarity's particle life.
  useAnimatedReaction(
    () => flash.value,
    (v: number, prev: number | null) => {
      'worklet';
      if (reduceMotion) return;
      if (prev !== null && prev < 0.4 && v >= 0.4) {
        const life = PARTICLE_LIFE_MS[peakRarity];
        burstElapsed.value = 0;
        burstElapsed.value = withTiming(life, { duration: life, easing: Easing.linear });
      }
    },
  );

  // Atlas transforms — a hook, so called on every render (reduceMotion included);
  // the modifier captures reduceMotion as a plain boolean and zeroes every quad
  // when it is true. Only the JSX differs between the two modes.
  const transforms = SkiaModule.useRSXformBuffer(MAX_PARTICLES, (val: { set: (a: number, b: number, c: number, d: number) => void }, i: number) => {
    'worklet';
    if (reduceMotion) {
      val.set(0, 0, 0, 0);
      return;
    }
    const count = PARTICLE_COUNT[peakRarity];
    const elapsed = burstParticleElapsed(burstElapsed.value, PARTICLE_LIFE_MS[peakRarity]);
    if (i >= count || elapsed < 0) {
      val.set(0, 0, 0, 0);
      return;
    }
    const pose = particlePose(i, elapsed, PARTICLE_LIFE_MS[peakRarity], origin, spread);
    const r = poseToRSXform(pose, PARTICLE_SPRITE_SIZE);
    val.set(r.scos, r.ssin, r.tx, r.ty);
  });

  const sprites = useMemo(
    () =>
      Array.from({ length: MAX_PARTICLES }, (_, i) =>
        rect((i % PARTICLE_SHEET_COLUMNS) * PARTICLE_SPRITE_SIZE, 0, PARTICLE_SPRITE_SIZE, PARTICLE_SPRITE_SIZE),
      ),
    [rect],
  );

  const particleImage = useImage(particleSheet ?? null);
  const glowImage = useImage(glowNineSlice ?? null);

  const rimCount = Math.min(cardCount, 10);

  return (
    <Canvas
      style={{ position: 'absolute', left: 0, top: 0, width, height }}
      pointerEvents="none"
      testID={testID ?? STAGE_TESTID}
    >
      {/* 1 vignette */}
      {/* The canvas is a 280×360 island on a light page, so this layer must be transparent at
          its own edges or it reads as a grey box (seen on the simulator, 2026-09-20). It is now
          a soft dark ring around the pack; the screen-wide LEG dim is a full-screen overlay in
          DrawCeremonyScreen driven by the same `dim` value. */}
      <Rect x={0} y={0} width={width} height={height} opacity={dim}>
        <RadialGradient
          c={vec(width / 2, packCentreY)}
          r={Math.min(width, height) * 0.72}
          colors={['rgba(8,4,20,0)', 'rgba(8,4,20,0.35)', 'rgba(8,4,20,0)']}
          positions={[0, 0.62, 1]}
        />
      </Rect>
      {/* 2 rays — not mounted under reduceMotion */}
      {!reduceMotion ? (
        <Rect x={0} y={0} width={width} height={height} opacity={rays} transform={rayTransform} origin={vec(width / 2, packCentreY)}>
          <SweepGradient c={vec(width / 2, packCentreY)} colors={stops.colors} positions={stops.positions} />
        </Rect>
      ) : null}
      {/* 3 halo */}
      <Rect x={0} y={0} width={width} height={height} opacity={halo}>
        <RadialGradient c={vec(width / 2, packCentreY)} r={width * 0.45} colors={haloColors} />
      </Rect>
      {/* 4 seam light-leak (plus blend) */}
      <Rect
        x={pack.x - 12}
        y={pack.y - 8}
        width={pack.width + 24}
        height={pack.height * LEAK_BAND_RATIO + 16}
        opacity={leak}
        blendMode="plus"
      >
        <RadialGradient
          c={vec(width / 2, pack.y + (pack.height * LEAK_BAND_RATIO) / 2)}
          r={pack.width * 0.7}
          colors={leakColors}
        />
      </Rect>
      {/* 5 rims — one StageRim per card (≤ 10), inside ONE centre-origin group:
          spill x/y are offsets from the stage centre (B00 §2.10) */}
      <Group transform={[{ translateX: width / 2 }, { translateY: height / 2 }]}>
        {Array.from({ length: rimCount }, (_, i) => {
          const s = spill[i];
          const a = rim[i];
          if (!s || !a) return null;
          return (
            <StageRim
              key={i}
              index={i}
              x={s.x}
              y={s.y}
              rot={s.rot}
              alpha={a}
              size={rimSize}
              color={rimColor}
              glowImage={glowImage}
            />
          );
        })}
      </Group>
      {/* 6 particles — only with an image and not under reduceMotion */}
      {!reduceMotion && particleImage ? (
        <Atlas image={particleImage} sprites={sprites} transforms={transforms} blendMode="plus" />
      ) : null}
      {/* 7 flash — never mounted under reduceMotion */}
      {!reduceMotion ? (
        <Rect x={0} y={0} width={width} height={height} opacity={flash}>
          {/* radial, transparent at the canvas edge — a solid rect flashed as a hard-edged box */}
          <RadialGradient
            c={vec(width / 2, packCentreY)}
            r={Math.max(width, height) * 0.7}
            colors={[FLASH_COLORS[peakRarity], FLASH_COLORS[peakRarity].replace(/,\s*[\d.]+\)$/, ',0)')]}
          />
        </Rect>
      ) : null}
    </Canvas>
  );
});
