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
import BottomTabBar from './src/components/BottomTabBar';
import { RootErrorBoundary } from './src/components/RootErrorBoundary';
import { getMainTabForRouteName } from './src/navigation/mainTabs';
import SplashScreen from './src/screens/SplashScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import AudienceSurveyScreen from './src/screens/AudienceSurveyScreen';
import PermissionPromptScreen from './src/screens/PermissionPromptScreen';
import HomeScreen from './src/screens/HomeScreen';
import DailyDoseScreen from './src/screens/DailyDoseScreen';
import WeekSummaryScreen from './src/screens/WeekSummaryScreen';
import MonthSummaryScreen from './src/screens/MonthSummaryScreen';
import PoolLaunchScreen from './src/screens/PoolLaunchScreen';
import FreshStartLandingScreen from './src/screens/FreshStartLandingScreen';
import PausedPoolScreen from './src/screens/PausedPoolScreen';
import PoolPickerScreen from './src/screens/PoolPickerScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import SortFilterScreen from './src/screens/SortFilterScreen';
import CardDetailScreen from './src/screens/CardDetailScreen';
import PoolOverviewScreen from './src/screens/PoolOverviewScreen';
import TagExplorerScreen from './src/screens/TagExplorerScreen';
import AudienceFilterScreen from './src/screens/AudienceFilterScreen';
import PlanOverviewScreen from './src/screens/PlanOverviewScreen';
import PlanTodayScreen from './src/screens/PlanTodayScreen';
import PlanWeekScreen from './src/screens/PlanWeekScreen';
import PlanMonthScreen from './src/screens/PlanMonthScreen';
import MilestoneHallScreen from './src/screens/MilestoneHallScreen';
import MilestoneDetailScreen from './src/screens/MilestoneDetailScreen';
import StreakMilestoneScreen from './src/screens/StreakMilestoneScreen';
import WeekStreakMilestoneScreen from './src/screens/WeekStreakMilestoneScreen';
import FreePullGrantScreen from './src/screens/FreePullGrantScreen';
import FreePullInventoryScreen from './src/screens/FreePullInventoryScreen';
import DailyDigestScreen from './src/screens/DailyDigestScreen';
import WeekPlannerPromptScreen from './src/screens/WeekPlannerPromptScreen';
import MonthRewindScreen from './src/screens/MonthRewindScreen';
import BacklogWarningScreen from './src/screens/BacklogWarningScreen';
import BacklogBurstScreen from './src/screens/BacklogBurstScreen';
import FreshStartConfirmScreen from './src/screens/FreshStartConfirmScreen';
import DormantNudgeScreen from './src/screens/DormantNudgeScreen';
import MoreScreen from './src/screens/MoreScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import AchievementsScreen from './src/screens/AchievementsScreen';
import SettingsMainScreen from './src/screens/SettingsMainScreen';
import SettingsAudienceScreen from './src/screens/SettingsAudienceScreen';
import SettingsNotificationsScreen from './src/screens/SettingsNotificationsScreen';
import SettingsPoolsScreen from './src/screens/SettingsPoolsScreen';
import SettingsAppearanceScreen from './src/screens/SettingsAppearanceScreen';
import AboutScreen from './src/screens/AboutScreen';
import HelpFAQScreen from './src/screens/HelpFAQScreen';
import ErrorNetworkScreen from './src/screens/ErrorNetworkScreen';
import ErrorGenericScreen from './src/screens/ErrorGenericScreen';
import ToastHostScreen from './src/screens/ToastHostScreen';
import CoachOverlayScreen from './src/screens/CoachOverlayScreen';
import OfflineBannerScreen from './src/screens/OfflineBannerScreen';
import DebugMenuScreen from './src/screens/DebugMenuScreen';
import CeremonyTuningScreen from './src/screens/dev/CeremonyTuning';
import LevelScreen from './src/screens/LevelScreen';
import DrawCeremonyScreen from './src/screens/DrawCeremonyScreen';
import DrawResultScreen from './src/screens/DrawResultScreen';
import SettlementScreen from './src/screens/SettlementScreen';
import MasteredCelebrationScreen from './src/screens/MasteredCelebrationScreen';
import CollectionMilestoneScreen from './src/screens/CollectionMilestoneScreen';
import MasteryMilestoneScreen from './src/screens/MasteryMilestoneScreen';
import ChallengeScreen from './src/screens/ChallengeScreen';
import DeckScreen from './src/screens/DeckScreen';
import SessionCardScreen from './src/screens/SessionCardScreen';
import DrawScreen from './src/screens/DrawScreen';
import SessionSummaryScreen from './src/screens/SessionSummaryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import SignInScreen from './src/screens/SignInScreen';
import ConfirmSignUpScreen from './src/screens/ConfirmSignUpScreen';

import { configureAmplifyOnce } from './src/auth/amplify';
import { useAuthStore } from './src/auth/authStore';
import { scheduleProgressSync } from './src/sync/progressSync';
import { useForceUpdateGate, type ForceUpdateGate } from './src/config/forceUpdateGate';
import { seedStarterPullsIfNeeded } from './src/features/gacha/rewards/rewardWallet';

