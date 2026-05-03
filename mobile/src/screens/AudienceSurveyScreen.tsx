import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { setAudiencePreference, type AudiencePreference } from '../features/gacha/audience/audiencePrefs';
import { completeOnboarding } from '../features/gacha/onboarding/onboardingPrefs';

type Props = NativeStackScreenProps<RootStackParamList, 'AudienceSurvey'>;

const OPTIONS: Array<{ key: AudiencePreference; label: string; body: string }> = [
  { key: 'junior', label: 'Junior', body: 'Prioritize simpler cards and clearer first wins.' },
  { key: 'both', label: 'Both', body: 'Keep the route balanced across easier and harder content.' },
  { key: 'all', label: 'All', body: 'Bias toward stretch cards when new content is selected.' },
];

export function AudienceSurveyScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<AudiencePreference>('both');
  const [saving, setSaving] = useState(false);

  async function finish() {
    if (saving) return;
    setSaving(true);
    try {
      await setAudiencePreference(selected);
      await completeOnboarding();
      navigation.replace('PermissionPrompt');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <View style={styles.container}>
          <Text style={styles.eyebrow}>Content preference</Text>
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
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default AudienceSurveyScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32 },
  eyebrow: { fontSize: 12, fontWeight: '900', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 12, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 12, fontSize: 14, lineHeight: 21, color: '#5A4B38' },
  optionList: { marginTop: 24, gap: 12 },
  optionCard: { borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.86)', borderWidth: 1, borderColor: 'rgba(42,34,24,0.08)' },
  optionCardActive: { borderColor: 'rgba(200,136,58,0.32)', backgroundColor: 'rgba(255,255,255,0.96)' },
  optionTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  optionTitleActive: { color: '#C8883A' },
  optionBody: { marginTop: 6, fontSize: 12, lineHeight: 18, color: '#6B7280' },
  primaryButton: { marginTop: 'auto', borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.65 },
});
