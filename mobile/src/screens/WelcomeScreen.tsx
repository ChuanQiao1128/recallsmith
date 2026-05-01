import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { completeWelcome } from '../features/gacha/onboarding/onboardingPrefs';

const PAGES = [
  {
    title: 'Draw makes the start lighter',
    body: 'Open the app, see your route, and use reward pulls as a support loop instead of a distraction.',
  },
  {
    title: 'One card keeps the day alive',
    body: 'You do not need a giant session to preserve momentum. v6 is built around small daily closure.',
  },
  {
    title: 'The system should adapt to you',
    body: 'Audience, streak, milestones, and plan should all feel like support systems around recall.',
  },
] as const;

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  const [index, setIndex] = useState(0);
  const page = PAGES[index];

  async function next() {
    if (index < PAGES.length - 1) {
      setIndex((value) => value + 1);
      return;
    }
    await completeWelcome();
    navigation.replace('AudienceSurvey');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F5F3FF', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Welcome</Text>
          <Text style={styles.title}>{page.title}</Text>
          <Text style={styles.body}>{page.body}</Text>

          <View style={styles.progressRow}>
            {PAGES.map((_, itemIndex) => (
              <View key={itemIndex} style={[styles.progressDot, itemIndex === index && styles.progressDotActive]} />
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>What changes in phase A</Text>
            <Text style={styles.cardBody}>Home becomes a product surface, Draw becomes a visible flow, and Settlement becomes a real completion layer.</Text>
          </View>

          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => void next()}>
            <Text style={styles.primaryButtonText}>{index === PAGES.length - 1 ? 'Continue to audience' : 'Next'}</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default WelcomeScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 32 },
  eyebrow: { fontSize: 12, fontWeight: '900', color: '#4F46E5', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 12, fontSize: 30, lineHeight: 36, fontWeight: '900', color: '#111827' },
  body: { marginTop: 12, fontSize: 15, lineHeight: 22, color: '#4B5563' },
  progressRow: { flexDirection: 'row', gap: 8, marginTop: 20 },
  progressDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: 'rgba(79,70,229,0.18)' },
  progressDotActive: { backgroundColor: '#4F46E5' },
  card: { marginTop: 24, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.86)' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  cardBody: { marginTop: 8, fontSize: 13, lineHeight: 19, color: '#6B7280' },
  primaryButton: { marginTop: 28, borderRadius: 14, backgroundColor: '#4F46E5', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.92 },
});
