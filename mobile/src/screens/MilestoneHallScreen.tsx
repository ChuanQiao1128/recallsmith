import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MILESTONE_HALL } from '../mock/milestones';

type Props = NativeStackScreenProps<RootStackParamList, 'MilestoneHall'>;

export function MilestoneHallScreen({ navigation }: Props) {
  const unlockedCount = MILESTONE_HALL.flatMap((group) => group.badges).filter((badge) => badge.unlockedAt).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#1E1B4B', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Milestone hall</Text>
          <Text style={styles.title}>Pool-grouped badges and unlock tracks</Text>
          <Text style={styles.body}>Hall is the long-lived archive for collection and mastery recognition across pools.</Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{unlockedCount}</Text>
              <Text style={styles.summaryLabel}>Unlocked this season</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{MILESTONE_HALL.length}</Text>
              <Text style={styles.summaryLabel}>Tracked pools</Text>
            </View>
          </View>

          {MILESTONE_HALL.map((group) => (
            <View key={group.poolId} style={styles.groupCard}>
              <Text style={styles.groupTitle}>{group.poolTitle}</Text>
              {group.badges.map((badge) => (
                <Pressable key={badge.id} style={styles.badgeRow} onPress={() => navigation.navigate('MilestoneDetail', { milestoneId: badge.id })}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.badgeTitle}>{badge.title}</Text>
                    <Text style={styles.badgeSubtitle}>{badge.unlockedAt ? `Unlocked ${badge.unlockedAt}` : 'Locked'}</Text>
                  </View>
                  <Text style={styles.badgeAction}>Open</Text>
                </Pressable>
              ))}
            </View>
          ))}

          <View style={styles.row}>
            <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('MilestoneDetail', { milestoneId: 'bronze-collect' })}>
              <Text style={styles.primaryButtonText}>Open detail</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('StreakMilestone', { days: 7 })}>
              <Text style={styles.secondaryButtonText}>Daily streak</Text>
            </Pressable>
          </View>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('WeekStreakMilestone', { weeks: 4 })}>
            <Text style={styles.secondaryButtonText}>Week streak</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default MilestoneHallScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  summaryCard: { flex: 1, borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  summaryValue: { fontSize: 24, fontWeight: '900', color: '#F5ECC4' },
  summaryLabel: { marginTop: 6, fontSize: 11, fontWeight: '700', color: '#D6C79A', textTransform: 'uppercase', letterSpacing: 0.8 },
  groupCard: { marginTop: 18, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  groupTitle: { fontSize: 16, fontWeight: '800', color: '#F5ECC4' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  badgeTitle: { fontSize: 13, fontWeight: '800', color: '#F5ECC4' },
  badgeSubtitle: { marginTop: 4, fontSize: 11, color: '#D6C79A' },
  badgeAction: { fontSize: 11, fontWeight: '800', color: '#E8B85A' },
  row: { flexDirection: 'row', gap: 10, marginTop: 20 },
  primaryButton: { flex: 1, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { flex: 1, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  secondaryButtonText: { color: '#F5ECC4', fontSize: 14, fontWeight: '800' },
});