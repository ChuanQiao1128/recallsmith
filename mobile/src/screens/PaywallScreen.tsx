// mobile/src/screens/PaywallScreen.tsx
import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import type { RootStackParamList } from '../navigation/types';
import { usePremiumStatus, setIsPremiumUser } from '../premium/premiumStore';
import {
  rcPurchaseMonthly,
  rcRestore,
  rcGetCustomerInfoSafe,
  rcGetMonthlyPackageSafe,
  isPremiumActive,
} from '../premium/revenuecat';
import { classifyPurchaseError, PURCHASE_ERROR_COPY } from '../premium/purchaseErrors';
import { useAuthStore } from '../auth/authStore';
import { colors } from '../theme/colors';

const TERMS_OF_USE_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_URL =
  'https://tartan-tortoise-e81.notion.site/DevCards-Spaced-Recall-Privacy-Policy-2bfa758eb54580db99a3ed89369f9a13?pvs=74';

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>;
type PricingState =
  | { kind: 'loading' }
  | { kind: 'ready'; label: string }
  | { kind: 'unavailable' };

export function PaywallScreen({ navigation }: Props) {
  const premiumStatus = usePremiumStatus();
  const isPremium = premiumStatus === 'premium';
  const isSignedIn = useAuthStore((s) => s.status === 'signed_in');
  // While signed in and the cached premium status is still resolving we show a
  // "checking" state instead of a false "Not subscribed" (MGACHA-25).
  const isCheckingPremium = isSignedIn && premiumStatus === 'unknown';
  const [busy, setBusy] = React.useState(false);
  const [pricing, setPricing] = React.useState<PricingState>({ kind: 'loading' });

  const mountedRef = React.useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Refetch the price on every focus so a brief offline moment at open no longer
  // hides the Subscribe button forever (MGACHA-17). A refetch keeps an already
  // `ready` price on screen; only loading/unavailable show the loading label.
  const loadPrice = useCallback(async () => {
    const pkg = await rcGetMonthlyPackageSafe();
    if (!mountedRef.current) return;

    const price = String(pkg?.product?.priceString ?? '').trim();
    setPricing(price ? { kind: 'ready', label: `${price} / month` } : { kind: 'unavailable' });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPrice();
    }, [loadPrice]),
  );

  // ✅ 更鲁棒：Paywall 打开时自动刷新一次订阅状态，避免“其实已经 Premium 但 UI 还显示未订阅”
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function refresh() {
        if (!isSignedIn) return;
        try {
          const info = await rcGetCustomerInfoSafe();
          if (cancelled) return;

          const active = isPremiumActive(info);
          setIsPremiumUser(active);
        } catch {
          // ignore
        }
      }

      void refresh();
      return () => {
        cancelled = true;
      };
    }, [isSignedIn]),
  );

  const navHas = (name: string) => {
    const s = (navigation as any).getState?.();
    if (s?.routeNames?.includes(name)) return true;

    const p1 = (navigation as any).getParent?.();
    const s1 = p1?.getState?.();
    if (s1?.routeNames?.includes(name)) return true;

    const p2 = p1?.getParent?.();
    const s2 = p2?.getState?.();
    if (s2?.routeNames?.includes(name)) return true;

    return false;
  };

  const goSignIn = () => {
    if (navHas('SignIn')) return (navigation as any).navigate('SignIn');
    if (navHas('Login')) return (navigation as any).navigate('Login');
    if (navHas('Auth')) return (navigation as any).navigate('Auth', { screen: 'SignIn' });
    // 最后兜底：还是回到上一页
    navigation.goBack();
  };

  async function handleSubscribe() {
    if (busy) return;

    if (!isSignedIn) {
      Alert.alert('Sign in required', 'Please sign in before purchasing Premium.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: goSignIn },
      ]);
      return;
    }

    setBusy(true);
    try {
      // ✅ 防止已订阅用户重复购买（并顺便刷新一次状态）
      try {
        const existing = await rcGetCustomerInfoSafe();
        const activeExisting = isPremiumActive(existing);
        setIsPremiumUser(activeExisting);

        if (activeExisting) {
          Alert.alert('Premium active', 'Your subscription is already active.');
          navigation.goBack();
          return;
        }
      } catch {
        // ignore，继续尝试购买
      }

      const info = await rcPurchaseMonthly();
      const active = isPremiumActive(info);
      setIsPremiumUser(active);

      if (active) {
        Alert.alert('Success', 'Premium is now active 🎉');
        navigation.goBack();
      } else {
        Alert.alert(
          'Purchased',
          'Purchase completed, but entitlement not active yet. Try “Restore Purchases” or reopen the app.',
        );
      }
    } catch (e: any) {
      const kind = classifyPurchaseError(e);
      if (kind === 'cancelled') return;
      const copy = PURCHASE_ERROR_COPY[kind];
      Alert.alert(copy.title, copy.body);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (busy) return;

    if (!isSignedIn) {
      Alert.alert('Sign in required', 'Please sign in before restoring purchases.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: goSignIn },
      ]);
      return;
    }

    setBusy(true);
    try {
      const info = await rcRestore();
      const active = isPremiumActive(info);
      setIsPremiumUser(active);

      Alert.alert('Restore complete', active ? 'Premium is active.' : 'No active subscription found.');
      if (active) navigation.goBack();
    } catch (e: any) {
      if (classifyPurchaseError(e) === 'network') {
        Alert.alert(PURCHASE_ERROR_COPY.network.title, PURCHASE_ERROR_COPY.network.body);
      } else {
        Alert.alert('Restore failed', 'We could not restore purchases right now. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient
          colors={[colors.parchmentBg, colors.parchmentBgDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.headerRow}>
              <Pressable
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                onPress={() => navigation.goBack()}
                disabled={busy}
              >
                <Text style={styles.backText}>← Back</Text>
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Premium</Text>
                <Text style={styles.subtitle}>Unlock premium decks and advanced learning features.</Text>
              </View>
            </View>

            {/* Status card */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Status</Text>
              <Text style={styles.sectionSubtitle}>
                {!isSignedIn
                  ? '🔒 Sign in required to purchase / restore'
                  : isCheckingPremium
                  ? 'Checking your subscription…'
                  : isPremium
                  ? '✅ Premium active on this account'
                  : '🔒 Not subscribed'}
              </Text>

              <View style={styles.divider} />

              <View style={styles.kvRow}>
                <Text style={styles.kLabel}>Account</Text>
                <Text style={styles.kValue}>{isSignedIn ? 'Signed in' : 'Signed out'}</Text>
              </View>

              <View style={styles.kvRow}>
                <Text style={styles.kLabel}>Access</Text>
                <Text style={styles.kValue}>
                  {!isSignedIn
                    ? 'Free decks only'
                    : isCheckingPremium
                    ? 'Checking…'
                    : isPremium
                    ? 'All premium decks'
                    : 'Free decks only'}
                </Text>
              </View>

              <View style={styles.kvRow}>
                <Text style={styles.kLabel}>Billing</Text>
                <Text style={styles.kValue} testID="paywall-billing-value">
                  {pricing.kind === 'ready'
                    ? pricing.label
                    : pricing.kind === 'loading'
                      ? 'Loading price…'
                      : 'Not available right now'}
                </Text>
              </View>

              {pricing.kind === 'unavailable' ? (
                <Pressable
                  testID="paywall-price-retry"
                  style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed, busy && styles.buttonDisabled]}
                  disabled={busy}
                  onPress={() => void loadPrice()}
                >
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              ) : null}
            </View>

            {/* What you get */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>What you get</Text>
              <Text style={styles.sectionSubtitle}>
                Premium keeps your deeper interview tracks, upgrades, and future releases in one stable lane.
              </Text>

              <View style={{ height: 10 }} />

              <Bullet text="Access all premium decks" />
              <Bullet text="Expanding curated interview tracks as new pools ship" />
              <Bullet text="Priority content updates and release access" />
            </View>

            {/* Actions */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Upgrade</Text>
              <Text style={styles.sectionSubtitle}>Purchase is handled through Apple In-App Purchase via RevenueCat, so premium access can be restored later on the same account.</Text>

              {pricing.kind === 'ready' ? (
                <Pressable
                  testID="paywall-subscribe"
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                    (busy || isPremium || isCheckingPremium) && styles.buttonDisabled,
                  ]}
                  disabled={busy || isPremium || isCheckingPremium}
                  onPress={() => {
                    if (!isSignedIn) {
                      goSignIn();
                      return;
                    }
                    void handleSubscribe();
                  }}
                >
                  {busy ? (
                    <View style={styles.rowInline}>
                      <ActivityIndicator />
                      <Text style={[styles.primaryButtonText, { marginLeft: 10 }]}>Processing…</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {isCheckingPremium
                        ? 'Checking…'
                        : isPremium
                        ? 'Premium active'
                        : isSignedIn
                        ? 'Unlock Premium'
                        : 'Sign in to continue'}
                    </Text>
                  )}
                </Pressable>
              ) : null}

              <Pressable
                style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed, busy && styles.buttonDisabled]}
                disabled={busy}
                onPress={() => {
                  if (!isSignedIn) {
                    goSignIn();
                    return;
                  }
                  void handleRestore();
                }}
              >
                <Text style={styles.linkBtnText}>Restore Purchases</Text>
              </Pressable>

              <Text style={styles.mutedNote}>Tip: if you changed devices or reinstalled the app, tap “Restore Purchases”.</Text>
            </View>

            <View style={styles.footerBox}>
              <Text style={styles.footerText}>Free decks stay available even if you never upgrade.</Text>
            </View>

            <View style={styles.legalRow}>
              <Pressable
                testID="paywall-terms-link"
                onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}
              >
                <Text style={styles.legalLinkText}>Terms of Use</Text>
              </Pressable>
              <Text style={styles.legalDot}>·</Text>
              <Pressable
                testID="paywall-privacy-link"
                onPress={() => void Linking.openURL(PRIVACY_URL)}
              >
                <Text style={styles.legalLinkText}>Privacy Policy</Text>
              </Pressable>
            </View>

            <View style={{ height: 10 }} />
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

