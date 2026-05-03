import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MILESTONE_DETAIL, MILESTONE_DETAILS_BY_ID } from '../mock/milestones';

type Props = NativeStackScreenProps<RootStackParamList, 'MilestoneDetail'>;

export function MilestoneDetailScreen({ navigation, route }: Props) {
  const detail = MILESTONE_DETAILS_BY_ID[route.params.milestoneId as keyof typeof MILESTONE_DETAILS_BY_ID] ?? MILESTONE_DETAIL;

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#1E1B4B', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Milestone detail</Text>
          <Text style={styles.title}>{detail.title}</Text>
          <Text style={styles.body}>{detail.body}</Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{detail.reward}</Text>
              <Text style={styles.summaryLabel}>Reward</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{route.params.milestoneId}</Text>
              <Text style={styles.summaryLabel}>Milestone id</Text>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Unlock path</Text>
            <Text style={styles.panelBody}>This detail view should explain why the badge exists, what it unlocks, and what the learner should do next once it lands.</Text>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('WeekStreakMilestone', { weeks: 4 })}>
            <Text style={styles.primaryButtonText}>Week streak milestone</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('MilestoneHall')}>
            <Text style={styles.secondaryButtonText}>Back to hall</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default MilestoneDetailScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  summaryCard: { flex: 1, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  summaryValue: { fontSize: 16, fontWeight: '800', color: '#F5ECC4' },
  summaryLabel: { marginTop: 6, fontSize: 11, color: '#D6C79A', textTransform: 'uppercase', letterSpacing: 0.8 },
  panel: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  panelTitle: { fontSize: 15, fontWeight: '800', color: '#F5ECC4' },
  panelBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#D6C79A' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#F5ECC4', fontSize: 14, fontWeight: '800' },
});