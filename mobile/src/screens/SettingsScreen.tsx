// mobile/src/screens/SettingsScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Linking,
  ScrollView,
  Modal,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import Purchases from 'react-native-purchases';

import type { RootStackParamList } from '../navigation/types';
import { checkManifestForUpdates, installDeckFromUrl } from '../content/deckRepository';
import {
  getCurrentAppVersion,
  fetchRemoteConfig,
  compareSemver,
  type RemoteConfig,
} from '../config/remoteConfig';

// ✅ Auth (primitive selectors only)
import { useAuthStore } from '../auth/authStore';

// ✅ Reminders prefs
import {
  getReminderPrefs,
  setReminderPrefs as saveReminderPrefs,
  refreshDailyRemindersFromCache,
  type ReminderPrefs,
} from '../notifications/reminders';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

// =========================
// Links
// =========================
const SUPPORT_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Support-Help-2bfa758eb545809ead04d8f8321a40dc?pvs=74';

const PRIVACY_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74';

const REMOTE_CONFIG_URL =
  'https://raw.githubusercontent.com/ChuanQiao1128/recallsmith-mobile-config/refs/heads/main/recallsmith-config.json';

// ✅ RevenueCat entitlement id (confirmed)
const ENTITLEMENT_ID = 'DeveloperCards Pro';

// System subscription pages (fallback)
const IOS_MANAGE_SUBS_URL = 'https://apps.apple.com/account/subscriptions';
const ANDROID_MANAGE_SUBS_URL = 'https://play.google.com/store/account/subscriptions';

// =========================
// Utils
// =========================
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

