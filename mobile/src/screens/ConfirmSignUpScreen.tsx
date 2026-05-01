import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../auth/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ConfirmSignUp'>;

function maskEmail(email: string) {
  const e = String(email || '').trim();
  const at = e.indexOf('@');
  if (at <= 1) return e;
  const name = e.slice(0, at);
  const dom = e.slice(at + 1);
  return `${name.slice(0, 2)}***${name.slice(-1)}@${dom}`;
}

export default function ConfirmSignUpScreen({ navigation, route }: Props) {
  const email = route.params.email;

  const loading = useAuthStore((s) => s.loading);
  const confirmSignUpCode = useAuthStore((s) => s.confirmSignUpCode);
  const resendConfirmCode = useAuthStore((s) => s.resendConfirmCode);

  const [code, setCode] = useState('');

  const canSubmit = useMemo(() => {
    const c = String(code || '').trim();
    return c.length >= 4 && !loading;
  }, [code, loading]);

  async function onConfirm() {
    if (!canSubmit) return;

    try {
      await confirmSignUpCode(email, code);
      Alert.alert('Verified', 'Your email is verified. Please sign in.', [
        { text: 'Continue', onPress: () => navigation.replace('SignIn', { email }) },
      ]);
    } catch (e: any) {
      Alert.alert('Confirm failed', e?.message ?? 'Please try again.');
    }
  }

  async function onResend() {
    try {
      await resendConfirmCode(email);
      Alert.alert('Sent', 'A new code has been sent to your email.');
    } catch (e: any) {
      Alert.alert('Resend failed', e?.message ?? 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        pointerEvents="none"
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
              disabled={loading}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Verify your email</Text>
              <Text style={styles.subtitle}>Code sent to {maskEmail(email)}.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Confirmation code</Text>
            <Text style={styles.cardHint}>Use the latest code to finish protecting sync and recovery.</Text>

            <Text style={styles.label}>Code</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.replace(/\s/g, ''))}
                keyboardType="number-pad"
                placeholder="123456"
                placeholderTextColor="#9CA3AF"
                style={styles.codeInput}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={onConfirm}
                maxLength={12}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (!canSubmit || loading) && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}
              disabled={!canSubmit || loading}
              onPress={onConfirm}
            >
              {loading ? (
                <View style={styles.rowCenter}>
                  <ActivityIndicator />
                  <Text style={[styles.primaryText, { marginLeft: 8 }]}>Verifying…</Text>
                </View>
              ) : (
                <Text style={styles.primaryText}>Verify</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>Didn’t get it?</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed, loading && styles.disabled]}
              onPress={onResend}
              disabled={loading}
            >
              <Text style={styles.secondaryText}>Resend code</Text>
            </Pressable>

            <Text style={styles.footnote}>Only the latest code works. If you requested several, use the newest email.</Text>
          </View>

          <View style={{ height: 28 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const CARD_BG = 'rgba(255,255,255,0.92)';
const CARD_BORDER = 'rgba(255,255,255,0.55)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },

  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.6 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backText: { fontSize: 13, color: '#111827', fontWeight: '700' },

  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 2, fontSize: 12, color: '#6B7280' },

  card: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  cardHint: { marginTop: 4, fontSize: 12, color: '#6B7280' },

  label: { marginTop: 14, fontSize: 12, fontWeight: '800', color: '#374151' },

  inputWrap: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  codeInput: {
    paddingVertical: 10,
    fontSize: 16,
    letterSpacing: 2,
    fontWeight: '800',
    color: '#111827',
  },

  primaryBtn: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: '#4F46E5',
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(17,24,39,0.10)' },
  dividerText: { marginHorizontal: 10, fontSize: 12, color: '#6B7280', fontWeight: '700' },

  secondaryBtn: {
    borderRadius: 16,
    backgroundColor: 'rgba(17,24,39,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '800', color: '#111827' },

  footnote: { marginTop: 12, fontSize: 11, color: '#6B7280', lineHeight: 16 },
});