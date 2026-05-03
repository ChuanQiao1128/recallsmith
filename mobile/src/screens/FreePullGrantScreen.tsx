import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { FREE_PULL_GRANTS } from '../mock/economy';

type Props = NativeStackScreenProps<RootStackParamList, 'FreePullGrant'>;

export function FreePullGrantScreen({ navigation, route }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#1E1B4B', '#FAF3E0']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Free pull grant</Text>
          <Text style={styles.title}>+{route.params.count} pulls from {route.params.source}</Text>
          <Text style={styles.body}>Grant screens are now part of the B-system reward layer: the user sees the source, the count, and the next inventory action.</Text>

          <View style={styles.panel}>
            {FREE_PULL_GRANTS.map((item) => (
              <Text key={item.id} style={styles.rowText}>{item.source} · +{item.count}</Text>
            ))}
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Draw', { slug: 'csharp', rewardPending: true })}>
            <Text style={styles.primaryButtonText}>Open draw</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('FreePullInventory')}>
            <Text style={styles.secondaryButtonText}>Inventory</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default FreePullGrantScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4', textTransform: 'capitalize' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  panel: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  rowText: { marginTop: 8, fontSize: 13, color: '#D6C79A', textTransform: 'capitalize' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#F5ECC4', fontSize: 14, fontWeight: '800' },
});