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
import { colors } from '../theme/colors';

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
        // Amplify already holds a session but our store may be stale (e.g. an
        // offline cold start). Re-read the session before leaving so the app
        // reflects the signed-in user instead of bouncing silently.
        await useAuthStore.getState().init();
        goAway(navigation);
        return;
      }
      Alert.alert('Sign in failed', msg || 'Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Background gradient — aligned with the rest of the app's
          parchment palette (was indigo→cyan, off-brand). */}
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
                placeholderTextColor={colors.inkMuted}
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
                placeholderTextColor={colors.inkMuted}
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

  // Show/Hide password pill — pokeBlue brand color, no more indigo
  pill: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.pokeBlueFaint,
  },
  pillText: { color: colors.pokeBlueDeep, fontWeight: '900', fontSize: 12 },

  // Primary CTA — pokeBlue 56pt pill matching the rest of the app
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

  // Secondary "Create an account" — ghost button matching DrawScreen ghost
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