import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReviewRating } from '../../../review/model';

const RATING_ITEMS: Array<{ key: ReviewRating; title: string; subtitle: string; styleKey: keyof typeof styles }> = [
  { key: 'again', title: 'Again', subtitle: 'Show very soon', styleKey: 'ratingAgain' },
  { key: 'hard', title: 'Hard', subtitle: 'Short interval', styleKey: 'ratingHard' },
  { key: 'good', title: 'Good', subtitle: 'Normal interval', styleKey: 'ratingGood' },
  { key: 'easy', title: 'Easy', subtitle: 'Much later', styleKey: 'ratingEasy' },
];

export function RatingBar(props: {
  disabled?: boolean;
  testID?: string;
  onRate: (rating: ReviewRating) => void;
}) {
  const { disabled = false, testID = 'review-rating-bar', onRate } = props;

  return (
    <View style={styles.wrapper} testID={testID}>
      <Text style={styles.hint}>Think about how well you recalled this before seeing the answer.</Text>
      <View style={styles.grid}>
        {RATING_ITEMS.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [
              styles.ratingButton,
              styles[item.styleKey],
              pressed && styles.ratingPressed,
              disabled && styles.ratingDisabled,
            ]}
            disabled={disabled}
            onPress={() => onRate(item.key)}
          >
            <Text style={styles.ratingTitle}>{item.title}</Text>
            <Text style={styles.ratingSub}>{item.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  hint: { fontSize: 12, color: '#6B7280', marginBottom: 10 },
  grid: { flexDirection: 'row', gap: 8 },
  ratingButton: {
    flex: 1,
    minWidth: 64,
    minHeight: 56,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingAgain: { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.18)' },
  ratingHard: { backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.18)' },
  ratingGood: { backgroundColor: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.18)' },
  ratingEasy: { backgroundColor: 'rgba(79,70,229,0.08)', borderColor: 'rgba(79,70,229,0.18)' },
  ratingPressed: { opacity: 0.92 },
  ratingDisabled: { opacity: 0.55 },
  ratingTitle: { fontSize: 13, fontWeight: '800', color: '#111827' },
  ratingSub: { marginTop: 4, fontSize: 11, color: '#6B7280' },
});

export default RatingBar;
