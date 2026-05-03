import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { TOAST_FIXTURES } from '../mock/toast';

type Props = NativeStackScreenProps<RootStackParamList, 'ToastHost'>;

export function ToastHostScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Toast host"
      title="Reusable success, warning, and error messaging"
      body="Transient feedback should feel short, calm, and trustworthy — strong enough to guide action without becoming a second notification system."
      chips={['Transient copy', 'Feedback system']}
      sections={[
        {
          title: 'Toast variants',
          items: TOAST_FIXTURES.map((item) => ({ title: item.level, subtitle: item.text })),
        },
        {
          title: 'Messaging posture',
          body: 'Success should be brief, warning should be actionable, and error should redirect the learner toward a stable next surface.',
        },
      ]}
      primaryLabel="Back home"
      onPrimary={() => navigation.navigate('Home')}
      secondaryLabel="Error state"
      onSecondary={() => navigation.navigate('ErrorGeneric')}
      tertiaryLabel="Debug menu"
      onTertiary={() => navigation.navigate('DebugMenu')}
    />
  );
}

export default ToastHostScreen;