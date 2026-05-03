import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'DebugMenu'>;
const scenarios = [
  { title: 'New user', subtitle: 'Home first-draw coach state' },
  { title: 'Day 7 active', subtitle: 'Standard active route' },
  { title: 'Day 15 dual-pool', subtitle: 'Pool launch visible' },
  { title: 'Backlog heavy', subtitle: 'Backlog + burst recovery' },
  { title: 'Dormant returnee', subtitle: 'Fresh re-entry + restart options' },
  { title: 'Paused pool', subtitle: 'Pool excluded from active route' },
  { title: 'Churned reset', subtitle: 'Fresh-start-first home state' },
];

export function DebugMenuScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Debug menu"
      title="Scenario switching and QA shortcuts"
      body="DebugMenu keeps its QA function but now carries more of the premium cosmic control-room feeling used by support and system surfaces."
      cosmic
      chips={['QA', 'Scenarios']}
      stats={[
        { label: 'Scenarios', value: String(scenarios.length) },
      ]}
      sections={[{ title: 'Scenarios', items: scenarios }]}
      primaryLabel="Open error shell"
      onPrimary={() => navigation.navigate('ErrorGeneric')}
      secondaryLabel="Offline banner"
      onSecondary={() => navigation.navigate('OfflineBanner')}
      tertiaryLabel="Back to more"
      onTertiary={() => navigation.navigate('More')}
    />
  );
}

export default DebugMenuScreen;