configureAmplifyOnce();

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
    if (!props.updateUrl) return;
    await Linking.openURL(props.updateUrl);
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
          <Pressable style={({ pressed }) => [styles.updateButton, pressed && { opacity: 0.9 }, !props.updateUrl && { opacity: 0.6 }]} disabled={!props.updateUrl} onPress={openUpdate}>
            <Text style={styles.updateButtonText}>{props.updateUrl ? 'Open App Store' : 'Update link not set'}</Text>
          </Pressable>
          {!props.updateUrl ? <Text style={styles.updateHint}>(Set updateUrl or appStoreId in remote config JSON)</Text> : null}
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
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') scheduleProgressSync({ delayMs: 0, reason: 'app_background' });
      else if (state === 'active') scheduleProgressSync({ delayMs: 0, reason: 'app_foreground' });
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
          onReady={() => setCurrentRouteName(navigationRef.getCurrentRoute()?.name as keyof RootStackParamList | undefined)}
          onStateChange={() => setCurrentRouteName(navigationRef.getCurrentRoute()?.name as keyof RootStackParamList | undefined)}
        >
          <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="AudienceSurvey" component={AudienceSurveyScreen} />
        <Stack.Screen name="PermissionPrompt" component={PermissionPromptScreen} />
        <Stack.Screen name="Paywall" component={PaywallScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="DailyDose" component={DailyDoseScreen} />
        <Stack.Screen name="WeekSummary" component={WeekSummaryScreen} />
        <Stack.Screen name="MonthSummary" component={MonthSummaryScreen} />
        <Stack.Screen name="PoolLaunch" component={PoolLaunchScreen} />
        <Stack.Screen name="PoolPicker" component={PoolPickerScreen} />
        <Stack.Screen name="FreshStartLanding" component={FreshStartLandingScreen} />
        <Stack.Screen name="PausedPool" component={PausedPoolScreen} />
        <Stack.Screen name="Library" component={LibraryScreen} />
        <Stack.Screen name="SortFilter" component={SortFilterScreen} />
        <Stack.Screen name="CardDetail" component={CardDetailScreen} />
        <Stack.Screen name="PoolOverview" component={PoolOverviewScreen} />
        <Stack.Screen name="TagExplorer" component={TagExplorerScreen} />
        <Stack.Screen name="AudienceFilter" component={AudienceFilterScreen} />
        <Stack.Screen name="PlanOverview" component={PlanOverviewScreen} />
        <Stack.Screen name="PlanToday" component={PlanTodayScreen} />
        <Stack.Screen name="PlanWeek" component={PlanWeekScreen} />
        <Stack.Screen name="PlanMonth" component={PlanMonthScreen} />
        <Stack.Screen name="MilestoneHall" component={MilestoneHallScreen} />
        <Stack.Screen name="MilestoneDetail" component={MilestoneDetailScreen} />
        <Stack.Screen name="StreakMilestone" component={StreakMilestoneScreen} />
        <Stack.Screen name="WeekStreakMilestone" component={WeekStreakMilestoneScreen} />
        <Stack.Screen name="FreePullGrant" component={FreePullGrantScreen} />
        <Stack.Screen name="FreePullInventory" component={FreePullInventoryScreen} />
        <Stack.Screen name="DailyDigest" component={DailyDigestScreen} />
        <Stack.Screen name="WeekPlannerPrompt" component={WeekPlannerPromptScreen} />
        <Stack.Screen name="MonthRewind" component={MonthRewindScreen} />
        <Stack.Screen name="BacklogWarning" component={BacklogWarningScreen} />
        <Stack.Screen name="BacklogBurst" component={BacklogBurstScreen} />
        <Stack.Screen name="FreshStartConfirm" component={FreshStartConfirmScreen} />
        <Stack.Screen name="DormantNudge" component={DormantNudgeScreen} />
        <Stack.Screen name="More" component={MoreScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="Achievements" component={AchievementsScreen} />
        <Stack.Screen name="SettingsMain" component={SettingsMainScreen} />
        <Stack.Screen name="SettingsAudience" component={SettingsAudienceScreen} />
        <Stack.Screen name="SettingsNotifications" component={SettingsNotificationsScreen} />
        <Stack.Screen name="SettingsPools" component={SettingsPoolsScreen} />
        <Stack.Screen name="SettingsAppearance" component={SettingsAppearanceScreen} />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="HelpFAQ" component={HelpFAQScreen} />
        <Stack.Screen name="ErrorNetwork" component={ErrorNetworkScreen} />
        <Stack.Screen name="ErrorGeneric" component={ErrorGenericScreen} />
        <Stack.Screen name="ToastHost" component={ToastHostScreen} />
        <Stack.Screen name="CoachOverlay" component={CoachOverlayScreen} />
        <Stack.Screen name="OfflineBanner" component={OfflineBannerScreen} />
        <Stack.Screen name="DebugMenu" component={DebugMenuScreen} />
        {__DEV__ ? <Stack.Screen name="CeremonyTuning" component={CeremonyTuningScreen} /> : null}
        <Stack.Screen name="Level" component={LevelScreen} />
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
        <Stack.Screen name="Settlement" component={SettlementScreen} />
        <Stack.Screen name="MasteredCelebration" component={MasteredCelebrationScreen} />
        <Stack.Screen name="CollectionMilestone" component={CollectionMilestoneScreen} />
        <Stack.Screen name="MasteryMilestone" component={MasteryMilestoneScreen} />
        <Stack.Screen name="Challenge" component={ChallengeScreen} />
        <Stack.Screen name="Deck" component={DeckScreen} />
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
          </Stack.Navigator>
        </NavigationContainer>
      </View>

      {activeMainTab ? (
        <SafeAreaView style={styles.mainTabSafeArea} edges={['bottom']}>
          <View style={styles.mainTabBarShell}>
          <BottomTabBar
            active={activeMainTab}
            navigate={(name, params) => {
              if (!navigationRef.isReady()) return;
              (navigationRef as any).navigate(name, params);
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
  updateHint: { marginTop: 10, fontSize: 12, color: '#6B7280' },
});