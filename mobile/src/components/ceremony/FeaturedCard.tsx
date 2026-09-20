// FeaturedCard — the static featured reveal card (B00 §2.12), the old ceremony
// tree's static reveal branch rebuilt with no motion library at all. Both faces
// are always in the tree so both testIDs survive; the hidden face is rotated away.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as RN from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { PackPalette } from '../../theme/packArt';
import { ceremonyStyles } from './ceremonyStyles';

// The integration test's react-native mock exports no Image, so read it
// defensively (a missing ESM namespace member throws under vitest) and only
// take the image branch when it is present.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);

export type FeaturedCardProps = {
  accent: string;
  rarityText: string;
  questionText: string;
  packPaletteCover: PackPalette['cover'];
  coverImage?: ImageSourcePropType;
  faceUp: boolean;
};

const hiddenFace = { opacity: 0, transform: [{ rotateY: '180deg' }] } as const;

export function FeaturedCard(props: FeaturedCardProps): React.JSX.Element {
  const { accent, rarityText, questionText, packPaletteCover, coverImage, faceUp } = props;
  return (
    <View style={[ceremonyStyles.flipCard, faceUp && [ceremonyStyles.flipCardRevealed, { borderColor: accent }]]}>
      {/* Back face */}
      <View style={faceUp ? hiddenFace : undefined} pointerEvents={faceUp ? 'none' : undefined}>
        <LinearGradient
          colors={packPaletteCover}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={ceremonyStyles.flipBackGradient}
        >
          {coverImage && RNImage ? (
            <RNImage source={coverImage} resizeMode="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          ) : null}
          {/* 'Reward card' is hard-coded in the old tree and is not in the copy module — kept byte-identical. */}
          <Text style={ceremonyStyles.cardBackText} numberOfLines={1}>
            Reward card
          </Text>
        </LinearGradient>
      </View>
      {/* Front face */}
      <View style={faceUp ? undefined : hiddenFace} pointerEvents={faceUp ? undefined : 'none'}>
        <View style={ceremonyStyles.flipFront}>
          <View style={[ceremonyStyles.cardRarityChip, { backgroundColor: accent }]}>
            <Text style={ceremonyStyles.cardRarity} testID="draw-ceremony-reveal-rarity" numberOfLines={1}>
              {rarityText}
            </Text>
          </View>
          <Text style={ceremonyStyles.cardQuestion} testID="draw-ceremony-reveal-question" numberOfLines={3}>
            {questionText}
          </Text>
        </View>
      </View>
    </View>
  );
}
