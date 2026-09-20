import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/types';
import { CEREMONY_COPY_V10, CEREMONY_COPY_V9, getCeremonyPhaseCopy } from '../features/gacha/draw/ceremonyCopy';
import {
  GLOW_9SLICE,
  PAGE_GRADIENT_CEREMONY,
  PARTICLE_SHEET,
  cardBackImageForSlug,
  cardFrameForRarity,
  packImageForSlug,
  packPaletteFromSlug,
  rarityAccentColor,
} from '../theme/packArt';
import { useFeatureFlags } from '../config/featureFlags';
import { CEREMONY_GAIN, useCeremonyAudio } from '../components/ceremonyAudio';
import { useCeremonyHaptics } from '../components/ceremonyHaptics';
import { GestureHandler, Reanimated, motionAvailable, skiaAvailable } from '../components/ceremony/reanimatedGuard';
import {
  FAST_FORWARD_FROM_HOLD_FRACTION,
  FAST_FORWARD_TEAR_FACTOR,
  REDUCED_MOTION_FLASH_MS,
  REDUCED_MOTION_SETTLE_MS,
  SWIPE_TRIGGER_DISTANCE,
  compressTimings,
  phaseDurations,
  resolveCeremonyTimings,
  type CeremonyPhase,
  type PeakRarity,
  type ResolvedCeremonyTimings,
} from '../features/gacha/draw/ceremonyTimings';
import { buildSpillSchedule, featuredCardIndex } from '../features/gacha/draw/spillSchedule';
import { skipPolicy } from '../features/gacha/draw/skipPolicy';
import {
  effectiveCeremoniesCompleted,
  getCeremonyDevOverrides,
  markCeremonyCompleted,
  readCeremoniesCompleted,
} from '../features/gacha/draw/ceremonyPrefs';
import { tableSlotLayout, useCeremonyTimeline } from '../components/ceremony/useCeremonyTimeline';
import { STAGE_TESTID, StageCanvas } from '../components/ceremony/StageCanvas';
import { PackTear, seamProgressFromDelta } from '../components/ceremony/PackTear';
import { TapCard, type TapCardData } from '../components/ceremony/TapCard';
import { FallbackStage } from '../components/ceremony/FallbackStage';
import { FeaturedCard, type FeaturedCardProps } from '../components/ceremony/FeaturedCard';
import { SpillSampler } from '../components/ceremony/SpillSampler';
import { ceremonyStyles as styles } from '../components/ceremony/ceremonyStyles';

type Props = NativeStackScreenProps<RootStackParamList, 'DrawCeremony'>;

type DrawCeremonyResult = NonNullable<RootStackParamList['DrawCeremony']['drawResult']>;

function rarityRank(rarity: PeakRarity): number {
  if (rarity === 'LEG') return 2;
  if (rarity === 'RAR') return 1;
  return 0;
}

function resolvePeakRarity(drawResult: DrawCeremonyResult): PeakRarity {
  if (drawResult.cards.length === 0) {
    return drawResult.highlightedRarity ?? 'COM';
  }
  let peak: PeakRarity = 'COM';
  for (const card of drawResult.cards) {
    if (rarityRank(card.rarity) > rarityRank(peak)) {
      peak = card.rarity;
    }
  }
  return peak;
}

function flashColor(rarity: PeakRarity): string {
  if (rarity === 'LEG') return 'rgba(245,201,94,0.95)';
  if (rarity === 'RAR') return 'rgba(201,173,247,0.95)';
  return 'rgba(255,255,255,0.88)';
}

type ScheduleEntry = { at: number; phase: CeremonyPhase | 'tail' };
type ScheduleStart = 'approach' | 'hold' | 'tear-flip' | 'flash-reveal';
const SCHEDULE_ORDER: CeremonyPhase[] = ['approach', 'hold', 'tear-flip', 'flash-reveal', 'settle'];

// Pure phase → timer table. Every transition after startPhase, then the table tail.
function scheduleFrom(startPhase: ScheduleStart, t: ResolvedCeremonyTimings, elapsedInStartMs: number): ScheduleEntry[] {
  const d: Record<CeremonyPhase, number> = {
    swipe: 0,
    approach: t.approach,
    hold: t.hold,
    'tear-flip': t.tearFlip,
    'flash-reveal': t.flashReveal,
    settle: t.settleMs,
    'cards-on-table': 0,
  };
  const startIdx = SCHEDULE_ORDER.indexOf(startPhase);
  const out: ScheduleEntry[] = [];
  let at = Math.max(0, d[startPhase] - elapsedInStartMs);
  for (let i = startIdx + 1; i < SCHEDULE_ORDER.length; i += 1) {
    const p = SCHEDULE_ORDER[i];
    out.push({ at, phase: p });
    at += d[p];
  }
  out.push({ at: at + t.tableTailMs, phase: 'tail' });
  return out;
}

