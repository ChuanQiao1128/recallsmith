import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { resetAllProgress } from '../features/debug/resetProgress';

type Props = NativeStackScreenProps<RootStackParamList, 'DebugMenu'>;
const scenarios = [
  { title: 'New user', subtitle: 'Home first-draw coach state' },
  { title: 'Day 7 active', subtitle: 'Standard active route' },
  { title: 'Day 15 dual-pool', subtitle: 'Pool launch visible' },
  { title: 'Backlog heavy', subtitle: 'Backlog + burst recovery' },
  { title: 'Dormant returnee', subtitle: 'Fresh re-entry + restart options' },
  { title: 'Paused pool', subtitle: 'Pool excluded from active route' },
  { title: 'Churned reset', subtitle: 'Fresh-start-first home state' },
];

export function DebugMenuScreen({ navigation }: Props) {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function performReset(resetOnboarding: boolean) {
    setBusy(true);
    try {
      const result = await resetAllProgress({ resetOnboarding });
      setLastResult(
        `Cleared ${result.removedKeyCount} key${result.removedKeyCount === 1 ? '' : 's'}` +
          (resetOnboarding ? ' (incl. onboarding).' : '.'),
      );
      Alert.alert(
        'Progress reset',
        `Removed ${result.removedKeyCount} storage key${result.removedKeyCount === 1 ? '' : 's'}. Restart the app to see fresh state.`,
      );
    } catch (e: any) {
      setLastResult(`Reset failed: ${e?.message ?? String(e)}`);
      Alert.alert('Reset failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (busy) return;
    Alert.alert(
      'Reset progress?',
      'Choose how much to wipe.\n\n• Progress only: owned cards, deck progress, daily stats, wallet, streaks. Onboarding + active deck are preserved.\n\n• Everything: also wipes onboarding stage + audience preference + active deck — true fresh-install simulation.\n\nAuth + premium are preserved either way.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Progress only',
          onPress: () => void performReset(false),
        },
        {
          text: 'Everything',
          style: 'destructive',
          onPress: () => void performReset(true),
        },
      ],
    );
  }

  return (
    <AppInfoScreen
      eyebrow="Debug menu"
      title="Scenario switching and QA shortcuts"
      body="DebugMenu keeps its QA function but now carries more of the premium cosmic control-room feeling used by support and system surfaces."
      cosmic
      chips={['QA', 'Scenarios']}
      stats={[
        { label: 'Scenarios', value: String(scenarios.length) },
      ]}
      sections={[{ title: 'Scenarios', items: scenarios }]}
      primaryLabel="Open error shell"
      onPrimary={() => navigation.navigate('ErrorGeneric')}
      secondaryLabel="Offline banner"
      onSecondary={() => navigation.navigate('OfflineBanner')}
      tertiaryLabel="Back to more"
      onTertiary={() => navigation.navigate('More')}
      footer={
        <View style={styles.dangerZone}>
          <Text style={styles.dangerEyebrow} numberOfLines={1}>
            DANGER ZONE
          </Text>
          <Text style={styles.dangerBody} numberOfLines={3}>
            Wipes owned cards, deck progress, daily stats, reward wallet, pity
            counters, and streak history. Useful for retesting a fresh install
            without resetting auth or premium.
          </Text>
          <Pressable
            testID="debug-reset-progress"
            accessibilityRole="button"
            accessibilityLabel="Reset all progress"
            disabled={busy}
            style={({ pressed }) => [
              styles.dangerButton,
              busy && styles.dangerButtonDisabled,
              pressed && styles.dangerButtonPressed,
            ]}
            onPress={() => void handleReset()}
          >
            <Text style={styles.dangerButtonText}>
              {busy ? 'Resetting…' : 'Reset all progress'}
            </Text>
          </Pressable>
          {lastResult ? (
            <Text style={styles.dangerResult} numberOfLines={2}>
              {lastResult}
            </Text>
          ) : null}
        </View>
      }
    />
  );
}

export default DebugMenuScreen;

const styles = StyleSheet.create({
  dangerZone: {
    marginTop: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(170,54,54,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(170,54,54,0.30)',
  },
  dangerEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: '#D75A5A',
    textTransform: 'uppercase',
  },
  dangerBody: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(245,236,196,0.85)',
    fontWeight: '600',
  },
  dangerButton: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: '#AA3636',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    shadowColor: 'rgba(170,54,54,0.55)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  dangerButtonDisabled: { opacity: 0.55 },
  dangerButtonPressed: { opacity: 0.85 },
  dangerResult: {
    marginTop: 10,
    fontSize: 11,
    color: 'rgba(245,236,196,0.75)',
    fontWeight: '600',
  },
});
