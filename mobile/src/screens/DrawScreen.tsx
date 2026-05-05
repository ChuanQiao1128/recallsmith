import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as RN from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import { checkManifestForUpdates, installDeckFromUrl, listManifestDecks, resolveDeckBySlug } from '../content/deckRepository';
import { commitDraw } from '../features/gacha/draw/drawCommit';
import {
  consumePullsFromStoredWallet,
  loadRewardWalletState,
  saveRewardWalletState,
  type RewardWalletState,
} from '../features/gacha/rewards/rewardWallet';
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { PAGE_GRADIENT_LIGHT, packImageForSlug, packPaletteFromSlug, type PackPalette } from '../theme/packArt';

function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const A: any = readRN('Animated', {});
const RNImage: any = readRN('Image', null);
const AnimatedView: any = A.View ?? View;
const hasAnimated = typeof A.Value === 'function';

type Props = NativeStackScreenProps<RootStackParamList, 'Draw'>;
type DrawLoadState = 'loading' | 'ready' | 'empty' | 'error';
type DeckOption = { slug: string; title: string };
type DrawReady = {
  slug: string;
  deckTitle: string;
  walletPulls: number;
  canPullSingle: boolean;
  canPullMulti: boolean;
  deckOptions: DeckOption[];
};

const SWIPE_ARM_DISTANCE = 72;
const SWIPE_TRACK_WIDTH = 200;
const PACK_WIDTH = 218;
const PACK_HEIGHT = 312;

function spendablePulls(wallet: RewardWalletState): number {
  return Math.max(0, Number(wallet.availablePulls ?? 0) || 0);
}

function normalizeTitle(raw: any, fallback: string): string {
  const fromManifest = String(raw?.title ?? raw?.Title ?? raw?.name ?? raw?.displayName ?? '').trim();
  return fromManifest || fallback;
}

function buildDeckOptions(manifest: any[]): DeckOption[] {
  const out: DeckOption[] = [];
  const seen = new Set<string>();
  for (const item of manifest) {
    const slug = String(item?.slug ?? '').trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, title: normalizeTitle(item, slug) });
  }
  return out;
}

function findNeighbors(options: DeckOption[], currentSlug: string): { left: DeckOption | null; right: DeckOption | null } {
  if (options.length <= 1) return { left: null, right: null };
  const index = options.findIndex((item) => item.slug === currentSlug);
  const currentIndex = index >= 0 ? index : 0;
  const left = options[(currentIndex - 1 + options.length) % options.length] ?? null;
  const right = options[(currentIndex + 1) % options.length] ?? null;
  return { left: left?.slug === currentSlug ? null : left, right: right?.slug === currentSlug ? null : right };
}

function NeighborHint({
  side,
  deck,
  disabled,
  onPress,
}: {
  side: 'left' | 'right';
  deck: DeckOption | null;
  disabled: boolean;
  onPress: () => void;
}) {
  if (!deck) {
    return <View testID={`draw-neighbor-${side}`} style={styles.neighborPlaceholder} />;
  }
  const palette = packPaletteFromSlug(deck.slug);
  return (
    <Pressable
      testID={`draw-neighbor-${side}`}
      accessibilityRole="button"
      accessibilityLabel={`Select ${deck.title}`}
      disabled={disabled}
      style={({ pressed }) => [styles.neighborWrap, disabled && styles.ctaDisabled, pressed && styles.pressed]}
      onPress={onPress}
    >
      <LinearGradient colors={palette.cover} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.neighborCard, { borderColor: palette.ring }]}> 
        <Text style={[styles.neighborArrow, { color: palette.titleInk }]} numberOfLines={1}>
          {side === 'left' ? '‹' : '›'}
        </Text>
      </LinearGradient>
      <Text style={styles.neighborTitle} numberOfLines={1}>
        {deck.title}
      </Text>
    </Pressable>
  );
}

