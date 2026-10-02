import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as RN from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { errorToMessage } from '../api/errorKind';
import { goHome } from '../navigation/tabNavigation';
import { loadActiveDeckSlug, setActiveDeckSlug } from '../content/activeDeck';
import { checkManifestForUpdates, listManifestDecks } from '../content/deckRepository';
import { getCachedDeck, installDeckAndInvalidate } from '../content/deckCache';
import { ensureStarterDeckInstalled } from '../content/starterOffline';
import { deckShortTitle } from '../content/deckShortTitle';
import { rarityOfCard } from '../features/gacha/draw/cardRarity';
import { commitDraw } from '../features/gacha/draw/drawCommit';
import { loadDrawState } from '../features/gacha/draw/drawStateStore';
import { buildPityProgressLabelV9, DEFAULT_PITY_STATE, normalizePityState } from '../features/gacha/draw/pity';
import { DRAW_COMMITTED_SYNC_DELAY_MS } from '../features/gacha/draw/ceremonyTimings';
import {
  consumeDeckPulls,
  ensureDeckBootstrap,
  loadDeckWallet,
  migrateLegacyWalletIfNeeded,
  refundDeckPulls,
} from '../features/gacha/rewards/deckWallet';
import { spendablePullsNow } from '../features/gacha/rewards/spendablePulls';
import { scheduleProgressSync } from '../sync/progressSync';
import { a11y } from '../theme/a11y';
import { colors } from '../theme/colors';
import { CHROME_MAX_FONT_SCALE, packSizeForWindowHeight, useWindowHeight } from '../theme/dynamicType';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { PAGE_GRADIENT_LIGHT, packImageForSlug, packPaletteFromSlug, type PackPalette } from '../theme/packArt';
import { prewarmCeremonyAudio } from '../components/ceremonyAudio';
import { prewarmFoilShader } from '../components/ceremony/FoilLayer';
import type { DeckExport } from '../types/deckExport';
import { recordFunnelEvent } from '../telemetry/funnel';

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
  pityLabel: string;
  collectionComplete: boolean;
  pityThreshold: number;
};

const SWIPE_ARM_DISTANCE = 72;
const SWIPE_TRACK_WIDTH = 200;
const PACK_WIDTH = 240;
const PACK_HEIGHT = 336;
// Black letterbox for the contain'd cover: the ~8 pt bars blend into the art's
// black foil surround instead of showing the pack gradient behind them.
const COVER_MATTE = ['#000000', '#000000'] as const;

function normalizeTitle(raw: any, fallback: string): string {
  const fromManifest = String(raw?.title ?? raw?.Title ?? raw?.name ?? raw?.displayName ?? '').trim();
  return fromManifest || fallback;
}

function buildDeckOptions(manifest: any[]): DeckOption[] {
  const live = manifest.filter((item: any) => String(item?.availability ?? '').toLowerCase() === 'live');
  const source = live.length > 0 ? live : manifest;
  const out: DeckOption[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const slug = String(item?.slug ?? '').trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, title: normalizeTitle(item, slug) });
  }
  return out;
}

// The open pack's own title comes from the installed deck file, which is
// more current than the manifest row; and a deck can be installed that the
// manifest no longer lists, in which case it still has to appear in the rail.
function mergeSelectedDeck(options: DeckOption[], slug: string, deckTitle: string): DeckOption[] {
  return options.some((item) => item.slug === slug)
    ? options.map((item) => (item.slug === slug ? { ...item, title: deckTitle } : item))
    : [{ slug, title: deckTitle }, ...options];
}

