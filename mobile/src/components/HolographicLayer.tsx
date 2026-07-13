// HolographicLayer — GPU-accelerated rare-card shimmer + particle burst.
//
// `@shopify/react-native-skia` is OPTIONAL. Without it this component renders
// nothing and the existing CSS gradient fallbacks in TapCard/RevealCard remain.
//
// To activate:
//   npx expo install @shopify/react-native-skia
//   npx expo prebuild
//   # rebuild dev client
//
// What it does when active:
//   variant="shimmer" — diagonal rainbow sweep that travels across the card
//                       face every 1.6s. Pixel-shader quality, GPU-rendered.
//   variant="burst"   — 60-particle radial explosion centered on the prop's
//                       (cx, cy). Each particle has its own velocity + decay.
//                       Used during flash-reveal.
//
// All math runs on the UI thread (Skia values), so this stays at 60fps even
// when JS is busy.

import React, { useEffect, useMemo, useRef } from 'react';

function loadSkia(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@shopify/react-native-skia');
  } catch {
    return null;
  }
}

const Skia = loadSkia();
export const skiaAvailable = !!Skia;

export type HolographicVariant = 'shimmer' | 'burst';

type Props = {
  variant: HolographicVariant;
  /** width/height of the area to render in. Default fills parent. */
  width: number;
  height: number;
  /** rgba color used as the dominant tint for burst particles + shimmer */
  accentColor: string;
  /** for burst: center x/y. Default center of the canvas. */
  cx?: number;
  cy?: number;
  /** burst particle count. Default 60. */
  particleCount?: number;
  /** play once or loop forever? default loop for shimmer, once for burst */
  loop?: boolean;
};

export const HolographicLayer: React.FC<Props> = (props) => {
  if (!skiaAvailable) return null;
  // Skia API objects only resolved when available; props validated lazily
  if (props.variant === 'shimmer') return <SkiaShimmer {...props} />;
  return <SkiaBurst {...props} />;
};

function SkiaShimmer({
  width,
  height,
  accentColor,
}: Props) {
  const {
    Canvas,
    Rect,
    LinearGradient: SkLinearGradient,
    vec,
    useClock,
    useDerivedValue,
  } = Skia!;

  const clock = useClock();
  const sweep = useDerivedValue(() => {
    // Sweep position oscillates 0 → width every 1.6s
    const t = (clock.value % 1600) / 1600;
    return t * width * 1.4 - width * 0.2;
  }, [width]);

  const start = useDerivedValue(() => vec(sweep.value - 60, 0), [sweep, width]);
  const end = useDerivedValue(() => vec(sweep.value + 60, height), [sweep, width, height]);

  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} opacity={0.55}>
        <SkLinearGradient
          start={start}
          end={end}
          colors={[
            'rgba(255,255,255,0)',
            accentColor,
            'rgba(255,255,255,0.95)',
            accentColor,
            'rgba(255,255,255,0)',
          ]}
        />
      </Rect>
    </Canvas>
  );
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number; // 0..1, mixed with accentColor
  life: number; // 0..1
};

function SkiaBurst({
  width,
  height,
  accentColor,
  cx,
  cy,
  particleCount = 60,
}: Props) {
  const { Canvas, Circle, useClock, useDerivedValue, Group } = Skia!;
  const centerX = cx ?? width / 2;
  const centerY = cy ?? height / 2;

  const startedAtRef = useRef<number | null>(null);
  const clock = useClock();

  // Particle templates — fixed per mount
  const particles = useMemo<Particle[]>(() => {
    const arr: Particle[] = [];
    let seed = 1;
    const r = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + r() * 0.4;
      const speed = 80 + r() * 220; // px/s
      arr.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + r() * 6,
        hue: r(),
        life: 1,
      });
    }
    return arr;
  }, [particleCount, centerX, centerY]);

  useEffect(() => {
    startedAtRef.current = Date.now();
  }, []);

  const time = useDerivedValue(() => {
    const start = startedAtRef.current ?? Date.now();
    const ms = clock.value - (clock.value - (Date.now() - start));
    return Math.min(1, (Date.now() - start) / 900); // 0 → 1 over 900ms
  });

  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Group opacity={0.9}>
        {particles.map((p, i) => {
          const cxA = useDerivedValue(() => p.x + p.vx * time.value * 0.9, [time]);
          const cyA = useDerivedValue(() => p.y + p.vy * time.value * 0.9, [time]);
          const radius = useDerivedValue(
            () => p.size * (1 + time.value * 0.6) * Math.max(0, 1 - time.value),
            [time],
          );
          // alternate between accent and white based on hue
          const color = p.hue > 0.5 ? '#FFFFFF' : accentColor;
          return <Circle key={i} cx={cxA} cy={cyA} r={radius} color={color} />;
        })}
      </Group>
    </Canvas>
  );
}

export default HolographicLayer;
