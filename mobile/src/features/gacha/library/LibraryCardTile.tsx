import React from 'react';
import { Pressable, Text, View } from 'react-native';

import type { LibraryCardRow } from './libraryMapper';
import { libraryStyles as styles } from './libraryScreenStyles';

type Props = {
  item: LibraryCardRow;
  numColumns: number;
  highlighted: boolean;
  onPress: (stableUid: string) => void;
};

export function LibraryCardTile({ item, numColumns, highlighted, onPress }: Props) {
  const isNew = item.status === 'new';
  const isLearning = item.status === 'learning';

  return (
    <Pressable
      style={[
        styles.card,
        numColumns === 2 ? styles.cardTwoColumns : styles.cardThreeColumns,
        isNew && styles.cardNew,
        highlighted && styles.cardHighlight,
      ]}
      testID={`library-card-${item.stableUid}`}
      onPress={() => onPress(item.stableUid)}
    >
      <Text style={styles.cardQuestion} numberOfLines={1}>
        {item.question}
      </Text>
      <View style={styles.cardBadgeRow}>
        <View
          testID={`library-card-status-${item.stableUid}`}
          style={[
            styles.statusBadge,
            isNew ? styles.statusBadgeNew : isLearning ? styles.statusBadgeLearning : styles.statusBadgeMastered,
          ]}
        >
          <Text
            style={[
              styles.statusBadgeText,
              !isNew && styles.statusBadgeTextOnSolid,
            ]}
            numberOfLines={1}
          >
            {item.statusLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
