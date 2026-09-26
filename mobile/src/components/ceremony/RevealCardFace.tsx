// RevealCardFace — the framed 5:7 card face, extracted from DrawResultScreen so the result
// screen and the single-pull RevealSpotlight render the SAME card (I04). The host structure
// (rarity gradient → art window with the marks column → question slab → title strip → the
// rarity frame painted last) is pinned by draw-result.screen.test / draw-result-kind.screen.test
// and must not change; those tests are out of scope and must keep passing unchanged.
//
// Image is read through the same `readRN` facade TapCard uses because the ceremony test's
// react-native mock has no Image export — image nodes are simply omitted when it is absent.

import React from 'react';
import { Text, View, Pressable } from 'react-native';
import * as RN from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '../../theme/colors';
import {
  CARD_FRAME_ART_WINDOW,
  CARD_FRAME_SIZE,
  CARD_FRAME_SLAB,
  CARD_FRAME_TITLE_STRIP,
  cardFrameForRarity,
  rarityAccentColor,
  type PackPalette,
} from '../../theme/packArt';
import { MCQ_COPY } from '../../features/gacha/mcq/mcqConstants';
import { drawResultStyles } from '../../features/gacha/components/drawResultStyles';
import { revealFaceMetrics } from '../../features/gacha/draw/spotlightPlan';
import { rarityLabel } from './TapCard';

