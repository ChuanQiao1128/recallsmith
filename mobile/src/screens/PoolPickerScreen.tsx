import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MOCK_POOLS } from '../mock/home';

type Props = NativeStackScreenProps<RootStackParamList, 'PoolPicker'>;

export function PoolPickerScreen({ navigation, route }: Props) {
  const activePoolId = route.params?.activePoolId ?? 'csharp';
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Pool picker</Text>
          <Text style={styles.title}>Choose the pool your home route should foreground</Text>
          <Text style={styles.body}>V6 uses this as the light-weight switcher between active pools and launch-ready pools.</Text>
          {MOCK_POOLS.map((pool) => {
            const active = pool.id === activePoolId;
            return (
              <Pressable key={pool.id} style={[styles.row, active && styles.rowActive]} onPress={() => navigation.replace('Home', { mockState: pool.id === 'aws' ? 'paused' : 'active' })}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{pool.title}</Text>
                  <Text style={styles.rowBody}>{pool.ownedCount} owned · {pool.dueToday} due · {pool.masteredCount} mastered</Text>
                </View>
                <Text style={styles.rowChip}>{active ? 'Active' : 'Open'}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default PoolPickerScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38' },
  row: { marginTop: 12, flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center' },
  rowActive: { borderWidth: 1, borderColor: 'rgba(200,136,58,0.28)' },
  rowTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  rowBody: { marginTop: 4, fontSize: 12, color: '#6B7280' },
  rowChip: { fontSize: 11, fontWeight: '800', color: '#C8883A' },
});