import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import * as RN from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { HomeDeckVM } from '../selectors/homeSelectors';
import type { PackPalette } from '../../../theme/packArt';
import { colors } from '../../../theme/colors';
import { typography } from '../../../theme/typography';

// 2026-10-18 home carousel: Home's cover is a horizontal swipe carousel, one page per visible pack
// in DECK_ORDER, no wrap. The current page is the tappable cover (testID home-featured-pack, the
// only one); its neighbours peek in at the edges, dimmed and hidden from VoiceOver. A swipe, a dot,
// a tap on a peek or a VoiceOver Next/Previous pack action only selects a pack -- the cover and the
// primary button keep every install, navigation and paywall path.
//
// RN's own horizontal ScrollView with snapToInterval: no native dependency, so it ships over the
// air. Image, Animated, AccessibilityInfo and useWindowDimensions are read through readRN because
// some Home test mocks of react-native leave them out.

// Vitest supplies react-native without some exports -- guarded lookup so tests don't crash.
function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Window width when the RN facade has no useWindowDimensions (some Home test mocks). */
const FALLBACK_WINDOW_WIDTH = 390;

const RNImage: any = readRN('Image', null);
const AI: any = readRN('AccessibilityInfo', null);
const RNEasing: any = readRN('Easing', null);
const useWindowDimensionsSafe: () => { width?: number } = readRN('useWindowDimensions', () => ({
  width: FALLBACK_WINDOW_WIDTH,
}));
// Safe Animated lookup, as in DrawScreen: `A` is a tolerant facade and `hasAnimated` turns the
// float off where the RN facade has no Animated (most Home test mocks) so the JSX still renders.
const A: any = readRN('Animated', {});
const AnimatedView: any = A.View ?? View;
const hasAnimated = typeof A.Value === 'function';

/** The cover's size on Home (the same as the single hero pack it replaces). */
const PACK_WIDTH = 168;
const PACK_HEIGHT = 240;
/** One page: the cover plus the gap that leaves its neighbours peeking in. Also the snap interval. */
export const HOME_PACK_PAGE_WIDTH = 208;
const PAGE_PADDING_TOP = 6;
// Room under the cover for its drop shadow: the ScrollView clips its content.
const PAGE_PADDING_BOTTOM = 22;

export const NEXT_PACK_ACTION = 'nextPack';
export const PREVIOUS_PACK_ACTION = 'previousPack';

export type HomePackPage = {
  slug: string;
  /** Full manifest title, drawn on the fallback cover when the pack has no image. */
  title: string;
  /** content/deckShortTitle: the caption under the carousel and the dot labels. */
  shortTitle: string;
  /** Null only for the placeholder page shown while no pack has loaded. */
  realRow: HomeDeckVM | null;
  cover: ImageSourcePropType | undefined;
  palette: PackPalette;
  /** The pack's state as its dot reads it: 'Ready', 'Install', 'Update', '3 due', ... */
  status: string;
  isFullyMastered: boolean;
};

type Props = {
  /** At least one page: the placeholder when no pack has loaded. */
  pages: readonly HomePackPage[];
  currentIndex: number;
  /** The starter lesson is open: one page (the lesson's pack), no swipe, no dots, no pack actions. */
  locked: boolean;
  featuredLabel: string;
  onFeaturedPress: () => void;
  /** A swipe, a dot, a peek or a VoiceOver action chose this page. Selection only. */
  onSelectPage: (page: HomePackPage) => void;
};

type SelectSource = 'swipe' | 'tap' | 'action';

function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  const safe = Number.isFinite(index) ? Math.round(index) : 0;
  return Math.max(0, Math.min(count - 1, safe));
}

/** The page a scroll offset rests on: the nearest snap point, clamped to the pages there are. */
export function packIndexForOffset(offsetX: number, pageCount: number): number {
  return clampIndex((Number(offsetX) || 0) / HOME_PACK_PAGE_WIDTH, pageCount);
}

/** Reduce Motion, or null until the first answer: nothing moves before the setting is known. */
function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const apply = (enabled: unknown) => {
      if (alive) setReduceMotion(enabled === true);
    };
    try {
      const pending = AI?.isReduceMotionEnabled?.();
      if (pending && typeof pending.then === 'function') pending.then(apply, () => apply(false));
      else apply(false);
    } catch {
      apply(false);
    }
    const sub = AI?.addEventListener?.('reduceMotionChanged', apply);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduceMotion;
}

