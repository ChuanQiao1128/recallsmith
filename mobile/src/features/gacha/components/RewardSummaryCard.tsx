import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { a11y } from '../../../theme/a11y';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

type RewardSummaryCardProps = {
  reward: {
    title: string;
    body: string;
    badge: string;
    pulls: number;
    walletBefore: { available: number; reserve: number };
    walletAfter: { available: number; reserve: number };
    fullClear: boolean;
    minimumGoalMet: boolean;
    usePullsLabel: string | null;
  };
  ctaLabel?: string | null;
  onPressUsePulls?: (() => void) | null;
  testID?: string;
};

export function RewardSummaryCard(props: RewardSummaryCardProps) {
  const { reward, ctaLabel = null, onPressUsePulls = null, testID } = props;
  const canUsePulls = !!onPressUsePulls && reward.walletAfter.available > 0;

  return (
    <View testID={testID} style={styles.card}>
      <View style={styles.topRow}>
        <Text numberOfLines={1} style={styles.badge}>
          {reward.badge}
        </Text>
        <Text numberOfLines={1} style={styles.sectionLabel}>
          Reward
        </Text>
      </View>

      <View style={styles.anchorRow}>
        <View style={styles.anchor}>
          <Text numberOfLines={1} style={styles.anchorCount}>
            +{reward.pulls}
          </Text>
          <Text numberOfLines={1} style={styles.anchorLabel}>
            pulls
          </Text>
        </View>
        <View style={styles.anchorContent}>
          <Text numberOfLines={2} style={styles.title}>
            {reward.title}
          </Text>
          <Text numberOfLines={3} style={styles.body}>
            {reward.body}
          </Text>
        </View>
      </View>

      <View style={styles.walletRow}>
        <Text numberOfLines={1} style={styles.walletCaption}>
          Wallet
        </Text>
        <Text numberOfLines={1} style={styles.walletValue}>
          {reward.walletBefore.available}
        </Text>
        <Text numberOfLines={1} style={styles.walletArrow}>
          →
        </Text>
        <Text numberOfLines={1} style={styles.walletValue}>
          {reward.walletAfter.available}
        </Text>
        <Text numberOfLines={1} style={styles.reserveLabel}>
          reserve {reward.walletBefore.reserve} → {reward.walletAfter.reserve}
        </Text>
      </View>

      {reward.usePullsLabel ? (
        <Text numberOfLines={1} style={styles.pullHint}>
          {reward.usePullsLabel}
        </Text>
      ) : null}

      {canUsePulls ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}
          onPress={onPressUsePulls ?? undefined}
        >
          <Text numberOfLines={1} style={styles.ctaText}>
            {ctaLabel ?? 'Open draw'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(250, 243, 224, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(200, 136, 58, 0.28)',
    shadowColor: colors.ink,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  badge: {
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(200, 136, 58, 0.2)',
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '800',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  sectionLabel: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  anchorRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  anchor: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(232, 184, 90, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(200, 136, 58, 0.32)',
  },
  anchorCount: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
    color: colors.ink,
  },
  anchorLabel: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  anchorContent: {
    flex: 1,
  },
  title: {
    color: colors.ink,
    fontSize: typography.title3,
    lineHeight: 22,
    fontWeight: '800',
  },
  body: {
    marginTop: 6,
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 18,
    fontWeight: '600',
  },
  walletRow: {
    marginTop: spacing.sm,
    minHeight: a11y.minTouch,
    borderRadius: spacing.buttonRadius,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  walletCaption: {
    color: colors.inkSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  walletValue: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '800',
  },
  walletArrow: {
    color: colors.inkSecondary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  reserveLabel: {
    marginLeft: 4,
    color: colors.gold,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  pullHint: {
    marginTop: 6,
    color: colors.inkSecondary,
    fontSize: typography.bodySmall,
    fontWeight: '700',
  },
  ctaButton: {
    marginTop: spacing.sm,
    minHeight: a11y.minTouch,
    borderRadius: spacing.buttonRadius,
    backgroundColor: 'rgba(42, 34, 24, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(42, 34, 24, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  ctaButtonPressed: {
    opacity: 0.85,
  },
  ctaText: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '800',
  },
});

export default RewardSummaryCard;
