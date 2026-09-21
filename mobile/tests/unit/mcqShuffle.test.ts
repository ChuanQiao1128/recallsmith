import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mcqSeed, seededShuffle, shownOrderFor } from '../../src/features/gacha/mcq/mcqShuffle';
import { fnv1a32Hex } from '../../src/features/gacha/library/topics';
import type { McqExport } from '../../src/types/deckExport';

const card1: McqExport = {
  v: 1,
  qualifier: null,
  shuffle: true,
  options: ['a', 'b', 'c', 'd'].map((key) => ({
    key,
    text: `option ${key}`,
    why: key === 'b' ? null : `why not ${key}`,
    correct: key === 'b',
  })),
};

const seedArb = fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.constantFrom(NaN, -1, 1.5, Infinity));
const itemsArb = fc.array(fc.integer(), { maxLength: 12 });

describe('mcqShuffle', () => {
  it('returns a permutation and never mutates the input', () => {
    fc.assert(
      fc.property(itemsArb, seedArb, (items, seed) => {
        const before = [...items];
        const out = seededShuffle(items, seed);
        expect(out).not.toBe(items);
        expect([...out].sort((a, b) => a - b)).toEqual([...items].sort((a, b) => a - b));
        expect(out.length).toBe(items.length);
        expect(items).toEqual(before);
      }),
    );
    expect(() => seededShuffle(Object.freeze(['a', 'b', 'c']), 7)).not.toThrow();
    expect(seededShuffle([], 5)).toEqual([]);
    expect(seededShuffle(['a'], 5)).toEqual(['a']);
  });

  it('is deterministic per seed and changes with attemptIndex', () => {
    fc.assert(
      fc.property(itemsArb, seedArb, (items, seed) => {
        expect(seededShuffle(items, seed)).toEqual(seededShuffle(items, seed));
      }),
    );

    const uid = 'aws-sqs-order-buffer-mcq-01';
    expect(mcqSeed('run-1', 'aws-sqs-order-buffer-mcq-01', 0)).toBe(2822193929);
    expect(mcqSeed('run-1', 'aws-sqs-order-buffer-mcq-01', 1)).toBe(2805416310);
    expect(mcqSeed('run-1', 'aws-sqs-order-buffer-mcq-01', 2)).toBe(2788638691);
    for (const i of [0, 1, 2]) {
      expect(mcqSeed('run-1', uid, i)).toBe(parseInt(fnv1a32Hex(`run-1|${uid}|${i}`), 16) >>> 0);
    }
    const seeds = new Set([
      mcqSeed('run-1', uid, 0),
      mcqSeed('run-1', uid, 1),
      mcqSeed('run-1', uid, 2),
    ]);
    expect(seeds.size).toBe(3);

    fc.assert(
      fc.property(fc.string(), fc.string(), fc.nat(50), (s, u, i) => {
        const seed = mcqSeed(s, u, i);
        expect(Number.isInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThanOrEqual(0xffffffff);
        expect(mcqSeed(s, u, i)).toBe(seed);
      }),
    );

    expect(seededShuffle(['a', 'b', 'c', 'd'], 2822193929)).toEqual(['c', 'd', 'b', 'a']);
    expect(seededShuffle(['a', 'b', 'c', 'd'], 2805416310)).toEqual(['d', 'a', 'c', 'b']);
    expect(seededShuffle(['a', 'b', 'c', 'd'], 2788638691)).toEqual(['b', 'a', 'd', 'c']);
    expect(seededShuffle(['a', 'b', 'c', 'd', 'e'], 2822193929)).toEqual(['e', 'c', 'd', 'b', 'a']);
    expect(seededShuffle(['a', 'b', 'c', 'd'], 0)).toEqual(['d', 'c', 'a', 'b']);
    expect(seededShuffle(['a', 'b', 'c', 'd'], 1)).toEqual(['d', 'b', 'a', 'c']);
    expect(seededShuffle(['a', 'b', 'c', 'd'], NaN)).toEqual(seededShuffle(['a', 'b', 'c', 'd'], 0));
  });

  it('keeps stored order when shuffle is false', () => {
    const keyOf = (o: { key: string }) => o.key;
    const stored = shownOrderFor({ ...card1, shuffle: false }, 2822193929);
    expect(stored).toEqual(card1.options);
    expect(stored).not.toBe(card1.options);
    expect(stored.map(keyOf)).toEqual(['a', 'b', 'c', 'd']);

    expect(shownOrderFor(card1, 2822193929).map(keyOf)).toEqual(['c', 'd', 'b', 'a']);
    expect(shownOrderFor(card1, 2822193929)).toEqual(seededShuffle(card1.options, 2822193929));

    fc.assert(
      fc.property(seedArb, (seed) => {
        const before = card1.options.map(keyOf);
        const shown = shownOrderFor(card1, seed);
        expect([...shown.map(keyOf)].sort()).toEqual([...before].sort());
        expect(card1.options.map(keyOf)).toEqual(before);
      }),
    );
  });
});