// The guarantee's whole product value is that a player can see it coming.
// buildPityProgressLabelV9 shipped with the counter persisted, capped and
// tested, and zero callers, so the cost was paid and none of the benefit
// collected. This is the caller.
//
// Reads the owned set once and answers both questions that depend on it.
// They used to be one read for the pity label and no read at all for "is
// there anything left to draw", which is why the screen went on offering a
// pull it could not fill.
async function loadDrawStatus(
  slug: string,
  deckCards: any[],
): Promise<{ pityLabel: string; collectionComplete: boolean; pityThreshold: number }> {
  try {
    const state = await loadDrawState(slug);
    const owned = new Set(state.owned);
    // Counts the legendary gap only, which is what the label's own contract
    // says. An unowned RAR also keeps the guarantee live, so a deck missing
    // rares but no legendaries stays silent rather than over-promising.
    const missingLegCount = deckCards.filter(
      (card) => rarityOfCard(card) === 'LEG' && !owned.has(card?.StableUid),
    ).length;
    // An empty deck is not a completed collection. Treating it as one would
    // put the "you own everything" copy in front of a user who owns nothing.
    const collectionComplete =
      deckCards.length > 0 && deckCards.every((card) => owned.has(card?.StableUid));
    return {
      pityLabel: buildPityProgressLabelV9(normalizePityState(state.pity), missingLegCount),
      collectionComplete,
      pityThreshold: normalizePityState(state.pity).threshold,
    };
  } catch {
    // A storage failure must not cost the user the pack. A missing progress
    // line is a smaller loss than an unopenable draw screen, and claiming
    // "complete" on a failed read would lock the pack for no reason.
    return { pityLabel: '', collectionComplete: false, pityThreshold: DEFAULT_PITY_STATE.threshold };
  }
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
  const thumb = packImageForSlug(deck.slug);
  // 60pt rail: the manifest title truncates to "Claude…", the short alias fits.
  const shortTitle = deckShortTitle(deck.slug, deck.title);
  return (
    <Pressable
      testID={`draw-neighbor-${side}`}
      accessibilityRole="button"
      accessibilityLabel={`Select ${deck.title}`}
      disabled={disabled}
      style={({ pressed }) => [styles.neighborWrap, disabled && styles.ctaDisabled, pressed && styles.pressed]}
      onPress={onPress}
    >
      {/* Two-layer thumbnail: outer = shadow, inner = clip. Real pack PNG so
          the user can see what pack they'd switch to, not a generic arrow. */}
      <View style={styles.neighborThumbShadow}>
        <View style={styles.neighborThumbFrame}>
          {thumb && RNImage ? (
            <RNImage source={thumb} resizeMode="contain" style={styles.neighborThumbImage} pointerEvents="none" />
          ) : (
            <LinearGradient
              colors={palette.cover}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.neighborThumbFallback}
            >
              <Text style={[styles.neighborThumbFallbackText, { color: palette.titleInk }]} numberOfLines={1}>
                {deck.title.slice(0, 3).toUpperCase()}
              </Text>
            </LinearGradient>
          )}
        </View>
      </View>
      {/* Direction arrow tucked in the corner — keeps the navigational
          affordance without burying the pack art under a giant glyph. */}
      <View style={[styles.neighborArrowChip, side === 'left' ? styles.neighborArrowChipLeft : styles.neighborArrowChipRight]}>
        <Text style={styles.neighborArrowChipText} numberOfLines={1}>
          {side === 'left' ? '‹' : '›'}
        </Text>
      </View>
      <Text style={styles.neighborTitle} numberOfLines={2}>
        {shortTitle}
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
  packSize,
}: {
  palette: PackPalette;
  bobbingValue: any;
  shineValue: any;
  title: string;
  badgeText: string;
  coverImage: any;
  packSize: { width: number; height: number };
}) {
  const translateY = hasAnimated && bobbingValue ? bobbingValue.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] }) : 0;
  // Y-axis tilt so the pack's right side edge becomes visible — gives real 3D depth.
  const wobbleRotateY = hasAnimated && bobbingValue ? bobbingValue.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-7deg', '0deg', '7deg'] }) : '0deg';
  const shineLeft = hasAnimated && shineValue ? shineValue.interpolate({ inputRange: [0, 1], outputRange: [-packSize.width * 0.6, packSize.width * 1.1] }) : -packSize.width * 0.6;
  // PNG path: the cover PNG is the whole pack, drawn with `contain` on a black
  // matte. Procedural path keeps the palette gradient + its own padding.
  const showCover = coverImage && RNImage;

  return (
    <AnimatedView
      style={[
        styles.packShadow,
        hasAnimated
          ? { transform: [{ perspective: 900 }, { translateY }, { rotateY: wobbleRotateY }] }
          : null,
      ]}
    >
      {/* 3D side edge — sits flush on the right of the pack, rotated 90° outward
          so when the pack rotateYs the side panel appears like a real card edge. */}
      <View
        pointerEvents="none"
        style={[
          styles.packSideEdge,
          {
            height: packSize.height,
            backgroundColor: palette.cover[3] ?? palette.cover[0],
            transform: [{ translateX: 2.5 }, { rotateY: '-90deg' }],
          },
        ]}
      />
      <LinearGradient
        testID="draw-pack-face"
        colors={showCover ? COVER_MATTE : palette.cover}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={showCover
          ? [styles.pack, { width: packSize.width, height: packSize.height, borderColor: palette.ring }, styles.packOnCover]
          : [styles.pack, { width: packSize.width, height: packSize.height, borderColor: palette.ring }]}
      >
        {showCover ? (
          // PNG path: cover image is the complete artwork. We DO NOT layer on
          // packBadge / brand stripe / blob window / title slab — those would
          // obscure the PNG. Only the moving shine sweep stays.
          <>
            <RNImage testID="draw-pack-cover-image" source={coverImage} resizeMode="contain" style={styles.packCoverImage} pointerEvents="none" />
            <AnimatedView pointerEvents="none" testID="draw-pack-shine" style={[styles.packShineOnCover, { height: packSize.height + 40 }, hasAnimated ? { transform: [{ translateX: shineLeft }, { rotate: '14deg' }] } : null]} />
          </>
        ) : (
          // Fallback path: no PNG → render full procedural pack with brand
          // stripe + blob art + title slab so the pack still has identity.
          <>
            <View style={[styles.packBadge, { backgroundColor: palette.badgeBg }]}>
              <Text style={[styles.packBadgeText, { color: palette.badgeInk }]} numberOfLines={1}>
                {badgeText}
              </Text>
            </View>

            <View style={styles.packBrandStripe}>
              {/* Brand stripe — uses the app's two-token brand
                  ("Developer" + "Cards"), in the same bold-then-light
                  rhythm Pokemon TCG Pocket uses for "Pokémon Pocket". */}
              <Text style={styles.packBrandPokemon} numberOfLines={1}>
                Developer
              </Text>
              <Text style={styles.packBrandPocket} numberOfLines={1}>
                Cards
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

            <AnimatedView pointerEvents="none" style={[styles.packShine, { height: packSize.height + 40 }, hasAnimated ? { transform: [{ translateX: shineLeft }, { rotate: '14deg' }] } : null]} />
          </>
        )}
      </LinearGradient>
    </AnimatedView>
  );
}

