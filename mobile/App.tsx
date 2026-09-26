import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';

import type { RootStackParamList } from './src/navigation/types';
import { linking } from './src/navigation/linking';
import BottomTabBar from './src/components/BottomTabBar';
import { RootErrorBoundary } from './src/components/RootErrorBoundary';
import { ScreenErrorBoundary } from './src/components/ScreenErrorBoundary';
import { getMainTabForRouteName, shouldShowMainTabBar } from './src/navigation/mainTabs';
import { navigateToTab } from './src/navigation/tabNavigation';
import SplashScreen from './src/screens/SplashScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import AudienceSurveyScreen from './src/screens/AudienceSurveyScreen';
import PermissionPromptScreen from './src/screens/PermissionPromptScreen';
import HomeScreen from './src/screens/HomeScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import CardDetailScreen from './src/screens/CardDetailScreen';
import MoreScreen from './src/screens/MoreScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import HelpFAQScreen from './src/screens/HelpFAQScreen';
import DebugMenuScreen from './src/screens/DebugMenuScreen';
import CeremonyTuningScreen from './src/screens/dev/CeremonyTuning';
import DrawCeremonyScreen from './src/screens/DrawCeremonyScreen';
import DrawResultScreen from './src/screens/DrawResultScreen';
import SessionCardScreen from './src/screens/SessionCardScreen';
import DrawScreen from './src/screens/DrawScreen';
import SessionSummaryScreen from './src/screens/SessionSummaryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import SignInScreen from './src/screens/SignInScreen';
import ConfirmSignUpScreen from './src/screens/ConfirmSignUpScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';

import { configureAmplifyOnce } from './src/auth/amplify';
import { useAuthStore } from './src/auth/authStore';
import { installAccessTokenRefresher, refreshAuthOnForeground } from './src/auth/freshToken';
import { scheduleProgressSync } from './src/sync/progressSync';
import { useForceUpdateGate, type ForceUpdateGate } from './src/config/forceUpdateGate';
import { DEFAULT_APP_STORE_URL } from './src/config/remoteConfig';
import { seedStarterPullsIfNeeded } from './src/features/gacha/rewards/rewardWallet';
import { loadFeedbackPrefs } from './src/features/gacha/settings/feedbackPrefs';
import { createOtaUpdateChecker, getExpoUpdatesModule } from './src/updates/otaUpdateCheck';
import { collectDeviceInfo } from './src/features/gacha/draw/ceremonyPerf';
import {
  configureClientErrorReporting,
  installGlobalErrorHandlers,
} from './src/telemetry/clientErrorReporter';

configureAmplifyOnce();
installAccessTokenRefresher();
const otaUpdateChecker = createOtaUpdateChecker({ updates: getExpoUpdatesModule() });