export default PaywallScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },

  container: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30,
  },

  pressed: { opacity: 0.92 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.softCream,
    marginRight: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  backText: { fontSize: 13, color: colors.inkSoft, fontWeight: '800' },

  title: { fontSize: 24, fontWeight: '900', color: colors.ink },
  subtitle: { marginTop: 4, fontSize: 12, color: colors.inkMuted, fontWeight: '600' },

  sectionCard: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: colors.ink },
  sectionSubtitle: { marginTop: 6, fontSize: 12, color: colors.inkMuted, lineHeight: 16, fontWeight: '600' },

  divider: {
    marginTop: 12,
    marginBottom: 10,
    height: 1,
    backgroundColor: colors.hairline,
  },

  kvRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  kLabel: { fontSize: 12, color: colors.inkMuted, fontWeight: '600' },
  kValue: { fontSize: 13, color: colors.inkSoft, fontWeight: '800' },

  retryBtn: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.softCream, borderWidth: 1, borderColor: colors.hairline },
  retryBtnText: { fontSize: 13, color: colors.pokeBlueDeep, fontWeight: '900' },

  // Premium bullets — gold dots reinforce the premium accent
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  bulletDot: { width: 18, fontSize: 16, color: colors.gold, lineHeight: 18, fontWeight: '900' },
  bulletText: { flex: 1, fontSize: 13, color: colors.inkSoft, lineHeight: 18, fontWeight: '600' },

  // Premium CTA = GOLD (not pokeBlue) — this is the upgrade tier
  primaryButton: {
    marginTop: 12,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.gold,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(200,136,58,0.45)',
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.4 },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.55 },

  rowInline: { flexDirection: 'row', alignItems: 'center' },

  linkBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  linkBtnText: { fontSize: 13, color: colors.pokeBlueDeep, fontWeight: '900' },

  mutedNote: { marginTop: 10, fontSize: 11, color: colors.inkMuted, lineHeight: 15, fontWeight: '600' },

  footerBox: { marginTop: 6, alignItems: 'center' },
  footerText: { fontSize: 11, color: colors.inkMuted, textAlign: 'center', fontWeight: '600' },
  legalRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 8 },
  legalLinkText: { fontSize: 12, color: colors.pokeBlueDeep, fontWeight: '800' },
  legalDot: { fontSize: 12, color: colors.inkMuted },
});
