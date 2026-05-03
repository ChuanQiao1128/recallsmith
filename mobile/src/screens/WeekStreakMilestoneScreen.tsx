import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'WeekStreakMilestone'>;

export function WeekStreakMilestoneScreen({ navigation, route }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#1E1B4B', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Week streak</Text>
          <Text style={styles.title}>🔥 Wk {route.params.weeks}</Text>
          <Text style={styles.body}>Week streak is the long-horizon cadence reward for repeat weekly return, especially valuable for weekend-heavy users.</Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('FreePullInventory')}>
            <Text style={styles.primaryButtonText}>Open inventory</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.secondaryButtonText}>Back home</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default WeekStreakMilestoneScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#F5ECC4', fontSize: 14, fontWeight: '800' },
});