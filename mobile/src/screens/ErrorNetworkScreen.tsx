import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'ErrorNetwork'>;

export function ErrorNetworkScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Network"
      title="Connection lost, but your route is still safe"
      body="Keep the learner calm when the network drops: explain what still works locally, what will resume later, and where to go next."
      chips={['Offline-safe', 'Recovery']}
      sections={[
        {
          title: 'What still works',
          items: [
            { title: 'Local browsing', subtitle: 'Home, Library, and Plan can still open from cached state' },
            { title: 'Later sync', subtitle: 'Progress can sync when the network returns' },
          ],
        },
        {
          title: 'Best next move',
          body: 'Return to a stable surface or keep reading locally. Save panic language for true destructive failures, not normal offline moments.',
        },
      ]}
      primaryLabel="Retry to Home"
      onPrimary={() => navigation.navigate('Home')}
      secondaryLabel="Offline banner"
      onSecondary={() => navigation.navigate('OfflineBanner')}
    />
  );
}

export default ErrorNetworkScreen;