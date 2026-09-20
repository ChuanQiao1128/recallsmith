// Property + literal tests for the pure multi-pull deal (spillSchedule.ts).
// Generators encode the real input contract; literals pin the design §3.1 M3 numbers.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildSpillSchedule,
  centreSlot,
  featuredCardIndex,
} from '../../src/features/gacha/draw/spillSchedule';
import {
  SPILL_STAGGER_MS,
  SPILL_START_FRACTION,
  SPILL_TRAVEL_FRACTION,
  type PeakRarity,
} from '../../src/features/gacha/draw/ceremonyTimings';

const rarityArb = fc.constantFrom<PeakRarity>('COM', 'RAR', 'LEG');
const cardsArb = fc.array(fc.record({ rarity: rarityArb }), { minLength: 1, maxLength: 10 });
const tearArb = fc.integer({ min: 0, max: 10000 });

describe('spillSchedule', () => {
  it('deals exactly one entry per card, in card-index order', () => {
    fc.assert(
      fc.property(cardsArb, tearArb, (cards, tearMs) => {
        const { entries } = buildSpillSchedule(cards, tearMs);
        expect(entries.length).toBe(cards.length);
        entries.forEach((e, i) => expect(e.index).toBe(i));
      }),
    );
    // Two cards spill two entries, not six padded clones (DrawCeremonyScreen.tsx:828-836).
    const two = buildSpillSchedule([{ rarity: 'COM' }, { rarity: 'LEG' }], 1800);
    expect(two.entries.length).toBe(2);
    const empty = buildSpillSchedule([], 1800);
    expect(empty.entries).toEqual([]);
    expect(empty.featuredIndex).toBe(-1);
    expect(empty.staggerMs).toBe(0);
  });

  it('lands every card inside the tear phase', () => {
    fc.assert(
      fc.property(cardsArb, tearArb, (cards, tearMs) => {
        const s = buildSpillSchedule(cards, tearMs);
        expect(s.startMs).toBe(Math.round(tearMs * SPILL_START_FRACTION));
        expect(s.travelMs).toBe(Math.round(tearMs * SPILL_TRAVEL_FRACTION));
        expect(s.staggerMs).toBeGreaterThanOrEqual(0);
        expect(s.staggerMs).toBeLessThanOrEqual(SPILL_STAGGER_MS);
        s.entries.forEach((e) => {
          expect(e.landAt).toBeLessThanOrEqual(tearMs);
          expect(e.leaveAt).toBeGreaterThanOrEqual(s.startMs);
          expect(e.landAt - e.leaveAt).toBe(s.travelMs);
        });
      }),
    );
  });

  it('assigns slots as a permutation with the featured card in the centre', () => {
    fc.assert(
      fc.property(cardsArb, tearArb, (cards, tearMs) => {
        const s = buildSpillSchedule(cards, tearMs);
        const slots = s.entries.map((e) => e.slot).sort((a, b) => a - b);
        expect(slots).toEqual(cards.map((_, i) => i));
        expect(s.featuredIndex).toBe(featuredCardIndex(cards));
        expect(s.entries[s.featuredIndex].slot).toBe(centreSlot(cards.length));
      }),
    );
    const table: Array<[number, number]> = [
      [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 1], [7, 1], [8, 1], [9, 2], [10, 2],
    ];
    for (const [count, slot] of table) expect(centreSlot(count)).toBe(slot);
    expect(centreSlot(0)).toBe(0);
  });

  it('deals the featured card last and the rest in index order', () => {
    fc.assert(
      fc.property(cardsArb, tearArb, (cards, tearMs) => {
        const s = buildSpillSchedule(cards, tearMs);
        const fi = s.featuredIndex;
        const featuredLeave = s.entries[fi].leaveAt;
        s.entries.forEach((e) => expect(featuredLeave).toBeGreaterThanOrEqual(e.leaveAt));
        if (s.staggerMs > 0) {
          const nonFeatured = s.entries.filter((e) => e.index !== fi);
          nonFeatured.forEach((e) => expect(featuredLeave).toBeGreaterThan(e.leaveAt));
          for (let i = 1; i < nonFeatured.length; i++) {
            expect(nonFeatured[i].leaveAt).toBeGreaterThan(nonFeatured[i - 1].leaveAt);
          }
        }
        const sorted = s.entries.map((e) => e.leaveAt).sort((a, b) => a - b);
        sorted.forEach((v, o) => expect(v).toBe(s.startMs + o * s.staggerMs));
      }),
    );
  });

  it('picks the first LEG, else the first RAR, else index 0', () => {
    fc.assert(
      fc.property(cardsArb, (cards) => {
        const fi = featuredCardIndex(cards);
        const legIdx = cards.findIndex((c) => c.rarity === 'LEG');
        const rarIdx = cards.findIndex((c) => c.rarity === 'RAR');
        if (legIdx >= 0) expect(fi).toBe(legIdx);
        else if (rarIdx >= 0) expect(fi).toBe(rarIdx);
        else expect(fi).toBe(0);
      }),
    );
    expect(featuredCardIndex([])).toBe(-1);
  });

  it('reproduces the DEVICE and TEST_BASE multi numbers', () => {
    const ten = (): Array<{ rarity: PeakRarity }> => Array.from({ length: 10 }, () => ({ rarity: 'COM' as PeakRarity }));
    const device = buildSpillSchedule(ten(), 1800);
    expect(device.startMs).toBe(900);
    expect(device.travelMs).toBe(300);
    expect(device.staggerMs).toBe(60);
    expect(Math.max(...device.entries.map((e) => e.landAt))).toBe(1740);

    const testBase = buildSpillSchedule(ten(), 940);
    expect(testBase.startMs).toBe(470);
    expect(testBase.travelMs).toBe(157);
    expect(testBase.staggerMs).toBe(34);
    expect(Math.max(...testBase.entries.map((e) => e.landAt))).toBe(933);

    const one = buildSpillSchedule([{ rarity: 'COM' }], 1800);
    expect(one.entries).toEqual([{ index: 0, leaveAt: 900, landAt: 1200, slot: 0 }]);
    expect(one.staggerMs).toBe(0);
  });

  it('is deterministic and tolerates a degenerate tear', () => {
    fc.assert(
      fc.property(cardsArb, tearArb, (cards, tearMs) => {
        expect(buildSpillSchedule(cards, tearMs)).toEqual(buildSpillSchedule(cards, tearMs));
      }),
    );
    for (const bad of [0, -50, NaN]) {
      const s = buildSpillSchedule([{ rarity: 'LEG' }, { rarity: 'COM' }, { rarity: 'RAR' }], bad);
      expect(s.startMs).toBe(0);
      expect(s.travelMs).toBe(0);
      expect(s.staggerMs).toBe(0);
      s.entries.forEach((e) => {
        expect(e.leaveAt).toBe(0);
        expect(e.landAt).toBe(0);
      });
      const slots = s.entries.map((e) => e.slot).sort((a, b) => a - b);
      expect(slots).toEqual([0, 1, 2]);
    }
  });
});
