import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DeckSummary } from '../contracts';
import type { HomeDeckActionHint } from '../selectors/homeSelectors';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

const HOME_DECK_ROW_TOKENS = {
  border: colors.hairline,
  surface: colors.softCream,
  selectedBorder: colors.gold,
  selectedSurface: colors.softPeach,
} as const;

export type HomeDeckRowProps = {
  deck: DeckSummary;
  action: HomeDeckActionHint;
  onPress: () => void;
  statusLabel?: string;
  progressLabel?: string;
  selected?: boolean;
  busy?: boolean;
};

function actionCopy(action: HomeDeckActionHint): string {
  switch (action) {
    case 'install':
      return 'Install';
    case 'update':
      return 'Update';
    case 'trial-start':
      return 'Start trial';
    case 'paywall':
      return 'Unlock';
    case 'none':
      return 'Coming';
    default:
      return 'Open';
  }
}

export function HomeDeckRow(props: HomeDeckRowProps) {
  const {
    deck,
    action,
    onPress,
    statusLabel,
    progressLabel,
    selected = false,
    busy = false,
  } = props;

  const subtitle =
    progressLabel ??
    (deck.canStudy
      ? `${deck.dueToday} due · ${deck.newToday} fresh`
      : `${deck.totalCards} cards`);

  return (
    <Pressable
      accessibilityRole="button"
      testID={`home-deck-row-${deck.slug}`}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
        busy && styles.rowBusy,
      ]}
      onPress={onPress}
      disabled={busy || action === 'none'}
    >
      <View style={styles.left}>
        <Text style={styles.title} numberOfLines={1}>
          {deck.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.status} numberOfLines={1}>
          {statusLabel ?? actionCopy(action)}
        </Text>
        <Text style={styles.action} numberOfLines={1}>
          {busy ? 'Working...' : actionCopy(action)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderRadius: spacing.cardRadius,
    borderWidth: 1,
    borderColor: HOME_DECK_ROW_TOKENS.border,
    backgroundColor: HOME_DECK_ROW_TOKENS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  rowSelected: {
    borderColor: HOME_DECK_ROW_TOKENS.selectedBorder,
    backgroundColor: HOME_DECK_ROW_TOKENS.selectedSurface,
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowBusy: {
    opacity: 0.7,
  },
  left: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  right: {
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.ink,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
    color: colors.inkSecondary,
  },
  status: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.inkSecondary,
  },
  action: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '800',
    color: colors.gold,
  },
});

export default HomeDeckRow;
