import { describe, expect, it } from 'vitest';
import {
  spotlightCardSize,
  revealFaceMetrics,
  resultFeaturedCardWidth,
  spotlightFlipPlan,
  spotlightFlipCues,
  spotlightEntranceCues,
  SPOTLIGHT_ENTRANCE_MS,
  SPOTLIGHT_FLYOUT_CUE_MS,
} from '../../src/features/gacha/draw/spotlightPlan';

describe('spotlightPlan', () => {
  it('sizes the spotlight card from the window for SE, 15 and Pro Max', () => {
    const se = spotlightCardSize({ width: 375, height: 667 });
    const fifteen = spotlightCardSize({ width: 393, height: 852 });
    const proMax = spotlightCardSize({ width: 430, height: 932 });

    for (const [win, card] of [
      [{ width: 375, height: 667 }, se],
      [{ width: 393, height: 852 }, fifteen],
      [{ width: 430, height: 932 }, proMax],
    ] as const) {
      expect(card.width).toBeLessThanOrEqual(0.86 * win.width);
      expect(card.height).toBeLessThanOrEqual(0.62 * win.height + 1);
      expect(card.height).toBe(Math.round(1.4 * card.width));
    }
    // The bigger phones use most of the width; SE is allowed to give the height ceiling more room.
    expect(fifteen.width).toBeGreaterThanOrEqual(0.8 * 393);
    expect(proMax.width).toBeGreaterThanOrEqual(0.8 * 430);
  });

  it('scales the face fonts with the card width', () => {
    expect(revealFaceMetrics(260).questionFontSize).toBe(12);
    const spotlight = spotlightCardSize({ width: 393, height: 852 });
    expect(revealFaceMetrics(spotlight.width).questionFontSize).toBeGreaterThanOrEqual(15);
    // line height tracks the font, chip and serial stay legible on the smallest card.
    const m = revealFaceMetrics(260);
    expect(m.questionLineHeight).toBe(Math.round(m.questionFontSize * 1.2));
    expect(m.chipFontSize).toBeGreaterThanOrEqual(11);
    expect(m.serialFontSize).toBeGreaterThanOrEqual(9);
  });

  it('sizes the result featured card from the window', () => {
    expect(resultFeaturedCardWidth(320)).toBe(260); // floored at 260
    expect(resultFeaturedCardWidth(390)).toBe(Math.round(390 * 0.78));
    expect(resultFeaturedCardWidth(600)).toBe(380); // capped at 380
  });

  it('plans the flip per rarity with a LEG shake and edge-on pause', () => {
    const com = spotlightFlipPlan('COM', false);
    const rar = spotlightFlipPlan('RAR', false);
    const leg = spotlightFlipPlan('LEG', false);

    expect(com).toMatchObject({ entranceMs: 420, shakeMs: 0, flipStartMs: 0, flipMs: 350, midpointMs: 175, landMs: 350 });
    expect(rar).toMatchObject({ entranceMs: 420, shakeMs: 0, flipStartMs: 0, flipMs: 450, midpointMs: 225, landMs: 450 });
    expect(leg).toMatchObject({ entranceMs: 420, shakeMs: 300, flipStartMs: 300, flipMs: 500, edgePauseMs: 150, midpointMs: 700, landMs: 950 });
    expect(SPOTLIGHT_ENTRANCE_MS).toBe(420);
  });

  it('reduce motion plans a crossfade with no shake or pause', () => {
    for (const rarity of ['COM', 'RAR', 'LEG'] as const) {
      expect(spotlightFlipPlan(rarity, true)).toEqual({
        entranceMs: 180, shakeMs: 0, flipStartMs: 0, flipMs: 180, edgePauseMs: 0, midpointMs: 90, landMs: 180,
      });
    }
  });

  it('lists the spotlight flip cues at flip start, midpoint and landing', () => {
    const legPlan = spotlightFlipPlan('LEG', false);
    const leg = spotlightFlipCues('LEG', legPlan);
    // sorted ascending by `at`
    expect(leg.map((c) => c.at)).toEqual([...leg.map((c) => c.at)].sort((a, b) => a - b));
    expect(leg[0]).toEqual({ at: 0, action: { kind: 'impact', style: 'soft' } });
    expect(leg.find((c) => c.action.kind === 'hit' && c.action.name === 'flip')?.at).toBe(legPlan.flipStartMs);
    expect(leg.find((c) => c.action.kind === 'hit' && c.action.name === 'stinger-leg')?.at).toBe(legPlan.midpointMs);
    // At landing LEG fires the heavy impact BEFORE the success (limiter order).
    const landCues = leg.filter((c) => c.at === legPlan.landMs);
    expect(landCues.map((c) => c.action.kind)).toEqual(['impact', 'success']);

    const rarPlan = spotlightFlipPlan('RAR', false);
    const rar = spotlightFlipCues('RAR', rarPlan);
    expect(rar.find((c) => c.action.kind === 'hit' && c.action.name === 'stinger-rar')?.at).toBe(rarPlan.midpointMs);
    expect(rar.find((c) => c.action.kind === 'success')?.at).toBe(rarPlan.landMs);

    // COM now gets its own stinger at the midpoint (I06), but no success.
    const comPlan = spotlightFlipPlan('COM', false);
    const com = spotlightFlipCues('COM', comPlan);
    expect(com.find((c) => c.action.kind === 'hit' && c.action.name === 'flip')?.at).toBe(comPlan.flipStartMs);
    expect(com.find((c) => c.action.kind === 'hit' && c.action.name === 'stinger-com')?.at).toBe(comPlan.midpointMs);
    expect(com.some((c) => c.action.kind === 'success')).toBe(false);
  });

  it('lists the entrance flyout cue in motion and nothing under reduce motion', () => {
    expect(SPOTLIGHT_FLYOUT_CUE_MS).toBe(100);
    expect(spotlightEntranceCues(false)).toEqual([
      { at: SPOTLIGHT_FLYOUT_CUE_MS, action: { kind: 'hit', name: 'flyout' } },
    ]);
    expect(spotlightEntranceCues(true)).toEqual([]);
  });
});
