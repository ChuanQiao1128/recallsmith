// PackTear — the reward pack that actually tears open (B06, release-1.6.0-plan §3.1).
//
// The pack cover is one Skia image drawn twice under two clip paths that a jagged
// 14-vertex seam splits: the body below the seam, and a top strip that peels away with
// a perspective rotateX about its bottom edge. A face-down card hint rises out of the
// seam with `cardOut`, multi-pull draws deck-thickness edges, and a pity draw gets a seal.
// The top 18 % of the pack height is the seam band (SEAM_BAND_RATIO, release-1.6.0-plan §3.6):
// the jagged seam's y stays inside that band so the tear reads near the pack's top edge.
//
// An accessible RN root (accessibilityRole="button", 'activate' action) wraps a
// gesture-handler Pan (via the guard's PanHost) that drives `timeline.seam` on the UI
// thread, so the first visual response lands within one frame (S0). Every Skia,
// Reanimated and gesture symbol comes from ./reanimatedGuard (B00 §2.1); this file never
// requires a native package directly.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { GestureHandler, Reanimated, SkiaModule, skiaAvailable, type SharedValue } from './reanimatedGuard';
import { SWIPE_TRIGGER_DISTANCE, type CeremonyPhase } from '../../features/gacha/draw/ceremonyTimings';
import { SEAM_BAND_RATIO, type PackPalette } from '../../theme/packArt';

const { useSharedValue, useDerivedValue, withTiming, runOnJS } = Reanimated;
const { PanHost, Gesture } = GestureHandler;
const SkiaApi: any | null = SkiaModule ? SkiaModule.Skia : null;

/** Structural subset of CeremonyTimeline (B00 §2.10) this component reads. */
export type PackTimeline = {
  seam: SharedValue<number>;      // 0 = intact, 1 = cut edge-to-edge
  peel: SharedValue<number>;      // 0 = strip flat, 1 = strip folded away
  cardOut: SharedValue<number>;   // 0 = card inside, 1 = card hint fully risen
  packScale: SharedValue<number>; // 1 at rest, 1.12 (single) / 1.10 (multi) in approach
  packY: SharedValue<number>;     // px, stage-space translateY
  shiver: SharedValue<number>;    // px, LEG beat translateX
};

export type PackTearProps = {
  width: number; height: number;                 // the pack SLOT (root View + canvas size); the pack body is packBodyRect() inside it.
  coverImage: ImageSourcePropType | undefined;
  palette: PackPalette;
  phase: CeremonyPhase;
  isMulti: boolean;
  pitySeal: boolean;
  timeline: PackTimeline;
  /** true under reduceMotion or when phase !== 'swipe' (DrawCeremonyScreen.tsx:990-993). */
  disabled: boolean;
  /** Called exactly once when the seam commits (release ≥ SWIPE_TRIGGER_DISTANCE, or the a11y 'activate' action). */
  onTear: () => void;
  onSeamProgress?: (progress01: number) => void;
};

export const PACK_A11Y_LABEL = 'Reward pack';
export const PACK_A11Y_HINT = 'Swipe right or double-tap to open';
export const PACK_ACTIVATE_ACTION = 'activate';
export const PACK_ACTIVATE_LABEL = 'Open pack';
export const PACK_A11Y_ACTIONS = Object.freeze([{ name: PACK_ACTIVATE_ACTION, label: PACK_ACTIVATE_LABEL }]);
export const PACK_BODY_FRACTION = 0.7;          // pack body = 70 % of the slot; the rest is bleed for scale 1.12 + the peel
export const PACK_CORNER_RADIUS = 14;
export const SEAM_VERTEX_COUNT = 14;
/** Jagged seam, normalised: x across the pack width (0..1, strictly increasing, first 0, last 1),
 *  y inside the seam band (0..1 of SEAM_BAND_RATIO × pack height). */
export const SEAM_PATH_NORMALISED: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0, 0.55], [0.08, 0.42], [0.16, 0.66], [0.24, 0.38], [0.31, 0.6], [0.39, 0.46], [0.47, 0.7],
  [0.55, 0.4], [0.62, 0.62], [0.7, 0.36], [0.78, 0.64], [0.86, 0.44], [0.93, 0.68], [1, 0.52],
] as const);
export const PEEL_ROTATE_X_RAD = -(70 * Math.PI) / 180;   // §3.1 S3 rotateX(-70°), Skia takes radians
export const PEEL_LIFT_PX = 40;                            // §3.1 S3 translateY(-40)
export const PEEL_PERSPECTIVE = 800;                        // §3.1 S3 perspective 800
export const CARD_OUT_RISE_FRACTION = 0.2;                  // card hint rises 20 % of the body height at cardOut = 1
export const DECK_EDGE_OFFSETS: readonly number[] = Object.freeze([6, 3]);   // multi deck-thickness rects (px)
export const SEAM_EDGE_COLOR = 'rgba(255,247,236,0.95)';
export const SEAL_COLOR = '#F5C95E';
export const RELEASE_SNAP_BACK_MS = 160;

export type PackRect = { x: number; y: number; width: number; height: number };

