import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { POOL_OVERVIEW } from '../mock/pools';

type Props = NativeStackScreenProps<RootStackParamList, 'PausedPool'>;

export function PausedPoolScreen({ navigation }: Props) {
  const pausedPool = POOL_OVERVIEW.aws;
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Paused pool</Text>
          <Text style={styles.title}>{pausedPool.title} is paused for now</Text>
          <Text style={styles.body}>Paused pools stay out of the active route without losing owned cards or mastery history.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Current snapshot</Text>
            <Text style={styles.cardBody}>{pausedPool.owned} owned · {pausedPool.mastered} mastered · {pausedPool.due} due when resumed</Text>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.primaryButtonText}>Resume later from home</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default PausedPoolScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  card: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.9)' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  cardBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#6B7280' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
