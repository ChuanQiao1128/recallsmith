import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'WeekSummary'>;

const STATS = [
  { title: 'Reviewed', value: '26' },
  { title: 'Mastered', value: '4' },
  { title: 'Active days', value: '5/7' },
  { title: 'Week streak', value: 'Wk 2' },
];

export function WeekSummaryScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Week summary</Text>
          <Text style={styles.title}>Your weekly rhythm, in one glance</Text>
          <Text style={styles.body}>This week stayed compact: enough activity to preserve momentum without turning the route into debt.</Text>

          <View style={styles.grid}>
            {STATS.map((item) => (
              <View key={item.title} style={styles.statCard}>
                <Text style={styles.statValue}>{item.value}</Text>
                <Text style={styles.statTitle}>{item.title}</Text>
              </View>
            ))}
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Next-week framing</Text>
            <Text style={styles.noteBody}>Keep weekday sessions short, then let the weekend hold the heavier interview cards.</Text>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('PlanOverview')}>
            <Text style={styles.primaryButtonText}>Open week plan</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default WeekSummaryScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  statCard: { width: '47%', borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.92)' },
  statValue: { fontSize: 22, fontWeight: '900', color: '#2A2218' },
  statTitle: { marginTop: 6, fontSize: 12, color: '#6B7280' },
  noteCard: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.88)' },
  noteTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  noteBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#5A4B38' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