function PackArt({
  palette,
  bobbingValue,
  shineValue,
  title,
  badgeText,
  coverImage,
}: {
  palette: PackPalette;
  bobbingValue: any;
  shineValue: any;
  title: string;
  badgeText: string;
  coverImage: any;
}) {
  const translateY = hasAnimated && bobbingValue ? bobbingValue.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] }) : 0;
  const wobbleRotate = hasAnimated && bobbingValue ? bobbingValue.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-1.6deg', '0deg', '1.6deg'] }) : '0deg';
  const shineLeft = hasAnimated && shineValue ? shineValue.interpolate({ inputRange: [0, 1], outputRange: [-PACK_WIDTH * 0.6, PACK_WIDTH * 1.1] }) : -PACK_WIDTH * 0.6;

  return (
    <AnimatedView style={[styles.packShadow, hasAnimated ? { transform: [{ translateY }, { rotate: wobbleRotate }] } : null]}>
      <LinearGradient colors={palette.cover} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.pack, { borderColor: palette.ring }]}> 
        {coverImage && RNImage ? <RNImage source={coverImage} resizeMode="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none" /> : null}

        <View style={[styles.packBadge, { backgroundColor: palette.badgeBg }]}>
          <Text style={[styles.packBadgeText, { color: palette.badgeInk }]} numberOfLines={1}>
            {badgeText}
          </Text>
        </View>

        <View style={styles.packBrandStripe}>
          <Text style={styles.packBrandPokemon} numberOfLines={1}>
            Pokémon
          </Text>
          <Text style={styles.packBrandPocket} numberOfLines={1}>
            Pocket
          </Text>
        </View>

        <View style={styles.packArtWindow}>
          <View style={[styles.packArtBlob, { backgroundColor: palette.cover[0], opacity: 0.7 }]} />
          <View style={[styles.packArtBlob, { backgroundColor: palette.cover[2], opacity: 0.7, marginLeft: 30, marginTop: -40 }]} />
          <View style={[styles.packArtBlob, { backgroundColor: palette.cover[1], opacity: 0.6, marginLeft: -42, marginTop: -28 }]} />
        </View>

        <View style={styles.packTitleSlab}>
          <Text style={[styles.packTitle, { color: palette.titleInk }]} numberOfLines={2}>
            {title}
          </Text>
        </View>

        <AnimatedView pointerEvents="none" style={[styles.packShine, hasAnimated ? { transform: [{ translateX: shineLeft }, { rotate: '14deg' }] } : null]} />
      </LinearGradient>
    </AnimatedView>
  );
}

