// mobile/App.tsx
import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  AppState, // ✅ NEW: listen app foreground/background
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootStackParamList } from './src/navigation/types';
import HomeScreen from './src/screens/HomeScreen';
import DeckScreen from './src/screens/DeckScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import SettingsScreen from './src/screens/SettingsScreen';

// ✅ Auth
import { configureAmplifyOnce } from './src/auth/amplify';
import { useAuthStore } from './src/auth/authStore';

configureAmplifyOnce();

// ✅ NEW: Progress sync (flush on lifecycle)
import { scheduleProgressSync } from './src/sync/progressSync';
import PaywallScreen from './src/screens/PaywallScreen';
import {
  fetchRemoteConfig,
  getCurrentAppVersion,
  resolveIosUpdate,
  type RemoteConfig,
} from './src/config/remoteConfig';

import * as Notifications from 'expo-notifications';
import SignUpScreen from './src/screens/SignUpScreen';
import SignInScreen from './src/screens/SignInScreen';
import ConfirmSignUpScreen from './src/screens/ConfirmSignUpScreen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const REMOTE_CONFIG_URL =
  'https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json';

const Stack = createNativeStackNavigator<RootStackParamList>();

type GateState =
  | { status: 'checking' }
  | { status: 'ready' }
  | {
      status: 'forceUpdate';
      message: string;
      updateUrl: string | null;
      currentVersion: string;
      minSupportedVersion: string | null;
    };

function ForceUpdateScreen(props: {
  message: string;
  updateUrl: string | null;
  currentVersion: string;
  minSupportedVersion: string | null;
}) {
  async function openUpdate() {
    if (!props.updateUrl) return;
    await Linking.openURL(props.updateUrl);
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.updateCard}>
            <Text style={styles.updateTitle}>Update Required</Text>
            <Text style={styles.updateBody}>{props.message}</Text>

            <View style={{ height: 10 }} />
            <Text style={styles.updateMeta}>
              Current: {props.currentVersion}
              {props.minSupportedVersion ? ` · Required: ${props.minSupportedVersion}+` : ''}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.updateButton,
                pressed && { opacity: 0.9 },
                !props.updateUrl && { opacity: 0.6 },
              ]}
              disabled={!props.updateUrl}
              onPress={openUpdate}
            >
              <Text style={styles.updateButtonText}>
                {props.updateUrl ? 'Open App Store' : 'Update link not set'}
              </Text>
            </Pressable>

            {!props.updateUrl ? (
              <Text style={styles.updateHint}>(Set updateUrl or appStoreId in remote config JSON)</Text>
            ) : null}
          </View>
        </LinearGradient>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default function App() {
   useEffect(() => {
    void useAuthStore.getState().init();
  }, []);
  const [gate, setGate] = useState<GateState>({ status: 'checking' });


  /**
   * ✅ App lifecycle -> flush queue / refresh remote
   *
   * 面试讲法：
   * - 我们不是“每 2s 定时同步”（MIN_PULL_INTERVAL 只是 pull 防抖）
   * - 真正策略是：事件驱动 + 生命周期兜底
   *   - rating: debounce 一段时间后批量 push
   *   - app 进后台：尽量 flush 一次（避免用户锁屏导致很久才上云）
   *   - app 回前台：做一次 refresh（拿其他设备更新）
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        // ✅ flush pending queue ASAP
        scheduleProgressSync({ delayMs: 0, reason: 'app_background' });
      } else if (state === 'active') {
        // ✅ refresh when user comes back
        // NOTE: 如果你担心太频繁，可以改 delayMs: 500~1000
        scheduleProgressSync({ delayMs: 0, reason: 'app_foreground' });
      }
    });

    return () => sub.remove();
  }, []);

  // ✅ Gate: remote config force update
  useEffect(() => {
    let cancelled = false;

    async function check() {
      const currentVersion = getCurrentAppVersion();

      const config: RemoteConfig | null = await fetchRemoteConfig(REMOTE_CONFIG_URL);
      if (cancelled) return;

      if (!config) {
        // 远端失败：不阻塞用户（否则离线无法使用）
        setGate({ status: 'ready' });
        return;
      }

      const ios = resolveIosUpdate(config, currentVersion);
      if (ios.forceUpdate) {
        setGate({
          status: 'forceUpdate',
          message: ios.message,
          updateUrl: ios.updateUrl,
          currentVersion,
          minSupportedVersion: ios.minSupportedVersion,
        });
        return;
      }

      setGate({ status: 'ready' });
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.status === 'checking') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.checking}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.checkingText}>Checking for updates...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (gate.status === 'forceUpdate') {
    return (
      <ForceUpdateScreen
        message={gate.message}
        updateUrl={gate.updateUrl}
        currentVersion={gate.currentVersion}
        minSupportedVersion={gate.minSupportedVersion}
      />
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Paywall" component={PaywallScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Deck" component={DeckScreen} />
        <Stack.Screen name="Review" component={ReviewScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="SignIn" component={SignInScreen} />
        <Stack.Screen name="SignUp" component={SignUpScreen} />
        <Stack.Screen name="ConfirmSignUp" component={ConfirmSignUpScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  checking: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  checkingText: { marginTop: 10, color: '#6B7280' },

  updateCard: {
    marginTop: 120,
    marginHorizontal: 18,
    borderRadius: 22,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  updateTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  updateBody: { marginTop: 8, fontSize: 13, color: '#374151', lineHeight: 18 },
  updateMeta: { fontSize: 12, color: '#6B7280' },
  updateButton: {
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  updateButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  updateHint: { marginTop: 8, fontSize: 12, color: '#6B7280' },
});