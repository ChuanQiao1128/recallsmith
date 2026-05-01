import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { PLAN_MONTH } from '../mock/plan';
import { ActionButton, MetricCard, ParchmentScaffold, SectionCard } from '../components/ParchmentScaffold';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanMonth'>;

export function PlanMonthScreen({ navigation }: Props) {
  const max = Math.max(...PLAN_MONTH.map((item) => item.count));
  const peak = PLAN_MONTH.reduce((best, item) => (item.count > best.count ? item : best), PLAN_MONTH[0]);

  return (
    <ParchmentScaffold
      eyebrow="Plan month"
      title="30-day heat load"
      body="Long-range planning now feels like a parchment heat map. Surges are visible at a glance, but the route still stays secondary to today’s action."
      chips={['Monthly load', 'Heat map']}
    >
      <View style={styles.metricsRow}>
        <MetricCard value={String(peak.count)} label="Peak due" />
        <MetricCard value={peak.date} label="Peak day" />
      </View>

      <SectionCard kicker="Forecast" title="Month heat cells" body="Density is shown as collectible tiles instead of generic grid blocks.">
        <View style={styles.grid}>
          {PLAN_MONTH.map((item) => (
            <View key={item.date} style={[styles.cell, { backgroundColor: `rgba(200,136,58,${0.14 + (item.count / max) * 0.42})` }]}>
              <Text style={styles.cellDate}>{item.date}</Text>
              <Text style={styles.cellCount}>{item.count}</Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <View style={styles.actionStack}>
        <ActionButton label="Month rewind" onPress={() => navigation.navigate('MonthRewind')} />
        <ActionButton label="Back to plan" variant="secondary" onPress={() => navigation.navigate('PlanOverview')} />
      </View>
    </ParchmentScaffold>
  );
}

export default PlanMonthScreen;

const styles = StyleSheet.create({
  metricsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  cell: {
    width: '30%',
    minHeight: 82,
    borderRadius: 18,
    padding: 12,
    justifyContent: 'space-between',
  },
  cellDate: {
    fontSize: 11,
    color: '#2A2218',
    fontWeight: '700',
  },
  cellCount: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: '900',
    color: '#2A2218',
  },
  actionStack: { marginTop: 20, gap: 10 },
});