export function DrawScreen({ navigation, route }: Props) {
  const [loadState, setLoadState] = useState<DrawLoadState>('loading');
  const [ready, setReady] = useState<DrawReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(route.params?.slug ?? null);
  const [swipePrimed, setSwipePrimed] = useState(false);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeResetTimerRef = useRef<number | null>(null);

  const bobbingRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const shineRef = useRef<any>(hasAnimated ? new A.Value(0) : null);

  useEffect(() => {
    if (route.params?.slug) {
      setSelectedSlug(route.params.slug);
    }
  }, [route.params?.slug]);

  const palette = useMemo(() => packPaletteFromSlug(ready?.slug ?? selectedSlug ?? route.params?.slug ?? ''), [ready?.slug, route.params?.slug, selectedSlug]);
  const coverImage = useMemo(() => packImageForSlug(ready?.slug ?? selectedSlug ?? route.params?.slug ?? ''), [ready?.slug, route.params?.slug, selectedSlug]);
  const neighbors = useMemo(() => findNeighbors(ready?.deckOptions ?? [], ready?.slug ?? ''), [ready?.deckOptions, ready?.slug]);

  const clearSwipeResetTimer = useCallback(() => {
    if (swipeResetTimerRef.current != null) {
      clearTimeout(swipeResetTimerRef.current);
      swipeResetTimerRef.current = null;
    }
  }, []);

  const armSwipe = useCallback(() => {
    clearSwipeResetTimer();
    setSwipePrimed(true);
    setSwipeDelta(0);
    const timer = setTimeout(() => {
      setSwipePrimed(false);
      setSwipeDelta(0);
    }, 4500) as unknown as number;
    swipeResetTimerRef.current = timer;
  }, [clearSwipeResetTimer]);

  useEffect(() => {
    if (!hasAnimated) return;
    const bob = A.loop(A.sequence([A.timing(bobbingRef.current, { toValue: 1, duration: 1600, useNativeDriver: true }), A.timing(bobbingRef.current, { toValue: 0, duration: 1600, useNativeDriver: true })]));
    const shine = A.loop(A.sequence([A.timing(shineRef.current, { toValue: 1, duration: 2200, useNativeDriver: true }), A.timing(shineRef.current, { toValue: 0, duration: 0, useNativeDriver: true }), A.delay(2400)]));
    bob.start?.();
    shine.start?.();
    return () => {
      bob.stop?.();
      shine.stop?.();
    };
  }, []);

  useEffect(() => clearSwipeResetTimer, [clearSwipeResetTimer]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const resolveOrInstall = async (slug: string) => {
        let deck = await resolveDeckBySlug(slug);
        if (deck) return deck;
        const updates = await checkManifestForUpdates(false);
        const update = updates[slug];
        if (!update?.remoteUrl) return null;
        const installed = await installDeckFromUrl(slug, update.remoteUrl, update.remoteVersion, update.remoteSha256);
        if (!installed) return null;
        return resolveDeckBySlug(slug);
      };

      const load = async () => {
        setLoadState('loading');
        setError(null);
        try {
          const manifest = await listManifestDecks({ preferRemote: true });
          const live = manifest.filter((item: any) => String(item?.availability ?? '').toLowerCase() === 'live');
          const manifestForOptions = live.length > 0 ? live : manifest;
          const deckOptions = buildDeckOptions(manifestForOptions);

          const firstSlug = deckOptions[0]?.slug ?? null;
          let slug = selectedSlug ?? route.params?.slug ?? (await loadActiveDeckSlug()) ?? firstSlug;
          if (!slug) {
            if (!cancelled) {
              setReady(null);
              setLoadState('empty');
            }
            return;
          }

          await setActiveDeckSlug(slug).catch(() => {});
          let deck = await resolveOrInstall(slug);

          if (!deck && firstSlug && firstSlug !== slug) {
            slug = firstSlug;
            await setActiveDeckSlug(slug).catch(() => {});
            deck = await resolveOrInstall(slug);
          }

          if (!deck) {
            if (!cancelled) {
              setReady(null);
              setLoadState('empty');
            }
            return;
          }

          const wallet = await loadRewardWalletState();
          const pulls = spendablePulls(wallet);
          const deckTitle = normalizeTitle(deck, slug);
          const mergedOptions = deckOptions.some((item) => item.slug === slug)
            ? deckOptions.map((item) => (item.slug === slug ? { ...item, title: deckTitle } : item))
            : [{ slug, title: deckTitle }, ...deckOptions];

          if (!cancelled) {
            setReady({
              slug,
              deckTitle,
              walletPulls: pulls,
              canPullSingle: pulls >= 1,
              canPullMulti: pulls >= 10,
              deckOptions: mergedOptions,
            });
            setSelectedSlug(slug);
            setSwipePrimed(false);
            setSwipeDelta(0);
            setLoadState('ready');
          }
        } catch (loadError: any) {
          if (!cancelled) {
            setReady(null);
            setLoadState('error');
            setError(loadError?.message ?? 'Unable to load draw chamber right now.');
          }
        }
      };

      void load();
      return () => {
        cancelled = true;
      };
    }, [retryToken, route.params?.slug, selectedSlug]),
  );

  const switchDeck = useCallback(
    (slug: string) => {
      if (!ready || opening || slug === ready.slug) return;
      clearSwipeResetTimer();
      setSwipePrimed(false);
      setSwipeDelta(0);
      setSelectedSlug(slug);
    },
    [clearSwipeResetTimer, opening, ready],
  );

  const open = useCallback(
    async (drawCount: 1 | 10) => {
      if (!ready || opening || !swipePrimed) return;
      if ((drawCount === 1 && !ready.canPullSingle) || (drawCount === 10 && !ready.canPullMulti)) return;

      clearSwipeResetTimer();
      setSwipePrimed(false);
      setSwipeDelta(0);
      setOpening(true);
      let walletBefore: RewardWalletState | null = null;
      try {
        walletBefore = await loadRewardWalletState();
        const spent = await consumePullsFromStoredWallet(drawCount);
        const result = await commitDraw(ready.slug, drawCount);
        if (!result) {
          await saveRewardWalletState(walletBefore).catch(() => {});
          setLoadState('error');
          setError('Unable to open this pack right now.');
          return;
        }

        const latestPulls = spendablePulls(spent.wallet);
        setReady((prev) =>
          prev
            ? { ...prev, walletPulls: latestPulls, canPullSingle: latestPulls >= 1, canPullMulti: latestPulls >= 10 }
            : prev,
        );

        navigation.navigate('DrawCeremony', {
          slug: ready.slug,
          drawResult: {
            poolId: ready.slug,
            cards: result.cards,
            pityBefore: result.pityBefore,
            pityAfter: result.pityAfter,
            pityTriggered: result.pityFiredFor !== null,
            highlightedRarity: result.highlightedRarity,
          },
          deckTitle: ready.deckTitle,
          ownedAfter: result.ownedAfter,
          totalCards: result.totalCards,
        });
      } catch {
        if (walletBefore) {
          await saveRewardWalletState(walletBefore).catch(() => {});
        }
        setLoadState('error');
        setError('Unable to open this pack right now.');
      } finally {
        setOpening(false);
      }
    },
    [clearSwipeResetTimer, navigation, opening, ready, swipePrimed],
  );

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
        <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
          <View style={styles.centerWrap}>
            <ActivityIndicator size="large" color={colors.pokeBlueDeep} />
            <Text style={styles.loadingText} numberOfLines={1}>
              Preparing draw...
            </Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
        <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
          <View style={styles.centerWrap}>
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle} numberOfLines={2}>
                Draw unavailable right now
              </Text>
              <Text style={styles.stateBody} numberOfLines={2}>
                {error ?? 'Unable to load draw chamber right now.'}
              </Text>
              <Pressable testID="screen-draw-primary-cta" style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]} onPress={() => setRetryToken((token) => token + 1)}>
                <Text style={styles.primaryCtaText} numberOfLines={1}>
                  Retry
                </Text>
              </Pressable>
              <Pressable testID="screen-draw-secondary-cta" style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]} onPress={() => navigation.navigate('Home')}>
                <Text style={styles.secondaryCtaText} numberOfLines={1}>
                  Back to Home
                </Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (loadState === 'empty' || !ready) {
    return (
      <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
        <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
          <View style={styles.centerWrap}>
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle} numberOfLines={2}>
                No active pack yet
              </Text>
              <Text style={styles.stateBody} numberOfLines={2}>
                Choose a pack from Library first, then come back.
              </Text>
              <Pressable testID="screen-draw-primary-cta" style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]} onPress={() => navigation.navigate('Library')}>
                <Text style={styles.primaryCtaText} numberOfLines={1}>
                  View library
                </Text>
              </Pressable>
              <Pressable testID="screen-draw-secondary-cta" style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]} onPress={() => navigation.navigate('Home')}>
                <Text style={styles.secondaryCtaText} numberOfLines={1}>
                  Back to Home
                </Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  const armedFraction = swipePrimed ? 1 : Math.min(1, swipeDelta / SWIPE_ARM_DISTANCE);
  const swipeThumbX = armedFraction * (SWIPE_TRACK_WIDTH - 38);
  const badgeText = ready.slug.slice(0, 3).toUpperCase();
  const openDisabled = opening || !swipePrimed;

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
      <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
        <View style={styles.container}>
          <View style={styles.header} testID="draw-header">
            <View style={styles.pullsBadge} testID="draw-pack-pulls-badge" nativeID="draw-wallet-badge">
              <View style={styles.pullsBadgeIcon}>
                <Text style={styles.pullsBadgeIconText} numberOfLines={1}>
                  ◆
                </Text>
              </View>
              <Text style={styles.pullsBadgeText} numberOfLines={1}>
                × {ready.walletPulls}
              </Text>
            </View>
          </View>

          <View
            testID="draw-card-stack-stage"
            style={styles.hero}
            onStartShouldSetResponder={() => !opening}
            onMoveShouldSetResponder={() => !opening}
            onResponderGrant={(event) => {
              const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
              swipeStartXRef.current = touchX;
            }}
            onResponderMove={(event) => {
              if (swipePrimed || swipeStartXRef.current == null) return;
              const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
              const nextDelta = Math.max(0, touchX - swipeStartXRef.current);
              setSwipeDelta(Math.min(nextDelta, SWIPE_ARM_DISTANCE));
            }}
            onResponderRelease={(event) => {
              if (swipePrimed) {
                swipeStartXRef.current = null;
                return;
              }
              const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
              const startX = swipeStartXRef.current ?? touchX;
              swipeStartXRef.current = null;
              if (touchX - startX >= SWIPE_ARM_DISTANCE) {
                armSwipe();
              } else {
                setSwipeDelta(0);
              }
            }}
            onResponderTerminate={() => {
              swipeStartXRef.current = null;
              if (!swipePrimed) setSwipeDelta(0);
            }}
          >
            <View pointerEvents="none" style={[styles.heroHalo, { backgroundColor: palette.halo }]} />

            <View style={styles.neighborRail}>
              <NeighborHint side="left" deck={neighbors.left} disabled={opening} onPress={() => neighbors.left && switchDeck(neighbors.left.slug)} />
              <NeighborHint side="right" deck={neighbors.right} disabled={opening} onPress={() => neighbors.right && switchDeck(neighbors.right.slug)} />
            </View>

            <View style={styles.packStage} testID="draw-swipe-zone">
              <PackArt palette={palette} bobbingValue={bobbingRef.current} shineValue={shineRef.current} title={ready.deckTitle} badgeText={badgeText} coverImage={coverImage} />
            </View>

            <View style={styles.swipeBlock}>
              <View style={styles.swipeTrack}>
                <View
                  style={[
                    styles.swipeTrackFill,
                    { width: 6 + armedFraction * (SWIPE_TRACK_WIDTH - 6), backgroundColor: swipePrimed ? colors.pokeBlue : colors.pokeBlueFaint },
                  ]}
                />
                <View style={[styles.swipeThumb, { transform: [{ translateX: swipeThumbX }] }, swipePrimed && styles.swipeThumbPrimed]}>
                  <Text style={styles.swipeThumbText}>›</Text>
                </View>
              </View>
              <Text style={styles.swipeHint} numberOfLines={1}>
                {swipePrimed ? 'Pack armed — choose Open 10 or Open 1' : 'Swipe right to arm this pack'}
              </Text>
              {!ready.canPullSingle ? (
                <Text style={styles.walletHint} numberOfLines={1}>
                  No pulls left. Study sessions grant more pulls.
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.footerActions}>
            <Pressable
              testID="screen-draw-primary-cta"
              accessibilityRole="button"
              accessibilityLabel={`Open ten cards from ${ready.deckTitle}`}
              disabled={openDisabled || !ready.canPullMulti}
              style={({ pressed }) => [styles.primaryCta, (openDisabled || !ready.canPullMulti) && styles.ctaDisabled, pressed && styles.pressed]}
              onPress={() => {
                void open(10);
              }}
            >
              <Text style={styles.primaryCtaText} numberOfLines={1}>
                Open 10
              </Text>
            </Pressable>
            <Pressable
              testID="screen-draw-secondary-cta"
              accessibilityRole="button"
              accessibilityLabel={`Open one card from ${ready.deckTitle}`}
              disabled={openDisabled || !ready.canPullSingle}
              style={({ pressed }) => [styles.secondaryCta, (openDisabled || !ready.canPullSingle) && styles.ctaDisabled, pressed && styles.pressed]}
              onPress={() => {
                void open(1);
              }}
            >
              <Text style={styles.secondaryCtaText} numberOfLines={1}>
                Open 1
              </Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.softCream },
  gradient: { flex: 1 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screenPadding },
  loadingText: { marginTop: spacing.sm, color: colors.inkSoft, fontSize: typography.bodySmall, fontWeight: '700' },
  stateCard: {
    width: '100%', borderRadius: spacing.cardRadius, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.softMist,
    padding: spacing.md, shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  stateTitle: { color: colors.inkSoft, fontSize: typography.title3, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  stateBody: { marginTop: spacing.xs, color: colors.inkMuted, fontSize: typography.bodySmall, lineHeight: 18, textAlign: 'center' },
  container: { flex: 1, paddingHorizontal: spacing.screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  pullsBadge: {
    flexDirection: 'row', alignItems: 'center', minHeight: 36, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.softMist, shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  pullsBadgeIcon: {
    width: 22, height: 22, borderRadius: 999, backgroundColor: colors.pokeBlueFaint,
    alignItems: 'center', justifyContent: 'center', marginRight: 6,
  },
  pullsBadgeIconText: { color: colors.pokeBlueDeep, fontWeight: '900', fontSize: 13 },
  pullsBadgeText: { color: colors.inkSoft, fontSize: typography.bodySmall, fontWeight: '900' },
  hero: { marginTop: spacing.lg, flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  heroHalo: { position: 'absolute', top: 26, width: 320, height: 320, borderRadius: 320, opacity: 0.85 },
  neighborRail: {
    position: 'absolute', top: 52, left: 0, right: 0, zIndex: 3,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  neighborPlaceholder: { width: 54, height: 74 },
  neighborWrap: { width: 54, alignItems: 'center' },
  neighborCard: {
    width: 48, minHeight: a11y.minTouch, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  neighborArrow: { fontSize: 22, fontWeight: '900', marginTop: -2 },
  neighborTitle: { marginTop: 4, color: colors.inkMuted, fontSize: 9, fontWeight: '700', textAlign: 'center', width: '100%' },
  packStage: { width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  packShadow: {
    shadowColor: 'rgba(58,35,5,0.32)', shadowOpacity: 0.6, shadowRadius: 22, shadowOffset: { width: 0, height: 14 }, elevation: 10, borderRadius: 22,
  },
  pack: { width: PACK_WIDTH, height: PACK_HEIGHT, borderRadius: 22, borderWidth: 2, overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  packBadge: {
    position: 'absolute', top: 10, right: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    minWidth: 30, alignItems: 'center', justifyContent: 'center',
  },
  packBadgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  packBrandStripe: { flexDirection: 'row', alignItems: 'center', marginTop: 2, marginLeft: 4 },
  packBrandPokemon: { color: colors.softCream, fontSize: 14, fontWeight: '900', letterSpacing: -0.3 },
  packBrandPocket: { color: colors.softCream, fontSize: 12, fontWeight: '700', marginLeft: 4, opacity: 0.86 },
  packArtWindow: { flex: 1, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  packArtBlob: { width: 80, height: 80, borderRadius: 999 },
  packTitleSlab: { marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.30)', alignSelf: 'center', maxWidth: '92%' },
  packTitle: { fontSize: 18, fontWeight: '900', textAlign: 'center', letterSpacing: 0.4 },
  packShine: { position: 'absolute', top: -20, width: 60, height: PACK_HEIGHT + 40, backgroundColor: colors.shine },
  swipeBlock: { marginTop: spacing.md, alignItems: 'center' },
  swipeTrack: {
    width: SWIPE_TRACK_WIDTH, height: 44, borderRadius: 999, backgroundColor: colors.softMist,
    shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
    overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 4,
  },
  swipeTrackFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 999 },
  swipeThumb: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: colors.pokeBlue,
    alignItems: 'center', justifyContent: 'center', shadowColor: 'rgba(44,156,192,0.6)', shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  swipeThumbPrimed: { backgroundColor: colors.pokeBlueDeep },
  swipeThumbText: { color: colors.softCream, fontSize: 22, fontWeight: '900', marginTop: -4 },
  swipeHint: { marginTop: spacing.xs, color: colors.inkMuted, fontSize: typography.caption, fontWeight: '700' },
  walletHint: { marginTop: 2, color: colors.inkMuted, fontSize: typography.caption, fontWeight: '700' },
  footerActions: { marginTop: spacing.md, gap: spacing.sm },
  primaryCta: {
    minHeight: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
    backgroundColor: colors.pokeBlue, shadowColor: 'rgba(44,156,192,0.5)', shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  primaryCtaText: { color: colors.softCream, fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  secondaryCta: {
    minHeight: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
    backgroundColor: colors.softMist, borderWidth: 2, borderColor: colors.pokeBlueFaint, shadowColor: colors.shadowSoft,
    shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  secondaryCtaText: { color: colors.pokeBlueDeep, fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  ctaDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.9 },
});
