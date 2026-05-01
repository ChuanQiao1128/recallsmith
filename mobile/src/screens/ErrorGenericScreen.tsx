import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'ErrorGeneric'>;

export function ErrorGenericScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Error"
      title="Something went wrong, but the route can recover"
      body="Show a calm fallback with next actions that keep the learner oriented instead of dropping them into a dead-end shell."
      sections={[
        {
          title: 'Recovery options',
          items: [
            { title: 'Retry the previous route', subtitle: 'Return to Home or reopen the surface you were on' },
            { title: 'Use debug menu', subtitle: 'Reproduce the failing scenario again' },
          ],
        },
        {
          title: 'If this keeps happening',
          body: 'Move the learner toward a stable surface quickly. Error messaging should shorten recovery time, not describe the failure in product-internal language.',
        },
      ]}
      primaryLabel="Back home"
      onPrimary={() => navigation.navigate('Home')}
      secondaryLabel="Debug menu"
      onSecondary={() => navigation.navigate('DebugMenu')}
    />
  );
}

export default ErrorGenericScreen;