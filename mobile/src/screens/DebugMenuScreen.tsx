import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { resetAllProgress } from '../features/debug/resetProgress';
import { saveRewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { loadDrawState, saveDrawState } from '../features/gacha/draw/drawStateStore';
import { rarityOfCard } from '../features/gacha/draw/cardRarity';
import { getCeremonyDevOverrides, setCeremonyDevOverride } from '../features/gacha/draw/ceremonyPrefs';

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
  const [devOverrides, setDevOverrides] = useState(() => getCeremonyDevOverrides());

  async function handleSeedWallet() {
    if (busy) return;
    setBusy(true);
    try {
      await saveRewardWalletState({ availablePulls: 30, reservePulls: 5 });
      setLastResult('Wallet seeded 30/5.');
    } catch (e: any) {
      setLastResult(`Seed failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleOnlyLegendary() {
    if (busy) return;
    setBusy(true);
    try {
      const { loadActiveDeckSlug } = await import('../content/activeDeck');
      const { resolveDeckBySlug } = await import('../content/deckRepository');
      const slug = await loadActiveDeckSlug();
      if (!slug) {
        setLastResult('No active deck.');
        return;
      }
      const deck = await resolveDeckBySlug(slug);
      const cards = deck?.Cards ?? [];
      if (cards.length === 0) {
        setLastResult(`Deck ${slug} is not installed.`);
        return;
      }
      const current = await loadDrawState(slug);
      const owned = new Set(current.owned);
      let added = 0;
      for (const card of cards) {
        if (rarityOfCard(card) !== 'LEG' && !owned.has(card.StableUid)) {
          owned.add(card.StableUid);
          added += 1;
        }
      }
      await saveDrawState(slug, { owned: [...owned], pity: current.pity });
      const legendaryLeft = cards.filter((card) => rarityOfCard(card) === 'LEG' && !owned.has(card.StableUid)).length;
      setLastResult(`Owned +${added} non-Legendary in ${slug}; ${legendaryLeft} Legendary left.`);
    } catch (e: any) {
      setLastResult(`Seed failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(key: 'forceFallback' | 'forceRepeat') {
    setCeremonyDevOverride(key, !devOverrides[key]);
    setDevOverrides(getCeremonyDevOverrides());
  }

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
        <>
        {__DEV__ ? (
          <View style={styles.ceremonyTools} testID="debug-ceremony-tools">
            <Text style={styles.ceremonyEyebrow} numberOfLines={1}>
              CEREMONY
            </Text>
            <Pressable
              testID="debug-seed-wallet"
              accessibilityRole="button"
              accessibilityLabel="Seed wallet 30/5"
              disabled={busy}
              style={({ pressed }) => [styles.ceremonyButton, busy && styles.dangerButtonDisabled, pressed && styles.dangerButtonPressed]}
              onPress={() => void handleSeedWallet()}
            >
              <Text style={styles.ceremonyButtonText}>Seed wallet 30/5</Text>
            </Pressable>
            <Pressable
              testID="debug-only-legendary"
              accessibilityRole="button"
              accessibilityLabel="Only Legendary left"
              disabled={busy}
              style={({ pressed }) => [styles.ceremonyButton, busy && styles.dangerButtonDisabled, pressed && styles.dangerButtonPressed]}
              onPress={() => void handleOnlyLegendary()}
            >
              <Text style={styles.ceremonyButtonText}>Only Legendary left</Text>
            </Pressable>
            <Pressable
              testID="debug-force-fallback"
              accessibilityRole="button"
              accessibilityState={{ checked: devOverrides.forceFallback }}
              style={({ pressed }) => [styles.ceremonyButton, pressed && styles.dangerButtonPressed]}
              onPress={() => handleToggle('forceFallback')}
            >
              <Text style={styles.ceremonyButtonText}>{`Force fallback renderer: ${devOverrides.forceFallback ? 'ON' : 'OFF'}`}</Text>
            </Pressable>
            <Pressable
              testID="debug-force-repeat"
              accessibilityRole="button"
              accessibilityState={{ checked: devOverrides.forceRepeat }}
              style={({ pressed }) => [styles.ceremonyButton, pressed && styles.dangerButtonPressed]}
              onPress={() => handleToggle('forceRepeat')}
            >
              <Text style={styles.ceremonyButtonText}>{`Force repeat ceremony: ${devOverrides.forceRepeat ? 'ON' : 'OFF'}`}</Text>
            </Pressable>
            <Pressable
              testID="debug-ceremony-tuning"
              accessibilityRole="button"
              accessibilityLabel="Open ceremony tuning"
              style={({ pressed }) => [styles.ceremonyButton, pressed && styles.dangerButtonPressed]}
              onPress={() => navigation.navigate('CeremonyTuning')}
            >
              <Text style={styles.ceremonyButtonText}>Ceremony tuning</Text>
            </Pressable>
          </View>
        ) : null}
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
        </>
      }
    />
  );
}

export default DebugMenuScreen;

const styles = StyleSheet.create({
  ceremonyTools: {
    marginTop: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(245,236,196,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.22)',
  },
  ceremonyEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: 'rgba(245,236,196,0.85)',
    textTransform: 'uppercase',
  },
  ceremonyButton: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'rgba(245,236,196,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  ceremonyButtonText: {
    color: '#F5ECC4',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
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
