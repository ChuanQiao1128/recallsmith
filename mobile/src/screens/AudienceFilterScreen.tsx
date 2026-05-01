import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { FILTER_META } from '../mock/library';

type Props = NativeStackScreenProps<RootStackParamList, 'AudienceFilter'>;

export function AudienceFilterScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Audience filter</Text>
          <Text style={styles.title}>Choose an audience focus</Text>
          <Text style={styles.body}>Due review stays the same. Use this only to bias which owned cards feel most relevant while you browse, not to rewrite the review queue.</Text>

          <View style={styles.matrix}>
            {FILTER_META.audience.map((option) => (
              <View key={option} style={styles.optionCard}>
                <Text style={styles.optionTitle}>{option}</Text>
                <Text style={styles.optionBody}>{option === 'all' ? 'Show every card without narrowing' : option === 'backend' ? 'Bias tags and examples toward system / infra thinking' : option === 'frontend' ? 'Bias tags and examples toward UI / client thinking' : 'Blend both lenses while browsing'}</Text>
              </View>
            ))}
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Library')}>
            <Text style={styles.primaryButtonText}>Apply focus</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('TagExplorer', { poolId: 'csharp' })}>
            <Text style={styles.secondaryButtonText}>Back to tag coverage</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default AudienceFilterScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  matrix: { gap: 12, marginTop: 18 },
  optionCard: { borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.92)' },
  optionTitle: { fontSize: 14, fontWeight: '800', color: '#2A2218', textTransform: 'capitalize' },
  optionBody: { marginTop: 4, fontSize: 12, color: '#6B7280' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(42,34,24,0.08)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
});