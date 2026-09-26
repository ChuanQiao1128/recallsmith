// DrawSummaryGrid — the full-width 2×5 grid of framed mini cards the multi-pull ends on (I05).
// Cards are ordered Legendary first (summaryGridOrder), laid out as centred rows of up to five
// (summaryGridLayout), each a framed RevealCardFace mini with a rarity glow behind RAR/LEG and a
// tap that re-opens the card. The ceremony renders it in place of the tap table once every card
// is face up; DrawResult renders the same grid in place of its old horizontal mini strip.

import React from 'react';
import { Pressable, View } from 'react-native';
import * as RN from 'react-native';
import type { ImageSourcePropType } from 'react-native';

import { RevealCardFace, type RevealCardFaceCard } from './RevealCardFace';
import { rarityLabel } from './TapCard';
import { rarityHaloColor, type PackPalette } from '../../theme/packArt';
import { summaryGridLayout, summaryGridOrder } from '../../features/gacha/draw/spotlightQueue';

function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const StyleSheet: any = readRN('StyleSheet', { create: (s: any) => s, absoluteFillObject: {} });

export type DrawSummaryGridProps = {
  cards: ReadonlyArray<RevealCardFaceCard>;
  width: number;
  testIDPrefix: string;
  packArt?: ImageSourcePropType;
  packPaletteCover: PackPalette['cover'];
  onPressCard: (uid: string) => void;
};

export function DrawSummaryGrid(props: DrawSummaryGridProps): React.JSX.Element {
  const { cards, width, testIDPrefix: prefix, packArt, packPaletteCover, onPressCard } = props;
  const ordered = summaryGridOrder(cards);
  const layout = summaryGridLayout(ordered.length, width);

  const rows: RevealCardFaceCard[][] = [];
  for (let i = 0; i < ordered.length; i += 5) {
    rows.push(ordered.slice(i, i + 5));
  }

  let cellIndex = 0;
  return (
    <View testID={`${prefix}-grid`} style={styles.grid}>
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} style={[styles.row, { gap: layout.gap, marginTop: rowIdx === 0 ? 0 : layout.gap }]}>
          {row.map((card) => {
            const i = cellIndex;
            cellIndex += 1;
            const showGlow = card.rarity !== 'COM';
            return (
              <Pressable
                key={card.stableUid}
                testID={`${prefix}-cell-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`${rarityLabel(card.rarity)}: ${card.question}`}
                onPress={() => onPressCard(card.stableUid)}
                style={[styles.cell, { width: layout.cellWidth, height: layout.cellHeight }]}
              >
                {showGlow ? (
                  <View
                    testID={`${prefix}-cell-${i}-glow`}
                    pointerEvents="none"
                    style={[styles.glow, { backgroundColor: rarityHaloColor(card.rarity) }]}
                  />
                ) : null}
                <RevealCardFace
                  variant="mini"
                  card={card}
                  width={layout.cellWidth}
                  testIDPrefix={`${prefix}-cell-${i}-face`}
                  packArt={packArt}
                  packPaletteCover={packPaletteCover}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', left: -6, right: -6, top: -6, bottom: -6, borderRadius: 16, opacity: 0.6 },
});

export default DrawSummaryGrid;
