import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { FILTER_META } from '../mock/library';

type Props = NativeStackScreenProps<RootStackParamList, 'SortFilter'>;

function Row(props: { title: string; values: string[] }) {
  return (
    <View style={styles.filterSection}>
      <Text style={styles.filterTitle}>{props.title}</Text>
      <View style={styles.chipWrap}>
        {props.values.map((value) => (
          <View key={value} style={styles.chip}>
            <Text style={styles.chipText}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function SortFilterScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Sort / filter</Text>
          <Text style={styles.title}>Filter library</Text>
          <Text style={styles.body}>This only changes how your library is browsed right now. Your due-review queue and daily route stay the same.</Text>

          <Row title="Status" values={FILTER_META.mastery.map((value) => value[0].toUpperCase() + value.slice(1))} />
          <Row title="Rarity" values={FILTER_META.rarity} />
          <Row title="Tags" values={FILTER_META.tags} />
          <Row title="Audience" values={FILTER_META.audience} />

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('AudienceFilter')}>
            <Text style={styles.primaryButtonText}>Audience focus</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('Library')}>
            <Text style={styles.secondaryButtonText}>Apply filters</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SortFilterScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  filterSection: { marginTop: 18, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.92)' },
  filterTitle: { fontSize: 14, fontWeight: '800', color: '#2A2218' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(42,34,24,0.08)' },
  chipText: { fontSize: 11, fontWeight: '700', color: '#2A2218', textTransform: 'capitalize' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(42,34,24,0.08)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
});