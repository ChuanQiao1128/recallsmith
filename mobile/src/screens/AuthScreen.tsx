// mobile/src/screens/AuthScreen.tsx
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { apiJson } from '../api/apiClient';
import { setAuthToken } from '../auth/authStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

type ApiOk<T> = {
  success: boolean;
  data: T;
  error: any;
  traceId: string;
  version: string;
};

type AuthResp = {
  accessToken: string;
  refreshToken?: string | null;
  userSub?: string | null;
};

const AUTH_LOGIN_PATH =
  (process.env.EXPO_PUBLIC_AUTH_LOGIN_PATH || '/api/v1/auth/login').trim();

const AUTH_REGISTER_PATH =
  (process.env.EXPO_PUBLIC_AUTH_REGISTER_PATH || '/api/v1/auth/register').trim();

export function AuthScreen({ navigation, route }: Props) {
  const initialMode = route.params?.mode === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);

  const title = mode === 'login' ? 'Sign in' : 'Create account';
  const primaryText = mode === 'login' ? 'Sign in' : 'Create account';

  const canSubmit = useMemo(() => {
    return email.trim().length >= 3 && password.length >= 6 && !busy;
  }, [email, password, busy]);

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    try {
      const path = mode === 'login' ? AUTH_LOGIN_PATH : AUTH_REGISTER_PATH;

      const resp = await apiJson<ApiOk<AuthResp>>(path, {
        method: 'POST',
        accessToken: null,
        body: {
          email: email.trim(),
          password,
        },
        timeoutMs: 15000,
      });

      if (!resp?.success) {
        const msg = resp?.error?.message || resp?.error || 'Auth failed.';
        throw new Error(msg);
      }

      const token = (resp?.data as any)?.accessToken;
      if (!token || typeof token !== 'string') {
        throw new Error('No accessToken returned by server.');
      }

      await setAuthToken(token);

      // ✅ 登录成功：回到 Home（清栈）
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' as any }],
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to authenticate.');
    } finally {
      setBusy(false);
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
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>Sync progress across devices with your account.</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.segment}>
              <Pressable
                style={({ pressed }) => [
                  styles.segmentItem,
                  mode === 'login' && styles.segmentItemActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setMode('login')}
                disabled={busy}
              >
                <Text style={[styles.segmentText, mode === 'login' && styles.segmentTextActive]}>
                  Sign in
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.segmentItem,
                  mode === 'register' && styles.segmentItemActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setMode('register')}
                disabled={busy}
              >
                <Text style={[styles.segmentText, mode === 'register' && styles.segmentTextActive]}>
                  Register
                </Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              editable={!busy}
            />

            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="At least 6 characters"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              editable={!busy}
            />

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (!canSubmit || busy) && styles.primaryBtnDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
              onPress={submit}
              disabled={!canSubmit || busy}
            >
              {busy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <ActivityIndicator />
                  <Text style={[styles.primaryBtnText, { marginLeft: 8 }]}>Please wait…</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>{primaryText}</Text>
              )}
            </Pressable>

            <Text style={styles.hint}>
              By continuing, you agree to keep your credentials safe. (You can add password reset later.)
            </Text>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default AuthScreen;

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
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },

  segment: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 4,
    backgroundColor: 'rgba(17,24,39,0.06)',
    marginBottom: 12,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
  },
  segmentItemActive: { backgroundColor: 'rgba(79,70,229,0.14)' },
  segmentText: { fontSize: 12, fontWeight: '900', color: '#111827' },
  segmentTextActive: { color: '#4F46E5' },

  fieldLabel: { marginTop: 8, fontSize: 12, fontWeight: '800', color: '#374151' },
  input: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
    backgroundColor: 'rgba(255,255,255,1)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#111827',
  },

  primaryBtn: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },

  hint: { marginTop: 10, fontSize: 11, color: '#6B7280', lineHeight: 16 },
});