if (__DEV__) {
  // Reanimated 4 needs react-native-worklets/plugin (applied by babel-preset-expo when the package is
  // installed). `_WORKLET` is only true on the UI runtime; on the JS runtime a workletized function
  // carries `__workletHash`. No hash = the plugin did not run and ceremony motion will fall back.
  const workletProbe = () => {
    'worklet';
    return (globalThis as { _WORKLET?: boolean })._WORKLET === true;
  };
  if (typeof (workletProbe as unknown as { __workletHash?: number }).__workletHash !== 'number') {
    console.warn('[recallsmith] react-native-worklets babel plugin is not active');
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json';
const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Interim client error reporting (MSHELL-02 / MSHELL-12). The reporter imports
// nothing at runtime; the token, device info and current screen are injected
// here. `installGlobalErrorHandlers` chains RN's previous ErrorUtils handler and
// (in production only) enables the Hermes unhandled-rejection tracker.
configureClientErrorReporting({
  getAccessToken: () => useAuthStore.getState().accessToken,
  getEnv: () => {
    const d = collectDeviceInfo();
    return { appVersion: d.appVersion, updateId: d.updateId, platform: d.platform };
  },
  getCurrentScreen: () =>
    navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name ?? null : null,
});
installGlobalErrorHandlers();

// Recovery target for a per-screen error boundary's "Back to Home".
function goHomeAfterScreenError() {
  if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
}

/**
 * Opaque, absolutely-positioned, and mounted last so it sits above the whole
 * shell. It replaced a `return <ForceUpdateScreen/>` early-exit: that shape
 * forced the app to know whether it was gated *before* it could render
 * anything at all, which is where the cold-start block came from. An overlay
 * blocks just as completely (it covers the screen and swallows the touches)
 * but the decision can arrive late.
 */
function ForceUpdateOverlay(props: ForceUpdateGate) {
  async function openUpdate() {
    await Linking.openURL(props.updateUrl ?? DEFAULT_APP_STORE_URL);
  }

  return (
    <View style={styles.updateOverlay} accessibilityViewIsModal>
      <LinearGradient colors={['#F5F3FF', '#E0F2FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <View style={styles.updateCard}>
          <Text style={styles.updateTitle}>Update Required</Text>
          <Text style={styles.updateBody}>{props.message}</Text>
          <View style={{ height: 10 }} />
          <Text style={styles.updateMeta}>
            Current: {props.currentVersion}
            {props.minSupportedVersion ? ` · Required: ${props.minSupportedVersion}+` : ''}
          </Text>
          <Pressable style={({ pressed }) => [styles.updateButton, pressed && { opacity: 0.9 }]} onPress={openUpdate}>
            <Text style={styles.updateButtonText}>Open App Store</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

export default function App() {
  const forceUpdate = useForceUpdateGate(REMOTE_CONFIG_URL);
  const [currentRouteName, setCurrentRouteName] = useState<keyof RootStackParamList | undefined>(undefined);

  useEffect(() => {
    void useAuthStore.getState().init();
    // Seed the brand-new-user starter wallet on first boot. Idempotent
    // (guarded by its own AsyncStorage flag), so safe to fire on every
    // launch — pre-existing users with non-empty wallets are skipped,
    // and we never re-grant after a user has spent their pulls.
    void seedStarterPullsIfNeeded();
    // Load the device-global sound/haptics choice early so the ceremony audio,
    // ceremony haptics and study haptics see the stored value on first use.
    void loadFeedbackPrefs();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') scheduleProgressSync({ delayMs: 0, reason: 'app_background' });
      else if (state === 'active') {
        void refreshAuthOnForeground();
        scheduleProgressSync({ delayMs: 0, reason: 'app_foreground' });
        void otaUpdateChecker.onForeground(() => (navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined));
      }
    });
    return () => sub.remove();
  }, []);

  const activeMainTab = getMainTabForRouteName(currentRouteName);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RootErrorBoundary>
        <View style={styles.appShell}>
      <View style={styles.navigatorShell}>
        <NavigationContainer
          ref={navigationRef}
          linking={linking}
          onReady={() => setCurrentRouteName(navigationRef.getCurrentRoute()?.name as keyof RootStackParamList | undefined)}
          onStateChange={() => setCurrentRouteName(navigationRef.getCurrentRoute()?.name as keyof RootStackParamList | undefined)}
        >
          <Stack.Navigator
            initialRouteName="Splash"
            screenOptions={{ headerShown: false }}
            screenLayout={({ children, route }) => (
              <ScreenErrorBoundary screen={route.name} onGoHome={goHomeAfterScreenError}>
                {children}
              </ScreenErrorBoundary>
            )}
          >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="AudienceSurvey" component={AudienceSurveyScreen} />
        <Stack.Screen name="PermissionPrompt" component={PermissionPromptScreen} />
        <Stack.Screen name="Paywall" component={PaywallScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Library" component={LibraryScreen} />
        <Stack.Screen name="CardDetail" component={CardDetailScreen} />
        <Stack.Screen name="More" component={MoreScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="HelpFAQ" component={HelpFAQScreen} />
        <Stack.Screen name="DebugMenu" component={DebugMenuScreen} />
        {__DEV__ ? <Stack.Screen name="CeremonyTuning" component={CeremonyTuningScreen} /> : null}
        {/* Draw flow uses cross-fade transitions so the pack art continuity
            from Draw → Ceremony → Result feels like a single moment. */}
        <Stack.Screen
          name="DrawCeremony"
          component={DrawCeremonyScreen}
          options={{ animation: 'fade', animationDuration: 320, gestureEnabled: false }}
        />
        <Stack.Screen
          name="DrawResult"
          component={DrawResultScreen}
          options={{ animation: 'fade', animationDuration: 280, gestureEnabled: false }}
        />
        <Stack.Screen name="SessionCard" component={SessionCardScreen} />
        <Stack.Screen
          name="Draw"
          component={DrawScreen}
          options={{ animation: 'fade_from_bottom', animationDuration: 240 }}
        />
        <Stack.Screen name="SessionSummary" component={SessionSummaryScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="SignIn" component={SignInScreen} />
        <Stack.Screen name="SignUp" component={SignUpScreen} />
        <Stack.Screen name="ConfirmSignUp" component={ConfirmSignUpScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </View>

      {activeMainTab && shouldShowMainTabBar(currentRouteName) ? (
        <SafeAreaView style={styles.mainTabSafeArea} edges={['bottom']}>
          <View style={styles.mainTabBarShell}>
          <BottomTabBar
            active={activeMainTab}
            navigate={(name, params) => {
              if (!navigationRef.isReady()) return;
              navigateToTab(navigationRef, name, params);
            }}
          />
          </View>
        </SafeAreaView>
      ) : null}

      {forceUpdate ? <ForceUpdateOverlay {...forceUpdate} /> : null}
        </View>
      </RootErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  appShell: { flex: 1, backgroundColor: '#F5F3FF' },
  navigatorShell: { flex: 1 },
  mainTabSafeArea: {
    backgroundColor: '#F5F3FF',
  },
  mainTabBarShell: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#F5F3FF',
  },
  gradient: { flex: 1 },
  updateOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Opaque, so the app underneath is neither visible nor tappable.
    backgroundColor: '#F5F3FF',
    zIndex: 100,
    elevation: 100,
  },
  updateCard: {
    marginTop: 120,
    marginHorizontal: 18,
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  updateTitle: { fontSize: 22, fontWeight: '900', color: '#111827' },
  updateBody: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#4B5563' },
  updateMeta: { fontSize: 12, color: '#6B7280' },
  updateButton: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    alignItems: 'center',
  },
  updateButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});