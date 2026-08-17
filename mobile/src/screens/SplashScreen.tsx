import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { getOnboardingStage } from '../features/gacha/onboarding/onboardingPrefs';
import { colors } from '../theme/colors';

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
      <LinearGradient colors={[colors.parchmentBg, colors.parchmentBgDeep]} style={styles.gradient}>
        <View style={styles.center}>
          {/* Soft gold halo behind the brand text — matches the warm
              backlight technique used on Home/Draw screens. */}
          <View pointerEvents="none" style={styles.halo} />
          <Text style={styles.brand}>DeveloperCards</Text>
          <Text style={styles.tagline}>Open packs. Learn cards. Master the deck.</Text>
          <ActivityIndicator color={colors.gold} style={{ marginTop: 16 }} />
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default SplashScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.parchmentBg },
  gradient: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  halo: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 280,
    backgroundColor: 'rgba(232,184,90,0.18)', // glowGold @ 18%
  },
  brand: { fontSize: 34, fontWeight: '900', color: colors.ink, letterSpacing: -0.5 },
  tagline: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkMuted,
    textAlign: 'center',
    fontWeight: '600',
  },
});
