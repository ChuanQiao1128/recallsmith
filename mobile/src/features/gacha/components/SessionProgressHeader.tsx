import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SessionProgressVM } from '../session/sessionReviewHelpers';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

export function SessionProgressHeader(props: { vm: SessionProgressVM }) {
  const { vm } = props;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label} numberOfLines={1}>
          {vm.title}
        </Text>
        {vm.currentRoleLabel ? (
          <Text style={styles.roleLabel} numberOfLines={1}>
            {vm.currentRoleLabel}
          </Text>
        ) : null}
        <Text style={styles.value} numberOfLines={1}>
          {vm.progressText}
        </Text>
      </View>

      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { flex: vm.percent, opacity: vm.percent === 0 ? 0 : 1 }]} />
        <View style={{ flex: 1 - vm.percent }} />
      </View>
    </View>
  );
}

const CARD_GLASS = 'rgba(255,255,255,0.42)';
const CARD_BORDER = 'rgba(42,34,24,0.12)';
const PROGRESS_TRACK = 'rgba(42,34,24,0.12)';
const ROLE_BADGE_BG = 'rgba(200,136,58,0.16)';

const styles = StyleSheet.create({
  card: {
    borderRadius: spacing.cardRadius,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: CARD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    marginBottom: spacing.xs,
  },
  headerRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.caption,
    color: colors.ink,
    fontWeight: '700',
  },
  value: {
    fontSize: typography.caption,
    color: colors.gold,
    fontWeight: '800',
  },
  roleLabel: {
    maxWidth: 116,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: ROLE_BADGE_BG,
    fontSize: typography.caption,
    fontWeight: '800',
    color: colors.ink,
  },
  progressBarBg: {
    marginTop: spacing.xs,
    height: 6,
    borderRadius: 999,
    backgroundColor: PROGRESS_TRACK,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressBarFill: {
    borderRadius: 999,
    backgroundColor: colors.gold,
  },
});

export default SessionProgressHeader;
