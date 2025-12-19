// mobile/src/screens/PaywallScreen.tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { usePremiumUser, setIsPremiumUser } from '../premium/premiumStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>;

/**
 * Paywall（订阅/购买入口）
 *
 * 现在是 stub（占位），但结构按未来可扩展设计：
 * - 展示 Premium 的价值（features）
 * - 提供订阅按钮（未来接 StoreKit / RevenueCat / 后端）
 * - DEV 模式提供“本地解锁”按钮用于测试整条 gating 链路
 */
export function PaywallScreen({ navigation }: Props) {
  const isPremium = usePremiumUser();
  const [busy, setBusy] = React.useState(false);

  async function handleSubscribe() {
    // TODO: 接入 IAP (StoreKit / RevenueCat) 或后端订阅
    Alert.alert('Coming soon', 'Subscription purchase flow will be added later.');
  }

  async function devUnlock() {
    if (!__DEV__) return;
    setBusy(true);
    try {
      await setIsPremiumUser(true);
      Alert.alert('Dev unlocked', 'Premium is now unlocked locally. Go back and open premium decks.');
    } finally {
      setBusy(false);
    }
  }

  async function devReset() {
    if (!__DEV__) return;
    setBusy(true);
    try {
      await setIsPremiumUser(false);
      Alert.alert('Dev reset', 'Premium is cleared locally.');
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
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable
                style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.9 }]}
                onPress={() => navigation.goBack()}
              >
                <Text style={styles.backText}>← Back</Text>
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Upgrade to Premium</Text>
                <Text style={styles.subtitle}>
                  Unlock premium decks and advanced study features.
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>What you get</Text>

              <View style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>Access all premium decks</Text>
              </View>
              <View style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>More curated interview tracks (coming soon)</Text>
              </View>
              <View style={styles.bulletRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>Priority updates and new content drops</Text>
              </View>

              <View style={{ height: 12 }} />

              <Text style={styles.statusText}>
                Status: {isPremium ? '✅ Premium active' : '🔒 Not subscribed'}
              </Text>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && { opacity: 0.9 },
                  busy && { opacity: 0.6 },
                ]}
                disabled={busy}
                onPress={handleSubscribe}
              >
                <Text style={styles.primaryButtonText}>Subscribe (coming soon)</Text>
              </Pressable>

              {__DEV__ ? (
                <>
                  <View style={{ height: 10 }} />
                  <Text style={styles.devHint}>DEV tools (local only)</Text>

                  <View style={styles.devRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.devButton,
                        pressed && { opacity: 0.9 },
                        busy && { opacity: 0.6 },
                      ]}
                      disabled={busy}
                      onPress={devUnlock}
                    >
                      <Text style={styles.devButtonText}>Unlock Premium</Text>
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.devButtonSecondary,
                        pressed && { opacity: 0.9 },
                        busy && { opacity: 0.6 },
                      ]}
                      disabled={busy}
                      onPress={devReset}
                    >
                      <Text style={styles.devButtonTextSecondary}>Reset</Text>
                    </Pressable>
                  </View>

                  <Text style={styles.devFooter}>
                    These buttons only toggle a local flag for testing gating flow.
                  </Text>
                </>
              ) : null}
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                You can still study all free decks without subscribing.
              </Text>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default PaywallScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backText: { fontSize: 13, color: '#111827' },

  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 2, fontSize: 12, color: '#6B7280' },

  card: {
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 10 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  bullet: { width: 18, fontSize: 14, color: '#374151', lineHeight: 18 },
  bulletText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },

  statusText: { fontSize: 12, color: '#4B5563', marginBottom: 10 },

  primaryButton: {
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },

  devHint: { fontSize: 12, color: '#6B7280', fontWeight: '700' },
  devRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  devButton: {
    width: '48%',
    borderRadius: 14,
    backgroundColor: '#16A34A',
    paddingVertical: 10,
    alignItems: 'center',
  },
  devButtonText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  devButtonSecondary: {
    width: '48%',
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
    paddingVertical: 10,
    alignItems: 'center',
  },
  devButtonTextSecondary: { fontSize: 13, fontWeight: '800', color: '#111827' },
  devFooter: { marginTop: 8, fontSize: 11, color: '#9CA3AF' },

  footer: { marginTop: 'auto', alignItems: 'center' },
  footerText: { fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
});