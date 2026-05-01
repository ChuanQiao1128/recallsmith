import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { POOL_OVERVIEW } from '../mock/pools';

type Props = NativeStackScreenProps<RootStackParamList, 'PoolOverview'>;

export function PoolOverviewScreen({ navigation, route }: Props) {
  const pool = POOL_OVERVIEW[route.params.poolId as keyof typeof POOL_OVERVIEW] ?? POOL_OVERVIEW.csharp;
  const stats = [
    { title: 'Owned', value: pool.owned },
    { title: 'Due', value: pool.due },
    { title: 'Mastered', value: pool.mastered },
    { title: 'Leech', value: pool.leech },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Pool progress</Text>
          <Text style={styles.title}>{pool.title}</Text>
          <Text style={styles.body}>Track how complete this pool is, how much is already mastered, and where to drill into weaker tags next.</Text>

          <View style={styles.grid}>
            {stats.map((item) => (
              <View key={item.title} style={styles.statCard}>
                <Text style={styles.statValue}>{item.value}</Text>
                <Text style={styles.statLabel}>{item.title}</Text>
              </View>
            ))}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Collection progress</Text>
            <Text style={styles.panelBody}>20% → 50% → 80% → 100% owned</Text>
            <Text style={[styles.panelTitle, styles.secondaryPanelTitle]}>Mastery progress</Text>
            <Text style={styles.panelBody}>20% → 50% → 80% → 100% mastered</Text>
            <Text style={[styles.panelTitle, styles.secondaryPanelTitle]}>Best next move</Text>
            <Text style={styles.panelBody}>If due pressure is climbing, move into tag coverage first. If mastery is healthy, jump into milestones or browse representative cards.</Text>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('TagExplorer', { poolId: pool.poolId })}>
            <Text style={styles.primaryButtonText}>Explore tags</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('MilestoneHall')}>
            <Text style={styles.secondaryButtonText}>Milestone hall</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('Library')}>
            <Text style={styles.secondaryButtonText}>Back to library</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default PoolOverviewScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  statCard: { width: '47%', borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.92)' },
  statValue: { fontSize: 22, fontWeight: '900', color: '#2A2218' },
  statLabel: { marginTop: 4, fontSize: 11, color: '#6B7280' },
  panel: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.92)' },
  panelTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  secondaryPanelTitle: { marginTop: 12 },
  panelBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#6B7280' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(42,34,24,0.08)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
});