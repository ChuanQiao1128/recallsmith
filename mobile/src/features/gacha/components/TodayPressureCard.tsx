import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TodayCounts } from '../contracts';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

export function TodayPressureCard(props: { counts: TodayCounts; selectedDeckTitle: string | null }) {
  const { counts, selectedDeckTitle } = props;

  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        Today’s pressure
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {selectedDeckTitle ? `${selectedDeckTitle} · ${counts.selectedDue} due · ${counts.selectedNew} fresh` : 'No active deck selected'}
      </Text>

      <View style={styles.row}>
        <View style={[styles.metric, styles.metricNormal]}>
          <Text style={styles.metricValue} numberOfLines={1}>
            {counts.normalCount}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>
            Normal
          </Text>
        </View>
        <View style={[styles.metric, styles.metricElite]}>
          <Text style={styles.metricValue} numberOfLines={1}>
            {counts.eliteCount}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>
            Elite
          </Text>
        </View>
        <View style={[styles.metric, styles.metricBoss]}>
          <Text style={styles.metricValue} numberOfLines={1}>
            {counts.bossCount}
          </Text>
          <Text style={styles.metricLabel} numberOfLines={1}>
            Boss
          </Text>
        </View>
      </View>

      <Text style={styles.footnote} numberOfLines={2}>
        Across all decks: {counts.totalDueAllDecks} due today · mastered in selected deck: {counts.selectedMastered}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: spacing.sm,
  },
  title: { fontSize: typography.body, fontWeight: '800', color: colors.ink },
  subtitle: { marginTop: 6, fontSize: typography.caption, color: colors.inkSecondary },
  row: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  metric: { flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: spacing.xs },
  metricNormal: { backgroundColor: 'rgba(79,70,229,0.10)' },
  metricElite: { backgroundColor: 'rgba(234,179,8,0.12)' },
  metricBoss: { backgroundColor: 'rgba(244,114,182,0.12)' },
  metricValue: { fontSize: 24, fontWeight: '800', color: colors.ink },
  metricLabel: { marginTop: 4, fontSize: typography.caption, fontWeight: '700', color: colors.inkSecondary, textTransform: 'uppercase' },
  footnote: { marginTop: spacing.sm, fontSize: typography.caption, lineHeight: 16, color: colors.inkSecondary },
});

export default TodayPressureCard;
