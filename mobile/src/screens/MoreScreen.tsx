import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import { listDrawStateSlugs, loadDrawState } from '../features/gacha/draw/drawStateStore';
import appJson from '../../app.json';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'More'>;

// SettingsScreen.tsx keeps its own private copies of these two Notion URLs
// (SettingsScreen.tsx:49,51); the two must change together.
export const MORE_LINKS = {
  support:
    'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Support-Help-2bfa758eb545809ead04d8f8321a40dc?pvs=74',
  privacy:
    'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74',
} as const;

export const MORE_BYLINE = 'Made by one developer in Auckland';

export function MoreScreen({ navigation }: Props) {
  const [snapshot, setSnapshot] = useState<StreakSnapshot | null>(null);
  const [collected, setCollected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedSnapshot, collectedCount] = await Promise.all([
        loadStreakSnapshot(),
        (async () => {
          try {
            const slugs = await listDrawStateSlugs();
            const records = await Promise.all(slugs.map(loadDrawState));
            return records.reduce((sum, record) => sum + record.owned.length, 0);
          } catch {
            return 0;
          }
        })(),
      ]);
      if (cancelled) return;
      setSnapshot(loadedSnapshot);
      setCollected(collectedCount);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An em dash while the reads are in flight, never a fake number.
  const dayStreak = snapshot === null ? '—' : String(snapshot.currentDailyStreak);
  const cardsCollected = collected === null ? '—' : String(collected);

  const openLink = (url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  };

  return (
    <AppInfoScreen
      eyebrow="Me"
      title="Your profile and support"
      body="Your streak and collection at a glance, plus settings, help, privacy and a way to reach me."
      cosmic
      stats={[
        { label: 'Day streak', value: dayStreak },
        { label: 'Cards collected', value: cardsCollected },
      ]}
      footer={
        <View>
          <View style={styles.card}>
            <Pressable
              accessibilityRole="button"
              testID="more-row-profile"
              style={styles.row}
              onPress={() => navigation.navigate('Profile')}
            >
              <Text style={styles.rowTitle}>Profile</Text>
              <Text style={styles.rowSubtitle}>Streak, week and audience</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="more-row-settings"
              style={styles.row}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.rowTitle}>Settings</Text>
              <Text style={styles.rowSubtitle}>Reminders, account, premium</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="more-row-help"
              style={styles.row}
              onPress={() => navigation.navigate('HelpFAQ')}
            >
              <Text style={styles.rowTitle}>Help</Text>
              <Text style={styles.rowSubtitle}>Pulls, pity, offline, Android</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="more-row-privacy"
              style={styles.row}
              onPress={() => openLink(MORE_LINKS.privacy)}
            >
              <Text style={styles.rowTitle}>Privacy</Text>
              <Text style={styles.rowSubtitle}>Privacy policy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="more-row-support"
              style={styles.row}
              onPress={() => openLink(MORE_LINKS.support)}
            >
              <Text style={styles.rowTitle}>Support</Text>
              <Text style={styles.rowSubtitle}>Report a wrong card or ask a question</Text>
            </Pressable>
          </View>
          <Text testID="more-byline" style={styles.byline}>
            {MORE_BYLINE}
          </Text>
          <Text testID="more-version" style={styles.version}>
            {`Version ${appJson.expo.version}`}
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(232,184,90,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  row: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  rowTitle: {
    fontSize: typography.body,
    lineHeight: 20,
    fontWeight: '800',
    color: colors.cosmicInk,
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: typography.caption,
    lineHeight: 16,
    color: '#D9D0AE',
  },
  byline: {
    marginTop: spacing.md,
    textAlign: 'center',
    fontSize: typography.bodySmall,
    color: '#D9D0AE',
  },
  version: {
    marginTop: spacing.xs,
    textAlign: 'center',
    fontSize: typography.caption,
    color: '#D9D0AE',
  },
});

export default MoreScreen;
