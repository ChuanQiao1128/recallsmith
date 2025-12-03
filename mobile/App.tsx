// mobile/App.tsx
import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './src/navigation/types';
import HomeScreen from './src/screens/HomeScreen';
import DeckScreen from './src/screens/DeckScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const REMOTE_CONFIG_URL =
  'https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json';

type RemoteConfig = {
  minimumSupportedVersion: string;
  latestVersion: string;
  iosUpdateUrl?: string;
  message?: string;
};

type GateState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'blocked'; config: RemoteConfig; currentVersion: string };

const REMOTE_CONFIG_CACHE_KEY = '@rs_remote_config_cache_v1';
const LAST_PROMPT_VERSION_KEY = '@rs_last_prompt_latest_version_v1';

const DEFAULT_CONFIG: RemoteConfig = {
  minimumSupportedVersion: '0.0.0',
  latestVersion: '0.0.0',
  iosUpdateUrl: undefined,
  message: undefined,
};

function getAppVersion(): string {
  // Expo: version 通常在 app.json / app.config.js
  const v =
    Constants.expoConfig?.version ??
    (Constants.expoConfig as any)?.runtimeVersion ??
    '0.0.0';
  return typeof v === 'string' ? v : '0.0.0';
}

function parseSemver(v: string): [number, number, number] {
  const clean = v.trim().replace(/^v/i, '');
  const parts = clean.split('.').map(x => Number(x));
  const a = Number.isFinite(parts[0]) ? parts[0] : 0;
  const b = Number.isFinite(parts[1]) ? parts[1] : 0;
  const c = Number.isFinite(parts[2]) ? parts[2] : 0;
  return [a, b, c];
}

function compareSemver(a: string, b: string): number {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  return 0;
}

async function fetchRemoteConfig(url: string, timeoutMs = 3500): Promise<RemoteConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const json = (await res.json()) as Partial<RemoteConfig>;

    if (
      !json ||
      typeof json.minimumSupportedVersion !== 'string' ||
      typeof json.latestVersion !== 'string'
    ) {
      return null;
    }

    return {
      minimumSupportedVersion: json.minimumSupportedVersion,
      latestVersion: json.latestVersion,
      iosUpdateUrl: typeof json.iosUpdateUrl === 'string' ? json.iosUpdateUrl : undefined,
      message: typeof json.message === 'string' ? json.message : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadCachedConfig(): Promise<RemoteConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(REMOTE_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemoteConfig;
    if (
      parsed &&
      typeof parsed.minimumSupportedVersion === 'string' &&
      typeof parsed.latestVersion === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheConfig(cfg: RemoteConfig) {
  try {
    await AsyncStorage.setItem(REMOTE_CONFIG_CACHE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

function UpdateRequiredScreen({
  message,
  onUpdate,
}: {
  message: string;
  onUpdate: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.blockContainer}>
          <View style={styles.blockCard}>
            <Text style={styles.blockTitle}>Update Required</Text>
            <Text style={styles.blockBody}>{message}</Text>

            <Pressable
              style={({ pressed }) => [
                styles.blockButton,
                pressed && styles.blockButtonPressed,
              ]}
              onPress={onUpdate}
            >
              <Text style={styles.blockButtonText}>Open App Store</Text>
            </Pressable>

            <Text style={styles.blockHint}>
              To keep your data and reviews safe, this version is no longer supported.
            </Text>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [gate, setGate] = useState<GateState>({ status: 'checking' });

  const currentVersion = useMemo(() => getAppVersion(), []);

  useEffect(() => {
    let cancelled = false;

    async function checkConfig() {
      // 1) remote first
      const remote = await fetchRemoteConfig(REMOTE_CONFIG_URL);
      if (cancelled) return;

      // 2) cache fallback
      const cached = await loadCachedConfig();
      if (cancelled) return;

      const config = remote ?? cached ?? DEFAULT_CONFIG;

      if (remote) {
        cacheConfig(remote);
      }

      const mustUpdate =
        compareSemver(currentVersion, config.minimumSupportedVersion) < 0;

      if (mustUpdate) {
        setGate({ status: 'blocked', config, currentVersion });
        return;
      }

      // optional update prompt (once per latestVersion)
      const hasNewer =
        compareSemver(currentVersion, config.latestVersion) < 0;

      if (hasNewer) {
        try {
          const lastPrompt = await AsyncStorage.getItem(LAST_PROMPT_VERSION_KEY);
          if (!lastPrompt || lastPrompt !== config.latestVersion) {
            Alert.alert(
              'Update available',
              `A newer version (${config.latestVersion}) is available.`,
              [
                { text: 'Later', style: 'cancel' },
                {
                  text: 'Update',
                  onPress: () => {
                    const url = config.iosUpdateUrl;
                    if (url) Linking.openURL(url);
                  },
                },
              ],
            );
            await AsyncStorage.setItem(LAST_PROMPT_VERSION_KEY, config.latestVersion);
          }
        } catch {
          // ignore
        }
      }

      setGate({ status: 'ready' });
    }

    checkConfig();

    return () => {
      cancelled = true;
    };
  }, [currentVersion]);

  if (gate.status === 'checking') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.loadingCenter}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.loadingText}>Starting RecallSmith…</Text>
            <Text style={styles.loadingSubText}>Checking updates & preparing your deck.</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (gate.status === 'blocked') {
    const msg =
      gate.config.message ??
      `Please update to continue. (Current: ${gate.currentVersion}, Required: ${gate.config.minimumSupportedVersion})`;

    const url =
      Platform.OS === 'ios'
        ? gate.config.iosUpdateUrl
        : undefined;

    return (
      <UpdateRequiredScreen
        message={msg}
        onUpdate={() => {
          if (url) {
            Linking.openURL(url);
          } else {
            Alert.alert(
              'Update link not ready',
              'The App Store link is not configured yet in remote config.',
            );
          }
        }}
      />
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false, // ✅ boolean
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Deck" component={DeckScreen} />
        <Stack.Screen name="Review" component={ReviewScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },

  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  loadingText: { marginTop: 12, fontSize: 14, color: '#111827', fontWeight: '600' },
  loadingSubText: { marginTop: 6, fontSize: 12, color: '#6B7280', textAlign: 'center' },

  blockContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  blockCard: {
    width: '100%',
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  blockTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  blockBody: { marginTop: 8, fontSize: 13, color: '#374151', lineHeight: 18 },
  blockButton: {
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  blockButtonPressed: { opacity: 0.92 },
  blockButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  blockHint: { marginTop: 10, fontSize: 11, color: '#6B7280' },
});