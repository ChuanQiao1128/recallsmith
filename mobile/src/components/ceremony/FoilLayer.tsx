// FoilLayer — the single Reanimated-driven Skia canvas that replaces the old
// per-card shimmer. It mounts only on the focused RAR/LEG card, so the table
// holds at most one focused-card canvas. The sweep is a Reanimated shared value
// through the guard — the Skia clock hook and any Skia-namespace derived-value
// hook that crashed the old renderer at mount are never touched here.
import React from 'react';
import type { ImageSourcePropType } from 'react-native';
import { Reanimated, SkiaModule, motionAvailable, skiaAvailable, type SharedValue } from './reanimatedGuard';
import type { PeakRarity } from '../../features/gacha/draw/ceremonyTimings';

const { useSharedValue, useDerivedValue, withRepeat, withTiming, cancelAnimation, Easing } = Reanimated;

export type FoilLayerProps = { width: number; height: number; accentColor: string; rarity: PeakRarity; active: boolean; tilt?: SharedValue<{ x: number; y: number }> | null; lut?: ImageSourcePropType };

/** Today's sweep period — one full pass across the card face every 1.6s. */
export const FOIL_SWEEP_MS = 1600;

export const foilAvailable: boolean = skiaAvailable && motionAvailable;

// A rainbow band driven by u_tilt/u_time over u_res, sampled from the LUT and
// masked to a narrow travelling stripe. Kept a plain string so the test can pin
// its uniforms without compiling anything.
export const FOIL_SKSL: string = `
uniform float2 u_res;
uniform float u_time;
uniform float2 u_tilt;
uniform shader u_lut;

half4 main(float2 xy) {
  float2 p = xy / u_res;
  float band = fract(p.x * 0.9 + p.y * 0.35 + u_time + u_tilt.x * 0.25 + u_tilt.y * 0.1);
  half4 lut = u_lut.eval(float2(band * 255.0, 1.5));
  float mask = smoothstep(0.0, 0.18, band) * (1.0 - smoothstep(0.55, 0.85, band));
  return half4(lut.rgb * mask, mask * 0.55);
}
`;

// undefined = not yet compiled, null = compile failed → gradient fallback.
let effect: any | null | undefined;

/** Compiles the SkSL once. DrawScreen calls it on mount (B10). No-op without Skia. */
export function prewarmFoilShader(): void {
  if (!skiaAvailable || effect !== undefined) return;
  try {
    effect = SkiaModule.Skia.RuntimeEffect.Make(FOIL_SKSL) ?? null;
  } catch {
    effect = null;
  }
}

// Hook-free outer gate so no hook and no Skia-namespace access runs while the
// module is null (mirrors the old outer/inner split). null when Skia or motion
// is unavailable, for COM, or when this foil is not the active/focused one.
export function FoilLayer(props: FoilLayerProps): React.JSX.Element | null {
  if (!foilAvailable || props.rarity === 'COM' || !props.active) return null;
  return <FoilCanvas {...props} />;
}

function FoilCanvas({ width, height, accentColor, tilt, lut }: FoilLayerProps): React.JSX.Element {
  React.useEffect(prewarmFoilShader, []);
  const sweep = useSharedValue(0);
  React.useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: FOIL_SWEEP_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(sweep);
  }, []);
  const lutImage = SkiaModule.useImage(lut ?? null);
  const uniforms = useDerivedValue(() => ({
    u_res: [width, height],
    u_time: sweep.value,
    u_tilt: [tilt?.value.x ?? 0, tilt?.value.y ?? 0],
  }));
  const start = useDerivedValue(() => SkiaModule.vec(sweep.value * width * 1.4 - width * 0.2 - 60, 0));
  const end = useDerivedValue(() => SkiaModule.vec(sweep.value * width * 1.4 - width * 0.2 + 60, height));

  const { Canvas, Rect, Shader, ImageShader, LinearGradient: SkLinearGradient } = SkiaModule;
  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height} opacity={0.55}>
        {effect && lutImage ? (
          <Shader source={effect} uniforms={uniforms}>
            <ImageShader image={lutImage} fit="fill" rect={{ x: 0, y: 0, width: 256, height: 4 }} />
          </Shader>
        ) : (
          <SkLinearGradient
            start={start}
            end={end}
            colors={['rgba(255,255,255,0)', accentColor, 'rgba(255,255,255,0.95)', accentColor, 'rgba(255,255,255,0)']}
          />
        )}
      </Rect>
    </Canvas>
  );
}