/** The current cover bobs gently up and down (3px) unless Reduce Motion is on. */
function usePackFloat(reduceMotion: boolean | null): unknown {
  const bobRef = useRef<any>(hasAnimated ? new A.Value(0.5) : null);
  useEffect(() => {
    if (!hasAnimated) return;
    if (reduceMotion !== false) {
      bobRef.current?.setValue?.(0.5);
      return;
    }
    const easing = RNEasing?.inOut ? RNEasing.inOut(RNEasing.ease) : undefined;
    const bob = A.loop(
      A.sequence([
        A.timing(bobRef.current, { toValue: 1, duration: 2400, easing, useNativeDriver: true }),
        A.timing(bobRef.current, { toValue: 0, duration: 2400, easing, useNativeDriver: true }),
      ]),
    );
    bob.start();
    return () => {
      try { bob.stop(); } catch { /* noop */ }
    };
  }, [reduceMotion]);
  return hasAnimated && bobRef.current?.interpolate
    ? bobRef.current.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] })
    : 0;
}

function PackCover({ page }: { page: HomePackPage }) {
  if (page.cover && RNImage) {
    return <RNImage source={page.cover} resizeMode="contain" style={styles.packImage} />;
  }
  return (
    <LinearGradient
      colors={page.palette.cover}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.packFallback}
    >
      <Text style={styles.packFallbackTitle} numberOfLines={2}>
        {page.title}
      </Text>
    </LinearGradient>
  );
}