export function seamProgressFromDelta(deltaX: number): number {
  'worklet';
  return Math.min(1, Math.max(0, deltaX / SWIPE_TRIGGER_DISTANCE));
}

export function packTestID(phase: CeremonyPhase, isMulti: boolean): string {
  return phase === 'swipe'
    ? 'draw-ceremony-swipe-pack'
    : isMulti
      ? 'draw-ceremony-multi-flyin'
      : 'draw-ceremony-single-pack-flyin';
}

export function packBodyRect(width: number, height: number): PackRect {
  const bw = Math.min(width, (height * 2) / 3) * PACK_BODY_FRACTION;
  const bh = bw * 1.5;
  return { x: (width - bw) / 2, y: (height - bh) / 2, width: bw, height: bh };
}

export function seamPointsPx(body: PackRect): Array<{ x: number; y: number }> {
  'worklet';
  return SEAM_PATH_NORMALISED.map(([nx, ny]) => ({
    x: body.x + nx * body.width,
    y: body.y + ny * body.height * SEAM_BAND_RATIO,
  }));
}

export function seamYAt(points: ReadonlyArray<{ x: number; y: number }>, x: number): number {
  'worklet';
  const first = points[0];
  const last = points[points.length - 1];
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.x) {
      const span = b.x - a.x;
      const t = span === 0 ? 0 : (x - a.x) / span;
      return a.y + (b.y - a.y) * t;
    }
  }
  return last.y;
}

// Path builders — module-level, worklet-safe, each takes the Skia host api first and
// returns SkiaApi.Path.Make() built with moveTo/lineTo/close.

function makeStripPath(api: any, body: PackRect, points: ReadonlyArray<{ x: number; y: number }>, progress: number): any {
  'worklet';
  const cutX = body.x + progress * body.width;
  const path = api.Path.Make();
  path.moveTo(body.x, body.y);
  path.lineTo(cutX, body.y);
  path.lineTo(cutX, seamYAt(points, cutX));
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i];
    if (p.x <= cutX) path.lineTo(p.x, p.y);
  }
  path.close();
  return path;
}

function makeBodyPath(api: any, body: PackRect, points: ReadonlyArray<{ x: number; y: number }>, progress: number): any {
  'worklet';
  const cutX = body.x + progress * body.width;
  const path = api.Path.Make();
  path.moveTo(body.x, points[0].y);
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.x <= cutX) path.lineTo(p.x, p.y);
  }
  path.lineTo(cutX, seamYAt(points, cutX));
  path.lineTo(cutX, body.y);
  path.lineTo(body.x + body.width, body.y);
  path.lineTo(body.x + body.width, body.y + body.height);
  path.lineTo(body.x, body.y + body.height);
  path.close();
  return path;
}

function makeSeamEdgePath(api: any, points: ReadonlyArray<{ x: number; y: number }>, progress: number): any {
  'worklet';
  const cutX = points[0].x + progress * (points[points.length - 1].x - points[0].x);
  const path = api.Path.Make();
  let started = false;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p.x <= cutX) {
      if (!started) {
        path.moveTo(p.x, p.y);
        started = true;
      } else {
        path.lineTo(p.x, p.y);
      }
    }
  }
  if (!started) path.moveTo(points[0].x, points[0].y);
  return path;
}

// PackCanvas — module-private; holds every Skia hook. Rendered only when
// skiaAvailable && SkiaModule, so SkiaModule is non-null here. It takes only the props
// it draws with and is memoised: the phase / disabled / handler churn that re-renders
// the accessible root never re-reconciles the Skia pack (2026-09-21 perf).
type PackCanvasProps = Pick<PackTearProps, 'width' | 'height' | 'coverImage' | 'palette' | 'isMulti' | 'pitySeal' | 'timeline'>;

