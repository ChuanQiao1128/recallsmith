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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuthStore } from '../auth/authStore';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SignUp'>;

function normEmail(v: string) {
  return String(v || '').trim().toLowerCase();
}

export default function SignUpScreen({ navigation }: Props) {
  const loading = useAuthStore((s) => s.loading);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);

  const canSubmit = useMemo(() => {
    return normEmail(email).length >= 3 && password.length >= 8 && !loading;
  }, [email, password, loading]);

  async function onSubmit() {
    if (!canSubmit) return;

    try {
      const e = normEmail(email);
      await signUpWithEmail(e, password);
      navigation.replace('ConfirmSignUp', { email: e });
    } catch (e: any) {
      Alert.alert('Sign up failed', e?.message ?? 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#F5F3FF', '#E0F2FE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Create your account</Text>
              <Text style={styles.subtitle}>
                Verify your email to enable cloud sync.
              </Text>
            </View>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign up</Text>
            <Text style={styles.cardHint}>
              We’ll send a verification code to your email.
            </Text>

            <Text style={styles.fieldLabel}>Email</Text>
            <View
              style={[
                styles.inputWrap,
                focus === 'email' && styles.inputWrapFocused,
              ]}
            >
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor="#9CA3AF"
                style={styles.input}
                editable={!loading}
                onFocus={() => setFocus('email')}
                onBlur={() => setFocus(null)}
                returnKeyType="next"
              />
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>
              Password <Text style={styles.fieldLabelSoft}>(min 8 chars)</Text>
            </Text>
            <View
              style={[
                styles.inputWrap,
                focus === 'password' && styles.inputWrapFocused,
              ]}
            >
              <TextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPwd}
                placeholder="Create a password"
                placeholderTextColor="#9CA3AF"
                style={styles.input}
                editable={!loading}
                onFocus={() => setFocus('password')}
                onBlur={() => setFocus(null)}
                returnKeyType="done"
                onSubmitEditing={onSubmit}
              />

              <Pressable
                onPress={() => setShowPwd((v) => !v)}
                style={({ pressed }) => [
                  styles.eyeBtn,
                  pressed && { opacity: 0.85 },
                ]}
                disabled={loading}
              >
                <Text style={styles.eyeText}>{showPwd ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (!canSubmit || loading) && styles.primaryBtnDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
              disabled={!canSubmit || loading}
              onPress={onSubmit}
            >
              {loading ? (
                <View style={styles.rowCenter}>
                  <ActivityIndicator />
                  <Text style={[styles.primaryBtnText, { marginLeft: 8 }]}>
                    Creating…
                  </Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>Create account</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>Already have one?</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.pressed,
              ]}
              onPress={() => navigation.replace('SignIn', { email: normEmail(email) || undefined })}
              disabled={loading}
            >
              <Text style={styles.secondaryBtnText}>Go to sign in</Text>
            </Pressable>

            <Text style={styles.legalText}>
              By creating an account, you agree to keep your credentials safe.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const CARD_BG = 'rgba(255,255,255,0.92)';
const CARD_BORDER = 'rgba(255,255,255,0.55)';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },

  pressed: { opacity: 0.92 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.8)',
    marginRight: 10,
  },
  backButtonPressed: { opacity: 0.9 },
  backText: { fontSize: 13, color: '#111827' },

  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 2, fontSize: 12, color: '#6B7280' },

  card: {
    marginTop: 8,
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

  fieldLabel: { marginTop: 14, fontSize: 12, fontWeight: '800', color: '#374151' },
  fieldLabelSoft: { fontSize: 12, fontWeight: '800', color: '#6B7280' },

  inputWrap: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
    backgroundColor: 'rgba(255,255,255,1)',
    paddingHorizontal: 12,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWrapFocused: {
    borderColor: 'rgba(79,70,229,0.55)',
    shadowColor: '#4F46E5',
    shadowOpacity: 0.10,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  eyeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(79,70,229,0.10)',
    marginLeft: 8,
  },
  eyeText: { color: '#4F46E5', fontWeight: '800', fontSize: 12 },

  primaryBtn: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: '#4F46E5',
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },

  rowCenter: { flexDirection: 'row', alignItems: 'center' },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 10,
  },
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
  secondaryBtnText: { fontSize: 14, fontWeight: '800', color: '#111827' },

  legalText: { marginTop: 12, fontSize: 11, color: '#6B7280', lineHeight: 16 },
});