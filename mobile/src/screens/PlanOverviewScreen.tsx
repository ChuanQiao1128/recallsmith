import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { PLAN_SNAPSHOTS } from '../mock/plan';
import { ActionButton, MetricCard, ParchmentScaffold, SectionCard } from '../components/ParchmentScaffold';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanOverview'>;

export function PlanOverviewScreen({ navigation }: Props) {
  const weekPeak = Math.max(...PLAN_SNAPSHOTS.week);
  const monthPeak = Math.max(...PLAN_SNAPSHOTS.month);

  return (
    <ParchmentScaffold
      eyebrow="Plan"
      title="Study plan and forecast"
      body="Turn planning into a calm support surface: today for immediate pressure, week for pacing, and month for longer-range load before backlog appears."
      chips={['Planner', 'Forecast', 'Support loop']}
    >
      <View style={styles.metricsRow}>
        <MetricCard value={String(PLAN_SNAPSHOTS.today.due)} label="Due today" />
        <MetricCard value={String(weekPeak)} label="Week peak" />
        <MetricCard value={String(monthPeak)} label="Month peak" />
      </View>

      <SectionCard kicker="Today" title="Immediate pressure" body="Use the first read to decide whether today is a minimum-goal day or a full-run day.">
        <View style={styles.stack}>
          <View style={styles.snapshotCard}>
            <Text style={styles.snapshotKicker}>Today</Text>
            <Text style={styles.snapshotBody}>
              {PLAN_SNAPSHOTS.today.due} due · {PLAN_SNAPSHOTS.today.newCards} new · {PLAN_SNAPSHOTS.today.reviewCards} review
            </Text>
          </View>
        </View>
      </SectionCard>

      <SectionCard kicker="Forecast" title="This week needs" body="A better weekly view makes the heavy days obvious early, so the learner can redistribute effort before the route turns into backlog.">
        <View style={styles.stack}>
          <View style={styles.snapshotCard}>
            <Text style={styles.snapshotKicker}>Week</Text>
            <Text style={styles.snapshotBody}>{PLAN_SNAPSHOTS.week.join(' · ')}</Text>
          </View>
          <View style={styles.snapshotCard}>
            <Text style={styles.snapshotKicker}>Month</Text>
            <Text style={styles.snapshotBody}>{PLAN_SNAPSHOTS.month.join(' · ')}</Text>
          </View>
        </View>
      </SectionCard>

      <SectionCard kicker="Routes" title="Open the planner" body="Move from overview into the exact lens you need without making planning feel like a parallel workflow.">
        <View style={styles.actionsGrid}>
          <View style={styles.actionItem}>
            <ActionButton label="Today plan" onPress={() => navigation.navigate('PlanToday')} />
          </View>
          <View style={styles.actionItem}>
            <ActionButton label="Week plan" variant="secondary" onPress={() => navigation.navigate('PlanWeek')} />
          </View>
        </View>
        <View style={styles.footerAction}>
          <ActionButton label="Month view" variant="ghost" onPress={() => navigation.navigate('PlanMonth')} />
        </View>
      </SectionCard>
    </ParchmentScaffold>
  );
}

export default PlanOverviewScreen;

const styles = StyleSheet.create({
  metricsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  stack: { marginTop: 14, gap: 10 },
  snapshotCard: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#FFF8EC',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.12)',
  },
  snapshotKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#8C7A5B',
  },
  snapshotBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#2A2218',
    fontWeight: '600',
  },
  actionsGrid: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionItem: { flex: 1 },
  footerAction: { marginTop: 10 },
});