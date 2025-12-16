// mobile/src/screens/SettingsScreen.tsx

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import {
  checkManifestForUpdates,
  installDeckFromUrl,
} from '../content/deckRepository';
import {
  getCurrentAppVersion,
  fetchRemoteConfig,
  compareSemver,
  type RemoteConfig,
} from '../config/remoteConfig';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const SUPPORT_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Support-Help-2bfa758eb545809ead04d8f8321a40dc?pvs=74';

const PRIVACY_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74';

const REMOTE_CONFIG_URL =
  'https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json';

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function openExternalLink(url: string) {
  const safeUrl = normalizeUrl(url);
  try {
    const supported = await Linking.canOpenURL(safeUrl);
    if (!supported) {
      Alert.alert('Cannot open link', 'Please try again later.');
      return;
    }
    await Linking.openURL(safeUrl);
  } catch {
    Alert.alert('Error', 'Failed to open link. Please try again.');
  }
}

/**
 * Extract a plain semver like "1.2.3" from a version string.
 * Examples:
 *  - "1.1.0" -> "1.1.0"
 *  - "v1.1.0 (12)" -> "1.1.0"
 *  - "1.1.0+12" -> "1.1.0"
 */
function extractSemver(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

function safeSemverCompare(aRaw: string | null | undefined, bRaw: string | null | undefined): number | null {
  const a = extractSemver(aRaw);
  const b = extractSemver(bRaw);
  if (!a || !b) return null;
  return compareSemver(a, b);
}

export function SettingsScreen({ navigation }: Props) {
  const appVersionRaw = getCurrentAppVersion();

  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const [remoteConfig, setRemoteConfig] = useState<RemoteConfig | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  const iosCfg = remoteConfig?.ios ?? null;

  const latestStoreVersion = iosCfg?.latestVersion ?? iosCfg?.minSupportedVersion ?? null;
  const minSupportedVersion = iosCfg?.minSupportedVersion ?? null;

  const updateUrl =
    iosCfg?.updateUrl ??
    (iosCfg?.appStoreId ? `https://apps.apple.com/app/id${iosCfg.appStoreId}` : null);

  // ✅ Fix: only force update when current < min (NOT <=)
  const { forceUpdate, hasOptionalUpdate } = useMemo(() => {
    if (remoteStatus !== 'loaded' || !iosCfg) {
      return { forceUpdate: false, hasOptionalUpdate: false };
    }

    const cmpMin = safeSemverCompare(appVersionRaw, minSupportedVersion);
    const cmpLatest = safeSemverCompare(appVersionRaw, latestStoreVersion);

    const belowMin = cmpMin !== null && cmpMin < 0;
    const optional = !belowMin && cmpLatest !== null && cmpLatest < 0;

    return { forceUpdate: belowMin, hasOptionalUpdate: optional };
  }, [remoteStatus, iosCfg, appVersionRaw, minSupportedVersion, latestStoreVersion]);

  async function handleUpdateDecks() {
    if (updating) return;

    setUpdating(true);
    setUpdateMessage('Checking for updates…');

    try {
      const updates = await checkManifestForUpdates();
      const updatesToInstall = Object.entries(updates).flatMap(([slug, info]) => {
        if (!info.hasUpdate || !info.remoteUrl) return [];
        return [
          {
            slug,
            remoteUrl: info.remoteUrl,
            expectedVersion: info.remoteVersion,
            remoteSha256: info.remoteSha256,
          },
        ];
      });

      if (updatesToInstall.length === 0) {
        setUpdateMessage('All decks are up to date.');
        return;
      }

      let successCount = 0;
      for (const u of updatesToInstall) {
        try {
          const ok = await installDeckFromUrl(
            u.slug,
            u.remoteUrl,
            u.expectedVersion,
            u.remoteSha256
          );
          if (ok) successCount += 1;
        } catch {
          // ignore single failure; proceed with others
        }
      }

      if (successCount > 0) {
        setUpdateMessage(`Updated ${successCount} deck${successCount === 1 ? '' : 's'}.`);
      } else {
        setUpdateMessage('No updates were applied.');
      }
    } catch {
      setUpdateMessage('Update check failed. Please try again.');
    } finally {
      setUpdating(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;

    async function loadRemoteVersion() {
      setRemoteStatus('loading');
      try {
        const cfg = await fetchRemoteConfig(REMOTE_CONFIG_URL, 5000);
        if (cancelled) return;

        if (cfg?.ios) {
          setRemoteConfig(cfg);
          setRemoteStatus('loaded');
        } else {
          setRemoteConfig(null);
          setRemoteStatus('error');
        }
      } catch {
        if (cancelled) return;
        setRemoteConfig(null);
        setRemoteStatus('error');
      }
    }

    void loadRemoteVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  const latestDisplay =
    latestStoreVersion ?? (remoteStatus === 'loading' ? '…' : '—');
  const minDisplay =
    minSupportedVersion ?? (remoteStatus === 'loading' ? '…' : '—');

  const statusText =
    remoteStatus === 'loading'
      ? 'Fetching store info…'
      : remoteStatus === 'error'
      ? 'Unable to fetch store info.'
      : forceUpdate
      ? 'Below minimum required · please update to continue.'
      : hasOptionalUpdate
      ? 'Update available (optional).'
      : 'You are up to date.';

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.container}>
          {/* 顶部 header */}
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Settings</Text>
              <Text style={styles.subtitle}>
                Support, privacy and app information.
              </Text>
            </View>
          </View>

          {/* App 信息 + 更新（合并卡片） */}
          <View style={styles.appCard}>
            <Text style={styles.appName}>DevCards</Text>
            <Text style={styles.appTagline}>
              Full‑stack concept with spaced repetition.
            </Text>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Current app</Text>
              <Text style={styles.versionValue}>{extractSemver(appVersionRaw) ?? appVersionRaw}</Text>
            </View>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Latest (store)</Text>
              <Text style={styles.versionValue}>{latestDisplay}</Text>
            </View>

            <View style={styles.versionRow}>
              <Text style={styles.versionLabel}>Minimum required</Text>
              <Text style={styles.versionValue}>{minDisplay}</Text>
            </View>

            <View style={{ marginTop: 8 }}>
              <Text style={styles.updateStatusText}>{statusText}</Text>
            </View>

            {updateUrl ? (
              <Pressable
                style={({ pressed }) => [
                  styles.storeButton,
                  pressed && styles.storeButtonPressed,
                  forceUpdate && { backgroundColor: '#DC2626' },
                ]}
                onPress={() => openExternalLink(updateUrl)}
              >
                <Text style={styles.storeButtonText}>
                  {forceUpdate
                    ? 'Update now (required)'
                    : hasOptionalUpdate
                    ? 'Update on App Store'
                    : 'Open App Store'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Deck updates */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Deck updates</Text>
            <Text style={styles.sectionSubtitle}>
              The app checks for updates on launch. Tap below to force a refresh or
              install missing decks now.
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.updateButton,
                pressed && !updating && styles.updateButtonPressed,
                updating && styles.updateButtonDisabled,
              ]}
              onPress={handleUpdateDecks}
              disabled={updating}
            >
              <Text style={styles.updateButtonText}>
                {updating ? 'Checking…' : 'Check & update decks'}
              </Text>
            </Pressable>

            {updateMessage ? (
              <Text style={styles.updateStatus}>{updateMessage}</Text>
            ) : null}
          </View>

          {/* 链接卡片 */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Help & Legal</Text>
            <Text style={styles.sectionSubtitle}>
              These pages open in your browser so you can read them comfortably.
            </Text>

            <Pressable
              style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
              onPress={() => openExternalLink(SUPPORT_URL)}
            >
              <View>
                <Text style={styles.linkTitle}>Support & FAQ</Text>
                <Text style={styles.linkSubtitle}>
                  Common questions, troubleshooting and contact info.
                </Text>
              </View>
              <Text style={styles.linkChevron}>›</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
              onPress={() => openExternalLink(PRIVACY_URL)}
            >
              <View>
                <Text style={styles.linkTitle}>Privacy Policy</Text>
                <Text style={styles.linkSubtitle}>
                  How we handle your data and what we store.
                </Text>
              </View>
              <Text style={styles.linkChevron}>›</Text>
            </Pressable>
          </View>

          {/* 最底下小字 */}
          <View style={styles.footerBox}>
            <Text style={styles.footerText}>
              Made with focus for developers preparing full‑stack interviews.
            </Text>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default SettingsScreen;

const CARD_GLASS = 'rgba(255,255,255,0.18)';
const CARD_BORDER = 'rgba(255,255,255,0.55)';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F3FF',
  },
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backButtonPressed: {
    opacity: 0.9,
  },
  backText: {
    fontSize: 13,
    color: '#111827',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  appCard: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: CARD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 16,
  },
  appName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  appTagline: {
    marginTop: 4,
    fontSize: 13,
    color: '#4B5563',
  },
  versionRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  versionLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  versionValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
  },
  sectionCard: {
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 10,
  },
  updateButton: {
    marginTop: 6,
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  updateButtonPressed: { opacity: 0.9 },
  updateButtonDisabled: { opacity: 0.6 },
  updateButtonText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  updateStatus: { marginTop: 8, fontSize: 12, color: '#6B7280' },
  updateStatusText: { fontSize: 12, color: '#4B5563' },
  storeButton: {
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  storeButtonPressed: { opacity: 0.9 },
  storeButtonText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkRowPressed: {
    opacity: 0.9,
  },
  linkTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  linkSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  linkChevron: {
    marginLeft: 'auto',
    fontSize: 20,
    color: '#9CA3AF',
  },
  footerBox: {
    marginTop: 'auto',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});