import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { colors } from '../../theme/colors';

// RarityStars — the canonical COM/RAR/LEG indicator. Three stars for
// Legendary, one for Rare, none for Common (drawing attention to the
// rarity tier without spamming a star on every card).
//
// Single source of truth: this same component is used on Library
// tiles, DrawResult mini-strip, DrawResult featured card, and
// CardDetail rarity chip. If the brand later switches stars to
// gem icons, change one place.

type Rarity = 'COM' | 'RAR' | 'LEG';

type Props = {
  rarity: Rarity;
  /** Star color override; defaults to brand gold. */
  color?: string;
  /** Glyph size. Default 12pt — small ornament, not headline. */
  size?: number;
  /** Optional letter-spacing for tighter/looser packing. */
  letterSpacing?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

function starCount(rarity: Rarity): number {
  if (rarity === 'LEG') return 3;
  if (rarity === 'RAR') return 1;
  return 0;
}

export function RarityStars({ rarity, color = colors.glowGold, size = 12, letterSpacing = 1, testID, style, textStyle }: Props) {
  const count = starCount(rarity);
  if (count === 0) return null;

  return (
    <View style={[styles.row, style]} testID={testID}>
      <Text
        style={[
          { color, fontSize: size, fontWeight: '900', letterSpacing },
          textStyle,
        ]}
        numberOfLines={1}
      >
        {'★'.repeat(count)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
