import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';


type Props = NativeStackScreenProps<RootStackParamList, 'More'>;

export function MoreScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Me"
      title="Your profile and support"
      body="Manage your streak, settings, help, and account surfaces here without competing with today’s study route. Treat this tab as your support rail, not as another home page."
      cosmic
      chips={['Profile', 'Settings', 'Support']}
      stats={[
        { label: 'Support areas', value: '3' },
        { label: 'Dev tools', value: '1' },
      ]}
      sections={[
        {
          title: 'What you can manage',
          items: [
            { title: 'Profile', subtitle: 'Identity, streaks, and long-run study posture' },
            { title: 'Settings', subtitle: 'Preferences, reminders, audience, pools, appearance, and account' },
            { title: 'Help', subtitle: 'Answers for draw rules, resets, and reminder behavior' },
            { title: 'Achievements', subtitle: 'Collection, streak, and mastery wins' },
          ],
        },
        {
          title: 'Developer tools',
          body: 'QA shortcuts still live here, but they stay secondary to the user-facing profile and support surfaces.',
          items: [
            { title: 'Debug menu', subtitle: 'Scenario switching and QA shortcuts' },
          ],
        },
      ]}
      primaryLabel="Profile"
      onPrimary={() => navigation.navigate('Profile')}
      secondaryLabel="Settings"
      onSecondary={() => navigation.navigate('SettingsMain')}
      tertiaryLabel="Help"
      onTertiary={() => navigation.navigate('HelpFAQ')}
    />
  );
}

export default MoreScreen;
