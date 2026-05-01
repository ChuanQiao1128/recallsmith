import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MasteredCelebration'>;

export function MasteredCelebrationScreen({ navigation, route }: Props) {
  const { deckTitle, masteredCount } = route.params;
  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#0B1030', '#312E81']} style={styles.gradient}>
        <View style={styles.center}>
          <Text style={styles.eyebrow}>Mastered celebration</Text>
          <Text style={styles.title}>{masteredCount} card{masteredCount === 1 ? '' : 's'} advanced in {deckTitle}</Text>
          <Text style={styles.body}>This is the v6 shell for the higher-energy mastery moment. In later passes, this becomes the deeper ceremony layer.</Text>
          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.primaryButtonText}>Back to home</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default MasteredCelebrationScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0B1030' },
  gradient: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#E8B85A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#F5ECC4', textAlign: 'center' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#D6C79A', textAlign: 'center' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#E8B85A', paddingVertical: 16, paddingHorizontal: 22 },
  primaryButtonText: { color: '#111827', fontSize: 15, fontWeight: '900' },
  pressed: { opacity: 0.92 },
});
