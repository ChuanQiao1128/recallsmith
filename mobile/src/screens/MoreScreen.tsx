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
      // "Dev tools: 1" used to sit here as a headline statistic. A count of
      // the QA surfaces is not a fact a learner has any use for, and putting
      // it beside "Support areas" implied it was one of them.
      stats={[{ label: 'Support areas', value: '3' }]}
      sections={[
        {
          title: 'What you can manage',
          items: [
            { title: 'Profile', subtitle: 'Identity, streaks, and long-run study posture' },
            { title: 'Settings', subtitle: 'Account, sync, reminders, and content preferences' },
            { title: 'Help', subtitle: 'Answers for draw rules, resets, and reminder behavior' },
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
      // 'SettingsMain' is the mock tree: it renders src/mock/settings.ts, so
      // it neither reflects nor changes anything the app does. The app has
      // exactly one real settings screen and the Home gear already opens it;
      // pointing here at the other one gave the repo two parallel settings
      // trees with only one of them wired up.
      onSecondary={() => navigation.navigate('Settings')}
      tertiaryLabel="Help"
      onTertiary={() => navigation.navigate('HelpFAQ')}
    />
  );
}

export default MoreScreen;
