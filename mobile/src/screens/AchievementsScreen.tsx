import React from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { MILESTONE_HALL } from '../mock/milestones';

type Props = NativeStackScreenProps<RootStackParamList, 'Achievements'>;

export function AchievementsScreen({ navigation }: Props) {
  const unlocked = MILESTONE_HALL.flatMap((group) =>
    group.badges
      .filter((badge) => badge.unlockedAt)
      .map((badge) => ({ title: `${group.poolTitle} · ${badge.title}`, subtitle: badge.unlockedAt ?? 'locked' })),
  );

  return (
    <AppInfoScreen
      eyebrow="Achievements"
      title="Wins and milestones"
      body="Track the streak, collection, and mastery moments you have already earned without turning this tab into another dashboard."
      chips={['Recognition', 'Milestones', 'Progress']}
      stats={[
        { label: 'Unlocked', value: String(unlocked.length) },
        { label: 'Pools', value: String(MILESTONE_HALL.length) },
      ]}
      sections={[
        {
          title: 'Unlocked milestones',
          body: 'Most recent visible wins across the current hall data.',
          items: unlocked,
        },
        {
          title: 'What moves next',
          body: 'Achievements should point the learner back toward the next route or hall target instead of stopping as a trophy wall.',
        },
      ]}
      primaryLabel="Milestone hall"
      onPrimary={() => navigation.navigate('MilestoneHall')}
      secondaryLabel="Back to profile"
      onSecondary={() => navigation.navigate('Profile')}
    />
  );
}

export default AchievementsScreen;