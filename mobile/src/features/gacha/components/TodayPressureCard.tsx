import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TodayCounts } from '../contracts';

export function TodayPressureCard(props: { counts: TodayCounts; selectedDeckTitle: string | null }) {
  const { counts, selectedDeckTitle } = props;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Today’s pressure</Text>
      <Text style={styles.subtitle}>
        {selectedDeckTitle ? `${selectedDeckTitle} · ${counts.selectedDue} due · ${counts.selectedNew} fresh` : 'No active deck selected'}
      </Text>

      <View style={styles.row}>
        <View style={[styles.metric, styles.metricNormal]}>
          <Text style={styles.metricValue}>{counts.normalCount}</Text>
          <Text style={styles.metricLabel}>Normal</Text>
        </View>
        <View style={[styles.metric, styles.metricElite]}>
          <Text style={styles.metricValue}>{counts.eliteCount}</Text>
          <Text style={styles.metricLabel}>Elite</Text>
        </View>
        <View style={[styles.metric, styles.metricBoss]}>
          <Text style={styles.metricValue}>{counts.bossCount}</Text>
          <Text style={styles.metricLabel}>Boss</Text>
        </View>
      </View>

      <Text style={styles.footnote}>
        Across all decks: {counts.totalDueAllDecks} due today · mastered in selected deck: {counts.selectedMastered}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  title: { fontSize: 15, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 6, fontSize: 12, color: '#6B7280' },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  metric: { flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 10 },
  metricNormal: { backgroundColor: 'rgba(79,70,229,0.10)' },
  metricElite: { backgroundColor: 'rgba(234,179,8,0.12)' },
  metricBoss: { backgroundColor: 'rgba(244,114,182,0.12)' },
  metricValue: { fontSize: 24, fontWeight: '800', color: '#111827' },
  metricLabel: { marginTop: 4, fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase' },
  footnote: { marginTop: 12, fontSize: 11, lineHeight: 16, color: '#6B7280' },
});

export default TodayPressureCard;