const PackCanvas: React.NamedExoticComponent<PackCanvasProps> = React.memo(function PackCanvas(props: PackCanvasProps): React.JSX.Element {
  const { width, height, coverImage, palette, isMulti, pitySeal, timeline } = props;
  const { Canvas, Group, Rect, RoundedRect, Image, Path, Circle, useImage, vec, rrect, rect } = SkiaModule;
  const { seam, peel, cardOut, packScale, packY, shiver } = timeline;

  const body = useMemo(() => packBodyRect(width, height), [width, height]);
  const points = useMemo(() => seamPointsPx(body), [body]);
  const centre = vec(body.x + body.width / 2, body.y + body.height / 2);
  const stripPivot = vec(centre.x, body.y + body.height * SEAM_BAND_RATIO);

  const cover = useImage(coverImage ?? null);

  const packTransform = useDerivedValue(() => {
    'worklet';
    return [{ translateX: shiver.value }, { translateY: packY.value }, { scale: packScale.value }];
  });
  const bodyClip = useDerivedValue(() => {
    'worklet';
    return makeBodyPath(SkiaApi, body, points, seam.value);
  });
  const stripClip = useDerivedValue(() => {
    'worklet';
    return makeStripPath(SkiaApi, body, points, seam.value);
  });
  const seamEdge = useDerivedValue(() => {
    'worklet';
    return makeSeamEdgePath(SkiaApi, points, seam.value);
  });
  const peelTransform = useDerivedValue(() => {
    'worklet';
    return [{ perspective: PEEL_PERSPECTIVE }, { translateY: -PEEL_LIFT_PX * peel.value }, { rotateX: PEEL_ROTATE_X_RAD * peel.value }];
  });
  const stripOpacity = useDerivedValue(() => {
    'worklet';
    return 1 - peel.value;
  });
  const cardOutTransform = useDerivedValue(() => {
    'worklet';
    return [{ translateY: -cardOut.value * body.height * CARD_OUT_RISE_FRACTION }];
  });

  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Group transform={packTransform} origin={centre}>
        {isMulti
          ? DECK_EDGE_OFFSETS.map((o, i) => (
              <RoundedRect key={o} x={body.x + o} y={body.y + o} width={body.width} height={body.height} r={PACK_CORNER_RADIUS} color={palette.ring} opacity={0.45 + i * 0.2} />
            ))
          : null}
        {/* face-down card hint rising out of the seam */}
        <RoundedRect x={body.x + body.width * 0.1} y={body.y + body.height * 0.05} width={body.width * 0.8} height={body.height * 0.9} r={10} color={palette.ring} opacity={cardOut} transform={cardOutTransform} />
        <Group clip={rrect(rect(body.x, body.y, body.width, body.height), PACK_CORNER_RADIUS, PACK_CORNER_RADIUS)}>
          <Group clip={bodyClip}>
            {cover ? <Image image={cover} x={body.x} y={body.y} width={body.width} height={body.height} fit="cover" /> : <Rect x={body.x} y={body.y} width={body.width} height={body.height} color={palette.cover[1]} />}
          </Group>
          <Group clip={stripClip} transform={peelTransform} origin={stripPivot} opacity={stripOpacity}>
            {cover ? <Image image={cover} x={body.x} y={body.y} width={body.width} height={body.height} fit="cover" /> : <Rect x={body.x} y={body.y} width={body.width} height={body.height} color={palette.cover[1]} />}
          </Group>
        </Group>
        <Path path={seamEdge} style="stroke" strokeWidth={2} color={SEAM_EDGE_COLOR} opacity={seam} />
        {pitySeal ? (
          <>
            <Circle cx={body.x + body.width - 18} cy={body.y + 18} r={12} color={SEAL_COLOR} />
            <Circle cx={body.x + body.width - 18} cy={body.y + 18} r={8} color={SEAM_EDGE_COLOR} style="stroke" strokeWidth={1.5} />
          </>
        ) : null}
      </Group>
    </Canvas>
  );
});

export function PackTear(props: PackTearProps): React.JSX.Element {
  const { width, height, coverImage, palette, phase, isMulti, pitySeal, disabled, timeline, onTear, onSeamProgress } = props;
  const seam = timeline.seam;

  const committedRef = useRef(false);
  useEffect(() => {
    if (phase === 'swipe') committedRef.current = false;
  }, [phase]);

  const commit = useCallback(() => {
    if (disabled || committedRef.current) return;
    committedRef.current = true;
    timeline.seam.value = 1;
    onTear();
  }, [disabled, onTear, timeline.seam]);

  const report = useCallback(
    (p: number) => {
      onSeamProgress?.(p);
    },
    [onSeamProgress],
  );

  const lastStep = useSharedValue(-1);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .activeOffsetX(8)
        .failOffsetY([-24, 24])
        .onUpdate((e: { translationX: number }) => {
          'worklet';
          const p = seamProgressFromDelta(e.translationX);
          seam.value = p;
          const step = Math.round(p * 10);
          if (step !== lastStep.value) {
            lastStep.value = step;
            runOnJS(report)(p);
          }
        })
        .onEnd((e: { translationX: number }) => {
          'worklet';
          lastStep.value = -1;
          if (e.translationX >= SWIPE_TRIGGER_DISTANCE) {
            seam.value = 1;
            runOnJS(commit)();
          } else {
            seam.value = withTiming(0, { duration: RELEASE_SNAP_BACK_MS });
            runOnJS(report)(0);
          }
        }),
    [disabled, seam, lastStep, report, commit],
  );

  return (
    <PanHost gesture={pan}>
      <View
        testID={packTestID(phase, isMulti)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={PACK_A11Y_LABEL}
        accessibilityHint={PACK_A11Y_HINT}
        accessibilityActions={PACK_A11Y_ACTIONS}
        accessibilityState={{ disabled }}
        onAccessibilityAction={(event: { nativeEvent?: { actionName?: string } }) => {
          if (event?.nativeEvent?.actionName === PACK_ACTIVATE_ACTION) commit();
        }}
        style={{ width, height }}
      >
        {skiaAvailable && SkiaModule ? (
          <PackCanvas width={width} height={height} coverImage={coverImage} palette={palette} isMulti={isMulti} pitySeal={pitySeal} timeline={timeline} />
        ) : (
          <View style={{ flex: 1, margin: '15%', borderRadius: PACK_CORNER_RADIUS, backgroundColor: palette.cover[1] }} />
        )}
      </View>
    </PanHost>
  );
}
