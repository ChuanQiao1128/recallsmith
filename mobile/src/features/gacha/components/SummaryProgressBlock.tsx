import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

type SummaryProgressBlockProps = {
  done: number;
  total: number;
  completionLabel: string;
  body: string;
  streak: { before: number; after: number; earned: boolean };
  transitions: { newToLearning: number; learningToMastered: number };
  streakNote?: string | null;
  transitionsNote?: string | null;
  testID?: string;
};

export function SummaryProgressBlock(props: SummaryProgressBlockProps) {
  const { done, total, completionLabel, body, streak, transitions, streakNote = null, transitionsNote = null, testID } = props;

  const fallbackStreak = streak.earned ? `🔥 ${streak.before} → ${streak.after}` : `🔥 ${streak.after}`;
  const fallbackTransitions =
    transitions.newToLearning > 0 || transitions.learningToMastered > 0
      ? `${transitions.newToLearning} cards entered Learning · ${transitions.learningToMastered} cards mastered`
      : 'Learning map updated for this run.';

  return (
    <View testID={testID} style={styles.card}>
      <Text numberOfLines={1} style={styles.eyebrow}>
        Progress
      </Text>
      <Text numberOfLines={2} style={styles.title}>
        Daily streak
      </Text>

      <View style={styles.metricRow}>
        <Text numberOfLines={1} style={styles.metricValue}>
          {done} / {total}
        </Text>
        <Text numberOfLines={1} style={styles.metricLabel}>
          cards
        </Text>
      </View>

      <Text numberOfLines={2} style={styles.completionLabel}>
        {completionLabel}
      </Text>
      <Text numberOfLines={3} style={styles.body}>
        {body}
      </Text>
      <Text numberOfLines={1} style={styles.note}>
        {streakNote ?? fallbackStreak}
      </Text>
      <Text numberOfLines={2} style={styles.note}>
        {transitionsNote ?? fallbackTransitions}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: colors.ink,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    marginBottom: spacing.sm,
  },
  eyebrow: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    marginTop: 6,
    color: colors.ink,
    fontSize: typography.title3,
    lineHeight: 22,
    fontWeight: '800',
  },
  metricRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  metricValue: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
  },
  metricLabel: {
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: 3,
  },
  completionLabel: {
    marginTop: 4,
    color: colors.ink,
    fontSize: typography.body,
    lineHeight: 20,
    fontWeight: '700',
  },
  body: {
    marginTop: 6,
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 18,
  },
  note: {
    marginTop: 6,
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 18,
    fontWeight: '700',
  },
});

export default SummaryProgressBlock;