function readRN<T = any>(key: string, fallback: T): T {
  try {
    const value = (RN as any)[key];
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const RNImage: any = readRN('Image', null);
const StyleSheet: any = readRN('StyleSheet', { create: (s: any) => s, absoluteFillObject: {} });

// The B12 rarity frame (400×560) is stretched over the whole card, so the face is laid out at
// the frame's own cut-outs as percentages of the card. Moved here from DrawResultScreen; the
// result screen re-exports the old names so its callers keep compiling.
function framePct(part: number, whole: number): `${number}%` {
  return `${Math.round((part / whole) * 100 * 100) / 100}%`;
}
const FRAME_W = CARD_FRAME_SIZE.width;
const FRAME_H = CARD_FRAME_SIZE.height;
export const REVEAL_FRAME_LAYOUT = {
  artWindow: {
    left: framePct(CARD_FRAME_ART_WINDOW.x, FRAME_W),
    top: framePct(CARD_FRAME_ART_WINDOW.y, FRAME_H),
    width: framePct(CARD_FRAME_ART_WINDOW.width, FRAME_W),
    height: framePct(CARD_FRAME_ART_WINDOW.height, FRAME_H),
  },
  slab: {
    left: framePct(CARD_FRAME_SLAB.x, FRAME_W),
    top: framePct(CARD_FRAME_SLAB.y, FRAME_H),
    width: framePct(CARD_FRAME_SLAB.width, FRAME_W),
    height: framePct(CARD_FRAME_SLAB.height, FRAME_H),
  },
  titleStrip: {
    left: framePct(CARD_FRAME_TITLE_STRIP.x, FRAME_W),
    top: framePct(CARD_FRAME_TITLE_STRIP.y, FRAME_H),
    width: framePct(CARD_FRAME_TITLE_STRIP.width, FRAME_W),
    height: framePct(CARD_FRAME_TITLE_STRIP.height, FRAME_H),
  },
} as const;
/** The face is a summary, not the study surface: the stem gets six lines, then an ellipsis. */
export const REVEAL_STEM_LINES = 6;

const FEATURED_GRADIENT_BY_RARITY: Record<'COM' | 'RAR' | 'LEG', readonly [string, string, string]> = {
  LEG: [colors.softCream, colors.rarityLegendary, colors.glowGold],
  RAR: [colors.softLavender, colors.rarityRare, colors.pokeBlue],
  COM: [colors.softPeach, colors.rarityCommon, colors.gold],
};

export type RevealCardFaceCard = {
  stableUid: string;
  question: string;
  rarity: 'COM' | 'RAR' | 'LEG';
  tag?: string;
  rank?: number;
  kind?: 'mcq';
  requiredCount?: number;
};

function cardTagText(card: RevealCardFaceCard): string {
  return typeof card.tag === 'string' && card.tag.trim() ? card.tag.trim() : '';
}
function cardKindText(card: RevealCardFaceCard): string {
  if (card.kind !== 'mcq') return '';
  return typeof card.requiredCount === 'number' && card.requiredCount >= 2
    ? MCQ_COPY.faceMarkPick(card.requiredCount)
    : MCQ_COPY.faceMark;
}

/** Gold ★ count for a rarity — RAR = 1, LEG = 3, COM = none. */
function rarityStars(rarity: RevealCardFaceCard['rarity']): string {
  if (rarity === 'LEG') return '★★★';
  if (rarity === 'RAR') return '★';
  return '';
}

export type RevealCardFaceProps = {
  card: RevealCardFaceCard;
  width: number;
  testIDPrefix: string;
  /** 'full' (default) is the study-surface face; 'mini' is the framed summary-grid thumbnail. */
  variant?: 'full' | 'mini';
  packArt?: ImageSourcePropType;
  packPaletteCover: PackPalette['cover'];
  serialText?: string;
  testID?: string;
  style?: any;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function RevealCardFace(props: RevealCardFaceProps): React.JSX.Element {
  const { card, width, testIDPrefix: prefix, variant = 'full', packArt, packPaletteCover, serialText, testID, style, onPress, accessibilityLabel } = props;

  const accent = rarityAccentColor(card.rarity);
  const metrics = revealFaceMetrics(width);
  const topic = cardTagText(card);
  const kind = cardKindText(card);

  // Root: a Pressable when the caller wants a tap (DrawResult opens the detail modal), else a
  // plain View (the spotlight owns the tap). `style` passes through untouched so DrawResult's
  // `({ pressed }) => [...]` function stays a function; the spotlight face self-sizes to a 5:7
  // card at the given width. No iOS shadow* here — the spotlight rotates the face in 3D.
  const rootStyle = style !== undefined ? style : { width, aspectRatio: 5 / 7, borderRadius: 18, overflow: 'hidden' as const };

  // The mini face (summary grid): rarity gradient base, the art window with the pack art, a
  // stars mark, and the rarity frame last. No chip, kind, topic, question or serial.
  const miniStars = rarityStars(card.rarity);
  const miniChildren = (
    <>
      {/* 1 — rarity gradient base. */}
      <LinearGradient
        colors={FEATURED_GRADIENT_BY_RARITY[card.rarity]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={drawResultStyles.featuredGradient}
      />

      {/* 2 — art window: the pack art cover-cropped over the pack palette. */}
      <View style={localStyles.artWindow} testID={`${prefix}-art-window`}>
        <LinearGradient
          colors={packPaletteCover}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={drawResultStyles.featuredArtGradient}
        />
        {RNImage && packArt ? (
          <RNImage
            testID={`${prefix}-art`}
            pointerEvents="none"
            source={packArt}
            resizeMode="cover"
            style={localStyles.artImage}
          />
        ) : null}
      </View>

      {/* 3 — stars mark. */}
      <View style={localStyles.miniStarsWrap} pointerEvents="none">
        <Text testID={`${prefix}-stars`} style={[localStyles.miniStars, { color: accent }]} numberOfLines={1}>
          {miniStars}
        </Text>
      </View>

      {/* 4 — rarity frame PNG, painted LAST over the face. */}
      {RNImage ? (
        <RNImage
          testID={`${prefix}-frame`}
          pointerEvents="none"
          source={cardFrameForRarity(card.rarity)}
          resizeMode="stretch"
          style={localStyles.frame}
        />
      ) : null}
    </>
  );

  const children = variant === 'mini' ? miniChildren : (
    <>
      {/* 1 — rarity gradient base (the frame's own colour when the PNG is absent). */}
      <LinearGradient
        colors={FEATURED_GRADIENT_BY_RARITY[card.rarity]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={drawResultStyles.featuredGradient}
      />

      {/* 2 — art window: the pack art cover-cropped over the pack palette, marks + topic over it. */}
      <View style={localStyles.artWindow} testID={`${prefix}-art-window`}>
        <LinearGradient
          colors={packPaletteCover}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={drawResultStyles.featuredArtGradient}
        />
        {RNImage && packArt ? (
          <RNImage
            testID={`${prefix}-art`}
            pointerEvents="none"
            source={packArt}
            resizeMode="cover"
            style={localStyles.artImage}
          />
        ) : null}
        <View testID={`${prefix}-marks`} style={localStyles.markStack}>
          <View style={[drawResultStyles.featuredRarityChip, localStyles.chipInWindow, { backgroundColor: accent }]}>
            <Text style={[drawResultStyles.featuredRarity, { fontSize: metrics.chipFontSize }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              ★ {rarityLabel(card.rarity)}
            </Text>
          </View>
          {kind ? (
            <View testID={`${prefix}-kind`} style={localStyles.kindChip}>
              <Text style={localStyles.topicText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {kind}
              </Text>
            </View>
          ) : null}
        </View>
        {topic ? (
          <View testID={`${prefix}-topic`} style={localStyles.topicChip}>
            <Text style={localStyles.topicText} numberOfLines={1}>
              {topic}
            </Text>
          </View>
        ) : null}
      </View>

      {/* 3 — question slab: leads the card, six lines then an ellipsis, fonts scaled to the width. */}
      <View style={[localStyles.slab, drawResultStyles.featuredQuestionSlab]}>
        <Text
          testID={`${prefix}-question`}
          style={[drawResultStyles.featuredQuestion, { fontSize: metrics.questionFontSize, lineHeight: metrics.questionLineHeight }]}
          numberOfLines={REVEAL_STEM_LINES}
          ellipsizeMode="tail"
        >
          {card.question}
        </Text>
      </View>

      {/* 4 — title strip: the registry serial. */}
      <View style={localStyles.titleStrip} pointerEvents="none">
        {serialText ? (
          <Text style={[drawResultStyles.featuredSerial, { fontSize: metrics.serialFontSize }]} numberOfLines={1} testID={`${prefix}-serial`}>
            {serialText}
          </Text>
        ) : null}
      </View>

      {/* 5 — rarity frame PNG, painted LAST over the face. */}
      {RNImage ? (
        <RNImage
          testID={`${prefix}-frame`}
          pointerEvents="none"
          source={cardFrameForRarity(card.rarity)}
          resizeMode="stretch"
          style={localStyles.frame}
        />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={rootStyle} onPress={onPress}>
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} accessibilityLabel={accessibilityLabel} style={rootStyle}>
      {children}
    </View>
  );
}

const localStyles = StyleSheet.create({
  frame: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  artWindow: { position: 'absolute', ...REVEAL_FRAME_LAYOUT.artWindow, overflow: 'hidden', borderRadius: 8 },
  artImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  markStack: { position: 'absolute', left: 8, top: 8, alignItems: 'flex-start', gap: 4, maxWidth: '80%' },
  chipInWindow: { marginBottom: 0 },
  topicChip: {
    position: 'absolute', left: 8, bottom: 8, maxWidth: '80%', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: 'rgba(20,23,55,0.72)',
  },
  topicText: { color: colors.softCream, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  kindChip: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: 'rgba(20,23,55,0.72)',
  },
  slab: { position: 'absolute', ...REVEAL_FRAME_LAYOUT.slab, justifyContent: 'center' },
  miniStarsWrap: { position: 'absolute', left: 0, right: 0, bottom: '10%', alignItems: 'center' },
  miniStars: { fontSize: 12, fontWeight: '900', letterSpacing: 1, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  titleStrip: {
    position: 'absolute', ...REVEAL_FRAME_LAYOUT.titleStrip, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    paddingHorizontal: 8,
  },
});

export default RevealCardFace;
