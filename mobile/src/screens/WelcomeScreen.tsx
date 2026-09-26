import React from 'react';
import * as RN from 'react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { completeWelcome } from '../features/gacha/onboarding/onboardingPrefs';
import { colors } from '../theme/colors';
import { packImageForSlug, packPaletteFromSlug } from '../theme/packArt';

// Vitest mocks RN without Image — guarded lookup so tests don't crash.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

// Welcome v3 — single page. Drops the 3-swipe carousel + internal jargon
// ("v6", "phase A"). New users see one value proposition + the actual
// first pack they're about to study, and reach the audience survey in
// one tap. Cuts onboarding clicks from 4 to 1 before the survey gate.
export function WelcomeScreen({ navigation }: Props) {
  const featuredSlug = 'csharp';
  const cover = packImageForSlug(featuredSlug);
  const palette = packPaletteFromSlug(featuredSlug);

  async function next() {
    await completeWelcome();
    navigation.replace('AudienceSurvey');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.parchmentBg, colors.parchmentBgDeep]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow} numberOfLines={1}>
            WELCOME TO DEVELOPERCARDS
          </Text>

          {/* Hero pack — gives a real artifact for the user to anchor on
              instead of generic onboarding copy. Same float-with-halo
              technique as Home v4. The pack itself is tappable and
              advances onboarding — users instinctively reach for it. */}
          <View style={styles.heroBand}>
            <View pointerEvents="none" style={styles.heroHalo} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue"
              style={styles.packFloat}
              onPress={() => void next()}
              hitSlop={8}
            >
              {cover && RNImage ? (
                <RNImage source={cover} resizeMode="contain" style={styles.packImage} />
              ) : (
                <LinearGradient
                  colors={palette.cover}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={styles.packFallback}
                >
                  <Text style={styles.packFallbackTitle} numberOfLines={1}>
                    C#
                  </Text>
                </LinearGradient>
              )}
            </Pressable>
          </View>

          {/* Value proposition — one line, no internal product jargon */}
          <Text style={styles.title} numberOfLines={2}>
            Open packs. Collect cards. Master the deck.
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            Study a few cards a day, build mastery without the grind.
          </Text>

          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={() => void next()}
          >
            {/* Was "Continue to audience" — "audience" is internal jargon
                that meant nothing to first-time users. Now: just "Continue". */}
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>

          {/* Returning users who reinstalled can restore their synced
              progress from here. Opens SignIn with `navigate` (not
              `replace`) so Back or a completed sign-in returns to Welcome;
              they still tap Continue to finish onboarding. No authStore
              import here — the onboarding test renders Welcome with only
              react-native / AsyncStorage mocks. */}
          <Pressable
            testID="welcome-sign-in-link"
            accessibilityRole="button"
            style={({ pressed }) => [styles.signInLink, pressed && styles.pressed]}
            onPress={() => navigation.navigate('SignIn')}
            hitSlop={8}
          >
            <Text style={styles.signInLinkText}>I already have an account</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default WelcomeScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 32 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  // Pack floats with shadow + halo, no frame — same language as Home v4
  heroBand: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
    height: 280,
    justifyContent: 'center',
  },
  heroHalo: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 280,
    backgroundColor: 'rgba(232,184,90,0.18)',
  },
  packFloat: {
    width: 180,
    height: 252,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(58,35,5,0.30)',
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  packImage: { width: '100%', height: '100%' },
  packFallback: {
    width: 180,
    height: 252,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packFallbackTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '900',
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 21,
    color: colors.inkSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 32,
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
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  // Quiet secondary link — parchment-toned, no fill, but a 44pt hit area so
  // it stays tappable without competing with the primary Continue button.
  signInLink: {
    marginTop: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  signInLinkText: {
    color: colors.inkSecondary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
    textDecorationLine: 'underline',
  },
  pressed: { opacity: 0.92 },
});
