import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { TodayCounts } from '../contracts';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

const TODAY_PRESSURE_TOKENS = {
  card: colors.softCream,
  metricNormal: colors.softLavender,
  metricElite: colors.parchmentBgDeep,
  metricBoss: colors.softPeach,
  metricTotal: colors.softMist,
  metricBorder: colors.hairline,
} as const;

export function TodayPressureCard(props: { counts: TodayCounts; selectedDeckTitle: string | null }) {
  const { counts, selectedDeckTitle } = props;
  const { width } = useWindowDimensions();
  const useCompactMetrics = width < 390;
  const metricSizeStyle = useCompactMetrics ? styles.metricCompact : styles.metricWide;

  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        Today’s pressure
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {selectedDeckTitle ? `${selectedDeckTitle} · ${counts.selectedDue} due · ${counts.selectedNew} fresh` : 'No active deck selected'}
      </Text>

      <View testID="home-today-count-grid" style={styles.row}>
        <View testID="home-today-count-normal" style={[styles.metric, metricSizeStyle, styles.metricNormal]}>
          <Text style={styles.metricValue} numberOfLines={1}>
            {counts.normalCount}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>
            Normal
          </Text>
        </View>
        <View testID="home-today-count-elite" style={[styles.metric, metricSizeStyle, styles.metricElite]}>
          <Text style={styles.metricValue} numberOfLines={1}>
            {counts.eliteCount}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>
            Elite
          </Text>
        </View>
        <View testID="home-today-count-boss" style={[styles.metric, metricSizeStyle, styles.metricBoss]}>
          <Text style={styles.metricValue} numberOfLines={1}>
            {counts.bossCount}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>
            Boss
          </Text>
        </View>
        <View testID="home-today-count-total" style={[styles.metric, metricSizeStyle, styles.metricTotal]}>
          <Text style={styles.metricValue} numberOfLines={1}>
            {counts.totalDueAllDecks}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>
            Total
          </Text>
        </View>
      </View>

      <Text style={styles.footnote} numberOfLines={1}>
        Mastered in selected deck: {counts.selectedMastered}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: spacing.md,
    backgroundColor: TODAY_PRESSURE_TOKENS.card,
    borderWidth: 1,
    borderColor: TODAY_PRESSURE_TOKENS.metricBorder,
    shadowColor: colors.ink,
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: spacing.sm,
  },
  title: { fontSize: typography.body, fontWeight: '800', color: colors.ink },
  subtitle: { marginTop: 6, fontSize: typography.caption, color: colors.inkSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm, justifyContent: 'space-between' },
  metric: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: spacing.xs,
    borderWidth: 1,
    borderColor: TODAY_PRESSURE_TOKENS.metricBorder,
  },
  metricWide: { flex: 1, minWidth: 0 },
  metricCompact: { width: '48%' },
  metricNormal: { backgroundColor: TODAY_PRESSURE_TOKENS.metricNormal },
  metricElite: { backgroundColor: TODAY_PRESSURE_TOKENS.metricElite },
  metricBoss: { backgroundColor: TODAY_PRESSURE_TOKENS.metricBoss },
  metricTotal: { backgroundColor: TODAY_PRESSURE_TOKENS.metricTotal },
  metricValue: { fontSize: 24, fontWeight: '800', color: colors.ink },
  metricLabel: { marginTop: 4, fontSize: typography.caption, fontWeight: '700', color: colors.inkSecondary, textTransform: 'uppercase' },
  footnote: { marginTop: spacing.sm, fontSize: typography.caption, lineHeight: 16, color: colors.inkSecondary },
});

export default TodayPressureCard;