function extractSemver(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

function safeSemverCompare(
  aRaw: string | null | undefined,
  bRaw: string | null | undefined,
): number | null {
  const a = extractSemver(aRaw);
  const b = extractSemver(bRaw);
  if (!a || !b) return null;
  return compareSemver(a, b);
}

function toDateMaybe(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ✅ "27 Dec 2025" format (local date)
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
function formatDateLocalDDMonYYYY(d: Date | null | undefined): string {
  if (!d) return '—';
  try {
    const day = String(d.getDate()); // no leading zero → "7 Dec 2025"
    const mon = MONTHS_SHORT[d.getMonth()] ?? '—';
    const year = d.getFullYear();
    return `${day} ${mon} ${year}`;
  } catch {
    return '—';
  }
}

const MORNING_OPTIONS = ['07:00', '08:00', '09:00', '10:00', '11:00'] as const;
const EVENING_OPTIONS = ['18:00', '19:00', '20:00', '21:00', '22:00'] as const;

export function SettingsScreen({ navigation }: Props) {
  const appVersionRaw = getCurrentAppVersion();

  // ✅ auth state
  const status = useAuthStore((s) => s.status);
  const email = useAuthStore((s) => s.email);
  const authLoading = useAuthStore((s) => s.loading);
  const isSignedIn = useAuthStore((s) => s.status === 'signed_in');
  const signOutNow = useAuthStore((s) => s.signOutNow);

  const authReady = status !== 'unknown' && !authLoading;

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // =========================
  // Premium (RevenueCat)
  // =========================
  const rcReqIdRef = useRef(0);

  // ✅ Track whether we have ever successfully loaded subscription info
  const rcHasLoadedOnceRef = useRef(false);

  // ✅ Soft "unavailable" flag (network / SDK / transient failure)
  const [rcUnavailable, setRcUnavailable] = useState(false);

  const [rcLoading, setRcLoading] = useState(true);
  const [rcRefreshing, setRcRefreshing] = useState(false);

  // Keep error only for dev debugging — never drive scary UI with it
  const [rcError, setRcError] = useState<string | null>(null);

  const [premiumActive, setPremiumActive] = useState(false);
  const [willRenew, setWillRenew] = useState<boolean | null>(null);
  const [premiumIsSandbox, setPremiumIsSandbox] = useState<boolean | null>(null);
  const [billingIssueDetected, setBillingIssueDetected] = useState(false);

  const [expirationDate, setExpirationDate] = useState<Date | null>(null);
  const [latestPurchaseDate, setLatestPurchaseDate] = useState<Date | null>(null);

  const loadRevenueCatInfo = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    const forceRefresh = !!opts?.forceRefresh;
    const reqId = ++rcReqIdRef.current;

    // ✅ Only show blocking loading on first-ever load (avoid flicker on focus)
    if (forceRefresh) {
      setRcRefreshing(true);
    } else if (!rcHasLoadedOnceRef.current) {
      setRcLoading(true);
    }

    try {
      setRcError(null);

      // Best-effort: refresh cache only when forced (pull-to-refresh / manual refresh)
      if (forceRefresh) {
        try {
          // @ts-ignore
          if (typeof Purchases.invalidateCustomerInfoCache === 'function') {
            // @ts-ignore
            await Purchases.invalidateCustomerInfoCache();
          }
        } catch {
          // ignore
        }
      }

      const info = await Purchases.getCustomerInfo();
      if (!mountedRef.current || reqId !== rcReqIdRef.current) return;

      const entAll = (info as any)?.entitlements?.all?.[ENTITLEMENT_ID] ?? null;
      const entActive = (info as any)?.entitlements?.active?.[ENTITLEMENT_ID] ?? null;
      const ent = entActive ?? entAll;

      const isActive = !!ent?.isActive;

      setPremiumActive(isActive);
      setWillRenew(typeof ent?.willRenew === 'boolean' ? ent.willRenew : null);
      setPremiumIsSandbox(typeof ent?.isSandbox === 'boolean' ? ent.isSandbox : null);

      const billingAt = toDateMaybe(ent?.billingIssueDetectedAt);
      setBillingIssueDetected(!!billingAt);

      setExpirationDate(toDateMaybe(ent?.expirationDate));
      setLatestPurchaseDate(toDateMaybe(ent?.latestPurchaseDate));

      // ✅ Mark as successfully loaded & clear unavailable
      rcHasLoadedOnceRef.current = true;
      setRcUnavailable(false);
    } catch (e: any) {
      if (!mountedRef.current || reqId !== rcReqIdRef.current) return;

      // ✅ Soft-fail:
      // - do NOT reset premiumActive / expirationDate etc. Keep last known values.
      // - do NOT show red error badge in UI.
      setRcUnavailable(true);

      // keep raw error only for dev
      setRcError(e?.message ?? 'Unable to refresh subscription status.');
    } finally {
      if (!mountedRef.current || reqId !== rcReqIdRef.current) return;
      setRcLoading(false);
      setRcRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRevenueCatInfo({ forceRefresh: false });
  }, [loadRevenueCatInfo]);

  // ✅ When returning from Paywall / navigating back, auto-refresh (cache-based)
  useFocusEffect(
    useCallback(() => {
      void loadRevenueCatInfo({ forceRefresh: false });
    }, [loadRevenueCatInfo]),
  );

  const handleManageSubscription = useCallback(async () => {
    // Prefer SDK helper if available; fallback to system URL.
    try {
      // @ts-ignore
      if (typeof Purchases.showManageSubscriptions === 'function') {
        // @ts-ignore
        await Purchases.showManageSubscriptions();
        return;
      }
    } catch {
      // ignore; fallback below
    }

    const url = Platform.OS === 'ios' ? IOS_MANAGE_SUBS_URL : ANDROID_MANAGE_SUBS_URL;
    await openExternalLink(url);
  }, []);

  const handleRestorePurchases = useCallback(async () => {
    try {
      setRcRefreshing(true);
      await Purchases.restorePurchases();
      await loadRevenueCatInfo({ forceRefresh: true });
      Alert.alert('Restored', 'Your purchases have been restored.');
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message ?? 'Unable to restore purchases.');
    } finally {
      setRcRefreshing(false);
    }
  }, [loadRevenueCatInfo]);

  const premiumBadge = useMemo(() => {
    // Only truly "red" state is billing issue
    if (billingIssueDetected) return { text: 'Billing issue', tone: 'danger' as const };

    // If we don't have any successful load yet, show Loading/Unknown softly
    if (!rcHasLoadedOnceRef.current) {
      if (rcLoading) return { text: 'Loading', tone: 'muted' as const };
      if (rcUnavailable) return { text: 'Unknown', tone: 'muted' as const };
      // If somehow neither, fall through to Free
    }

    // Prefer last known status
    if (premiumActive) {
      if (willRenew === false) return { text: 'Active (canceled)', tone: 'success' as const };
      return { text: 'Active', tone: 'success' as const };
    }

    if (expirationDate) return { text: 'Expired', tone: 'muted' as const };

    return { text: 'Free', tone: 'muted' as const };
  }, [billingIssueDetected, rcLoading, rcUnavailable, premiumActive, willRenew, expirationDate]);

  const premiumStatusText = useMemo(() => {
    // First load and no success yet
    if (!rcHasLoadedOnceRef.current) {
      if (rcLoading) return 'Checking subscription status…';
      if (rcUnavailable) return 'Subscription status unavailable right now. Pull to refresh or try again later.';
    }

    if (billingIssueDetected) return 'Billing issue detected · action required.';

    if (premiumActive) {
      const base =
        willRenew === false
          ? 'Premium active · auto-renew is off.'
          : 'Premium active · auto-renews unless canceled.';
      return rcUnavailable ? `${base} (Unable to refresh right now.)` : base;
    }

    if (!premiumActive && expirationDate) {
      const base = 'Premium expired.';
      return rcUnavailable ? `${base} (Unable to refresh right now.)` : base;
    }

    // Free state (or last known free)
    if (rcUnavailable) return 'Free plan (last known) · Pull to refresh to re-check subscription status.';
    return 'Unlock premium decks and advanced learning features.';
  }, [rcLoading, rcUnavailable, billingIssueDetected, premiumActive, willRenew, expirationDate]);

  const renewalOrExpiryLabel = useMemo(() => {
    if (!expirationDate) return null;

    if (premiumActive) {
      // If user canceled but still has access, RC willRenew may be false.
      return willRenew === false ? 'Expires on' : 'Renews on';
    }
    return 'Expired on';
  }, [expirationDate, premiumActive, willRenew]);

  const renewalOrExpiryValue = useMemo(() => {
    if (!expirationDate) return null;
    return formatDateLocalDDMonYYYY(expirationDate);
  }, [expirationDate]);

  // =========================
  // Deck updates
  // =========================
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

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
          const ok = await installDeckFromUrl(u.slug, u.remoteUrl, u.expectedVersion, u.remoteSha256);
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

  // =========================
  // App store info (remote config)
  // =========================
  const remoteReqIdRef = useRef(0);

  const [remoteConfig, setRemoteConfig] = useState<RemoteConfig | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  const loadRemoteStoreInfo = useCallback(async () => {
    const reqId = ++remoteReqIdRef.current;

    setRemoteStatus('loading');
    try {
      const cfg = await fetchRemoteConfig(REMOTE_CONFIG_URL, 5000);
      if (!mountedRef.current || reqId !== remoteReqIdRef.current) return;

      if (cfg?.ios) {
        setRemoteConfig(cfg);
        setRemoteStatus('loaded');
      } else {
        setRemoteConfig(null);
        setRemoteStatus('error');
      }
    } catch {
      if (!mountedRef.current || reqId !== remoteReqIdRef.current) return;
      setRemoteConfig(null);
      setRemoteStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadRemoteStoreInfo();
  }, [loadRemoteStoreInfo]);

  const iosCfg = remoteConfig?.ios ?? null;
  const latestStoreVersion = iosCfg?.latestVersion ?? iosCfg?.minSupportedVersion ?? null;
  const minSupportedVersion = iosCfg?.minSupportedVersion ?? null;

  const updateUrl =
    iosCfg?.updateUrl ??
    (iosCfg?.appStoreId ? `https://apps.apple.com/app/id${iosCfg.appStoreId}` : null);

  const { forceUpdate, hasOptionalUpdate } = useMemo(() => {
    if (remoteStatus !== 'loaded' || !iosCfg) return { forceUpdate: false, hasOptionalUpdate: false };

    const cmpMin = safeSemverCompare(appVersionRaw, minSupportedVersion);
    const cmpLatest = safeSemverCompare(appVersionRaw, latestStoreVersion);

    const belowMin = cmpMin !== null && cmpMin < 0;
    const optional = !belowMin && cmpLatest !== null && cmpLatest < 0;

    return { forceUpdate: belowMin, hasOptionalUpdate: optional };
  }, [remoteStatus, iosCfg, appVersionRaw, minSupportedVersion, latestStoreVersion]);

  const latestDisplay = latestStoreVersion ?? (remoteStatus === 'loading' ? '…' : '—');
  const minDisplay = minSupportedVersion ?? (remoteStatus === 'loading' ? '…' : '—');

  const appStoreStatusText =
    remoteStatus === 'loading'
      ? 'Fetching store info…'
      : remoteStatus === 'error'
        ? 'Unable to fetch store info.'
        : forceUpdate
          ? 'Below minimum required · please update to continue.'
          : hasOptionalUpdate
            ? 'Update available (optional).'
            : 'You are up to date.';

  // =========================
  // Reminders (prefs)
  // =========================
  const prefsReqIdRef = useRef(0);

  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsHint, setPrefsHint] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<ReminderPrefs>({
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: true,
    eveningTime: '20:00',
  });

  const [timePicker, setTimePicker] = useState<null | 'morning' | 'evening'>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  function showPrefsHint(msg: string) {
    setPrefsHint(msg);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setPrefsHint(null), 1600);
  }

  const loadPrefs = useCallback(async () => {
    const reqId = ++prefsReqIdRef.current;
    setPrefsLoading(true);
    try {
      const p = await getReminderPrefs();
      if (!mountedRef.current || reqId !== prefsReqIdRef.current) return;
      setPrefs(p);
    } catch {
      // ignore; keep defaults
    } finally {
      if (!mountedRef.current || reqId !== prefsReqIdRef.current) return;
      setPrefsLoading(false);
    }
  }, []);

  // ✅ Only load reminders prefs when signed in (since editing requires sign-in)
  useEffect(() => {
    if (!isSignedIn) {
      setPrefsLoading(false);
      return;
    }
    void loadPrefs();
  }, [isSignedIn, loadPrefs]);

  async function updatePrefs(patch: Partial<ReminderPrefs>) {
    if (!isSignedIn) {
      Alert.alert('Sign in required', 'Sign in to customize reminders.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ]);
      return;
    }

    setPrefsSaving(true);
    try {
      const next = await saveReminderPrefs(patch);
      setPrefs(next);

      await refreshDailyRemindersFromCache();
      showPrefsHint('Saved · reminders updated');
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Failed to update reminders.');
    } finally {
      setPrefsSaving(false);
    }
  }

  async function handleSignOut() {
    Alert.alert(
      'Sign out',
      'This will sign you out on this device and stop cloud sync. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            try {
              // Best-effort: log out RC user if your app logs in RC on auth
              try {
                await Purchases.logOut();
              } catch {
                // ignore
              }

              await signOutNow();

              // Refresh premium status (anonymous user)
              await loadRevenueCatInfo({ forceRefresh: false });
            } catch {
              // ignore
            }
          },
        },
      ],
    );
  }

  const timeOptions = timePicker === 'morning' ? MORNING_OPTIONS : EVENING_OPTIONS;

  // =========================
  // Dev tools: Reset local state
  // =========================
  const [resettingLocal, setResettingLocal] = useState(false);

  const showDevTools =
    __DEV__ || String(process.env.EXPO_PUBLIC_ENV || '').toLowerCase().trim() === 'development';

  async function resetLocalStateNow() {
    if (resettingLocal) return;

    setResettingLocal(true);
    try {
      // 1) RevenueCat logout (best-effort)
      try {
        // @ts-ignore
        if (typeof Purchases.invalidateCustomerInfoCache === 'function') {
          // @ts-ignore
          await Purchases.invalidateCustomerInfoCache();
        }
        await Purchases.logOut();
      } catch {
        // ignore
      }

      // 2) App sign out (best-effort)
      try {
        await signOutNow();
      } catch {
        // ignore
      }

      // 3) Clear AsyncStorage (cached premium, prefs, local flags, etc.)
      try {
        await AsyncStorage.clear();
      } catch {
        // ignore
      }

      // 4) Delete local deck caches (idempotent)
      const base =
        // ✅ Expo SDK 新写法（typed）
        (FileSystem as any)?.Paths?.document ??
        // ✅ 兼容老版本（runtime 可能有，但 TS 不一定有）
        (FileSystem as any)?.documentDirectory ??
        '';
      const pathsToDelete = [
        `${base}devcards-decks-v2`,
        `${base}devcards-decks`,
        `${base}decks`,
      ].filter(Boolean);

      for (const p of pathsToDelete) {
        try {
          const info = await FileSystem.getInfoAsync(p);
          if (info.exists) {
            await FileSystem.deleteAsync(p, { idempotent: true });
          }
        } catch {
          // ignore
        }
      }

      // 5) Reset in-memory UI bits
      setUpdateMessage(null);
      setPrefs({
        morningEnabled: true,
        morningTime: '09:00',
        eveningEnabled: true,
        eveningTime: '20:00',
      });

      await loadRevenueCatInfo({ forceRefresh: true });

      Alert.alert(
        'Reset complete',
        'Local cache cleared (auth, RevenueCat, AsyncStorage, deck files). Close the app and reopen it to start fresh.',
      );
    } finally {
      setResettingLocal(false);
    }
  }

  // =========================
  // Pull-to-refresh (optimized)
  // =========================
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        loadRevenueCatInfo({ forceRefresh: true }),
        loadRemoteStoreInfo(),
        isSignedIn ? loadPrefs() : Promise.resolve(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  }, [loadRevenueCatInfo, loadRemoteStoreInfo, isSignedIn, loadPrefs]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={['#F5F3FF', '#E0F2FE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {/* Time picker modal */}
          <Modal
            transparent
            animationType="fade"
            visible={!!timePicker}
            onRequestClose={() => setTimePicker(null)}
          >
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={() => setTimePicker(null)} />
              <View style={styles.modalCardOpaque}>
                <View style={styles.modalHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>
                      {timePicker === 'morning' ? 'Morning reminder' : 'Evening check-in'}
                    </Text>
                    <Text style={styles.modalSubtitle}>
                      {timePicker === 'morning'
                        ? 'Pick a daily time.'
                        : 'Only triggers if you still have cards due today.'}
                    </Text>
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.pressed]}
                    onPress={() => setTimePicker(null)}
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </Pressable>
                </View>

                <View style={styles.timeGrid}>
                  {timeOptions.map((t) => {
                    const active =
                      timePicker === 'morning' ? prefs.morningTime === t : prefs.eveningTime === t;

                    return (
                      <Pressable
                        key={t}
                        style={({ pressed }) => [
                          styles.timeChip,
                          active && styles.timeChipActive,
                          pressed && styles.pressed,
                        ]}
                        onPress={async () => {
                          const isMorning = timePicker === 'morning';
                          setTimePicker(null);
                          await updatePrefs(isMorning ? { morningTime: t } : { eveningTime: t });
                        }}
                      >
                        <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>{t}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.modalLegend}>
                  You can disable each reminder with the toggle. Times sync after sign-in.
                </Text>
              </View>
            </View>
          </Modal>

          <ScrollView
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} />}
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <Pressable
                style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.backText}>← Back</Text>
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Settings</Text>
                <Text style={styles.subtitle}>Account, premium, reminders, updates and legal.</Text>
              </View>
            </View>

            {/* Premium */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Premium</Text>

                <View style={styles.sectionHeaderRight}>
                  <View
                    style={[
                      styles.badge,
                      premiumBadge.tone === 'success' && styles.badgeSuccess,
                      premiumBadge.tone === 'danger' && styles.badgeDanger,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        premiumBadge.tone === 'success' && styles.badgeTextSuccess,
                        premiumBadge.tone === 'danger' && styles.badgeTextDanger,
                      ]}
                    >
                      {premiumBadge.text}
                    </Text>
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.smallGhostBtn, pressed && styles.pressed]}
                    onPress={() => loadRevenueCatInfo({ forceRefresh: true })}
                    disabled={rcRefreshing}
                  >
                    {rcRefreshing ? (
                      <ActivityIndicator />
                    ) : (
                      <Text style={styles.smallGhostText}>Refresh</Text>
                    )}
                  </Pressable>
                </View>
              </View>

              <Text style={styles.sectionSubtitle}>{premiumStatusText}</Text>

              {/* detail rows */}
              {renewalOrExpiryLabel && renewalOrExpiryValue ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>{renewalOrExpiryLabel}</Text>
                  <Text style={styles.kValue}>{renewalOrExpiryValue}</Text>
                </View>
              ) : null}

              {premiumActive && willRenew === false ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Auto-renew</Text>
                  <Text style={styles.kValue}>Off</Text>
                </View>
              ) : premiumActive && willRenew === true ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Auto-renew</Text>
                  <Text style={styles.kValue}>On</Text>
                </View>
              ) : null}

              {latestPurchaseDate ? (
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Last purchase</Text>
                  <Text style={styles.kValue}>{formatDateLocalDDMonYYYY(latestPurchaseDate)}</Text>
                </View>
              ) : null}

              {billingIssueDetected ? (
                <Text style={[styles.muted, { marginTop: 10 }]}>
                  Apple/Google reported a billing issue. Please update payment info to keep access.
                </Text>
              ) : (
                <Text style={[styles.muted, { marginTop: 10 }]}>
                  Billing and cancellation are handled by {Platform.OS === 'ios' ? 'Apple' : 'Google'}.
                </Text>
              )}

              {/* actions */}
              {premiumActive ? (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                    onPress={handleManageSubscription}
                  >
                    <Text style={styles.secondaryButtonText}>Manage subscription</Text>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [styles.linkLite, pressed && styles.pressed]}
                    onPress={handleRestorePurchases}
                  >
                    <Text style={styles.linkLiteText}>Restore purchases</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
                    onPress={() => navigation.navigate('Paywall')}
                  >
                    <Text style={styles.primaryButtonText}>Upgrade to Premium</Text>
                  </Pressable>

                  <View style={{ marginTop: 8 }}>
                    <Pressable
                      style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                      onPress={handleManageSubscription}
                    >
                      <Text style={styles.secondaryButtonText}>Manage subscriptions</Text>
                    </Pressable>
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.linkLite, pressed && styles.pressed]}
                    onPress={handleRestorePurchases}
                  >
                    <Text style={styles.linkLiteText}>Restore purchases</Text>
                  </Pressable>
                </>
              )}

              {premiumIsSandbox ? (
                <Text style={[styles.muted, { marginTop: 10 }]}>Sandbox purchase environment.</Text>
              ) : null}

              {/* ✅ Dev only error visibility */}
              {__DEV__ && rcError ? (
                <Text style={[styles.muted, { marginTop: 10 }]}>[dev] {rcError}</Text>
              ) : null}
            </View>

            {/* Account */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Account</Text>
              <Text style={styles.sectionSubtitle}>
                {!authReady
                  ? 'Loading account…'
                  : isSignedIn
                    ? `Signed in · ${email ?? '—'} · Backup enabled`
                    : 'Signed out · sign in to enable backup and unlock Month view'}
              </Text>

              {!isSignedIn ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                    (!authReady || authLoading) && styles.buttonDisabled,
                  ]}
                  onPress={() => navigation.navigate('SignIn')}
                  disabled={!authReady || authLoading}
                >
                  <Text style={styles.primaryButtonText}>Sign in / Register</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}
                  onPress={handleSignOut}
                >
                  <Text style={styles.primaryButtonText}>Sign out</Text>
                </Pressable>
              )}
            </View>

            {/* Dev tools */}
            {showDevTools ? (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Dev tools</Text>
                <Text style={styles.sectionSubtitle}>
                  Reset local caches without deleting the app (auth, RevenueCat, AsyncStorage, deck files).
                </Text>

                <Pressable
                  style={({ pressed }) => [
                    styles.dangerButton,
                    pressed && styles.buttonPressed,
                    resettingLocal && styles.buttonDisabled,
                  ]}
                  disabled={resettingLocal}
                  onPress={() => {
                    Alert.alert(
                      'Reset local state',
                      'This will sign out, clear local storage, and delete downloaded decks. Continue?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Reset', style: 'destructive', onPress: resetLocalStateNow },
                      ],
                    );
                  }}
                >
                  {resettingLocal ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ActivityIndicator />
                      <View style={{ width: 10 }} />
                      <Text style={styles.primaryButtonText}>Resetting…</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText}>Reset local state</Text>
                  )}
                </Pressable>

                <Text style={[styles.muted, { marginTop: 10 }]}>
                  After reset: fully close the app and reopen for a clean run.
                </Text>
              </View>
            ) : null}

            {/* Reminders */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Reminders</Text>
              <Text style={styles.sectionSubtitle}>
                Keep consistency with a morning reminder and a smart evening check-in.
              </Text>

              {!isSignedIn ? (
                <View style={styles.gateBox}>
                  <Text style={styles.gateTitle}>Customize reminders</Text>
                  <Text style={styles.gateSubtitle}>
                    Sign in to set your preferred reminder times (and sync them across devices).
                  </Text>

                  <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
                    onPress={() => navigation.navigate('SignIn')}
                  >
                    <Text style={styles.primaryButtonText}>Sign in to customize</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {prefsLoading ? (
                    <View style={{ paddingVertical: 8 }}>
                      <ActivityIndicator />
                      <Text style={[styles.muted, { marginTop: 6 }]}>Loading reminder settings…</Text>
                    </View>
                  ) : (
                    <>
                      {/* Morning row */}
                      <View style={[styles.settingRow, (prefsSaving || prefsLoading) && styles.rowDisabled]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>Morning reminder</Text>
                          <Text style={styles.rowSubtitle}>A gentle nudge to do a quick run.</Text>
                        </View>

                        <Pressable
                          style={({ pressed }) => [styles.rowChip, pressed && styles.pressed]}
                          onPress={() => setTimePicker('morning')}
                          disabled={prefsSaving || prefsLoading}
                        >
                          <Text style={styles.rowChipText}>{prefs.morningTime}</Text>
                        </Pressable>

                        <Pressable
                          style={({ pressed }) => [
                            styles.toggle,
                            prefs.morningEnabled && styles.toggleOn,
                            pressed && styles.pressed,
                          ]}
                          onPress={() => updatePrefs({ morningEnabled: !prefs.morningEnabled })}
                          disabled={prefsSaving || prefsLoading}
                        >
                          <View style={[styles.toggleKnob, prefs.morningEnabled && styles.toggleKnobOn]} />
                        </Pressable>
                      </View>

                      {/* Evening row */}
                      <View style={[styles.settingRow, (prefsSaving || prefsLoading) && styles.rowDisabled]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle}>Evening check-in</Text>
                          <Text style={styles.rowSubtitle}>Only if you still have due cards today.</Text>
                        </View>

                        <Pressable
                          style={({ pressed }) => [styles.rowChip, pressed && styles.pressed]}
                          onPress={() => setTimePicker('evening')}
                          disabled={prefsSaving || prefsLoading}
                        >
                          <Text style={styles.rowChipText}>{prefs.eveningTime}</Text>
                        </Pressable>

                        <Pressable
                          style={({ pressed }) => [
                            styles.toggle,
                            prefs.eveningEnabled && styles.toggleOn,
                            pressed && styles.pressed,
                          ]}
                          onPress={() => updatePrefs({ eveningEnabled: !prefs.eveningEnabled })}
                          disabled={prefsSaving || prefsLoading}
                        >
                          <View style={[styles.toggleKnob, prefs.eveningEnabled && styles.toggleKnobOn]} />
                        </Pressable>
                      </View>

                      <View style={styles.hintSlot}>
                        <Text style={styles.hintText} numberOfLines={1}>
                          {prefsHint ?? 'Tip: evening check-in helps you keep the due calendar manageable.'}
                        </Text>
                      </View>
                    </>
                  )}
                </>
              )}
            </View>

            {/* Deck updates */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Deck updates</Text>
              <Text style={styles.sectionSubtitle}>
                The app checks for updates on launch. Use this to force a refresh.
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !updating && styles.buttonPressed,
                  updating && styles.buttonDisabled,
                ]}
                onPress={handleUpdateDecks}
                disabled={updating}
              >
                <Text style={styles.primaryButtonText}>{updating ? 'Checking…' : 'Check & update decks'}</Text>
              </Pressable>

              {updateMessage ? <Text style={styles.mutedStatus}>{updateMessage}</Text> : null}
            </View>

            {/* App info */}
            <View style={styles.cardGlass}>
              <Text style={styles.appName}>DeveloperCards</Text>
              <Text style={styles.appTagline}>Full-stack concept.</Text>

              <View style={styles.kvRow}>
                <Text style={styles.kLabel}>Current app</Text>
                <Text style={styles.kValue}>{extractSemver(appVersionRaw) ?? appVersionRaw}</Text>
              </View>

              <View style={styles.kvRow}>
                <Text style={styles.kLabel}>Latest (store)</Text>
                <Text style={styles.kValue}>{latestDisplay}</Text>
              </View>

              <View style={styles.kvRow}>
                <Text style={styles.kLabel}>Minimum required</Text>
                <Text style={styles.kValue}>{minDisplay}</Text>
              </View>

              <Text style={[styles.muted, { marginTop: 10 }]}>{appStoreStatusText}</Text>

              {updateUrl ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                    forceUpdate && { backgroundColor: '#DC2626' },
                  ]}
                  onPress={() => openExternalLink(updateUrl)}
                >
                  <Text style={styles.primaryButtonText}>
                    {forceUpdate ? 'Update now (required)' : hasOptionalUpdate ? 'Update on App Store' : 'Open App Store'}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* Help & Legal */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Help & Legal</Text>
              <Text style={styles.sectionSubtitle}>
                These pages open in your browser so you can read them comfortably.
              </Text>

              <Pressable
                style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
                onPress={() => openExternalLink(SUPPORT_URL)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>Support & FAQ</Text>
                  <Text style={styles.linkSubtitle}>Troubleshooting and contact info.</Text>
                </View>
                <Text style={styles.linkChevron}>›</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
                onPress={() => openExternalLink(PRIVACY_URL)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>Privacy Policy</Text>
                  <Text style={styles.linkSubtitle}>What we store and how we handle data.</Text>
                </View>
                <Text style={styles.linkChevron}>›</Text>
              </Pressable>
            </View>

            <View style={styles.footerBox}>
              <Text style={styles.footerText}>Made with focus for developers preparing full-stack interviews.</Text>
            </View>

            <View style={{ height: 8 }} />
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default SettingsScreen;

const GLASS = 'rgba(255,255,255,0.16)';
const BORDER = 'rgba(255,255,255,0.45)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },

  container: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30,
  },

  pressed: { opacity: 0.92 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.86)',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
  },
  backButtonPressed: { opacity: 0.9 },
  backText: { fontSize: 13, color: '#111827', fontWeight: '800' },

  title: { fontSize: 22, fontWeight: '900', color: '#111827' },
  subtitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },

  // cards
  cardGlass: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  sectionCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  sectionTitle: { fontSize: 15, fontWeight: '900', color: '#111827' },
  sectionSubtitle: { marginTop: 6, fontSize: 12, color: '#6B7280', lineHeight: 16 },

  // badges
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(17,24,39,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
    marginRight: 10,
  },
  badgeText: { fontSize: 12, fontWeight: '900', color: '#111827' },

  badgeSuccess: {
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderColor: 'rgba(16,185,129,0.20)',
  },
  badgeTextSuccess: { color: '#065F46' },

  badgeDanger: {
    backgroundColor: 'rgba(220,38,38,0.10)',
    borderColor: 'rgba(220,38,38,0.18)',
  },
  badgeTextDanger: { color: '#991B1B' },

  // buttons
  primaryButton: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '900', color: '#111827' },

  dangerButton: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.6 },

  // small refresh
  smallGhostBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallGhostText: { fontSize: 12, fontWeight: '900', color: '#111827' },

  linkLite: { marginTop: 10, alignSelf: 'center' },
  linkLiteText: { fontSize: 12, fontWeight: '900', color: '#4F46E5' },

  muted: { fontSize: 12, color: '#6B7280' },
  mutedStatus: { marginTop: 10, fontSize: 12, color: '#6B7280' },

  // app info
  appName: { fontSize: 18, fontWeight: '900', color: '#111827' },
  appTagline: { marginTop: 4, fontSize: 12, color: '#4B5563' },

  kvRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between' },
  kLabel: { fontSize: 12, color: '#6B7280' },
  kValue: { fontSize: 13, color: '#111827', fontWeight: '700' },

  // links
  linkRow: {
    marginTop: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17,24,39,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkTitle: { fontSize: 13, fontWeight: '900', color: '#111827' },
  linkSubtitle: { marginTop: 3, fontSize: 12, color: '#6B7280' },
  linkChevron: { marginLeft: 10, fontSize: 20, color: '#9CA3AF', fontWeight: '900' },

  // reminders rows
  settingRow: {
    marginTop: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17,24,39,0.04)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowDisabled: { opacity: 0.6 },
  rowTitle: { fontSize: 13, fontWeight: '900', color: '#111827' },
  rowSubtitle: { marginTop: 3, fontSize: 12, color: '#6B7280', maxWidth: 220 },

  rowChip: {
    marginLeft: 10,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(79,70,229,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.18)',
  },
  rowChipText: { fontSize: 12, fontWeight: '900', color: '#4F46E5' },

  toggle: {
    marginLeft: 10,
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.12)',
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: 'rgba(79,70,229,0.28)' },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    alignSelf: 'flex-start',
  },
  toggleKnobOn: { alignSelf: 'flex-end' },

  hintSlot: { marginTop: 10, paddingVertical: 2 },
  hintText: { fontSize: 11, color: '#6B7280' },

  gateBox: {
    marginTop: 10,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(79,70,229,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(79,70,229,0.14)',
  },
  gateTitle: { fontSize: 13, fontWeight: '900', color: '#4F46E5' },
  gateSubtitle: { marginTop: 6, fontSize: 12, color: '#4B5563', lineHeight: 16 },

  // modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(17,24,39,0.25)',
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCardOpaque: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#111827' },
  modalSubtitle: { marginTop: 4, fontSize: 12, color: '#6B7280', fontWeight: '700' },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  modalCloseText: { fontSize: 16, fontWeight: '900', color: '#111827' },

  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  timeChip: {
    width: '32%',
    marginBottom: 10,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
  },
  timeChipActive: {
    backgroundColor: 'rgba(79,70,229,0.12)',
    borderColor: 'rgba(79,70,229,0.22)',
  },
  timeChipText: { fontSize: 12, fontWeight: '900', color: '#111827' },
  timeChipTextActive: { color: '#4F46E5' },

  modalLegend: { marginTop: 4, fontSize: 11, color: '#6B7280' },

  footerBox: { marginTop: 8, alignItems: 'center' },
  footerText: { fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
});