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
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';


const CARD_STACK = [-12, -6, 0, 6, 12];
const DRAW_GRADIENT = [colors.cosmicBg, colors.cosmicBgDeep] as const;
const DRAW_COLOR = {
  dustLilac: 'rgba(201,173,247,1)',
  copyMuted: 'rgba(214,199,154,1)',
  copySoft: 'rgba(245,236,196,0.72)',
  copyFaint: 'rgba(245,236,196,0.22)',
  heroShell: 'rgba(14,18,52,0.88)',
  heroGlow: 'rgba(232,184,90,0.12)',
  cardBack: 'rgba(24,29,74,1)',
  actionLabel: 'rgba(140,106,47,1)',
  actionBody: 'rgba(93,75,54,1)',
  primaryText: 'rgba(255,249,240,1)',
} as const;
const PARTICLES = Array.from({ length: 18 }, (_, index) => ({
  left: `${6 + ((index * 17) % 84)}%`,
  top: `${8 + ((index * 11) % 78)}%`,
  size: index % 3 === 0 ? 6 : index % 2 === 0 ? 4 : 3,
  amber: index % 5 === 0,
  opacity: index % 4 === 0 ? 0.8 : 0.42,
}));
type DrawLoadState = 'loading' | 'ready' | 'empty' | 'error';

type Props = NativeStackScreenProps<RootStackParamList, 'Draw'>;

