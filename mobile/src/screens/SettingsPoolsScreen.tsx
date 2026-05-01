import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { SETTINGS_SNAPSHOT } from '../mock/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsPools'>;

export function SettingsPoolsScreen({ navigation }: Props) {
  const activeCount = SETTINGS_SNAPSHOT.pools.filter((pool) => pool.state === 'active').length;
  return (
    <AppInfoScreen
      eyebrow="Pools"
      title="Pools and availability"
      body="See which pools are active, which are paused, and where to inspect them further from settings."
      chips={['Catalog', 'Availability']}
      stats={[
        { label: 'Currently active', value: String(activeCount) },
        { label: 'Paused', value: String(SETTINGS_SNAPSHOT.pools.length - activeCount) },
      ]}
      sections={[
        {
          title: 'Pool posture',
          body: 'Pools should feel like controlled availability, not like a sprawling admin console. Keep the main read simple: active, paused, and where to inspect further.',
          items: SETTINGS_SNAPSHOT.pools.map((pool) => ({ title: pool.title, subtitle: pool.state })),
        },
      ]}
      primaryLabel="Paused pool"
      onPrimary={() => navigation.navigate('PausedPool')}
      secondaryLabel="Back to settings"
      onSecondary={() => navigation.navigate('SettingsMain')}
      tertiaryLabel="Pool overview"
      onTertiary={() => navigation.navigate('PoolOverview', { poolId: 'csharp' })}
    />
  );
}

export default SettingsPoolsScreen;