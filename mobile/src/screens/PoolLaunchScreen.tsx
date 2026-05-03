import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { POOL_OVERVIEW } from '../mock/pools';

type Props = NativeStackScreenProps<RootStackParamList, 'PoolLaunch'>;

export function PoolLaunchScreen({ navigation }: Props) {
  const aws = POOL_OVERVIEW.aws;
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#070A1F', '#1E1B4B']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Pool launch</Text>
          <Text style={styles.title}>A new pool is ready: {aws.title}</Text>
          <Text style={styles.body}>Day-15 expansion should feel like a product event: visible value, clear next action, and a lower-pressure entry point than the main route.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Launch snapshot</Text>
            <Text style={styles.cardBody}>{aws.owned} owned · {aws.mastered} mastered · {aws.leech} leech</Text>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Draw', { slug: 'aws' })}>
            <Text style={styles.primaryButtonText}>Open AWS draw</Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('Library')}>
            <Text style={styles.secondaryButtonText}>Browse library first</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default PoolLaunchScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A' },
  card: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.10)' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#F5ECC4' },
  cardBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#D6C79A' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#C8883A', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#F5ECC4', fontSize: 14, fontWeight: '800' },
});
