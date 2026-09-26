// SpillSampler — the multi-pull deal-sampling leaf (design decision #9, B00 §2.12).
// The one setInterval left in the ceremony tree: it ticks a counter every
// SPILL_SAMPLE_MS and re-renders only this invisible 1×1 leaf, never the screen.
// Progress is tick-count based (no clock read), so it is strictly increasing under
// fake timers and saturates at 1.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ceremonyStyles } from './ceremonyStyles';
import { CEREMONY_COPY_V10 } from '../../features/gacha/draw/ceremonyCopy';
import type { CeremonyPhase } from '../../features/gacha/draw/ceremonyTimings';

export const SPILL_SAMPLE_MS = 100;

export type SpillSamplerProps = { durationMs: number; renderer: 'skia' | 'fallback' };

// MGACHA-24: the sampler exists only for the fallback stage's test contract
// (`draw-ceremony-orbit-*` testIDs). Its 100 ms setInterval must never tick on the Skia
// path, where it re-rendered this leaf 18× during the busiest 1.8 s of a 10-pull for no
// visible effect. Gate the mount on the fallback renderer so it stays off under Skia.
export function shouldMountSpillSampler(
  phase: CeremonyPhase,
  isMulti: boolean,
  renderer: 'skia' | 'fallback',
): boolean {
  return phase === 'tear-flip' && isMulti && renderer === 'fallback';
}

export const SpillSampler: React.NamedExoticComponent<SpillSamplerProps> = React.memo(
  function SpillSamplerImpl({ durationMs, renderer }: SpillSamplerProps) {
    const [samples, setSamples] = useState(0);

    useEffect(() => {
      const id = setInterval(() => setSamples((n) => n + 1), SPILL_SAMPLE_MS);
      return () => clearInterval(id);
    }, [durationMs]);

    const progress = Math.min(1, (samples * SPILL_SAMPLE_MS) / Math.max(1, durationMs));
    const focus = Math.min(1, progress * 1.35);

    return (
      <View
        testID="draw-ceremony-orbit-stage"
        style={ceremonyStyles.spillSampler}
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        accessibilityLabel={CEREMONY_COPY_V10.dealing(Math.round(progress * 100))}
      >
        <Text style={ceremonyStyles.holdMarker} testID="draw-ceremony-orbit-progress">
          {progress.toFixed(2)}
        </Text>
        <Text style={ceremonyStyles.holdMarker} testID="draw-ceremony-orbit-samples">
          {samples}
        </Text>
        <Text style={ceremonyStyles.holdMarker} testID="draw-ceremony-orbit-focus">
          {focus.toFixed(2)}
        </Text>
        <Text style={ceremonyStyles.holdMarker} testID="draw-ceremony-orbit-mode">
          {renderer}
        </Text>
      </View>
    );
  },
);
