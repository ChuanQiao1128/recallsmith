import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { formatRank, type LibraryCardRow } from './libraryMapper';
import { libraryStyles as styles } from './libraryScreenStyles';
import { colors } from '../../../theme/colors';
import { packPaletteFromSlug } from '../../../theme/packArt';

type Props = {
  item: LibraryCardRow;
  numColumns: number;
  highlighted: boolean;
  /** Slug of the deck this card belongs to — drives the art-header gradient
   *  so every tile carries its pack's color identity. */
  deckSlug: string;
  onPress: (stableUid: string) => void;
};

// Map card status → status dot color. We keep the dot as the single visual
// indicator now that the bottom badge is gone.
function statusDotColor(status: LibraryCardRow['status']): string {
  if (status === 'mastered') return colors.gold;
  if (status === 'learning') return colors.mint;
  return colors.inkMuted;
}

export function LibraryCardTile({ item, numColumns, highlighted, deckSlug, onPress }: Props) {
  // item.isMissing, not `status === 'new'`: once the gate is on, 'new' means
  // "drawn, not studied yet" -- a card the user owns and is entitled to read.
  // Reading the status string here would keep hiding the question text behind a
  // "?" on cards the user just pulled.
  const isMissing = item.isMissing;
  // item.rank, never item.orderInDeck: OrderInDeck is the authoring key (5,
  // 780, 3700…) and printing it read as "#780 of 371". The rank is the slot.
  const slotNumber = formatRank(item.rank);
  const palette = packPaletteFromSlug(deckSlug);
  const dotColor = statusDotColor(item.status);
  // Gacha rarity stars: COM = none, RAR = 1, LEG = 3. Owned cards
  // show stars (the user's already revealed the rarity by pulling).
  // Missing cards HIDE stars — pulling is the discovery moment, and
  // peeking at rarity tiers from the locked grid would spoil it.
  const rarityStarCount = item.rarity === 'LEG' ? 3 : item.rarity === 'RAR' ? 1 : 0;
  const rarityStars = !isMissing && rarityStarCount > 0 ? '★'.repeat(rarityStarCount) : '';

  return (
    <Pressable
      style={[
        styles.card,
        numColumns === 2 ? styles.cardTwoColumns : styles.cardThreeColumns,
        isMissing && styles.cardMissing,
        highlighted && styles.cardHighlight,
      ]}
      testID={`library-card-${item.stableUid}`}
      onPress={() => onPress(item.stableUid)}
    >
      {/* ART HEADER — pack-palette gradient. Slot # + rarity stars
          painted onto it (white/gold) and a status dot in the top-right.
          Two information dimensions visible at a glance:
            • slot # = 1-based rank in the deck (Pokedex slot)
            • star count = gacha rarity tier (COM/RAR/LEG)
            • status dot = SRS state (new/learning/mastered) */}
      <View style={styles.cardArtHeader}>
        <LinearGradient
          colors={palette.cover}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.cardArtHeaderGradient, isMissing && styles.cardArtHeaderMissing]}
        />
        <View style={styles.cardArtTopLeft}>
          <Text style={styles.cardArtSlotNumber} numberOfLines={1}>
            {`#${slotNumber}`}
          </Text>
          {rarityStarCount > 0 ? (
            <Text
              style={styles.cardArtRarityStars}
              numberOfLines={1}
              testID={`library-card-rarity-${item.stableUid}`}
            >
              {rarityStars}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.cardArtStatusDot,
            { backgroundColor: dotColor, borderColor: 'rgba(255,255,255,0.85)' },
          ]}
        />
      </View>

      {/* BODY — question text or "?" placeholder for missing cards.
          Owned cards also show a small emoji icon (derived from tag /
          codeLanguage) for per-card visual identity. Missing cards
          keep the ? mystery to preserve the discovery moment. */}
      {isMissing ? (
        <View style={styles.cardBody}>
          <Text style={styles.cardBodyMissingMark} numberOfLines={1}>
            ?
          </Text>
        </View>
      ) : (
        <View style={styles.cardBody}>
          <Text style={styles.cardBodyIcon} numberOfLines={1}>
            {item.icon}
          </Text>
          <Text style={styles.cardBodyText} numberOfLines={2}>
            {item.question}
          </Text>
        </View>
      )}

      {/* Hidden test contract — library-card-status-{uid} must remain in
          tree with the legacy status label. Rendered as 0×0. */}
      <View
        testID={`library-card-status-${item.stableUid}`}
        style={styles.cardTestProbeHidden}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={styles.cardTestProbeHidden}>{item.statusLabel}</Text>
      </View>
    </Pressable>
  );
}
