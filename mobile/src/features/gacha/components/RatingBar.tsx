import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReviewRating } from '../../../review/model';
import { colors } from '../../../theme/colors';

// Subtitles are sized to a 4-up grid at 320pt content width (~64pt per
// button, minus padding) at the default font scale: two short words at 11pt.
// "Show very soon" / "Normal interval" were cut to "Show very s…" /
// "Normal inte…" on the owner's device (2026-09-21), which is worse than no
// subtitle at all. Wording stays parallel across the four so the eye reads
// them as one scale.
export const RATING_ITEMS: ReadonlyArray<{
  key: ReviewRating;
  title: string;
  subtitle: string;
  styleKey: 'ratingAgain' | 'ratingHard' | 'ratingGood' | 'ratingEasy';
}> = [
  { key: 'again', title: 'Again', subtitle: 'Show soon', styleKey: 'ratingAgain' },
  { key: 'hard', title: 'Hard', subtitle: 'Short gap', styleKey: 'ratingHard' },
  { key: 'good', title: 'Good', subtitle: 'Normal gap', styleKey: 'ratingGood' },
  { key: 'easy', title: 'Easy', subtitle: 'Much later', styleKey: 'ratingEasy' },
];

// The hint changes with the face. Before reveal it asks for the recall
// attempt; after reveal the old sentence ("…before seeing the answer") kept
// describing a moment that had already passed, so it now asks the question
// the four buttons answer.
export const RATING_HINT = {
  beforeReveal: 'Think about how well you recalled this before seeing the answer.',
  afterReveal: 'How well did you recall it?',
} as const;

export function RatingBar(props: {
  disabled?: boolean;
  /** Whether the answer is showing. Drives the hint copy only; `disabled` still gates the buttons. */
  revealed?: boolean;
  testID?: string;
  onRate: (rating: ReviewRating) => void;
}) {
  const { disabled = false, revealed = false, testID = 'review-rating-bar', onRate } = props;

  return (
    <View style={styles.wrapper} testID={testID}>
      <Text style={styles.hint} numberOfLines={2} testID="review-rating-hint">
        {revealed ? RATING_HINT.afterReveal : RATING_HINT.beforeReveal}
      </Text>
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
            <Text style={styles.ratingTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.ratingSub} numberOfLines={1}>
              {item.subtitle}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  hint: { fontSize: 12, color: colors.inkSecondary, marginBottom: 10 },
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
  ratingTitle: { fontSize: 13, fontWeight: '800', color: colors.ink },
  ratingSub: { marginTop: 4, fontSize: 11, color: colors.inkSecondary },
});

export default RatingBar;
