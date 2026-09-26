import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackParamList } from '../navigation/types';
import { mapPermissionResponse } from '../notifications/permissionState';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'PermissionPrompt'>;

// Guarded require — keeps vitest happy when expo-notifications isn't
// loadable in jsdom. On real devices this resolves to the real module.
function safeRequestNotificationPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'error'> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    if (!Notifications?.requestPermissionsAsync) return Promise.resolve('error');
    return Notifications.requestPermissionsAsync()
      .then((res: unknown) => mapPermissionResponse(res))
      .catch(() => 'error' as const);
  } catch {
    return Promise.resolve('error');
  }
}

// One-shot gate: AudienceSurvey marks it when onboarding completes; the
// first DrawResult the user leaves via "Done" consumes it and pushes this
// screen. Existing users (flag never set) are never prompted again.
export const PERMISSION_PROMPT_PENDING_KEY = 'notifications:permission-prompt:pending:v1';

export async function markPermissionPromptPending(): Promise<void> {
  try { await AsyncStorage.setItem(PERMISSION_PROMPT_PENDING_KEY, '1'); } catch {}
}

export async function isPermissionPromptPending(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PERMISSION_PROMPT_PENDING_KEY)) === '1'; } catch { return false; }
}

export async function clearPermissionPromptPending(): Promise<void> {
  try { await AsyncStorage.removeItem(PERMISSION_PROMPT_PENDING_KEY); } catch {}
}

// PermissionPrompt v3 — actually requests the iOS notification permission
// when the user taps "Allow reminders" (was just navigating, which was
// misleading). "Not now" still skips without asking. Either path returns
// to the existing Home screen beneath the first-draw flow.
export function PermissionPromptScreen({ navigation }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleAllow() {
    if (busy) return;
    setBusy(true);
    let resultStatus: 'granted' | 'denied' | 'undetermined' | 'error' = 'undetermined';
    try {
      // Trigger the real iOS permission sheet. We don't gate the
      // navigation on the result — even if the user denies, they should
      // still complete onboarding and reach Home. But we DO acknowledge
      // the deny via a one-shot Home toast so the user doesn't feel the
      // tap was ignored.
      resultStatus = await safeRequestNotificationPermission();
    } finally {
      navigation.navigate('Home', {
        notice: resultStatus === 'denied' ? 'notifications-denied' : undefined,
      });
    }
  }

  function handleSkip() {
    if (busy) return;
    navigation.navigate('Home', {
      notice: 'notifications-skipped',
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.parchmentBg, colors.parchmentBgDeep]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>NOTIFICATIONS</Text>
          <Text style={styles.title}>Stay on streak with daily reminders</Text>
          <Text style={styles.body}>
            One reminder each morning, plus an optional evening check-in only when
            cards are still due. You can change both anytime in Settings &gt; Reminders.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={() => void handleAllow()}
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Asking…' : 'Allow reminders'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={handleSkip}
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default PermissionPromptScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 24, paddingTop: 36, paddingBottom: 32 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: { marginTop: 12, fontSize: 28, lineHeight: 34, fontWeight: '900', color: colors.ink },
  body: { marginTop: 12, fontSize: 14, lineHeight: 21, color: colors.inkSecondary, fontWeight: '600' },
  primaryButton: {
    marginTop: 28,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  secondaryButton: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: colors.inkSoft, fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  buttonDisabled: { opacity: 0.55 },
  pressed: { opacity: 0.92 },
});
