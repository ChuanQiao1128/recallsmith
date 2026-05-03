import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { PLAN_WEEK, WEEK_GOAL_DEFAULTS } from '../mock/plan';
import { ActionButton, MetricCard, ParchmentScaffold, SectionCard } from '../components/ParchmentScaffold';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanWeek'>;

export function PlanWeekScreen({ navigation }: Props) {
  const max = Math.max(...PLAN_WEEK.map((item) => item.count));
  return (
    <ParchmentScaffold
      eyebrow="Plan week"
      title="Weekly due pattern"
      body={`Current weekly goal ${WEEK_GOAL_DEFAULTS.current} · suggested ${WEEK_GOAL_DEFAULTS.suggested}. The week view now feels more like a premium pacing board for spotting heavy weekends early.`}
      chips={['Weekly load', 'Forecast']}
    >
      <View style={styles.metricsRow}>
        <MetricCard value={String(WEEK_GOAL_DEFAULTS.current)} label="Current goal" />
        <MetricCard value={String(WEEK_GOAL_DEFAULTS.suggested)} label="Suggested" />
      </View>

      <SectionCard kicker="Load curve" title="Seven-day cadence" body="Bar rows are framed as a planner artifact rather than raw instrumentation.">
        <View style={styles.chartWrap}>
          {PLAN_WEEK.map((item) => (
            <View key={item.day} style={styles.row}>
              <Text style={styles.day}>{item.day}</Text>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${(item.count / max) * 100}%` }]} />
              </View>
              <Text style={styles.count}>{item.count}</Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <View style={styles.actionStack}>
        <ActionButton label="Month view" onPress={() => navigation.navigate('PlanMonth')} />
        <ActionButton label="Week planner prompt" variant="secondary" onPress={() => navigation.navigate('WeekPlannerPrompt')} />
      </View>
    </ParchmentScaffold>
  );
}

export default PlanWeekScreen;

const styles = StyleSheet.create({
  metricsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  chartWrap: {
    marginTop: 14,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  day: {
    width: 36,
    fontSize: 12,
    fontWeight: '800',
    color: '#2A2218',
  },
  barBg: {
    flex: 1,
    height: 14,
    borderRadius: 999,
    backgroundColor: '#EFE3D0',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#C8883A',
  },
  count: {
    width: 24,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
    color: '#2A2218',
  },
  actionStack: { marginTop: 20, gap: 10 },
});
