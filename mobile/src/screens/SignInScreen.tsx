import React, { useEffect, useMemo, useState } from 'react';
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

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;

function goAway(navigation: Props['navigation']) {
  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }
  navigation.reset({
    index: 0,
    routes: [{ name: 'Home' as any }],
  });
}

function normEmail(v: string) {
  return String(v || '').trim().toLowerCase();
}

export default function SignInScreen({ navigation, route }: Props) {
  const loading = useAuthStore((s) => s.loading);
  const status = useAuthStore((s) => s.status);
  const isSignedIn = useAuthStore((s) => s.status === 'signed_in');
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);

  const [email, setEmail] = useState(route.params?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  useEffect(() => {
    if (isSignedIn) goAway(navigation);
  }, [isSignedIn, navigation]);

  const canSubmit = useMemo(() => {
    return normEmail(email).length >= 3 && password.length >= 1 && !loading && status !== 'signed_in';
  }, [email, password, loading, status]);

  async function onSubmit() {
    if (!canSubmit) return;

    try {
      await signInWithEmail(email, password);
      goAway(navigation);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (/already.*signed in/i.test(msg)) {
        goAway(navigation);
        return;
      }
      Alert.alert('Sign in failed', msg || 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Background gradient (doesn't capture touches) */}
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
          {/* Header */}
          <View style={styles.headerRow}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => navigation.goBack()}
            >
              <Text style={styles.backText}>← Back</Text>
            </Pressable>

            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Sign in to restore your study progress, sync, and account recovery.</Text>
            </View>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>
            <Text style={styles.cardHint}>Use the verified email tied to your study history.</Text>

            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrap}>
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
                returnKeyType="next"
              />
            </View>

            <Text style={[styles.label, { marginTop: 12 }]}>Password</Text>
            <View style={styles.inputWrap}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPwd}
                placeholder="Your password"
                placeholderTextColor="#9CA3AF"
                style={styles.input}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={onSubmit}
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

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (!canSubmit || loading) && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}
              disabled={!canSubmit || loading}
              onPress={onSubmit}
            >
              {loading ? (
                <View style={styles.rowCenter}>
                  <ActivityIndicator />
                  <Text style={[styles.primaryText, { marginLeft: 8 }]}>Signing in…</Text>
                </View>
              ) : (
                <Text style={styles.primaryText}>Continue</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>New here?</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              onPress={() => navigation.navigate('SignUp')}
              disabled={loading}
            >
              <Text style={styles.secondaryText}>Create an account</Text>
            </Pressable>

            <Text style={styles.footnote}>
              Keep using an email you can access later if you ever need to restore study history on a new device.
            </Text>
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#111827' },

  pill: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(79,70,229,0.10)',
  },
  pillText: { color: '#4F46E5', fontWeight: '800', fontSize: 12 },

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