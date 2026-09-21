// SwipeHint — the visible affordance for the ceremony's swipe phase. The phase
// copy ('Swipe to open') is rendered a11y-only by the screen, so a sighted player
// saw a static pack for the whole phase with nothing telling them what to do.
// This leaf shows the same words plus a chevron that nudges right on a loop, and
// the screen unmounts it at the first touch. Motion goes through the guard: under
// Reduce Motion (and the guard fallback) the chevron simply sits still.
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Reanimated } from './reanimatedGuard';
import { ceremonyStyles } from './ceremonyStyles';

export const SWIPE_HINT_TESTID = 'draw-ceremony-swipe-hint';
/** One nudge: rest → NUDGE_PX → rest, repeated while mounted. */
export const SWIPE_HINT_NUDGE_PX = 10;
export const SWIPE_HINT_NUDGE_MS = 520;
export const SWIPE_HINT_REST_MS = 640;

const { useSharedValue, useAnimatedStyle, withTiming, withSequence, withRepeat, withDelay, cancelAnimation, Easing } = Reanimated;

export type SwipeHintProps = {
  label: string;
  reduceMotion: boolean;
};

export function SwipeHint({ label, reduceMotion }: SwipeHintProps): React.JSX.Element {
  const nudge = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(nudge);
      nudge.value = 0;
      return undefined;
    }
    nudge.value = withRepeat(
      withSequence(
        withTiming(1, { duration: SWIPE_HINT_NUDGE_MS, easing: Easing.out(Easing.quad) }),
        withDelay(SWIPE_HINT_REST_MS, withTiming(0, { duration: SWIPE_HINT_NUDGE_MS, easing: Easing.out(Easing.quad) })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(nudge);
  }, [reduceMotion]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: nudge.value * SWIPE_HINT_NUDGE_PX }],
    opacity: 0.55 + 0.45 * nudge.value,
  }));

  return (
    // The pack itself is the accessible control (label + hint + activate action) and the
    // phase copy is announced through the live region, so this decoration is hidden from
    // assistive tech instead of reading the same words a third time.
    <View
      testID={SWIPE_HINT_TESTID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={ceremonyStyles.swipeHint}
    >
      <Text style={ceremonyStyles.swipeHintText} numberOfLines={1}>{label}</Text>
      <Reanimated.View style={[ceremonyStyles.swipeHintChevron, chevronStyle]}>
        <Text style={ceremonyStyles.swipeHintChevronText}>›</Text>
      </Reanimated.View>
    </View>
  );
}
