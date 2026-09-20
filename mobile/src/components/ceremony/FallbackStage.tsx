// FallbackStage — the no-Skia / kill-switch ceremony stage (B00 §1/§2.12). A plain
// react-native leaf: it draws the pack, the static multi-pull spill and the featured
// reveal with ordinary state changes, no motion library. The screen mounts the tap
// table itself; this leaf never renders one. Every user string comes from the copy
// module or is a shared pack constant.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as RN from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PACK_A11Y_HINT, PACK_A11Y_LABEL, PACK_ACTIVATE_ACTION } from './PackTear';
import { spillSlotOffset, tableSlotLayout, TELL_COLORS } from './useCeremonyTimeline';
import { rarityAccentColor, type PackPalette } from '../../theme/packArt';
import { FeaturedCard, type FeaturedCardProps } from './FeaturedCard';
import { ceremonyStyles } from './ceremonyStyles';
import { CEREMONY_COPY_V10 } from '../../features/gacha/draw/ceremonyCopy';
import type { CeremonyPhase, PeakRarity } from '../../features/gacha/draw/ceremonyTimings';
import type { SpillSchedule } from '../../features/gacha/draw/spillSchedule';

// The integration test's react-native mock exports no Image, so read it
// defensively and only take the image branch when it is present.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);

export const FALLBACK_STAGE_TESTID = 'draw-ceremony-fallback-stage';

export type FallbackStageProps = {
  phase: CeremonyPhase;
  isMulti: boolean;
  reduceMotion: boolean;
  peakRarity: PeakRarity;
  palette: PackPalette;
  coverImage?: ImageSourcePropType;
  pitySeal: boolean;
  /** true under reduceMotion or when phase !== 'swipe' (same rule as PackTear.disabled). */
  disabled: boolean;
  onTear: () => void;
  swipeProgress: number; // 0..1 from the stage responder
  cards: ReadonlyArray<{ stableUid: string; rarity: PeakRarity }>;
  spill: SpillSchedule | null; // slots for the static spill layout (multi)
  glowNineSlice?: ImageSourcePropType; // GLOW_9SLICE (B12); undefined → plain border rims
  /** hold onward: rims/pack border take the rarity colour (the tell); before: neutral. */
  tellVisible: boolean;
  featured: FeaturedCardProps | null; // mounted when non-null (tapFlow off, flash-reveal/settle)
};

const DECK_EDGE_OFFSETS = [6, 3];

export function FallbackStage(props: FallbackStageProps): React.JSX.Element {
  const {
    phase, isMulti, peakRarity, palette, coverImage, pitySeal, disabled, onTear,
    swipeProgress, cards, spill, glowNineSlice, tellVisible, featured,
  } = props;

  const packPhase = phase === 'swipe' || phase === 'approach' || phase === 'hold' || phase === 'tear-flip';
  const packBorder = tellVisible ? rarityAccentColor(peakRarity) : TELL_COLORS.NEUTRAL;

  return (
    <View testID={FALLBACK_STAGE_TESTID} style={ceremonyStyles.fallbackStage}>
      {phase === 'hold' ? <View testID="draw-ceremony-hold-marker" style={ceremonyStyles.holdMarker} /> : null}

      {packPhase ? (
        <>
          {isMulti
            ? DECK_EDGE_OFFSETS.map((o) => (
                <View key={`deck-edge-${o}`} style={[ceremonyStyles.deckEdge, { transform: [{ translateX: o }, { translateY: o }] }]} />
              ))
            : null}
          <View
            testID={phase === 'swipe' ? 'draw-ceremony-swipe-pack' : isMulti ? 'draw-ceremony-multi-flyin' : 'draw-ceremony-single-pack-flyin'}
            accessible
            accessibilityRole="button"
            accessibilityLabel={PACK_A11Y_LABEL}
            accessibilityHint={PACK_A11Y_HINT}
            accessibilityActions={[{ name: PACK_ACTIVATE_ACTION, label: CEREMONY_COPY_V10.activateAction }]}
            onAccessibilityAction={(e: { nativeEvent?: { actionName?: string } }) => {
              if (!disabled && e?.nativeEvent?.actionName === PACK_ACTIVATE_ACTION) onTear();
            }}
            accessibilityState={{ disabled }}
            style={[
              phase === 'swipe' ? ceremonyStyles.swipePack : ceremonyStyles.stageCard,
              phase === 'tear-flip' && !isMulti && ceremonyStyles.stageCardTear,
              phase === 'swipe' ? { transform: [{ translateX: swipeProgress * 24 }] } : null,
              { borderColor: packBorder },
              { opacity: 1 },
            ]}
          >
            <LinearGradient
              colors={palette.cover}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[ceremonyStyles.swipePackInner, { borderColor: palette.ring }]}
            >
              {coverImage && RNImage ? (
                <RNImage source={coverImage} resizeMode="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
              ) : null}
              {pitySeal ? <View style={ceremonyStyles.pitySeal} /> : null}
            </LinearGradient>
          </View>
        </>
      ) : null}

      {phase === 'tear-flip' && isMulti && spill
        ? spill.entries
            .filter((entry) => entry.index < cards.length)
            .map((entry) => {
              const o = spillSlotOffset(entry.slot, cards.length);
              const size = tableSlotLayout(cards.length);
              const accent = rarityAccentColor(cards[entry.index].rarity);
              return (
                <View
                  key={`spill-${entry.index}`}
                  testID={`draw-ceremony-spill-card-${entry.index}`}
                  style={[
                    ceremonyStyles.spillCard,
                    {
                      width: size.width,
                      height: size.height,
                      borderColor: tellVisible ? accent : TELL_COLORS.NEUTRAL,
                      transform: [{ translateX: o.x }, { translateY: o.y }, { rotate: `${o.rot}deg` }],
                    },
                  ]}
                >
                  {glowNineSlice && RNImage ? (
                    <View pointerEvents="none" style={ceremonyStyles.fallbackRim}><RNImage source={glowNineSlice} style={ceremonyStyles.fallbackRimImage} tintColor={accent} resizeMode="stretch" /></View>
                  ) : null}
                </View>
              );
            })
        : null}

      {featured ? <FeaturedCard {...featured} /> : null}
    </View>
  );
}
