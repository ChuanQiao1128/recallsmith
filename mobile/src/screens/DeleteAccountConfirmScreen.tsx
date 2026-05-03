import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { DELETE_PREVIEW } from '../mock/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'DeleteAccountConfirm'>;

export function DeleteAccountConfirmScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Delete account"
      title="Delete account"
      body="This removes your account data and progress preview shown below, so the impact is clear before you continue."
      chips={['Destructive action', 'Review first']}
      stats={[
        { label: 'Cards', value: String(DELETE_PREVIEW.cards) },
        { label: 'Streak', value: String(DELETE_PREVIEW.streak) },
      ]}
      sections={[
        {
          title: 'You would lose',
          items: [
            { title: 'Cards', subtitle: String(DELETE_PREVIEW.cards) },
            { title: 'Streak', subtitle: String(DELETE_PREVIEW.streak) },
            { title: 'Milestones', subtitle: String(DELETE_PREVIEW.milestones) },
            { title: 'Study hours', subtitle: String(DELETE_PREVIEW.studyHours) },
          ],
        },
        {
          title: 'Safer alternatives',
          body: 'If the real goal is to clear study pressure rather than erase identity, Fresh Start or account unlinking should remain easier to reach than deletion.',
        },
      ]}
      primaryLabel="Delete account data"
      onPrimary={() => navigation.navigate('Welcome')}
      secondaryLabel="Back to account"
      onSecondary={() => navigation.navigate('SettingsAccount')}
      tertiaryLabel="Cancel"
      onTertiary={() => navigation.navigate('SettingsMain')}
    />
  );
}

export default DeleteAccountConfirmScreen;