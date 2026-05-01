import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug } from '../content/activeDeck';
import { listManifestDecks, resolveDeckBySlug } from '../content/deckRepository';
import { loadDeckProgress } from '../review/storage';
import { buildDrawState } from '../features/gacha/draw/drawState';
import { buildPityProgressLabel } from '../features/gacha/draw/pity';
import { consumePullsFromStoredWallet, loadRewardWalletState, type RewardWalletState } from '../features/gacha/rewards/rewardWallet';
import { getAudiencePreference, type AudiencePreference } from '../features/gacha/audience/audiencePrefs';
import { getAudiencePreferenceLabel } from '../features/gacha/audience/audienceRules';
import { buildPoolDrawResult } from '../mock/draw';


const CARD_STACK = [-12, -6, 0, 6, 12];
const PARTICLES = Array.from({ length: 18 }, (_, index) => ({
  left: `${6 + ((index * 17) % 84)}%`,
  top: `${8 + ((index * 11) % 78)}%`,
  size: index % 3 === 0 ? 6 : index % 2 === 0 ? 4 : 3,
  amber: index % 5 === 0,
  opacity: index % 4 === 0 ? 0.8 : 0.42,
}));

type Props = NativeStackScreenProps<RootStackParamList, 'Draw'>;

export function DrawScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug ?? null;
  const rewardPending = route.params?.rewardPending ?? false;
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<RewardWalletState>({ availablePulls: 0, reservePulls: 0 });
  const [slug, setSlug] = useState<string | null>(slugFromRoute);
  const [hasTodayWork, setHasTodayWork] = useState(false);
  const [opening, setOpening] = useState(false);
  const [audiencePref, setAudiencePref] = useState<AudiencePreference>('both');
  const [pityBefore, setPityBefore] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        setLoading(true);
        let nextSlug = slugFromRoute;
        if (!nextSlug) nextSlug = await loadActiveDeckSlug();
        if (!nextSlug) {
          const manifest = await listManifestDecks();
          nextSlug = manifest[0]?.slug ?? null;
        }

        const [nextWallet, nextAudiencePref] = await Promise.all([loadRewardWalletState(), getAudiencePreference()]);

        if (!nextSlug) {
          if (!cancelled) {
            setSlug(null);
            setWallet(nextWallet);
            setHasTodayWork(false);
            setAudiencePref(nextAudiencePref);
            setPityBefore(0);
            setLoading(false);
          }
          return;
        }

        const deck = await resolveDeckBySlug(nextSlug);
        const progress = deck ? await loadDeckProgress(deck) : [];
        const dueCount = progress.filter((item) => typeof item.nextReviewAt === 'number' && item.nextReviewAt > 0 && item.nextReviewAt <= Date.now()).length;
        const newCount = progress.filter((item) => !(typeof item.lastReviewedAt === 'number' && item.lastReviewedAt > 0)).length;

        if (!cancelled) {
          setSlug(nextSlug);
          setWallet(nextWallet);
          setHasTodayWork(dueCount > 0 || newCount > 0);
          setAudiencePref(nextAudiencePref);
          setPityBefore(8);
          setLoading(false);
        }
      }
      void load();
      return () => {
        cancelled = true;
      };
    }, [slugFromRoute]),
  );

  const drawVm = useMemo(
    () => buildDrawState({ wallet, hasTodayWork, rewardPending }),
    [wallet, hasTodayWork, rewardPending],
  );

  const deckTitle = slug === 'aws' ? 'AWS SAA' : slug ? 'C# Interview' : 'No active pool';
  const metaLine = `${wallet.availablePulls} token${wallet.availablePulls === 1 ? '' : 's'} · ${wallet.reservePulls} reserve · ${getAudiencePreferenceLabel(audiencePref)}`;

  async function openPull(drawCount: number) {
    if (!slug || opening) return;
    setOpening(true);
    try {
      const result = await consumePullsFromStoredWallet(1);
      const drawResult = buildPoolDrawResult(slug, pityBefore, drawCount);
      setWallet(result.wallet);
      setPityBefore(drawResult.pityAfter);
      navigation.navigate('DrawCeremony', { slug, drawResult });
    } finally {
      setOpening(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#0B1030', '#070A1F']} style={styles.gradient}>
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#E8B85A" />
            <Text style={styles.loadingText}>Preparing the draw chamber…</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#0B1030', '#070A1F']} style={styles.gradient}>
        <View pointerEvents="none" style={styles.particleLayer}>
          {PARTICLES.map((particle, index) => (
            <View
              key={`particle-${index}`}
              style={[
                styles.particle,
                {
                  left: particle.left as any,
                  top: particle.top as any,
                  width: particle.size,
                  height: particle.size,
                  borderRadius: particle.size,
                  opacity: particle.opacity,
                  backgroundColor: particle.amber ? '#E8B85A' : '#C9ADF7',
                  shadowColor: particle.amber ? '#E8B85A' : '#C9ADF7',
                },
              ]}
            />
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => navigation.goBack()}>
              <Text style={styles.backText}>← Home</Text>
            </Pressable>
            <Text style={styles.monoMeta}>recall.draw(n=10)</Text>
          </View>

          <View style={styles.heroFrame}>
            <View style={styles.heroGlow} />
            <Text style={styles.kicker}>Reward draw</Text>
            <Text style={styles.title}>{drawVm.canOpen ? 'Reward draw' : 'Reward draw is locked for now'}</Text>
            <Text style={styles.subtitle}>{drawVm.canOpen ? 'Use reward pulls after the study route, not before it. This page should feel like a clean reward chamber, not another main workflow screen.' : 'Today still has study pressure. Clear the route first, then come back for the next reveal.'}</Text>

            <View style={styles.stackStage}>
              {CARD_STACK.map((rotation, index) => (
                <View
                  key={`stack-${rotation}`}
                  style={[
                    styles.cardBack,
                    {
                      transform: [{ translateY: Math.abs(rotation) * 0.7 }, { rotate: `${rotation}deg` }],
                      borderColor: index === 2 ? 'rgba(232,184,90,0.9)' : 'rgba(245,236,196,0.2)',
                      shadowOpacity: index === 2 ? 0.42 : 0.12,
                    },
                  ]}
                >
                  <Text style={[styles.cardBackGlyph, index === 2 && styles.cardBackGlyphActive]}>◈</Text>
                </View>
              ))}
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaPill}>Current pool · {deckTitle}</Text>
              <Text style={styles.metaPill}>{metaLine}</Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoKicker}>Drop odds</Text>
            <View style={styles.oddsRow}>
              <Text style={[styles.oddsChip, styles.oddsChipCom]}>COM 70%</Text>
              <Text style={[styles.oddsChip, styles.oddsChipRar]}>RAR 27%</Text>
              <Text style={[styles.oddsChip, styles.oddsChipLeg]}>LEG 3%</Text>
            </View>
            <Text style={styles.infoBody}>{buildPityProgressLabel(pityBefore)}</Text>
            <Text style={styles.supportText}>{drawVm.canOpen ? 'A reward pull is ready. Open it now, then let the ceremony hand off to the result spread and your library.' : 'This draw chamber stays locked until today’s challenge is handled. Library remains available if you want to inspect cards first.'}</Text>
          </View>

          <View style={styles.actionCard}> 
            <Text style={styles.actionLabel}>What happens next</Text>
            <Text style={styles.actionTitle}>{drawVm.canOpen ? 'Choose a light 1-pull peek or open the full 10-card reveal' : 'Your draw stays parked until today is handled'}</Text>
            <Text style={styles.actionBody}>{drawVm.canOpen ? 'Single pull is the low-friction reward. Ten-pull is the full ceremony and result spread.' : 'Library remains available now if you want to inspect cards or finish setup.'}</Text>

            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, opening && styles.buttonDisabled]}
              disabled={opening}
              onPress={() => {
                if (drawVm.canOpen) {
                  void openPull(10);
                  return;
                }
                navigation.navigate('Deck', slug ? ({ slug } as any) : (undefined as any));
              }}
            >
              <Text style={styles.primaryButtonText}>{opening ? 'Opening…' : drawVm.canOpen ? 'Open 10 pull' : 'View library'}</Text>
            </Pressable>

            {drawVm.canOpen ? (
              <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, opening && styles.buttonDisabled]} disabled={opening} onPress={() => void openPull(1)}>
                <Text style={styles.secondaryButtonText}>Open 1 pull</Text>
              </Pressable>
            ) : (
              <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Deck', slug ? ({ slug } as any) : (undefined as any))}>
                <Text style={styles.secondaryButtonText}>Browse archive instead</Text>
              </Pressable>
            )}
          </View>

        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  particleLayer: { ...StyleSheet.absoluteFillObject },
  particle: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  container: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 116 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  loadingText: { marginTop: 12, color: '#D6C79A', fontSize: 13, letterSpacing: 0.4 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(245,236,196,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.14)',
  },
  backText: { color: '#F5ECC4', fontSize: 12, fontWeight: '700' },
  monoMeta: { fontSize: 11, color: 'rgba(245,236,196,0.72)', letterSpacing: 1, fontFamily: 'Courier' },
  heroFrame: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 22,
    backgroundColor: 'rgba(14,18,52,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.14)',
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroGlow: {
    position: 'absolute',
    top: -40,
    left: '50%',
    marginLeft: -110,
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(232,184,90,0.12)',
  },
  kicker: { color: '#E8B85A', fontSize: 11, letterSpacing: 1.8, fontWeight: '800', fontFamily: 'Courier' },
  title: { marginTop: 10, color: '#F8EFD2', fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { marginTop: 8, color: '#D6C79A', fontSize: 13, lineHeight: 19 },
  stackStage: { height: 240, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  cardBack: {
    position: 'absolute',
    width: 152,
    height: 206,
    borderRadius: 20,
    backgroundColor: '#181D4A',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E8B85A',
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  cardBackGlyph: { color: 'rgba(245,236,196,0.22)', fontSize: 42, fontFamily: 'Courier', fontWeight: '700' },
  cardBackGlyphActive: { color: '#E8B85A' },
  metaRow: { gap: 8 },
  metaPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(245,236,196,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.12)',
    color: '#F5ECC4',
    fontSize: 11,
    overflow: 'hidden',
  },
  infoCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: 'rgba(245,236,196,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.12)',
    marginBottom: 16,
  },
  infoKicker: { color: '#E8B85A', fontSize: 11, letterSpacing: 1.2, fontWeight: '800', fontFamily: 'Courier' },
  oddsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  oddsChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '800',
    marginRight: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  oddsChipCom: { backgroundColor: 'rgba(239,230,204,0.16)', color: '#D6C79A' },
  oddsChipRar: { backgroundColor: 'rgba(201,173,247,0.16)', color: '#C9ADF7' },
  oddsChipLeg: { backgroundColor: 'rgba(232,184,90,0.18)', color: '#E8B85A' },
  infoBody: { marginTop: 2, color: '#F5ECC4', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  supportText: { marginTop: 8, color: 'rgba(245,236,196,0.72)', fontSize: 12, lineHeight: 18 },
  actionCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#F4EAD0',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  actionLabel: { color: '#8C6A2F', fontSize: 11, letterSpacing: 1.2, fontWeight: '800', fontFamily: 'Courier' },
  actionTitle: { marginTop: 8, color: '#241B10', fontSize: 22, lineHeight: 28, fontWeight: '900' },
  actionBody: { marginTop: 8, color: '#5D4B36', fontSize: 13, lineHeight: 19 },
  primaryButton: {
    marginTop: 16,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: '#C8883A',
    shadowColor: '#C8883A',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonText: { color: '#FFF9F0', fontSize: 15, fontWeight: '900' },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: 'rgba(42,34,24,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.10)',
  },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
  buttonDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.92 },
});
