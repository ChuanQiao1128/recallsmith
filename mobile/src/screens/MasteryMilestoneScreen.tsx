import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MasteryMilestone'>;

export function MasteryMilestoneScreen({ navigation, route }: Props) {
  const { poolId, tier } = route.params;
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#312E81', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Mastery milestone</Text>
          <Text style={styles.title}>{tier} mastery reached in {poolId}</Text>
          <Text style={styles.body}>This is the base phase-A mastery ceremony so settlement can hand off into a visible track reward before Hall and Profile are finished.</Text>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What it means</Text>
            <Text style={styles.cardBody}>You are no longer just collecting. The route is proving retained knowledge across repeated recall wins.</Text>
          </View>
          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Settlement', { slug: 'csharp', deckTitle: 'C# Interview', sessionDone: 4, rewardPulls: 3, masteredCount: 1 })}>
            <Text style={styles.primaryButtonText}>Back to settlement</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default MasteryMilestoneScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  card: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#F5ECC4' },
  cardBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#D6C79A' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});