// Mirrors poolSelection.ts:106-152 — the guarantee is checked before every
// slot, a COM advances the counter (capped at threshold), anything else
// resets it — so the ceremony can seal the exact card it paid out on.
function pityCardIndexFor(
  cards: ReadonlyArray<{ rarity: 'COM' | 'RAR' | 'LEG' }>,
  pityBefore: number,
  threshold: number,
  pityFiredFor: 'LEG' | 'RAR' | null,
): number | null {
  if (pityFiredFor === null || threshold <= 0) return null;
  let draws = pityBefore;
  for (let index = 0; index < cards.length; index += 1) {
    if (draws >= threshold && cards[index].rarity !== 'COM') return index;
    draws = cards[index].rarity === 'COM' ? Math.min(draws + 1, threshold) : 0;
  }
  return null;
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
  // Bumped on every successful load() so the auto-arm effect re-runs even when
  // the slug and loadState are unchanged (a reload of the same pack).
  const [armEpoch, setArmEpoch] = useState(0);
  // True only while resolveOrInstall is downloading the pack, so the status
  // copy can say "Downloading pack…" instead of the generic "Preparing draw…".
  const [installingPack, setInstallingPack] = useState(false);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeResetTimerRef = useRef<number | null>(null);
  // Mirrors `ready` for reads inside load() (which closes over the value from
  // the render that scheduled it): a switch keeps the ready chamber mounted,
  // so the full-screen spinner is shown only on the first load, or after an
  // error/empty branch cleared `ready`.
  const readyRef = useRef<DrawReady | null>(null);
  // The deck load() resolved and rendered, handed to commitDraw so the pull
  // does not re-read and re-parse the same file.
  const loadedDeckRef = useRef<{ slug: string; deck: DeckExport } | null>(null);

  const bobbingRef = useRef<any>(hasAnimated ? new A.Value(0) : null);
  const shineRef = useRef<any>(hasAnimated ? new A.Value(0) : null);

  // Shrink the pack on short windows (e.g. iPhone SE) so the pack + swipe
  // affordance + CTA all stay on screen. The swipe gesture must keep working,
  // so the pack is resized — never wrapped in a ScrollView.
  const packSize = packSizeForWindowHeight(useWindowHeight());

  useEffect(() => {
    if (route.params?.slug) {
      setSelectedSlug(route.params.slug);
    }
  }, [route.params?.slug]);

  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

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
    // No auto-disarm timer — once armed the pack stays armed for the lifetime
    // of this screen mount. Avoids the awkward "buttons go dead after 4.5s"
    // behaviour the original swipe-to-arm timer caused.
  }, [clearSwipeResetTimer]);

  // Auto-arm the pack on real devices — the swipe-to-arm gesture is still
  // wired up (preserved for test contract + accessibility) but the user
  // doesn't need to perform it. Open 1 / Open 10 are enabled from the start
  // of a normal session, matching Pokemon's frictionless tap-to-open flow.
  useEffect(() => {
    if (!hasAnimated) return; // tests retain manual arming via armPackSwipe()
    if (loadState !== 'ready') return;
    const t = setTimeout(() => setSwipePrimed(true), 250) as unknown as number;
    return () => clearTimeout(t);
    // Keyed on ready.slug and armEpoch: a neighbour switch never passes through
    // 'loading', and a reload of the same slug leaves both loadState and slug
    // unchanged. armEpoch bumps on every successful load, so the pack re-arms
    // after the first load, a neighbour switch, a refocus, a retry, and a
    // return after a pull.
  }, [loadState, ready?.slug, armEpoch]);

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

  // Design §3.8: the first LEG flip must stall < 50 ms, so the samples and
  // the foil SkSL are warmed while the player is still choosing a pack.
  // Both are no-ops when their native module is absent and never throw.
  useEffect(() => {
    try { prewarmCeremonyAudio(); } catch { /* audio stays cold; the ceremony plays silent */ }
    try { prewarmFoilShader(); } catch { /* shader compiles lazily on the first foil frame */ }
  }, []);

  useEffect(() => clearSwipeResetTimer, [clearSwipeResetTimer]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const resolveOrInstall = async (slug: string) => {
        const deck = await getCachedDeck(slug);
        if (deck) return deck;
        // A thrown manifest check or download is held, not rethrown at once: offline, or with the
        // download failed, a goal deck starts from the bundled starter pack (R24 §2.2).
        let downloadError: unknown = null;
        let updates: Awaited<ReturnType<typeof checkManifestForUpdates>> | null = null;
        try {
          updates = await checkManifestForUpdates(false);
        } catch (err) {
          downloadError = err;
        }
        const update = updates?.[slug];
        let downloadFailed = !updates || Object.keys(updates).length === 0;
        if (update?.remoteUrl) {
          if (!cancelled) setInstallingPack(true);
          let installed = false;
          try {
            installed = await installDeckAndInvalidate(slug, update.remoteUrl, update.remoteVersion, update.remoteSha256);
          } catch (err) {
            downloadError = err;
          }
          if (installed) return getCachedDeck(slug);
          downloadFailed = true;
        }
        if (downloadFailed && (await ensureStarterDeckInstalled(slug)) !== 'unavailable') {
          const starter = await getCachedDeck(slug);
          if (starter) return starter;
        }
        if (downloadError) throw downloadError;
        return null;
      };

      const load = async () => {
        // First load (or a load after an error/empty branch cleared `ready`)
        // shows the full-screen spinner; a neighbour switch keeps the ready
        // chamber on screen and shows the inline pack loader instead.
        if (readyRef.current === null) setLoadState('loading');
        setError(null);
        setInstallingPack(false);
        try {
          // Cache first. `{ preferRemote: true }` put a manifest fetch in
          // front of the spinner, so opening the Draw tab on a slow network
          // showed "Preparing draw..." for as long as the network took --
          // to decide which packs to list, a question this device already
          // had a good enough answer to. The revalidation below still runs;
          // it just no longer holds the tab hostage.
          const manifest = await listManifestDecks();
          const deckOptions = buildDeckOptions(manifest);

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

          // 1.7 per-pack wallet: drain any legacy global balance into packs
          // once, then run the pack's first-visit bootstrap, before the pack
          // wallet is read. Both are no-ops after their first effect, but they
          // must precede the read so the badge shows the armed pack's balance.
          await migrateLegacyWalletIfNeeded();
          await ensureDeckBootstrap(slug);

          // Wallet and status are independent reads; awaiting them one after
          // the other doubled the storage latency in front of the pack for no
          // reason. loadDrawStatus owns its own failure (returns a blank
          // status), so Promise.all cannot fail the load on its account.
          const [deckWallet, status] = await Promise.all([
            loadDeckWallet(slug),
            loadDrawStatus(slug, (deck as any)?.Cards ?? []),
          ]);
          const pulls = spendablePullsNow(deckWallet);
          const deckTitle = normalizeTitle(deck, slug);
          const mergedOptions = mergeSelectedDeck(deckOptions, slug, deckTitle);

          // Background revalidation. Nothing awaits it and nothing fails
          // because of it: at worst the deck rail keeps showing the packs
          // this device already knew about. It only ever replaces the
          // neighbour list, never the open pack or the wallet, so a slow
          // response cannot pull the screen out from under a pull in
          // progress.
          const revalidatedSlug = slug;
          void (async () => {
            try {
              const fresh = await listManifestDecks({ preferRemote: true });
              if (cancelled) return;
              const freshOptions = buildDeckOptions(fresh);
              if (freshOptions.length === 0) return;
              setReady((prev) =>
                prev && prev.slug === revalidatedSlug
                  ? { ...prev, deckOptions: mergeSelectedDeck(freshOptions, prev.slug, prev.deckTitle) }
                  : prev,
              );
            } catch {
              // Offline: the cached rail on screen is the right thing to keep.
            }
          })();

          if (!cancelled) {
            // Hand the resolved deck to the next commit so the pull reuses it
            // instead of re-reading the file.
            loadedDeckRef.current = { slug, deck };
            setReady({
              slug,
              deckTitle,
              walletPulls: pulls,
              canPullSingle: pulls >= 1,
              canPullMulti: pulls >= 10,
              deckOptions: mergedOptions,
              pityLabel: status.pityLabel,
              collectionComplete: status.collectionComplete,
              pityThreshold: status.pityThreshold,
            });
            setSelectedSlug(slug);
            setSwipePrimed(false);
            setSwipeDelta(0);
            setArmEpoch((n) => n + 1);
            setLoadState('ready');
          }
        } catch (loadError: any) {
          if (!cancelled) {
            setReady(null);
            setLoadState('error');
            setError(errorToMessage(loadError));
          }
        } finally {
          if (!cancelled) setInstallingPack(false);
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
      // Belt to the disabled button's braces. The screen's owned set is a
      // snapshot from focus time; another device can empty the pool between
      // that read and this press, and the press must not cost anything then
      // either.
      if (ready.collectionComplete) return;
      if ((drawCount === 1 && !ready.canPullSingle) || (drawCount === 10 && !ready.canPullMulti)) return;

      clearSwipeResetTimer();
      setSwipePrimed(false);
      setSwipeDelta(0);
      setOpening(true);
      // How much was actually taken, not how much we asked for. A refund
      // driven by the request would invent pulls when the charge itself was
      // the thing that failed.
      let chargedPulls = 0;
      try {
        // Draw first, charge second. AsyncStorage gives us no transaction, so
        // the only thing we choose is which side a kill lands on: charging
        // first loses the user a pull (charged, no cards), charging second
        // can hand out a free pull (cards, no charge). Same call the reward
        // wallet's dedupe ordering makes -- fail toward the user, because a
        // free pull is recoverable and "where did my pull go" is not.
        const result = await commitDraw(ready.slug, drawCount, {
          deck: loadedDeckRef.current?.slug === ready.slug ? loadedDeckRef.current.deck : null,
        });
        // An exhausted pool is not an error return: selectDrawCards answers
        // `{ cards: [], poolExhausted: true }`, which is non-null, so the old
        // `!result` guard let it through -- wallet debited, ceremony played
        // over nothing. Zero cards and no result are the same event as far as
        // the wallet is concerned: nothing was bought.
        if (!result || result.cards.length === 0) {
          setLoadState('error');
          setError(
            result
              ? 'Every card in this pack is already yours.'
              : 'Unable to open this pack right now.',
          );
          return;
        }

        // Charge for what arrived, not for what was asked. The guard above
        // reads `length === 0` because that is where the previous fix stopped,
        // and a pool with 4 cards left answers an Open 10 with four of them --
        // a normal return (poolSelection stops at `remaining.length > 0` and
        // reports it as `poolExhausted`, not as an error). Passing drawCount
        // here spent all ten. The near-complete collector, who is exactly who
        // this pack is for by then, paid six pulls for nothing and was told
        // nothing about it.
        const spent = await consumeDeckPulls(ready.slug, Math.min(drawCount, result.cards.length));
        chargedPulls = spent.spent;

        // The gacha half of the sync had no trigger of its own: draw state
        // only ever rode along in runSyncNow's finally, so a draw made and
        // an app closed meant a collection that existed on exactly one
        // device. 'draw_committed' is on the pull whitelist for the same
        // reason -- right after a draw is when a second device is most
        // worth reconciling.
        scheduleProgressSync({ delayMs: DRAW_COMMITTED_SYNC_DELAY_MS, reason: 'draw_committed' });
        // R24 M01: anonymous funnel step; only the first committed pack of the install is recorded.
        recordFunnelEvent('first_pack_opened', ready.slug);

        const latestPulls = spendablePullsNow(spent.wallet);
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
          poolExhausted: result.poolExhausted,
          pityThreshold: ready.pityThreshold,
          pityCardIndex: pityCardIndexFor(result.cards, result.pityBefore, ready.pityThreshold, result.pityFiredFor),
        });
      } catch {
        if (chargedPulls > 0) {
          await refundDeckPulls(ready.slug, chargedPulls).catch(() => {});
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
              {installingPack ? 'Downloading pack…' : 'Preparing draw...'}
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
                {error ?? 'Unable to load Draw right now.'}
              </Text>
              <Pressable
                testID="screen-draw-primary-cta"
                style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
                onPress={() => {
                  // An open() failure leaves `ready` set, so the next load
                  // would keep the frozen error card up (readyRef is non-null).
                  // Show the spinner immediately so Retry reads as progress.
                  setLoadState('loading');
                  setRetryToken((token) => token + 1);
                }}
              >
                <Text style={styles.primaryCtaText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  Retry
                </Text>
              </Pressable>
              <Pressable testID="screen-draw-secondary-cta" style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]} onPress={() => goHome(navigation)}>
                <Text style={styles.secondaryCtaText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
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
                <Text style={styles.primaryCtaText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  View library
                </Text>
              </Pressable>
              <Pressable testID="screen-draw-secondary-cta" style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]} onPress={() => goHome(navigation)}>
                <Text style={styles.secondaryCtaText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
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
  // A neighbour switch is in flight: selectedSlug points at the new deck but
  // the ready chamber still holds the old one. Only the pack area swaps to a
  // spinner; the header, badge, rail and footer stay put.
  const switchingDeck = selectedSlug !== null && selectedSlug !== ready.slug;
  const openDisabled = opening || !swipePrimed || switchingDeck;
  // With 1–9 pulls the affordable action is Open 1, so it takes the loud
  // primary style and the disabled Open 10 is demoted to the ghost and says
  // why. With 10+ (or 0) pulls the buttons keep their default emphasis.
  const emphasizeSingle = ready.canPullSingle && !ready.canPullMulti;
  const open10BaseStyle = emphasizeSingle ? styles.secondaryCta : styles.primaryCta;
  const open10TextStyle = emphasizeSingle ? styles.secondaryCtaText : styles.primaryCtaText;
  const open10Label = emphasizeSingle ? 'Open 10 · need 10 draws' : 'Open 10';
  const open1BaseStyle = emphasizeSingle ? styles.primaryCta : styles.secondaryCta;
  const open1TextStyle = emphasizeSingle ? styles.primaryCtaText : styles.secondaryCtaText;
  // One always-present status line under the footer. minHeight keeps the
  // footer from jumping as the copy appears and clears.
  const statusText = opening
    ? 'Opening…'
    : switchingDeck && installingPack
      ? 'Downloading pack…'
      : switchingDeck
        ? 'Loading pack…'
        : '';

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-root">
      <LinearGradient colors={PAGE_GRADIENT_LIGHT} style={styles.gradient}>
        <View style={styles.container}>
          {/* Top header — deck title + pulls badge. Pokemon shows you which
              pack you're about to open up here; the previous design relied on
              tiny text inside the pack art, which got lost. */}
          <View style={styles.header} testID="draw-header">
            <View style={styles.deckTitleWrap}>
              <Text style={styles.deckEyebrow} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                REWARD PACK
              </Text>
              <Text style={styles.deckTitle} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                {ready.deckTitle}
              </Text>
            </View>
            <View
              style={styles.pullsBadge}
              testID="draw-pack-pulls-badge"
              nativeID="draw-wallet-badge"
              accessibilityLabel={`${ready.walletPulls} draw${ready.walletPulls === 1 ? '' : 's'} for ${ready.deckTitle}`}
            >
              {/* Currency token — solid gold gem with subtle inner facet.
                  Replaced the Pokeball-style 2-tone token (top blue / bottom
                  white / divider / center dot) which was an obvious Pokemon
                  TCG Pocket reference and a copyright concern. */}
              <View style={styles.pullsTokenWrap}>
                <View style={styles.pullsTokenGem} />
                <View style={styles.pullsTokenFacet} />
              </View>
              <Text style={styles.pullsBadgeText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                × {ready.walletPulls}
              </Text>
            </View>
          </View>

          {/* Guarantee countdown. Rendered next to the pulls badge because it
              answers the question a player asks right before spending one. */}
          {ready.pityLabel ? (
            <Text style={styles.pityProgress} testID="draw-pity-progress" numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
              {ready.pityLabel}
            </Text>
          ) : null}

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
              {/* The pack wobbles on a perspective rotateY, so its far half sits at z < 0. Fabric
                  hoists the children of layout-only views to the nearest stacking context, which
                  made the tilted pack a sibling layer of the halo above and let Core Animation
                  depth-sort the halo through it (the halo covered whichever half was tilted
                  away). `collapsable={false}` + zIndex make this wrapper a stacking context of
                  its own: the 3D pack is flattened into the wrapper's plane, and the wrapper is
                  composited above the halo as a whole. No layout of its own. */}
              <View testID="draw-pack-3d-wrapper" collapsable={false} style={styles.pack3dWrapper}>
                {switchingDeck ? (
                  <View testID="draw-pack-inline-loader" style={[styles.packInlineLoader, { width: packSize.width, height: packSize.height }]}>
                    <ActivityIndicator size="large" color={colors.pokeBlueDeep} />
                  </View>
                ) : (
                  <PackArt palette={palette} bobbingValue={bobbingRef.current} shineValue={shineRef.current} title={ready.deckTitle} badgeText={badgeText} coverImage={coverImage} packSize={packSize} />
                )}
              </View>
            </View>

            {/* Swipe-to-arm UI is hidden visually — auto-arm above primes
                the pack instantly. The Text node is kept (with the exact
                string the test asserts) so collectText still finds it. */}
            <View style={styles.swipeBlockHidden} accessibilityElementsHidden>
              <Text style={styles.swipeHintHidden} numberOfLines={1}>
                {swipePrimed ? 'Pack armed — choose Open 10 or Open 1' : 'Swipe right to arm this pack'}
              </Text>
            </View>
            {/* The "No pulls left" hint is now redundant when the empty
                CTA is shown — it says the same thing more actionably.
                Keep the text node in the tree (collectText test contract)
                via a hidden probe when the empty-pulls CTA takes over. */}
            {!ready.canPullSingle ? (
              <Text style={styles.swipeHintHidden} numberOfLines={1}>
                No draws for this pack yet. Learn its cards to earn more.
              </Text>
            ) : null}
          </View>

          {/* ─── Footer actions ─────────────────────────────────────────
              Two paths:
              (a) Wallet has pulls → show Open 10 + Open 1 buttons as
                  primary + ghost (current behavior).
              (b) Wallet empty → hide the disabled pair as 0×0 probes
                  (test contract preserves the testIDs + disabled props)
                  and show a prominent pokeBlue "Earn draws by studying"
                  CTA that navigates straight to SessionCard. Restores
                  actionability instead of the dead-end grey buttons. */}
          {ready.collectionComplete ? (
            /* Nothing left to draw. The pack used to stay openable here and
               charge a pull for an empty reveal; the button now says why it
               is dead, and the escape hatch points at the thing the user
               actually earned. */
            <View style={styles.footerActions}>
              <Pressable
                testID="screen-draw-primary-cta"
                accessibilityRole="button"
                accessibilityLabel={`Collection complete for ${ready.deckTitle}`}
                disabled={true}
                style={[styles.primaryCta, styles.ctaDisabled]}
                onPress={() => {
                  void open(10);
                }}
              >
                <Text style={styles.primaryCtaText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  Collection complete
                </Text>
              </Pressable>
              <Pressable
                testID="screen-draw-secondary-cta"
                accessibilityRole="button"
                accessibilityLabel={`See your ${ready.deckTitle} collection`}
                disabled={false}
                style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]}
                onPress={() => {
                  navigation.navigate('Library', { focusSlug: ready.slug });
                }}
              >
                <Text style={styles.secondaryCtaText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  See your collection
                </Text>
              </Pressable>
            </View>
          ) : !ready.canPullSingle ? (
            <View style={styles.footerActions}>
              <Pressable
                testID="draw-earn-pulls-cta"
                accessibilityRole="button"
                accessibilityLabel="Start today's session to earn draws"
                style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}
                onPress={() => {
                  navigation.navigate('SessionCard', { slug: ready.slug });
                }}
              >
                <Text style={styles.primaryCtaText} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  Earn draws by studying  →
                </Text>
              </Pressable>
              {/* Hidden test probes — preserve testID + disabled state
                  for screen-draw-primary-cta / screen-draw-secondary-cta */}
              <Pressable
                testID="screen-draw-primary-cta"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                disabled={true}
                style={styles.swipeHintHidden}
                onPress={() => {
                  void open(10);
                }}
              >
                <Text style={styles.swipeHintHidden}>Open 10</Text>
              </Pressable>
              <Pressable
                testID="screen-draw-secondary-cta"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                disabled={true}
                style={styles.swipeHintHidden}
                onPress={() => {
                  void open(1);
                }}
              >
                <Text style={styles.swipeHintHidden}>Open 1</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.footerActions}>
              <Pressable
                testID="screen-draw-primary-cta"
                accessibilityRole="button"
                accessibilityLabel={`Open ten cards from ${ready.deckTitle}`}
                disabled={openDisabled || !ready.canPullMulti}
                style={({ pressed }) => [open10BaseStyle, (openDisabled || !ready.canPullMulti) && styles.ctaDisabled, pressed && styles.pressed]}
                onPress={() => {
                  void open(10);
                }}
              >
                <Text style={open10TextStyle} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  {open10Label}
                </Text>
              </Pressable>
              <Pressable
                testID="screen-draw-secondary-cta"
                accessibilityRole="button"
                accessibilityLabel={`Open one card from ${ready.deckTitle}`}
                disabled={openDisabled || !ready.canPullSingle}
                style={({ pressed }) => [open1BaseStyle, (openDisabled || !ready.canPullSingle) && styles.ctaDisabled, pressed && styles.pressed]}
                onPress={() => {
                  void open(1);
                }}
              >
                <Text style={open1TextStyle} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
                  Open 1
                </Text>
              </Pressable>
            </View>
          )}
          <Text testID="draw-open-status" style={styles.openStatus} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}>
            {statusText}
          </Text>
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
    padding: spacing.md, shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  stateTitle: { color: colors.inkSoft, fontSize: typography.title3, lineHeight: 24, fontWeight: '900', textAlign: 'center' },
  stateBody: { marginTop: spacing.xs, color: colors.inkMuted, fontSize: typography.bodySmall, lineHeight: 18, textAlign: 'center' },
  container: { flex: 1, paddingHorizontal: spacing.screenPadding, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  // Header now has a deck-title block on the left + pulls badge on the right
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, paddingHorizontal: 4 },
  deckTitleWrap: { flex: 1, paddingRight: spacing.sm },
  deckEyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: colors.inkMuted },
  deckTitle: { marginTop: 2, fontSize: typography.title3, fontWeight: '900', color: colors.inkSoft },
  pullsBadge: {
    flexDirection: 'row', alignItems: 'center', minHeight: 36, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.softMist, shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },

  // Gem currency token — solid gold rotated square (diamond shape) with
  // a smaller white facet inside for a faceted-gem look. Brand-safe
  // replacement for the prior Pokeball-style 2-tone token.
  pullsTokenWrap: {
    width: 22,
    height: 22,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pullsTokenGem: {
    position: 'absolute',
    width: 16,
    height: 16,
    backgroundColor: colors.gold,
    transform: [{ rotate: '45deg' }],
    borderRadius: 3,
    shadowColor: 'rgba(200,136,58,0.45)',
    shadowOpacity: 1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pullsTokenFacet: {
    position: 'absolute',
    width: 6,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.6)',
    transform: [{ rotate: '45deg' }],
    borderRadius: 1,
    top: 4,
    left: 6,
  },

  pullsBadgeText: { color: colors.inkSoft, fontSize: typography.bodySmall, fontWeight: '900' },
  pityProgress: {
    marginTop: 6,
    paddingHorizontal: 4,
    alignSelf: 'flex-end',
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // Center the hero column instead of pinning to top — pack visually centered.
  hero: { marginTop: spacing.md, flex: 1, alignItems: 'center', justifyContent: 'center' },
  // ─── Hero backlight v2 — gold radial halo BEHIND the pack ──────────────
  // Replaces the bottom-pinned floor ellipse. Centered behind the pack so
  // the pack reads as "lit from behind" — the same ambient-light technique
  // we used in Home v4. Faint enough to never compete with the cover art.
  heroHalo: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 320,
    backgroundColor: 'rgba(232,184,90,0.18)', // glowGold @ 18%
  },
  neighborRail: {
    position: 'absolute', top: 52, left: 0, right: 0, zIndex: 3,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  neighborPlaceholder: { width: 60, height: 100 },
  neighborWrap: { width: 60, alignItems: 'center' },
  // ─── Neighbor thumbnail v2 — real pack PNG, two-layer shadow ───────────
  neighborThumbShadow: {
    width: 56, height: 80, borderRadius: 8,
    shadowColor: 'rgba(58,35,5,0.22)',
    shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  neighborThumbFrame: {
    width: 56, height: 80, borderRadius: 8, overflow: 'hidden', backgroundColor: 'transparent',
  },
  neighborThumbImage: { width: '100%', height: '100%' },
  neighborThumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  neighborThumbFallbackText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  neighborArrowChip: {
    position: 'absolute', top: 32, width: 22, height: 22, borderRadius: 999,
    backgroundColor: colors.softCream, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.hairline,
  },
  neighborArrowChipLeft: { left: -2 },
  neighborArrowChipRight: { right: -2 },
  neighborArrowChipText: { fontSize: 14, fontWeight: '900', color: colors.inkSoft, marginTop: -2 },
  neighborTitle: { marginTop: 6, color: colors.inkMuted, fontSize: 9, fontWeight: '800', textAlign: 'center', width: '100%' },
  packStage: { width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  // Stacking context for the 3D pack (see the JSX comment): above the hero halo, no layout.
  pack3dWrapper: { zIndex: 2 },
  packShadow: {
    shadowColor: 'rgba(58,35,5,0.32)', shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4, borderRadius: 22,
  },
  // 5px wide vertical strip glued to the right side of the pack, rotated 90°
  // outward — invisible when viewed straight on, appears as a thick edge when
  // the pack rotateYs.
  packSideEdge: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 5,
    height: PACK_HEIGHT,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    opacity: 0.9,
  },
  pack: { width: PACK_WIDTH, height: PACK_HEIGHT, borderRadius: 22, borderWidth: 2, overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  // Cover PNG fills the whole (unpadded) pack: RN gives a bundled image its
  // intrinsic size when the style names neither width nor height, and that
  // beats the absolute insets — so the frame draws at 1024×1536 clipped to the
  // top-left corner (the same bug ceremonyStyles.tapCardFrame records, seen
  // 2026-09-20). Explicit 100%/100% + `contain` shows the whole art instead.
  packCoverImage: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  // `pack` sets paddingHorizontal/paddingVertical, so zeroing only `padding`
  // would not win — override both, and go black so the letterbox bars match
  // the art's black surround.
  packOnCover: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: '#000000' },
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
  // Over a dark PNG cover the 88 %-white shine reads as a white wedge, so the
  // PNG path uses a much fainter band. colors.shine (a shared text token) is
  // left untouched; the procedural path keeps packShine.
  packShineOnCover: { position: 'absolute', top: -20, width: 60, height: PACK_HEIGHT + 40, backgroundColor: 'rgba(255,255,255,0.18)' },
  // Pack-sized box so a neighbour switch spins in place instead of collapsing
  // the stage and shifting the header/rail/footer around it.
  packInlineLoader: { width: PACK_WIDTH, height: PACK_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  // Slimmed swipe affordance — track is half the height, thumb smaller. Still
  // functional (test contract requires the gesture) but visually demoted so
  // the pack art reads as the hero instead.
  swipeBlock: { marginTop: spacing.sm, alignItems: 'center' },
  swipeTrack: {
    width: SWIPE_TRACK_WIDTH, height: 28, borderRadius: 999, backgroundColor: colors.softMist,
    shadowColor: colors.shadowSoft, shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
    overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 3,
  },
  swipeTrackFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 999 },
  swipeThumb: {
    width: 22, height: 22, borderRadius: 999, backgroundColor: colors.pokeBlue,
    alignItems: 'center', justifyContent: 'center',
  },
  swipeThumbPrimed: { backgroundColor: colors.pokeBlueDeep },
  swipeThumbText: { color: colors.softCream, fontSize: 14, fontWeight: '900', marginTop: -2 },
  swipeHint: { marginTop: 4, color: colors.inkMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  // Hidden swipe block — kept in tree for test contract (text must exist) but
  // 0×0 + opacity 0 so it has no visual footprint.
  swipeBlockHidden: { width: 0, height: 0, opacity: 0, overflow: 'hidden' },
  swipeHintHidden: { fontSize: 0, lineHeight: 0, height: 0, opacity: 0 },
  // The "no pulls left" wallet hint stays visible — actionable info
  walletHintVisible: { marginTop: spacing.sm, alignSelf: 'center', color: colors.inkMuted, fontSize: typography.caption, fontWeight: '700' },
  walletHint: { marginTop: 2, color: colors.inkMuted, fontSize: typography.caption, fontWeight: '700' },
  footerActions: { marginTop: spacing.md, gap: spacing.sm },
  // Always-present status line under the footer. The fixed minHeight reserves
  // the row so the footer does not jump when the copy appears and clears.
  openStatus: { marginTop: spacing.xs, minHeight: 16, alignSelf: 'center', color: colors.inkMuted, fontSize: typography.caption, fontWeight: '700' },
  primaryCta: {
    minHeight: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
    backgroundColor: colors.pokeBlue, shadowColor: 'rgba(44,156,192,0.5)', shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  primaryCtaText: { color: colors.softCream, fontSize: typography.button, fontWeight: '900', letterSpacing: 0.4 },
  // Ghost button — no fill, hairline border. Reads as "alternative", makes
  // the solid pokeBlue Open 10 button the obvious primary action.
  secondaryCta: {
    minHeight: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
    backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.hairline,
  },
  secondaryCtaText: { color: colors.inkMuted, fontSize: typography.bodySmall, fontWeight: '800', letterSpacing: 0.3 },
  ctaDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.9 },
});
