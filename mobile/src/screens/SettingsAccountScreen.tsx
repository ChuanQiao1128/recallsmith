import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { SETTINGS_SNAPSHOT } from '../mock/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsAccount'>;

export function SettingsAccountScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Account"
      title="Account and billing"
      body="Manage sign-in state, linked services, and destructive account actions from one clear place."
      chips={['Account', 'Recovery']}
      sections={[
        {
          title: 'Account state',
          items: [
            { title: 'Linked', subtitle: String(SETTINGS_SNAPSHOT.accountLinked) },
            { title: 'Mode', subtitle: 'Device ID with optional Apple/Google link' },
          ],
        },
        {
          title: 'Sync and recovery posture',
          body: 'This page should make it obvious what is still local, what can later be linked, and where destructive actions live before the user commits.',
          items: [
            { title: 'Current protection', subtitle: 'Local-first progress with optional future linking and account recovery' },
          ],
        },
      ]}
      primaryLabel="Delete account"
      onPrimary={() => navigation.navigate('DeleteAccountConfirm')}
      secondaryLabel="Back to settings"
      onSecondary={() => navigation.navigate('SettingsMain')}
    />
  );
}

export default SettingsAccountScreen;