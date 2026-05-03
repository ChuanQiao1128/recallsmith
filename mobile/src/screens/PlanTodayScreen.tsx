import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { PLAN_TODAY } from '../mock/plan';
import { ActionButton, MetricCard, ParchmentScaffold, SectionCard } from '../components/ParchmentScaffold';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanToday'>;

export function PlanTodayScreen({ navigation }: Props) {
  return (
    <ParchmentScaffold
      eyebrow="Plan today"
      title="Today’s route split"
      body="Separate fresh supply from review pressure before a session begins. The page now reads like a route briefing instead of a plain checklist."
      chips={['Session prep', 'Daily route']}
    >
      <View style={styles.metricsRow}>
        <MetricCard value={String(PLAN_TODAY.newCards.length)} label="New cards" />
        <MetricCard value={String(PLAN_TODAY.reviewCards.length)} label="Review cards" />
      </View>

      <SectionCard kicker="Fresh supply" title="New cards" body="Concepts worth introducing while focus is highest.">
        <View style={styles.list}>
          {PLAN_TODAY.newCards.map((title) => (
            <View key={title} style={styles.rowCard}>
              <Text style={styles.rowTitle}>{title}</Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <SectionCard kicker="Pressure" title="Review cards" body="Due items grouped so the user can gauge weight before committing.">
        <View style={styles.list}>
          {PLAN_TODAY.reviewCards.map((title) => (
            <View key={title} style={styles.rowCard}>
              <Text style={styles.rowTitle}>{title}</Text>
            </View>
          ))}
        </View>
      </SectionCard>

      <View style={styles.actionStack}>
        <ActionButton label="Start session" onPress={() => navigation.navigate('Level', { slug: 'csharp', source: 'daily-dose' })} />
        <ActionButton label="Week plan" variant="secondary" onPress={() => navigation.navigate('PlanWeek')} />
      </View>
    </ParchmentScaffold>
  );
}

export default PlanTodayScreen;

const styles = StyleSheet.create({
  metricsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  list: { marginTop: 14, gap: 10 },
  rowCard: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFF8EC',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.12)',
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 19,
    color: '#2A2218',
    fontWeight: '700',
  },
  actionStack: { marginTop: 20, gap: 10 },
});
