import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { getCurrentAppVersion } from '../config/remoteConfig';
import { useAuthStore } from '../auth/authStore';
import {
  getReminderPrefs,
  type ReminderPrefs,
} from '../notifications/reminders';
import { buildReminderPlanVM } from '../features/gacha/reminders/reminderPlanner';
import { loadStreakSnapshot, type StreakSnapshot } from '../features/gacha/streaks/streakTracker';
import type { AudiencePreference } from '../features/gacha/audience/audiencePrefs';
import {
  loadAudiencePreference,
  saveAudiencePreference,
} from '../features/gacha/settings/content/audienceActions';
import {
  confirmResetReviewSchedule,
  runResetReviewSchedule,
} from '../features/gacha/settings/account/accountActions';
import AccountSection from '../features/gacha/settings/account/AccountSection';
import ContentSection from '../features/gacha/settings/content/ContentSection';
import RemindersSection from '../features/gacha/settings/reminders/RemindersSection';
import AppearanceSection from '../features/gacha/settings/appearance/AppearanceSection';
import AboutSection from '../features/gacha/settings/about/AboutSection';
import DebugSection from '../features/gacha/settings/debug/DebugSection';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const SUPPORT_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Support-Help-2bfa758eb545809ead04d8f8321a40dc?pvs=74';
const PRIVACY_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74';

const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  morningEnabled: true,
  morningTime: '09:00',
  eveningEnabled: true,
  eveningTime: '20:00',
};

function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url.trim()}`;
}

async function openExternalLink(url: string): Promise<void> {
  const safeUrl = normalizeUrl(url);
  try {
    const supported = await Linking.canOpenURL(safeUrl);
    if (!supported) {
      Alert.alert('Cannot open link', 'Please try again later.');
      return;
    }
    await Linking.openURL(safeUrl);
  } catch {
    Alert.alert('Cannot open link', 'Please try again later.');
  }
}

export function SettingsScreen({ navigation }: Props) {
  const appVersion = getCurrentAppVersion();

  const status = useAuthStore((state) => state.status);
  const authLoading = useAuthStore((state) => state.loading);
  const email = useAuthStore((state) => state.email);
  const signOutNow = useAuthStore((state) => state.signOutNow);
  const signedIn = status === 'signed_in';

  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState<AudiencePreference>('both');
  const [audienceSaving, setAudienceSaving] = useState(false);
  const [reminderPrefs, setReminderPrefsState] = useState<ReminderPrefs>(DEFAULT_REMINDER_PREFS);
  const [streak, setStreak] = useState<StreakSnapshot | null>(null);
  const [resetting, setResetting] = useState(false);

  const reminderPlan = useMemo(() => buildReminderPlanVM(reminderPrefs), [reminderPrefs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextAudience, nextPrefs, nextStreak] = await Promise.all([
        loadAudiencePreference(),
        getReminderPrefs(),
        loadStreakSnapshot(),
      ]);

      setAudience(nextAudience);
      setReminderPrefsState(nextPrefs);
      setStreak(nextStreak);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onSelectAudience = useCallback(async (next: AudiencePreference) => {
    if (audienceSaving || next === audience) return;

    setAudienceSaving(true);
    try {
      const saved = await saveAudiencePreference(next);
      setAudience(saved);
    } catch {
      Alert.alert('Update failed', 'Unable to update audience preference right now.');
    } finally {
      setAudienceSaving(false);
    }
  }, [audience, audienceSaving]);

  const onResetReviewSchedule = useCallback(() => {
    confirmResetReviewSchedule({
      onConfirm: async () => {
        setResetting(true);
        try {
          await runResetReviewSchedule(new Date());
          await refresh();
        } finally {
          setResetting(false);
        }
      },
    });
  }, [refresh]);

  const onSignIn = useCallback(() => {
    navigation.navigate('SignIn');
  }, [navigation]);

  const onSignOut = useCallback(async () => {
    await signOutNow();
    await refresh();
  }, [refresh, signOutNow]);

  const momentumDays = streak?.currentDailyStreak ?? 0;
  const totalSessions = streak?.totalQualifiedSessions ?? 0;

  if (loading || authLoading || status === 'unknown') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Loading settings...
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              Settings
            </Text>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => navigation.goBack()}>
              <Text style={styles.backText} numberOfLines={1}>
                Close
              </Text>
            </Pressable>
          </View>

          <Text style={styles.title} numberOfLines={2}>
            Account, content, reminders, and app basics.
          </Text>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle} numberOfLines={1}>
              Momentum
            </Text>
            <Text style={styles.sectionBody} numberOfLines={1}>
              {momentumDays} days streak · {totalSessions} qualified sessions
            </Text>
            <Text style={styles.metaText}>{reminderPlan.eveningLine}</Text>
          </View>

          <AccountSection
            signedIn={signedIn}
            email={email}
            resetting={resetting}
            onSignIn={onSignIn}
            onSignOut={() => void onSignOut()}
            onResetReviewSchedule={onResetReviewSchedule}
          />

          <ContentSection
            audience={audience}
            saving={audienceSaving}
            onSelect={(next) => void onSelectAudience(next)}
          />

          <RemindersSection
            signedIn={signedIn}
            plan={reminderPlan}
            onSignIn={onSignIn}
          />

          <AppearanceSection />

          <AboutSection
            appVersion={appVersion}
            onSupport={() => void openExternalLink(SUPPORT_URL)}
            onPrivacy={() => void openExternalLink(PRIVACY_URL)}
          />

          {__DEV__ ? <DebugSection onOpenDebug={() => navigation.navigate('DebugMenu')} /> : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.parchmentBg,
  },
  gradient: {
    flex: 1,
  },
  container: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.screenPadding,
    paddingBottom: spacing.xl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: typography.caption,
    color: colors.gold,
    textTransform: 'uppercase',
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  backButton: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
  },
  backText: {
    fontSize: typography.bodySmall,
    color: colors.ink,
    fontWeight: '700',
  },
  title: {
    marginTop: spacing.xs,
    fontSize: typography.title3,
    color: colors.ink,
    fontWeight: '800',
  },
  sectionCard: {
    marginTop: spacing.sm,
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  sectionTitle: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.ink,
  },
  sectionBody: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  metaText: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  pressed: {
    opacity: 0.9,
  },
});
