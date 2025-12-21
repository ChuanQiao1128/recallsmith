// mobile/src/screens/PaywallScreen.tsx
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { usePremiumUser, setIsPremiumUser } from '../premium/premiumStore';
import { rcPurchaseMonthly, rcRestore, rcGetCustomerInfo, isPremiumActive } from '../premium/revenuecat';
import { useAuthStore } from '../auth/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>;

export function PaywallScreen({ navigation }: Props) {
  const isPremium = usePremiumUser();
  const isSignedIn = useAuthStore((s) => s.status === 'signed_in');
  const [busy, setBusy] = React.useState(false);

  async function handleSubscribe() {
    if (busy) return;

    if (!isSignedIn) {
      Alert.alert('Sign in required', 'Please sign in before purchasing Premium.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ]);
      return;
    }

    setBusy(true);
    try {
      // 防止已订阅用户重复购买
      const existing = await rcGetCustomerInfo();
      if (isPremiumActive(existing)) {
        await setIsPremiumUser(true);
        Alert.alert('Premium active', 'Your subscription is already active.');
        navigation.goBack();
        return;
      }

      const info = await rcPurchaseMonthly();
      const active = isPremiumActive(info);

      await setIsPremiumUser(active);

      if (active) {
        Alert.alert('Success', 'Premium is now active 🎉');
        navigation.goBack();
      } else {
        Alert.alert('Purchased', 'Purchase completed, but entitlement not active yet.');
      }
    } catch (e: any) {
      if (e?.userCancelled) return;
      Alert.alert('Purchase failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (busy) return;

    if (!isSignedIn) {
      Alert.alert('Sign in required', 'Please sign in before restoring purchases.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ]);
      return;
    }

    setBusy(true);
    try {
      const info = await rcRestore();
      const active = isPremiumActive(info);
      await setIsPremiumUser(active);

      Alert.alert('Restore complete', active ? 'Premium is active.' : 'No active subscription found.');
      if (active) navigation.goBack();
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
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
                  {isSignedIn ? (isPremium ? 'All premium decks' : 'Free decks only') : 'Free decks only'}
                </Text>
              </View>

              <View style={styles.kvRow}>
                <Text style={styles.kLabel}>Billing</Text>
                <Text style={styles.kValue}>Monthly subscription</Text>
              </View>
            </View>

            {/* What you get */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>What you get</Text>
              <Text style={styles.sectionSubtitle}>
                Premium is designed to keep your interview prep focused and consistent.
              </Text>

              <View style={{ height: 10 }} />

              <Bullet text="Access all premium decks" />
              <Bullet text="More curated interview tracks (coming soon)" />
              <Bullet text="Priority updates and new content drops" />
            </View>

            {/* Actions */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Upgrade</Text>
              <Text style={styles.sectionSubtitle}>
                Purchase uses Apple In-App Purchase via RevenueCat.
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  (busy || isPremium) && styles.buttonDisabled,
                ]}
                disabled={busy || isPremium}
                onPress={() => {
                  if (!isSignedIn) {
                    navigation.navigate('SignIn');
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
                    {isPremium ? 'Premium active' : isSignedIn ? 'Unlock Premium' : 'Sign in to continue'}
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.linkBtn,
                  pressed && styles.pressed,
                  busy && styles.buttonDisabled,
                ]}
                disabled={busy}
                onPress={() => {
                  if (!isSignedIn) {
                    navigation.navigate('SignIn');
                    return;
                  }
                  void handleRestore();
                }}
              >
                <Text style={styles.linkBtnText}>Restore Purchases</Text>
              </Pressable>

              <Text style={styles.mutedNote}>
                Tip: if you changed devices or reinstalled the app, tap “Restore Purchases”.
              </Text>
            </View>

            <View style={styles.footerBox}>
              <Text style={styles.footerText}>
                You can keep studying free decks without subscribing.
              </Text>
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
  backText: { fontSize: 13, color: '#111827', fontWeight: '800' },

  title: { fontSize: 22, fontWeight: '900', color: '#111827' },
  subtitle: { marginTop: 4, fontSize: 12, color: '#6B7280' },

  sectionCard: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.86)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: '#111827' },
  sectionSubtitle: { marginTop: 6, fontSize: 12, color: '#6B7280', lineHeight: 16 },

  divider: {
    marginTop: 12,
    marginBottom: 10,
    height: 1,
    backgroundColor: 'rgba(17,24,39,0.08)',
  },

  kvRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  kLabel: { fontSize: 12, color: '#6B7280' },
  kValue: { fontSize: 13, color: '#111827', fontWeight: '700' },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  bulletDot: { width: 18, fontSize: 16, color: '#374151', lineHeight: 18 },
  bulletText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },

  primaryButton: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.6 },

  rowInline: { flexDirection: 'row', alignItems: 'center' },

  linkBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 6 },
  linkBtnText: { fontSize: 12, color: '#4F46E5', fontWeight: '900' },

  mutedNote: { marginTop: 10, fontSize: 11, color: '#6B7280', lineHeight: 15 },

  footerBox: { marginTop: 6, alignItems: 'center' },
  footerText: { fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
});