export default function HomePackCarousel({
  pages,
  currentIndex,
  locked,
  featuredLabel,
  onFeaturedPress,
  onSelectPage,
}: Props) {
  const { width: rawWidth } = useWindowDimensionsSafe() ?? {};
  const windowWidth =
    typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : FALLBACK_WINDOW_WIDTH;
  const sideInset = Math.max(0, (windowWidth - HOME_PACK_PAGE_WIDTH) / 2);
  const reduceMotion = useReduceMotion();
  const floatY = usePackFloat(reduceMotion);

  const count = pages.length;
  const index = clampIndex(currentIndex, count);
  const current = pages[index] ?? null;
  const currentSlug = current?.slug ?? null;
  const canSwipe = !locked && count > 1;
  const showDots = !locked && !!current?.realRow;

  const scrollRef = useRef<ScrollView | null>(null);
  const coverRef = useRef<View | null>(null);
  // Fixed after mount: a changing contentOffset prop would jump the scroll view; later moves go
  // through scrollTo below.
  const initialOffsetRef = useRef({ x: index * HOME_PACK_PAGE_WIDTH, y: 0 });
  // The page the scroll view rests on (or is animating to).
  const scrolledIndexRef = useRef(index);
  // The slug last handed to onSelectPage, or the one Home shows: a swipe ending where it started
  // does nothing. iOS also ends a programmatic scrollTo with onMomentumScrollEnd.
  const committedSlugRef = useRef<string | null>(currentSlug);
  // Set by a tap or a VoiceOver action here: the next move animates (unless Reduce Motion is on)
  // and, for an action, VoiceOver focus follows the cover. A move Home makes on its own (its first
  // load settling on the stored active deck) jumps, as the single cover used to swap.
  const animateNextMoveRef = useRef(false);
  // Where an animated scrollTo is headed. Its momentum end is not a swipe; one that reports a
  // stop on the way (a second dot tapped mid-animation) must not select that stop.
  const pendingScrollIndexRef = useRef<number | null>(null);
  const focusCoverRef = useRef(false);

  useEffect(() => {
    committedSlugRef.current = currentSlug;
  }, [currentSlug]);

  // Follow the selection when it moved without a swipe: a dot, a peek, a VoiceOver action, or Home
  // picking another pack.
  useEffect(() => {
    const animate = animateNextMoveRef.current;
    animateNextMoveRef.current = false;
    if (scrolledIndexRef.current !== index) {
      const animated = animate && reduceMotion !== true;
      scrolledIndexRef.current = index;
      pendingScrollIndexRef.current = animated ? index : null;
      scrollRef.current?.scrollTo?.({ x: index * HOME_PACK_PAGE_WIDTH, y: 0, animated });
    }
    if (focusCoverRef.current) {
      // A VoiceOver action moved the cover to another page: keep focus on the cover.
      focusCoverRef.current = false;
      if (coverRef.current) AI?.sendAccessibilityEvent?.(coverRef.current, 'focus');
    }
  }, [index, reduceMotion]);

  const select = (rawIndex: number, source: SelectSource) => {
    const targetIndex = clampIndex(rawIndex, count);
    const target = pages[targetIndex];
    if (!target?.realRow) return;
    if (source === 'swipe') scrolledIndexRef.current = targetIndex;
    const changed = committedSlugRef.current !== target.slug;
    if (source === 'swipe' && !changed) return;
    committedSlugRef.current = target.slug;
    if (source !== 'swipe' && changed) animateNextMoveRef.current = true;
    if (source === 'action') focusCoverRef.current = true;
    onSelectPage(target);
    if (changed) AI?.announceForAccessibility?.(`${target.shortTitle} selected`);
  };

  const coverActions = canSwipe
    ? [
        ...(index < count - 1 ? [{ name: NEXT_PACK_ACTION, label: 'Next pack' }] : []),
        ...(index > 0 ? [{ name: PREVIOUS_PACK_ACTION, label: 'Previous pack' }] : []),
      ]
    : undefined;
  const coverValue = current?.realRow
    ? { text: canSwipe ? `${current.shortTitle}, ${index + 1} of ${count}` : current.shortTitle }
    : undefined;

  return (
    <View testID="home-pack-visual" style={styles.root}>
      {/* Gold halo behind the current cover: faint ambient light, no frame. */}
      <View pointerEvents="none" style={styles.halo} />
      <ScrollView
        testID="home-pack-carousel"
        ref={scrollRef}
        horizontal
        scrollEnabled={canSwipe}
        snapToInterval={HOME_PACK_PAGE_WIDTH}
        decelerationRate="fast"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        contentOffset={initialOffsetRef.current}
        style={[styles.scroller, { width: windowWidth }]}
        contentContainerStyle={{ paddingHorizontal: sideInset }}
        onScrollBeginDrag={() => {
          // The learner took over: whatever scrollTo was under way, this is a swipe now.
          pendingScrollIndexRef.current = null;
        }}
        onMomentumScrollEnd={(event: any) => {
          const x = event?.nativeEvent?.contentOffset?.x ?? 0;
          let landed = packIndexForOffset(x, count);
          const pending = pendingScrollIndexRef.current;
          if (pending !== null) {
            pendingScrollIndexRef.current = null;
            if (landed !== pending) return;
          }
          // A scroll that skipped the snap can stop between pages: VoiceOver's three-finger scroll
          // pages by the view's width (375-430pt), not by snapToInterval, so rounding the offset
          // could skip a pack. Inside the track, a stop well off a page moves at most one page from
          // the current one, and the carousel settles on it. Overscroll past either end and a
          // few points of float are left to the plain rounding above.
          const offGrid = Math.abs(x - landed * HOME_PACK_PAGE_WIDTH) > 8;
          if (offGrid && x > 0 && x < (count - 1) * HOME_PACK_PAGE_WIDTH) {
            if (Math.abs(landed - index) > 1) landed = index + Math.sign(landed - index);
            pendingScrollIndexRef.current = landed;
            scrollRef.current?.scrollTo?.({ x: landed * HOME_PACK_PAGE_WIDTH, y: 0, animated: false });
          }
          select(landed, 'swipe');
        }}
        onScrollEndDrag={(event: any) => {
          // A release with no velocity can settle without a momentum phase.
          if (event?.nativeEvent?.velocity?.x !== 0) return;
          select(packIndexForOffset(event?.nativeEvent?.contentOffset?.x ?? 0, count), 'swipe');
        }}
      >
        {pages.map((page, i) => {
          const isCurrent = i === index;
          return (
            <View
              key={page.slug}
              testID={`home-pack-page-${page.slug}`}
              style={styles.page}
              accessibilityElementsHidden={!isCurrent}
              importantForAccessibility={isCurrent ? 'auto' : 'no-hide-descendants'}
            >
              <View style={isCurrent ? null : styles.peek}>
                {isCurrent ? (
                  <Pressable
                    ref={coverRef}
                    testID="home-featured-pack"
                    accessibilityRole="button"
                    accessibilityLabel={featuredLabel}
                    accessibilityValue={coverValue}
                    accessibilityActions={coverActions}
                    onAccessibilityAction={(event: any) => {
                      const action = event?.nativeEvent?.actionName;
                      if (action === NEXT_PACK_ACTION) select(index + 1, 'action');
                      else if (action === PREVIOUS_PACK_ACTION) select(index - 1, 'action');
                    }}
                    onPress={onFeaturedPress}
                    hitSlop={8}
                  >
                    <AnimatedView
                      style={[styles.packFloat, hasAnimated ? { transform: [{ translateY: floatY }] } : null]}
                    >
                      <PackCover page={page} />
                    </AnimatedView>
                  </Pressable>
                ) : (
                  <Pressable accessible={false} onPress={() => select(i, 'tap')}>
                    <View style={styles.packFloat}>
                      <PackCover page={page} />
                    </View>
                  </Pressable>
                )}
                {/* Update chip over the cover's foot, outside the cover's Pressable: a stale deck
                    says what it is missing, or that it is on its way. */}
                {page.realRow?.update ? (
                  <View
                    testID={`home-pack-update-chip-${page.slug}`}
                    pointerEvents="none"
                    style={[
                      styles.updateChip,
                      page.realRow.update.state === 'updating' && styles.updateChipUpdating,
                    ]}
                  >
                    <Text style={styles.updateChipText} numberOfLines={2}>
                      {page.realRow.update.chipLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
      {current?.realRow ? (
        <Text testID="home-pack-caption" style={styles.caption} numberOfLines={1}>
          {current.shortTitle}
        </Text>
      ) : null}
      {showDots ? (
        <View testID="home-pack-dots" style={styles.dots}>
          {pages.map((page, i) => (
            <Pressable
              key={page.slug}
              testID={`home-pack-dot-${page.slug}`}
              accessibilityRole="button"
              accessibilityLabel={`${page.shortTitle} pack — ${page.status}`}
              accessibilityHint={`Pack ${i + 1} of ${count}`}
              accessibilityState={{ selected: i === index }}
              hitSlop={{ top: 10, bottom: 10 }}
              style={styles.dotHit}
              onPress={() => select(i, 'tap')}
            >
              <View style={[styles.dot, i === index && styles.dotCurrent]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  // Same halo as the single hero pack had, centred behind the current cover.
  halo: {
    position: 'absolute',
    top: 0,
    width: 240,
    height: 240,
    borderRadius: 240,
    backgroundColor: 'rgba(232,184,90,0.18)', // colors.glowGold @ 18%
  },
  // Full window width (the page has 18pt side padding), so the neighbours peek in from the edges.
  scroller: {
    alignSelf: 'center',
    flexGrow: 0,
  },
  page: {
    width: HOME_PACK_PAGE_WIDTH,
    alignItems: 'center',
    paddingTop: PAGE_PADDING_TOP,
    paddingBottom: PAGE_PADDING_BOTTOM,
  },
  // The neighbours: smaller and dimmed, static (no animated interpolation).
  peek: {
    opacity: 0.5,
    transform: [{ scale: 0.86 }],
  },
  // Floating cover: shadow only, no border, no backing colour.
  packFloat: {
    width: PACK_WIDTH,
    height: PACK_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(58,35,5,0.30)',
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  packImage: {
    width: '100%',
    height: '100%',
  },
  packFallback: {
    width: PACK_WIDTH,
    height: PACK_HEIGHT,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  packFallbackTitle: {
    color: '#FFFFFF',
    fontSize: typography.title2,
    fontWeight: '900',
    textAlign: 'center',
  },
  // "Update · +34 cards" pill pinned to the foot of the cover; may wrap to two short lines.
  updateChip: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    maxWidth: PACK_WIDTH - 24,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.pokeBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateChipUpdating: {
    backgroundColor: colors.inkSecondary,
  },
  updateChipText: {
    color: '#FFFFFF',
    fontSize: typography.caption,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  caption: {
    fontSize: typography.bodySmall,
    lineHeight: 16,
    fontWeight: '800',
    color: colors.inkSecondary,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  // 44 x 24 plus 10pt hit slop above and below: a 44 x 44pt target around an 8pt dot (Apple HIG).
  dotHit: {
    width: 44,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(67,42,18,0.22)',
  },
  dotCurrent: {
    width: 18,
    backgroundColor: colors.pokeBlueDeep,
  },
});
