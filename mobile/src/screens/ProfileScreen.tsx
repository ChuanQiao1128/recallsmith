import React, { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { getAudiencePreference, type AudiencePreference } from '../features/gacha/audience/audiencePrefs';
import { getAudiencePreferenceLabel } from '../features/gacha/audience/audienceRules';
import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

// Every number on this screen used to come from src/mock/user.ts, so each
// shipped build told every user their streak was 4 and their week streak was
// 2. The tracker that owns the real answer (applySessionStreak writes it on
// every qualified session) sat one import away with no reader.
//
// The two are not the same shape, and the labels moved to match: the
// snapshot counts *days completed inside the current week*, which is not a
// week-over-week streak. Renaming the row was cheaper than inventing a
// statistic to fill the old one.
export function ProfileScreen({ navigation }: Props) {
  const [snapshot, setSnapshot] = useState<StreakSnapshot | null>(null);
  const [audience, setAudience] = useState<AudiencePreference | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedSnapshot, loadedAudience] = await Promise.all([
        loadStreakSnapshot(),
        getAudiencePreference(),
      ]);
      if (cancelled) return;
      setSnapshot(loadedSnapshot);
      setAudience(loadedAudience);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An em dash while the read is in flight, not a zero. A zero is a claim
  // about the user ("you have no streak") and it would be wrong for exactly
  // the users who care most about the number.
  const pending = snapshot === null;
  const dailyStreak = pending ? '—' : String(snapshot.currentDailyStreak);
  const daysThisWeek = pending ? '—' : String(snapshot.weekCompletedDays);

  return (
    <AppInfoScreen
      eyebrow="Profile"
      title="Your study profile"
      body="Your streak, your week and the preferences that shape what you study."
      chips={['Momentum', 'Progress']}
      stats={[
        { label: 'Daily streak', value: dailyStreak },
        { label: 'Days this week', value: daysThisWeek },
      ]}
      sections={[
        {
          title: 'Current setup',
          items: [
            { title: 'Audience', subtitle: audience ? getAudiencePreferenceLabel(audience) : '—' },
          ],
        },
        {
          title: 'Momentum this week',
          items: [
            {
              title: 'Qualified runs',
              subtitle: pending
                ? 'Reading your session history'
                : `${snapshot.totalQualifiedSessions} sessions have counted toward a streak`,
            },
            {
              title: 'Week posture',
              subtitle: pending
                ? 'Reading this week'
                : `${snapshot.weekCompletedDays} of 7 days completed this week · best run ${snapshot.longestDailyStreak}`,
            },
          ],
        },
      ]}
      primaryLabel="Study settings"
      onPrimary={() => navigation.navigate('Settings')}
    />
  );
}

export default ProfileScreen;
