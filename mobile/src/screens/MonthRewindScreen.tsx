import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { REWIND_SLIDES } from '../mock/month';

type Props = NativeStackScreenProps<RootStackParamList, 'MonthRewind'>;

export function MonthRewindScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#1E1B4B', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Month rewind</Text>
          <Text style={styles.title}>Monthly high points</Text>
          <Text style={styles.body}>Use month rewind as a calm retrospective: enough signal to notice what moved, where the load spiked, and what should change next month.</Text>
          <View style={styles.panel}>
            {REWIND_SLIDES.map((item) => (
              <Text key={item} style={styles.rowText}>{item}</Text>
            ))}
          </View>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('PlanOverview')}>
            <Text style={styles.secondaryButtonText}>Back to plan</Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.primaryButtonText}>Back home</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default MonthRewindScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  panel: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  rowText: { marginTop: 8, fontSize: 13, color: '#D6C79A' },
  secondaryButton: { marginTop: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#F5ECC4', fontSize: 14, fontWeight: '800' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});