export function DrawScreen({ navigation, route }: Props) {
  const slugFromRoute = route.params?.slug ?? null;
  const rewardPending = route.params?.rewardPending ?? false;
  const [loadState, setLoadState] = useState<DrawLoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [wallet, setWallet] = useState<RewardWalletState>({ availablePulls: 0, reservePulls: 0 });
  const [slug, setSlug] = useState<string | null>(slugFromRoute);
  const [hasActivePool, setHasActivePool] = useState(false);
  const [hasTodayWork, setHasTodayWork] = useState(false);
  const [opening, setOpening] = useState(false);
  const [audiencePref, setAudiencePref] = useState<AudiencePreference>('both');
  const [pityBefore, setPityBefore] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      async function load() {
        setLoadState('loading');
        setLoadError(null);
        try {
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
              setHasActivePool(false);
              setWallet(nextWallet);
              setHasTodayWork(false);
              setAudiencePref(nextAudiencePref);
              setPityBefore(0);
              setLoadState('empty');
            }
            return;
          }

          const deck = await resolveDeckBySlug(nextSlug);
          const progress = deck ? await loadDeckProgress(deck) : [];
          const dueCount = progress.filter((item) => typeof item.nextReviewAt === 'number' && item.nextReviewAt > 0 && item.nextReviewAt <= Date.now()).length;
          const newCount = progress.filter((item) => !(typeof item.lastReviewedAt === 'number' && item.lastReviewedAt > 0)).length;

          if (!cancelled) {
            setSlug(nextSlug);
            setHasActivePool(!!deck);
            setWallet(nextWallet);
            setHasTodayWork(!!deck && (dueCount > 0 || newCount > 0));
            setAudiencePref(nextAudiencePref);
            setPityBefore(8);
            setLoadState(deck ? 'ready' : 'empty');
          }
        } catch (error: any) {
          if (!cancelled) {
            setHasActivePool(false);
            setLoadState('error');
            setLoadError(error?.message ?? 'Unable to load draw chamber right now.');
          }
        }
      }
      void load();
      return () => {
        cancelled = true;
      };
    }, [slugFromRoute, retryToken]),
  );

  const drawVm = useMemo(
    () => buildDrawState({ wallet, hasTodayWork, rewardPending, hasActivePool }),
    [wallet, hasTodayWork, rewardPending, hasActivePool],
  );

  const deckTitle = !hasActivePool ? 'No active pool' : slug === 'aws' ? 'AWS SAA' : slug ? 'C# Interview' : 'No active pool';
  const metaLine = `${wallet.availablePulls} token${wallet.availablePulls === 1 ? '' : 's'} · ${wallet.reservePulls} reserve · ${getAudiencePreferenceLabel(audiencePref)}`;

  async function openPull(drawCount: number, options?: { previewOnly?: boolean }) {
    if (!slug || opening || !hasActivePool) return;
    const previewOnly = options?.previewOnly ?? false;
    setOpening(true);
    try {
      const result = previewOnly ? null : await consumePullsFromStoredWallet(1);
      const drawResult = buildPoolDrawResult(slug, pityBefore, drawCount);
      if (result) {
        setWallet(result.wallet);
      }
      setPityBefore(drawResult.pityAfter);
      navigation.navigate('DrawCeremony', { slug, drawResult });
    } finally {
      setOpening(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
        <LinearGradient colors={DRAW_GRADIENT} style={styles.gradient}>
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.glowGold} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Preparing the draw chamber…
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
        <LinearGradient colors={DRAW_GRADIENT} style={styles.gradient}>
          <View style={styles.center}>
            <View style={styles.stateCard}>
              <Text style={styles.errorTitle} numberOfLines={2}>
                Draw unavailable right now
              </Text>
              <Text style={styles.errorBody} numberOfLines={2}>
                {loadError ?? 'Unable to load draw chamber right now.'}
              </Text>
              <Pressable
                testID="screen-draw-primary-cta"
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                onPress={() => setRetryToken((token) => token + 1)}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>
                  Retry
                </Text>
              </Pressable>
              <Pressable
                testID="screen-draw-secondary-cta"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                onPress={() => navigation.navigate('Library')}
              >
                <Text style={styles.secondaryButtonText} numberOfLines={1}>
                  View library
                </Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (loadState === 'empty') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
        <LinearGradient colors={DRAW_GRADIENT} style={styles.gradient}>
          <View style={styles.center}>
            <View style={styles.stateCard}>
              <Text style={styles.errorTitle} numberOfLines={2}>
                No active draw pool yet
              </Text>
              <Text style={styles.errorBody} numberOfLines={2}>
                Choose or install a pool from Library first, then come back to open pulls.
              </Text>
              <Pressable
                testID="screen-draw-primary-cta"
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                onPress={() => navigation.navigate('Library')}
              >
                <Text style={styles.primaryButtonText} numberOfLines={1}>
                  View library
                </Text>
              </Pressable>
              <Pressable
                testID="screen-draw-secondary-cta"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                onPress={() => navigation.navigate('Home')}
              >
                <Text style={styles.secondaryButtonText} numberOfLines={1}>
                  Back to Home
                </Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
      <LinearGradient colors={DRAW_GRADIENT} style={styles.gradient}>
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
                  backgroundColor: particle.amber ? colors.glowGold : DRAW_COLOR.dustLilac,
                  shadowColor: particle.amber ? colors.glowGold : DRAW_COLOR.dustLilac,
                },
              ]}
            />
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => navigation.goBack()}>
              <Text style={styles.backText} numberOfLines={1}>
                ← Home
              </Text>
            </Pressable>
            <Text style={styles.monoMeta} numberOfLines={1}>
              recall.draw(n=10)
            </Text>
          </View>

          <View style={styles.heroFrame}>
            <View style={styles.heroGlow} />
            <Text style={styles.kicker} numberOfLines={1}>
              Reward draw
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {drawVm.canOpen ? 'Reward draw' : 'Reward draw is locked for now'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {drawVm.canOpen
                ? 'Use reward pulls after the study route, not before it.'
                : 'Today still has study pressure. Clear the route first, then come back.'}
            </Text>

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
                  <Text style={[styles.cardBackGlyph, index === 2 && styles.cardBackGlyphActive]} numberOfLines={1}>
                    ◈
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaPill} numberOfLines={1}>
                Current pool · {deckTitle}
              </Text>
              <Text style={styles.metaPill} numberOfLines={1}>
                {metaLine}
              </Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoKicker} numberOfLines={1}>
              Drop odds
            </Text>
            <View style={styles.oddsRow}>
              <Text style={[styles.oddsChip, styles.oddsChipCom]} numberOfLines={1}>
                COM 70%
              </Text>
              <Text style={[styles.oddsChip, styles.oddsChipRar]} numberOfLines={1}>
                RAR 27%
              </Text>
              <Text style={[styles.oddsChip, styles.oddsChipLeg]} numberOfLines={1}>
                LEG 3%
              </Text>
            </View>
            <Text style={styles.infoBody} numberOfLines={2}>
              {buildPityProgressLabel(pityBefore)}
            </Text>
            <Text style={styles.supportText} numberOfLines={2}>
              {drawVm.canOpen
                ? 'A reward pull is ready. Open it now, then continue through ceremony and result spread.'
                : 'This draw chamber stays locked until today’s challenge is handled. Library remains available first.'}
            </Text>
          </View>

          <View style={styles.actionCard}> 
            <Text style={styles.actionLabel} numberOfLines={1}>
              What happens next
            </Text>
            <Text style={styles.actionTitle} numberOfLines={2}>
              {drawVm.canOpen ? 'Choose a light 1-pull peek or open the full 10-card reveal' : 'No reward pull is banked yet, but you can still preview the single-pull reveal'}
            </Text>
            <Text style={styles.actionBody} numberOfLines={2}>
              {drawVm.canOpen
                ? 'Single pull is the low-friction reward. Ten-pull is the full ceremony and result spread.'
                : 'Library stays available, and a preview single pull lets you test the draw animation first.'}
            </Text>

            <Pressable
              testID="screen-draw-primary-cta"
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, opening && styles.buttonDisabled]}
              disabled={opening}
              onPress={() => {
                if (drawVm.canOpen) {
                  void openPull(10);
                  return;
                }
                if (hasActivePool && slug) {
                  navigation.navigate('Deck', { slug } as any);
                  return;
                }
                navigation.navigate('Library');
              }}
            >
              <Text style={styles.primaryButtonText} numberOfLines={1}>
                {opening ? 'Opening…' : drawVm.canOpen ? 'Open 10 pull' : 'View library'}
              </Text>
            </Pressable>

            <Pressable
              testID="screen-draw-secondary-cta"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, opening && styles.buttonDisabled]}
              disabled={opening}
              onPress={() => {
                if (drawVm.canOpen) {
                  void openPull(1);
                  return;
                }
                if (hasActivePool && slug) {
                  void openPull(1, { previewOnly: true });
                  return;
                }
                navigation.navigate('Library');
              }}
            >
              <Text style={styles.secondaryButtonText} numberOfLines={1}>
                Open 1 pull
              </Text>
            </Pressable>
          </View>

        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.cosmicBgDeep },
  gradient: { flex: 1 },
  particleLayer: { ...StyleSheet.absoluteFillObject },
  particle: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  container: { paddingHorizontal: spacing.lg - 4, paddingTop: spacing.sm + 2, paddingBottom: 116 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg - 4 },
  stateCard: {
    width: '100%',
    borderRadius: spacing.lg,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
    backgroundColor: DRAW_COLOR.heroShell,
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.14)',
  },
  loadingText: { marginTop: spacing.sm, color: DRAW_COLOR.copyMuted, fontSize: typography.bodySmall, letterSpacing: 0.4 },
  errorTitle: { color: colors.cosmicInk, fontSize: typography.title3, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  errorBody: { marginTop: spacing.xs, color: DRAW_COLOR.copyMuted, fontSize: typography.bodySmall, lineHeight: 18, textAlign: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backButton: {
    borderRadius: 999,
    minHeight: a11y.minTouch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(245,236,196,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.cosmicInk, fontSize: 12, fontWeight: '700' },
  monoMeta: { fontSize: typography.caption, color: DRAW_COLOR.copySoft, letterSpacing: 1, fontFamily: 'Courier' },
  heroFrame: {
    borderRadius: 28,
    paddingHorizontal: spacing.lg - 4,
    paddingTop: spacing.lg - 2,
    paddingBottom: spacing.lg - 2,
    backgroundColor: DRAW_COLOR.heroShell,
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
    backgroundColor: DRAW_COLOR.heroGlow,
  },
  kicker: { color: colors.glowGold, fontSize: typography.caption, letterSpacing: 1.8, fontWeight: '800', fontFamily: 'Courier' },
  title: { marginTop: spacing.sm - 2, color: colors.cosmicInk, fontSize: typography.title1, lineHeight: 34, fontWeight: '900' },
  subtitle: { marginTop: spacing.xs, color: DRAW_COLOR.copyMuted, fontSize: typography.bodySmall, lineHeight: 19 },
  stackStage: { height: 240, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  cardBack: {
    position: 'absolute',
    width: 152,
    height: 206,
    borderRadius: 20,
    backgroundColor: DRAW_COLOR.cardBack,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.glowGold,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  cardBackGlyph: { color: DRAW_COLOR.copyFaint, fontSize: 42, fontFamily: 'Courier', fontWeight: '700' },
  cardBackGlyphActive: { color: colors.glowGold },
  metaRow: { gap: 8 },
  metaPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    backgroundColor: 'rgba(245,236,196,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.12)',
    color: colors.cosmicInk,
    fontSize: typography.caption,
    overflow: 'hidden',
  },
  infoCard: {
    borderRadius: 24,
    padding: spacing.md + 2,
    backgroundColor: 'rgba(245,236,196,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.12)',
    marginBottom: 16,
  },
  infoKicker: { color: colors.glowGold, fontSize: typography.caption, letterSpacing: 1.2, fontWeight: '800', fontFamily: 'Courier' },
  oddsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  oddsChip: {
    borderRadius: 999,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 6,
    fontSize: typography.caption,
    fontWeight: '800',
    marginRight: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  oddsChipCom: { backgroundColor: 'rgba(239,230,204,0.16)', color: DRAW_COLOR.copyMuted },
  oddsChipRar: { backgroundColor: 'rgba(201,173,247,0.16)', color: DRAW_COLOR.dustLilac },
  oddsChipLeg: { backgroundColor: 'rgba(232,184,90,0.18)', color: colors.glowGold },
  infoBody: { marginTop: 2, color: colors.cosmicInk, fontSize: typography.bodySmall, lineHeight: 18, fontWeight: '700' },
  supportText: { marginTop: spacing.xs, color: DRAW_COLOR.copySoft, fontSize: 12, lineHeight: 18 },
  actionCard: {
    borderRadius: 24,
    padding: spacing.md + 2,
    backgroundColor: colors.parchmentBgDeep,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  actionLabel: { color: DRAW_COLOR.actionLabel, fontSize: typography.caption, letterSpacing: 1.2, fontWeight: '800', fontFamily: 'Courier' },
  actionTitle: { marginTop: spacing.xs, color: colors.ink, fontSize: typography.title2, lineHeight: 28, fontWeight: '900' },
  actionBody: { marginTop: spacing.xs, color: DRAW_COLOR.actionBody, fontSize: typography.bodySmall, lineHeight: 19 },
  primaryButton: {
    marginTop: spacing.md,
    borderRadius: 16,
    minHeight: a11y.minTouch,
    paddingHorizontal: spacing.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    shadowColor: colors.gold,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonText: { color: DRAW_COLOR.primaryText, fontSize: typography.button, fontWeight: '900' },
  secondaryButton: {
    marginTop: spacing.sm - 2,
    borderRadius: 16,
    minHeight: a11y.minTouch,
    paddingHorizontal: spacing.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(42,34,24,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.10)',
  },
  secondaryButtonText: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  buttonDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.92 },
});
