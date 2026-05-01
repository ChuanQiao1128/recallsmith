import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { TAG_BREAKDOWN } from '../mock/library';

type Props = NativeStackScreenProps<RootStackParamList, 'TagExplorer'>;

export function TagExplorerScreen({ navigation, route }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Tag coverage</Text>
          <Text style={styles.title}>{route.params.poolId} tag coverage</Text>
          <Text style={styles.body}>See which topics are already well covered, which ones still feel shallow, and where a tag-level sweep would sharpen the library fastest.</Text>

          {TAG_BREAKDOWN.map((item) => (
            <Pressable key={item.tag} style={styles.row} onPress={() => navigation.navigate('CardDetail', { cardId: 'card-1' })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.tag}</Text>
                <Text style={styles.rowBody}>{item.owned}/{item.total} owned · tap into a representative card</Text>
              </View>
              <Text style={styles.rowPct}>{Math.round((item.owned / item.total) * 100)}%</Text>
            </Pressable>
          ))}

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('AudienceFilter')}>
            <Text style={styles.primaryButtonText}>Filter library by tag</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('PoolOverview', { poolId: route.params.poolId })}>
            <Text style={styles.secondaryButtonText}>Back to pool progress</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default TagExplorerScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218', textTransform: 'capitalize' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  row: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.92)' },
  rowTitle: { fontSize: 14, fontWeight: '800', color: '#2A2218' },
  rowBody: { marginTop: 4, fontSize: 12, color: '#6B7280' },
  rowPct: { fontSize: 13, fontWeight: '800', color: '#C8883A' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(42,34,24,0.08)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
});