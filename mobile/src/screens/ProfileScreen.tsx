import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { MOCK_USER } from '../mock/user';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

export function ProfileScreen({ navigation }: Props) {
  return (
    <AppInfoScreen
      eyebrow="Profile"
      title="Your study profile"
      body="Keep your learner identity, momentum, and longer-run progress in one place before you dive back into studying."
      chips={['Momentum', 'Identity', 'Progress']}
      stats={[
        { label: 'Daily streak', value: String(MOCK_USER.streak) },
        { label: 'Week streak', value: String(MOCK_USER.weekStreak) },
      ]}
      sections={[
        {
          title: 'Current setup',
          items: [
            { title: 'Audience', subtitle: MOCK_USER.audiencePreference },
            { title: 'Account mode', subtitle: MOCK_USER.accountMode },
          ],
        },
        {
          title: 'Momentum this week',
          body: 'A compact read on whether this learner is simply keeping the habit warm or still carrying enough energy for a full route.',
          items: [
            { title: 'Qualified runs', subtitle: `${MOCK_USER.streak} recent streak days still holding` },
            { title: 'Week posture', subtitle: `${MOCK_USER.weekStreak} week streak with room for one stronger catch-up run` },
          ],
        },
        {
          title: 'Study identity',
          items: [
            { title: 'Nickname', subtitle: 'Learner #local' },
            { title: 'Status', subtitle: 'On-device progress with optional account linking later' },
          ],
        },
        {
          title: 'Next best return point',
          body: 'Profile should always hand the learner back to a sensible next move rather than becoming a dead-end account page.',
          items: [
            { title: 'Best next action', subtitle: 'Return to today’s route if due pressure exists; otherwise inspect milestones or adjust preferences.' },
          ],
        },
      ]}
      primaryLabel="Edit profile"
      onPrimary={() => navigation.navigate('EditProfile')}
      secondaryLabel="Achievements"
      onSecondary={() => navigation.navigate('Achievements')}
      tertiaryLabel="Milestone hall"
      onTertiary={() => navigation.navigate('MilestoneHall')}
    />
  );
}

export default ProfileScreen;