export function DrawCeremonyScreen({ navigation, route }: Props) {
  const drawResult: DrawCeremonyResult = route.params.drawResult ?? {
    poolId: route.params.slug,
    cards: [],
    pityBefore: 0,
    pityAfter: 0,
    pityTriggered: false,
    highlightedRarity: null,
  };

  const cards = drawResult.cards;
  const isMulti = cards.length > 1;
  const peakRarity = resolvePeakRarity(drawResult);
  const featuredIdx = featuredCardIndex(cards);
  const featured = featuredIdx >= 0 ? cards[featuredIdx] : null;

  const palette = useMemo(() => packPaletteFromSlug(route.params.slug), [route.params.slug]);
  const coverImage = useMemo(() => packImageForSlug(route.params.slug), [route.params.slug]);
  const cardBackImage = useMemo(() => cardBackImageForSlug(route.params.slug), [route.params.slug]);
  const accent = rarityAccentColor(peakRarity);
  const pitySeal = route.params.pityCardIndex != null;
  const bedName = peakRarity === 'LEG' ? 'choir-swell' : peakRarity === 'RAR' ? 'shimmer-pad' : 'air';

  const flags = useFeatureFlags();
  const dev = getCeremonyDevOverrides();
  const renderer: 'skia' | 'fallback' =
    motionAvailable && skiaAvailable && flags.ceremony.seamOfLight && !flags.ceremony.forceFallback && !dev.forceFallback
      ? 'skia'
      : 'fallback';
  const timings = useMemo(() => resolveCeremonyTimings({ isMulti, peakRarity, motionAvailable }), [isMulti, peakRarity]);
  const enableTapFlow = route.params.tapFlow ?? (motionAvailable && drawResult.cards.length > 0);
  const slot = tableSlotLayout(cards.length);

  const [phase, setPhase] = useState<CeremonyPhase>('swipe');
  const [canSkip, setCanSkip] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [sequenceToken, setSequenceToken] = useState(0);
  const [flippedSet, setFlippedSet] = useState<Set<string>>(new Set());
  const [focusedUid, setFocusedUid] = useState<string | null>(null);
  const [ceremoniesCompleted, setCeremoniesCompleted] = useState(0);
  const [tellLanded, setTellLanded] = useState(false);
  const [compressed, setCompressed] = useState(false);
  const [activeTimings, setActiveTimings] = useState<ResolvedCeremonyTimings>(timings);

  const timers = useRef<number[]>([]);
  const swipeStartXRef = useRef<number | null>(null);
  const phaseRef = useRef<CeremonyPhase>('swipe');
  const flippedRef = useRef<Set<string>>(flippedSet);
  const phaseStartedAtRef = useRef<number>(0);
  const goResultRef = useRef<() => void>(() => {});

  const audio = useCeremonyAudio();
  const haptics = useCeremonyHaptics();

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    flippedRef.current = flippedSet;
  }, [flippedSet]);
  useEffect(() => {
    setActiveTimings(timings);
  }, [timings]);

  const setPhaseAt = useCallback((p: CeremonyPhase) => {
    phaseStartedAtRef.current = Date.now();
    setPhase(p);
  }, []);

  const spill = useMemo(
    () => (isMulti && cards.length > 0 ? buildSpillSchedule(cards, activeTimings.tearFlip) : null),
    [cards, isMulti, activeTimings.tearFlip],
  );
  const timeline = useCeremonyTimeline({
    phase,
    peakRarity,
    isMulti,
    cardCount: cards.length,
    timings: activeTimings,
    spill,
    reduceMotion,
    compressed,
  });
  const durations = useMemo(() => phaseDurations(activeTimings), [activeTimings]);

  // The one Reanimated hook the screen calls directly: the scene camera (S4 punch +
  // the LEG decaying rock reach the screen only through this). Plain object under the
  // guard fallback, at rest under Reduce Motion.
  const cameraStyle = Reanimated.useAnimatedStyle(() => ({
    transform: [{ scale: timeline.cameraScale.value }, { rotate: `${timeline.cameraRot.value}deg` }],
  }));
  // Screen-wide dim for the LEG tell (§3.2 "backdrop dims 30 %"). Lives here, not in the
  // 280×360 stage canvas: dimming only the canvas rectangle drew a grey box on the light page.
  const dimStyle = Reanimated.useAnimatedStyle(() => ({ opacity: timeline.dim.value }));

  const goResult = useCallback(() => {
    navigation.replace('DrawResult', {
      slug: route.params.slug,
      drawResult,
      deckTitle: route.params.deckTitle,
      ownedAfter: route.params.ownedAfter,
      totalCards: route.params.totalCards,
      revealedUids: [...flippedRef.current],
      ceremonyEcho: {
        rarity: peakRarity,
        phaseCue: CEREMONY_COPY_V9.settle.body,
        tableReached: phaseRef.current === 'cards-on-table',
      },
    });
  }, [
    navigation,
    drawResult,
    peakRarity,
    route.params.slug,
    route.params.deckTitle,
    route.params.ownedAfter,
    route.params.totalCards,
  ]);
  goResultRef.current = goResult;

  const startSequence = useCallback(() => {
    setSwipeProgress(0);
    audio.hit('whoosh');
    audio.bed('air');
    haptics.tick();
    setSequenceToken((token) => token + 1);
  }, [audio, haptics]);

  // Reduce-motion detection (kept verbatim from the pre-1.6 screen).
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(!!enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (enabled: boolean) => {
        setReduceMotion(!!enabled);
      },
    );
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  // Familiarity counter, fail-closed 0 on any error.
  useEffect(() => {
    let mounted = true;
    readCeremoniesCompleted()
      .then((n) => {
        if (mounted) setCeremoniesCompleted(effectiveCeremoniesCompleted(n));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const runSchedule = useCallback(
    (entries: ScheduleEntry[]) => {
      for (const e of entries) {
        const id = setTimeout(() => {
          if (e.phase === 'settle') {
            setPhaseAt('settle');
            setCanSkip(true);
          } else if (e.phase === 'tail') {
            if (enableTapFlow) {
              setFlippedSet(new Set());
              setPhaseAt('cards-on-table');
              setCanSkip(true);
            } else {
              goResultRef.current();
            }
          } else {
            setPhaseAt(e.phase);
          }
        }, e.at) as unknown as number;
        timers.current.push(id);
      }
    },
    [enableTapFlow, setPhaseAt],
  );

  // The single sequence effect: startSequence bumps the token, timers do the rest.
  useEffect(() => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setCanSkip(false);
    setTellLanded(false);
    setCompressed(false);
    setActiveTimings(timings);
    setFocusedUid(null);

    if (reduceMotion) {
      setPhaseAt('flash-reveal');
      const settleCue = setTimeout(() => {
        setPhaseAt('settle');
        setCanSkip(true);
      }, REDUCED_MOTION_FLASH_MS) as unknown as number;
      const tail = setTimeout(() => {
        if (enableTapFlow) {
          setFlippedSet(new Set());
          setPhaseAt('cards-on-table');
          setCanSkip(true);
        } else {
          goResultRef.current();
        }
      }, REDUCED_MOTION_FLASH_MS + REDUCED_MOTION_SETTLE_MS) as unknown as number;
      timers.current.push(settleCue, tail);
      return () => {
        timers.current.forEach((t) => clearTimeout(t));
      };
    }

    if (sequenceToken === 0) {
      setPhaseAt('swipe');
      return () => {
        timers.current.forEach((t) => clearTimeout(t));
      };
    }

    setPhaseAt('approach');
    runSchedule(scheduleFrom('approach', timings, 0));
    const tellTimer = setTimeout(
      () => setTellLanded(true),
      timings.approach + Math.round(timings.hold * FAST_FORWARD_FROM_HOLD_FRACTION),
    ) as unknown as number;
    timers.current.push(tellTimer);
    if (timings.beatMs > 0) {
      const beatTimer = setTimeout(
        () => audio.duck(CEREMONY_GAIN.duck, 80),
        timings.approach + timings.hold - timings.beatMs,
      ) as unknown as number;
      timers.current.push(beatTimer);
    }

    return () => {
      timers.current.forEach((t) => clearTimeout(t));
    };
  }, [sequenceToken, reduceMotion, timings, enableTapFlow]);

  const skipDecision = skipPolicy({
    ceremoniesCompleted,
    phase,
    phaseElapsedMs: phase === 'hold' ? (tellLanded ? durations.hold : 0) : 0,
    phaseDurationMs: durations[phase],
    reduceMotion,
    alreadyCompressed: compressed,
  });

  const compress = useCallback(() => {
    if (skipDecision !== 'compress') return;
    const elapsed = Date.now() - phaseStartedAtRef.current;
    const c = compressTimings(timings, phase === 'hold' ? elapsed : timings.hold);
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    if (phase === 'hold') {
      runSchedule(scheduleFrom('hold', c, 0));
    } else if (phase === 'tear-flip') {
      const entries = scheduleFrom('tear-flip', c, 0);
      if (entries.length > 0) {
        entries[0] = {
          ...entries[0],
          at: Math.max(0, Math.round((timings.tearFlip - elapsed) / FAST_FORWARD_TEAR_FACTOR)),
        };
      }
      runSchedule(entries);
    } else if (phase === 'flash-reveal') {
      runSchedule(scheduleFrom('flash-reveal', c, elapsed));
    }
    setCompressed(true);
    setActiveTimings(c);
    audio.duck(0, 60);
    haptics.tick();
  }, [skipDecision, timings, phase, runSchedule, audio, haptics]);

  // Reduce-motion cues on mount / RM change.
  useEffect(() => {
    haptics.reset({ reduceMotion });
    if (reduceMotion) {
      audio.tail('soft-chime');
      haptics.impact('light');
    }
  }, [reduceMotion]);

  // Per-phase audio/haptic cues (fire-and-forget through the B04 controllers).
  useEffect(() => {
    if (phase === 'hold') {
      // The bed starts now; the impact aligned with the tell is fired by the tell timer below.
      audio.bed(bedName, { gain: CEREMONY_GAIN.bed[peakRarity] });
    } else if (phase === 'tear-flip') {
      audio.hit('rip');
      haptics.impact('light');
      if (isMulti) {
        const id = setTimeout(() => audio.hit('stack-thud'), Math.round(activeTimings.tearFlip * 0.5)) as unknown as number;
        timers.current.push(id);
      }
    } else if (phase === 'flash-reveal') {
      audio.hit('seam-burst');
      if (peakRarity === 'LEG') audio.hit('stinger');
      else if (peakRarity === 'RAR') audio.hit('chime');
      haptics.impact(peakRarity === 'LEG' ? 'heavy' : peakRarity === 'RAR' ? 'medium' : 'light');
      if (peakRarity === 'LEG') haptics.success();
    } else if (phase === 'settle') {
      if (peakRarity !== 'COM') audio.tail('sparkle-tail');
      audio.bed(bedName, { gain: CEREMONY_GAIN.bedTable });
    }
  }, [phase]);

  // The tell impact lands with the colour (RAR/LEG only) when tellLanded flips true.
  useEffect(() => {
    if (tellLanded && phase === 'hold' && peakRarity !== 'COM') {
      haptics.impact(peakRarity === 'LEG' ? 'heavy' : 'medium');
    }
  }, [tellLanded]);

  // Stop all audio on unmount.
  useEffect(() => {
    return () => {
      audio.stopAll();
    };
  }, []);

  const phaseCopy = getCeremonyPhaseCopy(phase, isMulti);
  const phaseTitleText = phase === 'approach' ? CEREMONY_COPY_V9.approach.rareTitles[peakRarity] : phaseCopy.title;

  // VoiceOver phase announcements (optional-called; the test mock has no such member).
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(phaseTitleText);
  }, [phaseTitleText]);

  const onTapStart = useCallback(
    (card: TapCardData) => {
      audio.hit('card-flip');
      if (card.rarity === 'RAR') audio.hit('chime');
      else if (card.rarity === 'LEG') audio.hit('legendary');
      haptics.impact('soft');
    },
    [audio, haptics],
  );
  const onFlipped = useCallback((uid: string) => {
    setFlippedSet((s) => {
      const next = new Set(s);
      next.add(uid);
      return next;
    });
  }, []);
  const onFocusToggle = useCallback((uid: string) => {
    setFocusedUid((cur) => (cur === uid ? null : uid));
  }, []);
  const onContinue = useCallback(() => {
    markCeremonyCompleted().catch(() => {});
    goResult();
  }, [goResult]);

  const packPhase = phase === 'swipe' || phase === 'approach' || phase === 'hold' || phase === 'tear-flip';
  const tablePhase = phase === 'flash-reveal' || phase === 'settle' || phase === 'cards-on-table';
  const showFeatured = !enableTapFlow && (phase === 'flash-reveal' || phase === 'settle');
  const featuredProps: FeaturedCardProps = {
    accent,
    rarityText: featured?.rarity ?? peakRarity,
    questionText: featured?.question ?? 'Cards revealed',
    packPaletteCover: palette.cover,
    coverImage,
    faceUp: true,
  };

  const allFlipped = cards.length > 0 && flippedSet.size >= cards.length;
  // On the table the word appears once a card is face up; on the featured-reveal path
  // (tapFlow off) the settle phase shows it. With tapFlow on the reveal is the table,
  // so settle keeps the word withheld until the first flip.
  const rarityVisible = phase === 'cards-on-table' ? flippedSet.size > 0 : phase === 'settle' && !enableTapFlow;
  const rarityWord = peakRarity === 'LEG' ? 'Legendary' : peakRarity === 'RAR' ? 'Rare' : 'Common';
  const ctaText =
    phase === 'cards-on-table'
      ? allFlipped
        ? CEREMONY_COPY_V10.continueCta
        : CEREMONY_COPY_V10.skipProgress(flippedSet.size, cards.length)
      : CEREMONY_COPY_V10.showResult;
  const ctaPress = phase === 'cards-on-table' && allFlipped ? onContinue : goResult;

  const stageOwnsSwipe = phase === 'swipe' && !reduceMotion && !(renderer === 'skia' && GestureHandler.available);

  const renderTapCard = (card: TapCardData, index: number) => (
    <TapCard
      key={card.stableUid}
      card={card}
      index={index}
      total={cards.length}
      width={slot.width}
      height={slot.height}
      disabled={phase !== 'cards-on-table'}
      flipped={flippedSet.has(card.stableUid)}
      onTapStart={onTapStart}
      onFlipped={onFlipped}
      cardBackImage={cardBackImage}
      frameImage={cardFrameForRarity(card.rarity)}
      reduceMotion={reduceMotion}
      focused={focusedUid === card.stableUid}
      onFocusToggle={onFocusToggle}
      timings={activeTimings}
    />
  );

  const renderTable = () => {
    if (cards.length <= 5) {
      return <View style={styles.tapRow}>{cards.map((card, i) => renderTapCard(card as TapCardData, i))}</View>;
    }
    const half = Math.ceil(cards.length / 2);
    return (
      <View style={styles.tapTwoRows}>
        <View style={styles.tapRow}>{cards.slice(0, half).map((card, i) => renderTapCard(card as TapCardData, i))}</View>
        <View style={styles.tapRow}>
          {cards.slice(half).map((card, i) => renderTapCard(card as TapCardData, half + i))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} testID="screen-draw-ceremony-root">
      <LinearGradient colors={PAGE_GRADIENT_CEREMONY} style={styles.gradient}>
        <View style={styles.backdrop} testID="draw-ceremony-backdrop" />

        <Pressable
          testID="draw-ceremony-leave"
          accessibilityRole="button"
          accessibilityLabel={CEREMONY_COPY_V10.leaveCeremony}
          onPress={goResult}
          style={styles.leaveButton}
        />

        {skipDecision === 'compress' ? (
          <Pressable
            testID="draw-ceremony-fast-forward"
            accessibilityRole="button"
            accessibilityLabel={CEREMONY_COPY_V10.speedUp}
            onPress={compress}
            hitSlop={12}
            style={styles.ceremonySkipX}
          >
            <Text style={styles.ceremonySkipXText}>×</Text>
          </Pressable>
        ) : null}

        <Reanimated.View pointerEvents="none" style={[styles.dimOverlay, dimStyle]} />
        <Reanimated.View style={[styles.content, cameraStyle]}>
          <Text
            style={styles.phaseCopyHidden}
            testID="draw-ceremony-phase-copy"
            numberOfLines={1}
            accessibilityLiveRegion="polite"
          >
            {phaseTitleText}
          </Text>
          <Text style={styles.phaseCopyHidden} numberOfLines={1} testID="draw-ceremony-phase-body-copy">
            {phaseCopy.body}
          </Text>

          <View
            style={styles.stage}
            testID="draw-ceremony-stage"
            onStartShouldSetResponder={() => stageOwnsSwipe || skipDecision === 'compress'}
            onMoveShouldSetResponder={() => stageOwnsSwipe || skipDecision === 'compress'}
            onResponderGrant={(event) => {
              if (stageOwnsSwipe) {
                swipeStartXRef.current = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
                audio.bed('crinkle');
                haptics.impact('light');
              }
            }}
            onResponderMove={(event) => {
              if (!stageOwnsSwipe || swipeStartXRef.current == null) return;
              const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
              const delta = Math.max(0, touchX - swipeStartXRef.current);
              const p = seamProgressFromDelta(delta);
              setSwipeProgress(p);
              timeline.seam.value = p;
            }}
            onResponderRelease={(event) => {
              if (stageOwnsSwipe) {
                const touchX = event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0;
                const startX = swipeStartXRef.current ?? touchX;
                swipeStartXRef.current = null;
                const delta = touchX - startX;
                if (delta >= SWIPE_TRIGGER_DISTANCE) {
                  startSequence();
                  return;
                }
                setSwipeProgress(0);
                timeline.seam.value = 0;
                audio.bed(null);
                return;
              }
              if (skipDecision === 'compress') {
                compress();
              }
            }}
            onResponderTerminate={() => {
              swipeStartXRef.current = null;
              if (phase === 'swipe') {
                setSwipeProgress(0);
              }
            }}
          >
            {renderer === 'skia' ? (
              <StageCanvas
                testID={STAGE_TESTID}
                width={280}
                height={360}
                peakRarity={peakRarity}
                timeline={timeline}
                reduceMotion={reduceMotion}
                particleSheet={PARTICLE_SHEET}
                glowNineSlice={GLOW_9SLICE}
                cardCount={cards.length}
              />
            ) : null}

            {renderer === 'skia' && packPhase ? (
              <PackTear
                width={240}
                height={336}
                coverImage={coverImage}
                palette={palette}
                phase={phase}
                isMulti={isMulti}
                pitySeal={pitySeal}
                timeline={timeline}
                disabled={reduceMotion || phase !== 'swipe'}
                onTear={startSequence}
                onSeamProgress={setSwipeProgress}
              />
            ) : null}

            {renderer === 'skia' && phase === 'hold' ? (
              <View testID="draw-ceremony-hold-marker" style={styles.holdMarker} />
            ) : null}

            {renderer === 'fallback' ? (
              <FallbackStage
                phase={phase}
                isMulti={isMulti}
                reduceMotion={reduceMotion}
                peakRarity={peakRarity}
                palette={palette}
                coverImage={coverImage}
                pitySeal={pitySeal}
                disabled={reduceMotion || phase !== 'swipe'}
                onTear={startSequence}
                swipeProgress={swipeProgress}
                cards={cards}
                spill={spill}
                glowNineSlice={GLOW_9SLICE}
                tellVisible={phase !== 'swipe' && phase !== 'approach'}
                featured={showFeatured ? featuredProps : null}
              />
            ) : null}

            {renderer === 'skia' && showFeatured ? <FeaturedCard {...featuredProps} /> : null}

            {phase === 'tear-flip' && isMulti ? (
              <SpillSampler durationMs={activeTimings.tearFlip} renderer={renderer} />
            ) : null}

            {enableTapFlow && tablePhase ? (
              <View
                testID={phase === 'cards-on-table' ? 'draw-ceremony-cards-on-table' : undefined}
                style={phase === 'cards-on-table' ? styles.tapTable : styles.tapTableFrom}
              >
                {renderTable()}
              </View>
            ) : null}
          </View>

          <Text
            style={[styles.footerRarity, !rarityVisible && styles.footerRarityHidden]}
            testID="draw-ceremony-footer-rarity"
            numberOfLines={1}
          >
            {rarityVisible ? rarityWord : ''}
          </Text>

          {canSkip ? (
            <Pressable
              testID="screen-draw-ceremony-primary-cta"
              nativeID="draw-ceremony-skip-hint"
              accessibilityRole="button"
              style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
              onPress={ctaPress}
            >
              <Text style={styles.skipText} numberOfLines={1}>
                {ctaText}
              </Text>
            </Pressable>
          ) : null}
        </Reanimated.View>

        <View
          testID="draw-ceremony-reveal-flash"
          style={[
            styles.flash,
            {
              backgroundColor: flashColor(peakRarity),
              opacity: phase === 'flash-reveal' && !reduceMotion ? 0.85 : 0,
            },
            renderer === 'skia' ? styles.flashHiddenBehindCanvas : null,
          ]}
          pointerEvents="none"
        />
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawCeremonyScreen;
