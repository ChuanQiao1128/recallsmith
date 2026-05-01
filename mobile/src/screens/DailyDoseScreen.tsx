import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MOCK_DAILY_DOSE } from '../mock/session';

type Props = NativeStackScreenProps<RootStackParamList, 'DailyDose'>;

export function DailyDoseScreen({ navigation, route }: Props) {
  const slug = route.params?.slug ?? 'csharp';
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F5F3FF', '#E0F2FE']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Daily dose</Text>
          <Text style={styles.title}>4 cards · about 6 minutes</Text>
          <Text style={styles.body}>Use this as today’s guided route. Warm-up first, then move into higher-pressure cards.</Text>

          {MOCK_DAILY_DOSE.map((card, index) => (
            <View key={card.stableUid} style={styles.row}>
              <Text style={styles.rowIndex}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{card.question}</Text>
                <Text style={styles.rowMeta}>{card.role} · Difficulty {card.difficulty}</Text>
              </View>
            </View>
          ))}

          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Level', { slug, source: 'daily-dose', cardIds: MOCK_DAILY_DOSE.map((card) => card.stableUid) })}>
            <Text style={styles.primaryButtonText}>Start daily dose</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.secondaryButtonText}>Maybe later</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DailyDoseScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F3FF' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#4F46E5', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#111827' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#4B5563' },
  row: { marginTop: 12, flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.9)' },
  rowIndex: { width: 24, fontSize: 15, fontWeight: '800', color: '#4F46E5' },
  rowTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  rowMeta: { marginTop: 4, fontSize: 11, color: '#6B7280', textTransform: 'capitalize' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#4F46E5', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(79,70,229,0.10)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#4F46E5', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.92 },
});
