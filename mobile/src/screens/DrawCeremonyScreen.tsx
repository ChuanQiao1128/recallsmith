import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

const STAR_FIELD = Array.from({ length: 40 }, (_, index) => ({
  left: `${5 + ((index * 13) % 90)}%`,
  top: `${8 + ((index * 19) % 76)}%`,
  size: index % 3 === 0 ? 5 : index % 2 === 0 ? 3 : 2,
  amber: index % 6 === 0,
  opacity: index % 4 === 0 ? 0.85 : 0.45,
}));
const STACK_ROTATIONS = [-14, -7, 0, 7, 14];

type Props = NativeStackScreenProps<RootStackParamList, 'DrawCeremony'>;

export function DrawCeremonyScreen({ navigation, route }: Props) {
  const drawResult = route.params.drawResult ?? {
    poolId: route.params.slug,
    cards: [],
    pityBefore: 0,
    pityTriggered: false,
    pityAfter: 0,
    highlightedRarity: null,
  };
  const featuredRarity = drawResult.highlightedRarity ?? (drawResult.pityTriggered ? 'RAR+' : 'COM+');
  const statsLine = useMemo(() => {
    const leg = drawResult.cards.filter((card) => card.rarity === 'LEG').length;
    const rar = drawResult.cards.filter((card) => card.rarity === 'RAR').length;
    const com = drawResult.cards.filter((card) => card.rarity === 'COM').length;
    return `${leg}⚡ · ${rar}🔷 · ${com}⚪ · pity ${drawResult.pityAfter}/10`;
  }, [drawResult.cards, drawResult.pityAfter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('DrawResult', { slug: route.params.slug, drawResult });
    }, 900);
    return () => clearTimeout(timer);
  }, [drawResult, navigation, route.params.slug]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#0B1030', '#070A1F']} style={styles.gradient}>
        <View pointerEvents="none" style={styles.starLayer}>
          {STAR_FIELD.map((star, index) => (
            <View
              key={`star-${index}`}
              style={[
                styles.star,
                {
                  left: star.left as any,
                  top: star.top as any,
                  width: star.size,
                  height: star.size,
                  borderRadius: star.size,
                  opacity: star.opacity,
                  backgroundColor: star.amber ? '#E8B85A' : '#C9ADF7',
                  shadowColor: star.amber ? '#E8B85A' : '#C9ADF7',
                },
              ]}
            />
          ))}
          <View style={styles.centerGlow} />
        </View>

        <View style={styles.content}>
          <Text style={styles.metaLine}>Reward draw ceremony · {drawResult.seedLabel ?? 'seed #----'}</Text>
          <Text style={styles.title}>Opening your {drawResult.cards.length}-card reveal…</Text>
          <Text style={styles.body}>The center card surfaces first. Reward draw results lock in immediately after the ceremony, then hand off into the result spread.</Text>

          <View style={styles.stackStage}>
            {STACK_ROTATIONS.map((rotation, index) => (
              <View
                key={`back-${rotation}`}
                style={[
                  styles.cardBack,
                  {
                    transform: [{ translateY: Math.abs(rotation) * 0.45 }, { rotate: `${rotation}deg` }],
                    borderColor: index === 2 ? 'rgba(232,184,90,0.92)' : 'rgba(245,236,196,0.18)',
                    shadowOpacity: index === 2 ? 0.45 : 0.12,
                  },
                ]}
              >
                <Text style={[styles.cardGlyph, index === 2 && styles.cardGlyphCenter]}>◈</Text>
              </View>
            ))}
          </View>

          <View style={styles.footerBlock}>
            <Text style={styles.featuredText}>Featured reward window: {featuredRarity}</Text>
            {drawResult?.pityTriggered ? <Text style={styles.pityText}>Pity triggered · RAR+ guaranteed in this reveal</Text> : null}
            <Text style={styles.statsText}>{statsLine}</Text>
          </View>

          <Pressable style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]} onPress={() => navigation.replace('DrawResult', { slug: route.params.slug, drawResult })}>
            <Text style={styles.skipText}>Skip ceremony</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawCeremonyScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  starLayer: { ...StyleSheet.absoluteFillObject },
  star: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  centerGlow: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -130,
    marginTop: -130,
    width: 260,
    height: 260,
    borderRadius: 260,
    backgroundColor: 'rgba(232,184,90,0.13)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  metaLine: {
    color: '#E8B85A',
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: 'Courier',
  },
  title: {
    marginTop: 12,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    color: '#F8EFD2',
    textAlign: 'center',
  },
  body: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    color: '#D6C79A',
    textAlign: 'center',
    maxWidth: 280,
  },
  stackStage: {
    marginTop: 26,
    height: 270,
    width: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBack: {
    position: 'absolute',
    width: 156,
    height: 220,
    borderRadius: 22,
    backgroundColor: '#181D4A',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E8B85A',
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  cardGlyph: {
    fontSize: 44,
    color: 'rgba(245,236,196,0.20)',
    fontWeight: '700',
    fontFamily: 'Courier',
  },
  cardGlyphCenter: { color: '#E8B85A' },
  footerBlock: {
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(245,236,196,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.12)',
  },
  featuredText: { color: '#F5ECC4', fontSize: 13, fontWeight: '800' },
  pityText: { marginTop: 8, fontSize: 12, fontWeight: '800', color: '#E8B85A', textAlign: 'center' },
  statsText: { marginTop: 8, fontSize: 11, color: 'rgba(245,236,196,0.72)', fontFamily: 'Courier' },
  skipButton: {
    marginTop: 22,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(245,236,196,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.18)',
  },
  skipText: { color: '#F5ECC4', fontWeight: '800', fontSize: 12 },
  pressed: { opacity: 0.92 },
});
