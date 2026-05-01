import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { SETTINGS_SNAPSHOT } from '../mock/settings';

type Props = NativeStackScreenProps<RootStackParamList, 'SettingsNotifications'>;

export function SettingsNotificationsScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Notifications"
      title="Reminders and quiet hours"
      body="Control when the app nudges you back in, while keeping reminders clearly secondary to the study loop itself."
      chips={['Morning plan', 'Rescue nudge']}
      sections={[
        {
          title: 'Reminder plan',
          items: [
            { title: 'Morning nudge', subtitle: SETTINGS_SNAPSHOT.morningTime },
            { title: 'Quiet hours', subtitle: SETTINGS_SNAPSHOT.quietHours },
          ],
        },
        {
          title: 'Evening rescue',
          body: 'Use a lighter fallback reminder only when due cards remain, so the product helps without sounding like a debt collector.',
          items: [
            { title: 'Fallback behavior', subtitle: 'Only rescue the day when study pressure is still unresolved.' },
          ],
        },
      ]}
      primaryLabel="Back to settings"
      onPrimary={() => navigation.navigate('SettingsMain')}
    />
  );
}

export default SettingsNotificationsScreen;