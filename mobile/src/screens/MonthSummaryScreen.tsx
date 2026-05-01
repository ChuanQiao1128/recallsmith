import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { REWIND_SLIDES } from '../mock/month';

type Props = NativeStackScreenProps<RootStackParamList, 'MonthSummary'>;

export function MonthSummaryScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#1E1B4B', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Month rewind</Text>
          <Text style={styles.title}>Longer-term momentum, made visible</Text>
          <Text style={styles.body}>This screen turns a month of study into a compact story: owned, mastered, streaked, and what to protect next.</Text>

          {REWIND_SLIDES.map((slide, index) => (
            <View key={slide} style={styles.row}>
              <Text style={styles.rowIndex}>{index + 1}</Text>
              <Text style={styles.rowText}>{slide}</Text>
            </View>
          ))}

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.primaryButtonText}>Return home</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default MonthSummaryScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  row: { marginTop: 12, flexDirection: 'row', gap: 12, borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.10)' },
  rowIndex: { width: 24, fontSize: 15, fontWeight: '800', color: '#E8B85A' },
  rowText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#F5ECC4' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
