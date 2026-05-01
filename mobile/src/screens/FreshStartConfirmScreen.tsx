import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { FRESH_START_SUMMARY } from '../mock/recovery';

type Props = NativeStackScreenProps<RootStackParamList, 'FreshStartConfirm'>;

export function FreshStartConfirmScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Fresh start confirm</Text>
          <Text style={styles.title}>See what resets before you commit</Text>
          <Text style={styles.body}>This is the deeper confirmation layer for returners who need a softer schedule reset without losing collection progress.</Text>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Collection kept</Text>
            <Text style={styles.panelBody}>{FRESH_START_SUMMARY.keepCollection} cards stay owned</Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Reset schedule</Text>
            <Text style={styles.panelBody}>{String(FRESH_START_SUMMARY.resetSchedule)}</Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Reset streak</Text>
            <Text style={styles.panelBody}>{String(FRESH_START_SUMMARY.resetStreak)}</Text>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.primaryButtonText}>Confirm and return home</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default FreshStartConfirmScreen;

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