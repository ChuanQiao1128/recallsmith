import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PermissionPrompt'>;

export function PermissionPromptScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Permission prompt</Text>
          <Text style={styles.title}>Allow reminders when the route starts slipping</Text>
          <Text style={styles.body}>In v6 this sits after first draw. For the front-end build, it acts as the final onboarding handoff into Home.</Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.replace('Home', { firstDrawCoach: true })}>
            <Text style={styles.primaryButtonText}>Allow and continue</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.replace('Home', { firstDrawCoach: true })}>
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default PermissionPromptScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(42,34,24,0.08)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
});