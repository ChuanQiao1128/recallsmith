import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { getOnboardingStage } from '../features/gacha/onboarding/onboardingPrefs';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export function SplashScreen({ navigation }: Props) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stage = await getOnboardingStage();
      if (cancelled) return;
      if (stage === 'welcome') navigation.replace('Welcome');
      else if (stage === 'audience') navigation.replace('AudienceSurvey');
      else navigation.replace('Home');
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#0B1030', '#1E1B4B']} style={styles.gradient}>
        <View style={styles.center}>
          <Text style={styles.brand}>RecallSmith</Text>
          <Text style={styles.tagline}>Adaptive study, wrapped like a ritual.</Text>
          <ActivityIndicator color="#E8B85A" style={{ marginTop: 16 }} />
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SplashScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0B1030' },
  gradient: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  brand: { fontSize: 32, fontWeight: '900', color: '#F5ECC4' },
  tagline: { marginTop: 8, fontSize: 14, lineHeight: 20, color: '#D6C79A', textAlign: 'center' },
});
