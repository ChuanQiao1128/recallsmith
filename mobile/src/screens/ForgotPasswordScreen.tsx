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
import { friendlyAuthError } from '../auth/authErrors';
import { evaluatePassword, isPasswordValid } from '../auth/passwordPolicy';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

const PASSWORD_RULES_ATTR =
  'minlength: 8; required: lower; required: upper; required: digit; required: special;';

function normEmail(v: string) {
  return String(v || '').trim().toLowerCase();
}

export default function ForgotPasswordScreen({ navigation, route }: Props) {
  const loading = useAuthStore((s) => s.loading);
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);
  const confirmPasswordReset = useAuthStore((s) => s.confirmPasswordReset);

  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState(route.params?.email ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const passwordRules = useMemo(() => evaluatePassword(newPassword), [newPassword]);

  const canSend = useMemo(
    () => normEmail(email).length >= 3 && !loading,
    [email, loading],
  );

  const canConfirm = useMemo(
    () => String(code || '').trim().length >= 4 && isPasswordValid(newPassword) && !loading,
    [code, newPassword, loading],
  );

  async function onSend() {
    if (!canSend) return;
    try {
      await requestPasswordReset(email);
      setStep('confirm');
    } catch (e: any) {
      Alert.alert('Reset failed', friendlyAuthError(e));
    }
  }

  async function onResend() {
    try {
      await requestPasswordReset(email);
      Alert.alert('Sent', 'A new code has been sent to your email.');
    } catch (e: any) {
      Alert.alert('Reset failed', friendlyAuthError(e));
    }
  }

  async function onConfirm() {
    if (!canConfirm) return;
    const e = normEmail(email);
    try {
      await confirmPasswordReset(e, code, newPassword);
      Alert.alert('Password updated', 'Sign in with your new password.');
      navigation.popTo('SignIn', { email: e });
    } catch (err: any) {
      Alert.alert('Reset failed', friendlyAuthError(err));
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.parchmentBg, colors.parchmentBgDeep]}
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
              <Text style={styles.title}>Reset password</Text>
              <Text style={styles.subtitle}>
                We’ll email you a code to set a new password and get back to syncing.
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            {step === 'request' ? (
              <>
                <Text style={styles.cardTitle}>Forgot your password?</Text>
                <Text style={styles.cardHint}>
                  Enter the email tied to your study history and we’ll send a reset code.
                </Text>

                <Text style={styles.label}>Email</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    placeholder="you@example.com"
                    placeholderTextColor={colors.inkMuted}
                    style={styles.input}
                    editable={!loading}
                    returnKeyType="done"
                    onSubmitEditing={onSend}
                  />
                </View>

                <Pressable
                  testID="forgot-send-code"
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    (!canSend || loading) && styles.disabled,
                    pressed && canSend && styles.pressed,
                  ]}
                  disabled={!canSend || loading}
                  onPress={onSend}
                >
                  {loading ? (
                    <View style={styles.rowCenter}>
                      <ActivityIndicator />
                      <Text style={[styles.primaryText, { marginLeft: 8 }]}>Sending…</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryText}>Send reset code</Text>
                  )}
                </Pressable>

                <Text style={styles.footnote}>
                  If an account exists for that email, we sent a code to it.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Set a new password</Text>
                <Text style={styles.cardHint}>
                  Enter the code from your email and choose a new password.
                </Text>

                <Text style={styles.label}>Code</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    testID="forgot-code-input"
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\s/g, ''))}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    placeholderTextColor={colors.inkMuted}
                    style={styles.input}
                    editable={!loading}
                    returnKeyType="next"
                    maxLength={12}
                  />
                </View>

                <Text style={[styles.label, { marginTop: 12 }]}>New password</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    testID="forgot-new-password-input"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showPwd}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    passwordRules={PASSWORD_RULES_ATTR}
                    placeholder="Create a new password"
                    placeholderTextColor={colors.inkMuted}
                    style={styles.input}
                    editable={!loading}
                    returnKeyType="done"
                    onSubmitEditing={onConfirm}
                  />
                  <Pressable
                    onPress={() => setShowPwd((v) => !v)}
                    disabled={loading}
                    hitSlop={10}
                    style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                  >
                    <Text style={styles.pillText}>{showPwd ? 'Hide' : 'Show'}</Text>
                  </Pressable>
                </View>

                <View style={styles.checklist}>
                  {passwordRules.map((rule) => (
                    <Text
                      key={rule.id}
                      testID={`forgot-password-rule-${rule.id}`}
                      style={[styles.checklistItem, rule.ok && styles.checklistItemOk]}
                    >
                      {(rule.ok ? '✓' : '•') + ' ' + rule.label}
                    </Text>
                  ))}
                </View>

                <Pressable
                  testID="forgot-confirm"
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    (!canConfirm || loading) && styles.disabled,
                    pressed && canConfirm && styles.pressed,
                  ]}
                  disabled={!canConfirm || loading}
                  onPress={onConfirm}
                >
                  {loading ? (
                    <View style={styles.rowCenter}>
                      <ActivityIndicator />
                      <Text style={[styles.primaryText, { marginLeft: 8 }]}>Saving…</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryText}>Set new password</Text>
                  )}
                </Pressable>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Didn’t get it?</Text>
                  <View style={styles.dividerLine} />
                </View>

                <Pressable
                  testID="forgot-resend"
                  style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed, loading && styles.disabled]}
                  onPress={onResend}
                  disabled={loading}
                >
                  <Text style={styles.secondaryText}>Resend code</Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={{ height: 28 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },

  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.55 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    marginRight: 10,
  },
  backText: { fontSize: 13, color: colors.inkSoft, fontWeight: '800' },

  title: { fontSize: 22, fontWeight: '900', color: colors.ink },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.inkMuted, lineHeight: 18, fontWeight: '600' },

  card: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardTitle: { fontSize: 18, fontWeight: '900', color: colors.ink },
  cardHint: { marginTop: 4, fontSize: 12, color: colors.inkMuted, fontWeight: '600' },

  label: { marginTop: 14, fontSize: 12, fontWeight: '900', color: colors.inkSoft, letterSpacing: 0.4 },

  inputWrap: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 14, color: colors.inkSoft },

  pill: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.pokeBlueFaint,
  },
  pillText: { color: colors.pokeBlueDeep, fontWeight: '900', fontSize: 12 },

  checklist: { marginTop: 10, gap: 2 },
  checklistItem: { fontSize: 12, color: colors.inkMuted, fontWeight: '600' },
  checklistItemOk: { color: colors.pokeBlueDeep },

  primaryBtn: {
    marginTop: 16,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(44,156,192,0.4)',
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.4 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { marginHorizontal: 10, fontSize: 12, color: colors.inkMuted, fontWeight: '700' },

  secondaryBtn: {
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '800', color: colors.inkSoft },

  footnote: { marginTop: 12, fontSize: 11, color: colors.inkMuted, lineHeight: 16, fontWeight: '600' },
});
