import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { BURST_SESSION } from '../mock/recovery';

type Props = NativeStackScreenProps<RootStackParamList, 'BacklogBurst'>;

export function BacklogBurstScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Burst session</Text>
          <Text style={styles.title}>{BURST_SESSION.totalCards} cards · ~{BURST_SESSION.remainingMinutes} minutes</Text>
          <Text style={styles.body}>Burst is the high-pressure recovery option. It should feel deliberate, not like the app is punishing the user.</Text>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Session shape</Text>
            <Text style={styles.panelBody}>Warm-up first, clear the backlog cluster second, then return to a smaller normal route tomorrow.</Text>
          </View>
          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Settlement', { slug: 'csharp', deckTitle: 'C# Interview', sessionDone: BURST_SESSION.totalCards, rewardPulls: 2, masteredCount: 1 })}>
            <Text style={styles.primaryButtonText}>Open burst settlement</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.secondaryButtonText}>Back home</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default BacklogBurstScreen;

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