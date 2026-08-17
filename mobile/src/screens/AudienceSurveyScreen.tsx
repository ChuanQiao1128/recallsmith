import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { setAudiencePreference, type AudiencePreference } from '../features/gacha/audience/audiencePrefs';
import { completeOnboarding } from '../features/gacha/onboarding/onboardingPrefs';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'AudienceSurvey'>;

// Outcome-driven copy — was internal jargon ("balanced across easier
// and harder content", "stretch cards"). Now uses the user's perspective.
const OPTIONS: Array<{ key: AudiencePreference; label: string; body: string }> = [
  { key: 'junior', label: 'Just starting', body: 'Easier cards first to build confidence.' },
  { key: 'both', label: 'Mix it up', body: 'A balance of easy and hard cards.' },
  { key: 'all', label: 'Push me', body: 'Lean toward harder cards when new content arrives.' },
];

export function AudienceSurveyScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<AudiencePreference>('both');
  const [saving, setSaving] = useState(false);

  async function finish(preferenceOverride?: AudiencePreference) {
    if (saving) return;
    setSaving(true);
    try {
      await setAudiencePreference(preferenceOverride ?? selected);
      await completeOnboarding();
      navigation.replace('PermissionPrompt');
    } finally {
      setSaving(false);
    }
  }

  // Skip = use the balanced default ('both') — matches the visible
  // pre-selected option in the survey, so skipping is functionally
  // identical to "I'm fine with the default, just continue". Was 'all'
  // (stretch bias) which silently steered new users toward harder
  // content — wrong default for someone who didn't express a preference.
  async function skip() {
    if (saving) return;
    await finish('both');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={[colors.parchmentBg, colors.parchmentBgDeep]} style={styles.gradient}>
        <View style={styles.container}>
          <Text style={styles.eyebrow}>CONTENT PREFERENCE</Text>
          <Text style={styles.title}>Which lane should new content favor?</Text>
          <Text style={styles.body}>This only shapes new supply and draw recommendations. Due review stays intact.</Text>

          <View style={styles.optionList}>
            {OPTIONS.map((option) => {
              const active = selected === option.key;
              return (
                <Pressable key={option.key} style={({ pressed }) => [styles.optionCard, active && styles.optionCardActive, pressed && styles.pressed]} onPress={() => setSelected(option.key)}>
                  <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{option.label}</Text>
                  <Text style={styles.optionBody}>{option.body}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, saving && styles.buttonDisabled]} disabled={saving} onPress={() => void finish()}>
            <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Finish setup'}</Text>
          </Pressable>

          {/* Skip escape hatch — picks 'all' (most permissive) and
              advances. Lets users reach Home in 1 tap if they don't
              care about the survey. */}
          <Pressable
            style={({ pressed }) => [styles.skipLink, pressed && styles.pressed]}
            onPress={() => void skip()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Skip survey for now"
          >
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default AudienceSurveyScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: { marginTop: 12, fontSize: 28, lineHeight: 34, fontWeight: '900', color: colors.ink },
  body: { marginTop: 12, fontSize: 14, lineHeight: 21, color: colors.inkSecondary, fontWeight: '600' },
  optionList: { marginTop: 24, gap: 12 },
  optionCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.softCream,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: colors.shadowSoft,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  optionCardActive: {
    borderColor: colors.gold,
    backgroundColor: '#FFFFFF',
  },
  optionTitle: { fontSize: 15, fontWeight: '900', color: colors.ink },
  optionTitleActive: { color: colors.gold },
  optionBody: { marginTop: 6, fontSize: 12, lineHeight: 18, color: colors.inkMuted, fontWeight: '600' },
  // Primary CTA — pokeBlue 56pt to match the rest of the app
  primaryButton: {
    marginTop: 'auto',
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
  // Skip pill — upgraded from a quiet text link to a ghost-style
  // button, more clearly an alternative action. Same height as
  // primary's secondary peer, transparent + hairline border so it
  // doesn't compete with the primary visually.
  skipLink: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  skipLinkText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.65 },
});
