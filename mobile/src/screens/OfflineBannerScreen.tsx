import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'OfflineBanner'>;

export function OfflineBannerScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Offline banner"
      title="Non-blocking offline messaging"
      body="Explain cached progress and later sync clearly, while preserving the feeling that the learner can keep moving through the product."
      sections={[
        {
          title: 'Banner language',
          items: [
            { title: 'Offline', subtitle: 'Progress will sync when the connection returns' },
            { title: 'Non-blocking', subtitle: 'The user can keep reading and browsing locally' },
          ],
        },
        {
          title: 'When to escalate',
          body: 'Only push the learner into a stronger error state when a route truly cannot continue. Ordinary offline moments should stay lightweight and recoverable.',
        },
      ]}
      primaryLabel="Back home"
      onPrimary={() => navigation.navigate('Home')}
      secondaryLabel="Network error"
      onSecondary={() => navigation.navigate('ErrorNetwork')}
    />
  );
}

export default OfflineBannerScreen;