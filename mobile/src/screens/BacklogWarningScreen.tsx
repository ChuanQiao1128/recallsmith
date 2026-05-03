import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { BACKLOG_FIXTURES } from '../mock/recovery';

type Props = NativeStackScreenProps<RootStackParamList, 'BacklogWarning'>;

export function BacklogWarningScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Backlog</Text>
          <Text style={styles.title}>{BACKLOG_FIXTURES.medium.backlogCount} cards are piling up</Text>
          <Text style={styles.body}>Backlog warning reframes pressure into options: take a burst session, soften the week, or keep the route from turning into debt.</Text>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Current risk</Text>
            <Text style={styles.panelBody}>If nothing changes, the heavier weekend cards will stack on top of tomorrow’s reviews.</Text>
          </View>
          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('BacklogBurst')}>
            <Text style={styles.primaryButtonText}>Burst session</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('WeekPlannerPrompt')}>
            <Text style={styles.secondaryButtonText}>Week planner</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default BacklogWarningScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  panel: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.92)' },
  panelTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  panelBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#6B7280' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(42,34,24,0.08)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
});