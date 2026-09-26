import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import AppInfoScreen from '../components/AppInfoScreen';
import { resetAllProgress } from '../features/debug/resetProgress';
import { saveRewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { loadDrawState, saveDrawState } from '../features/gacha/draw/drawStateStore';
import { rarityOfCard } from '../features/gacha/draw/cardRarity';
import { getCeremonyDevOverrides, setCeremonyDevOverride } from '../features/gacha/draw/ceremonyPrefs';
import {
  CEREMONY_PERF_HISTORY_LIMIT,
  formatCeremonyPerfReport,
  loadCeremonyPerfHistory,
  loadLastCeremonyPerfReport,
  type CeremonyPerfReport,
} from '../features/gacha/draw/ceremonyPerf';

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

/** Outside __DEV__ (the 7-tap door from Settings) every wallet / seed action asks once more. */
export function confirmDevOnly(action: () => void, isDev: boolean = __DEV__): void {
  if (isDev) {
    action();
    return;
  }
  Alert.alert(
    'Dev only',
    'This changes wallet or ownership data on this device. Continue?',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', style: 'destructive', onPress: action },
    ],
  );
}

export function DebugMenuScreen({ navigation }: Props) {
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [devOverrides, setDevOverrides] = useState(() => getCeremonyDevOverrides());
  const [perfReport, setPerfReport] = useState<CeremonyPerfReport | null>(null);
  const [perfHistory, setPerfHistory] = useState<CeremonyPerfReport[]>([]);
  const [perfLoaded, setPerfLoaded] = useState(false);
  const [perfJsonVisible, setPerfJsonVisible] = useState(false);

  const reloadPerf = useCallback(async () => {
    let report: CeremonyPerfReport | null = null;
    let history: CeremonyPerfReport[] = [];
    try {
      report = await loadLastCeremonyPerfReport();
    } catch {
      report = null;
    }
    try {
      history = await loadCeremonyPerfHistory();
    } catch {
      history = [];
    }
    return { report, history };
  }, []);

  useEffect(() => {
    let mounted = true;
    void reloadPerf().then(({ report, history }) => {
      if (!mounted) return;
      setPerfReport(report);
      setPerfHistory(history);
      setPerfLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [reloadPerf]);

  async function handleSeedWallet() {
    if (busy) return;
    setBusy(true);
    try {
      await saveRewardWalletState({ availablePulls: 60, reservePulls: 5 });
      setLastResult('Wallet seeded 60/5.');
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

  // Read __DEV__ at render (tests flip the global between cases). In
  // production the 7-tap door still opens this screen, but it is read-only:
  // only the ceremony performance report remains. The mock scenario list, the
  // dev error/offline shells and the progress-wiping DANGER ZONE are __DEV__
  // only so an App Reviewer or curious user cannot reach them.
  const isDev = __DEV__;

  return (
    <AppInfoScreen
      eyebrow="Debug menu"
      title={isDev ? 'Scenario switching and QA shortcuts' : 'Diagnostics'}
      body={
        isDev
          ? 'DebugMenu keeps its QA function but now carries more of the premium cosmic control-room feeling used by support and system surfaces.'
          : 'Performance details you can share with support. Nothing here changes your progress.'
      }
      cosmic
      chips={isDev ? ['QA', 'Scenarios'] : undefined}
      stats={isDev ? [{ label: 'Scenarios', value: String(scenarios.length) }] : undefined}
      sections={isDev ? [{ title: 'Scenarios', items: scenarios }] : undefined}
      tertiaryLabel="Back to more"
      onTertiary={() => navigation.navigate('More')}
      footer={
        <>
        <View style={styles.perfCard} testID="debug-ceremony-perf">
          <Text style={styles.ceremonyEyebrow} numberOfLines={1}>
            LAST CEREMONY REPORT
          </Text>
          {perfReport ? (
            formatCeremonyPerfReport(perfReport).map((line, i) => (
              <Text key={i} style={styles.perfLine} testID={`debug-ceremony-perf-line-${i}`}>
                {line}
              </Text>
            ))
          ) : (
            <Text style={styles.perfLine} testID="debug-ceremony-perf-empty">
              {perfLoaded ? 'No ceremony recorded on this device yet. Open a pack, then come back.' : 'Loading…'}
            </Text>
          )}
          {perfHistory.length > 0 ? (
            <Text style={styles.perfLine} testID="debug-ceremony-perf-history-count">
              {`Keeping the last ${perfHistory.length} of ${CEREMONY_PERF_HISTORY_LIMIT} reports`}
            </Text>
          ) : null}
          <View style={styles.perfRow}>
            <Pressable
              testID="debug-ceremony-perf-reload"
              accessibilityRole="button"
              accessibilityLabel="Reload ceremony report"
              style={({ pressed }) => [styles.ceremonyButton, styles.perfButton, pressed && styles.dangerButtonPressed]}
              onPress={() => {
                void reloadPerf().then(({ report, history }) => {
                  setPerfReport(report);
                  setPerfHistory(history);
                  setPerfLoaded(true);
                });
              }}
            >
              <Text style={styles.ceremonyButtonText}>Reload</Text>
            </Pressable>
            {perfReport ? (
              <Pressable
                testID="debug-ceremony-perf-json"
                accessibilityRole="button"
                accessibilityLabel={perfJsonVisible ? 'Hide report JSON' : 'Show report JSON'}
                style={({ pressed }) => [styles.ceremonyButton, styles.perfButton, pressed && styles.dangerButtonPressed]}
                onPress={() => setPerfJsonVisible((v) => !v)}
              >
                <Text style={styles.ceremonyButtonText}>{perfJsonVisible ? 'Hide JSON' : 'Show JSON'}</Text>
              </Pressable>
            ) : null}
          </View>
          {perfReport && perfJsonVisible ? (
            <Text style={styles.perfJson} selectable testID="debug-ceremony-perf-json-body">
              {JSON.stringify(perfReport, null, 1)}
            </Text>
          ) : null}
          {perfJsonVisible && perfHistory.length > 1 ? (
            <Text style={styles.perfJson} selectable testID="debug-ceremony-perf-history-json">
              {JSON.stringify(perfHistory, null, 1)}
            </Text>
          ) : null}
        </View>
        {__DEV__ ? (
          <View style={styles.ceremonyTools} testID="debug-ceremony-tools">
            <Text style={styles.ceremonyEyebrow} numberOfLines={1}>
              CEREMONY
            </Text>
            <Pressable
              testID="debug-seed-wallet"
              accessibilityRole="button"
              accessibilityLabel="Seed wallet 60/5"
              disabled={busy}
              style={({ pressed }) => [styles.ceremonyButton, busy && styles.dangerButtonDisabled, pressed && styles.dangerButtonPressed]}
              onPress={() => confirmDevOnly(() => void handleSeedWallet())}
            >
              <Text style={styles.ceremonyButtonText}>Seed wallet 60/5</Text>
            </Pressable>
            <Pressable
              testID="debug-only-legendary"
              accessibilityRole="button"
              accessibilityLabel="Only Legendary left"
              disabled={busy}
              style={({ pressed }) => [styles.ceremonyButton, busy && styles.dangerButtonDisabled, pressed && styles.dangerButtonPressed]}
              onPress={() => confirmDevOnly(() => void handleOnlyLegendary())}
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
        {isDev ? (
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
        ) : null}
        </>
      }
    />
  );
}

export default DebugMenuScreen;

const styles = StyleSheet.create({
  perfCard: {
    marginTop: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(120,180,245,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(120,180,245,0.28)',
  },
  perfLine: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(245,236,196,0.9)',
    fontWeight: '600',
  },
  perfRow: { flexDirection: 'row', columnGap: 10 },
  perfButton: { flex: 1 },
  perfJson: {
    marginTop: 10,
    fontSize: 10,
    lineHeight: 13,
    color: 'rgba(245,236,196,0.75)',
  },
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
