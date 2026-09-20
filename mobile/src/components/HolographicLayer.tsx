// Superseded by ceremony/FoilLayer (B08): the Skia clock/derived-value pair that crashed the
// table at mount (RAR/LEG TapCard) is gone. Kept only so DrawCeremonyScreen.tsx keeps compiling
// until B09 rewires it; B11 deletes this file.
import React from 'react';
import { FoilLayer, foilAvailable } from './ceremony/FoilLayer';

export { FoilLayer, foilAvailable } from './ceremony/FoilLayer';
export const skiaAvailable = foilAvailable;

export type HolographicVariant = 'shimmer' | 'burst';
type LegacyProps = { variant: HolographicVariant; width: number; height: number; accentColor: string; cx?: number; cy?: number; particleCount?: number; loop?: boolean };

/** Legacy prop shape of the pre-1.6 shimmer; 'burst' was mounted nowhere and renders nothing. */
export function HolographicLayer({ variant, width, height, accentColor }: LegacyProps) {
  if (variant !== 'shimmer') return null;
  return <FoilLayer width={width} height={height} accentColor={accentColor} rarity="RAR" active />;
}
export default HolographicLayer;
