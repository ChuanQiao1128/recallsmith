// Property + literal tests for the pure fast-forward decision (skipPolicy.ts).
// The generators include dirty numeric inputs (NaN/Infinity/fractions) on purpose, as
// scheduler.properties.test.ts:26-29 does, because the policy must fail closed on them.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { skipPolicy, type SkipPolicyInput } from '../../src/features/gacha/draw/skipPolicy';
import {
  FAST_FORWARD_FROM_HOLD_FRACTION,
  DEVICE,
  type CeremonyPhase,
} from '../../src/features/gacha/draw/ceremonyTimings';

const phaseArb = fc.constantFrom<CeremonyPhase>(
  'swipe', 'approach', 'hold', 'tear-flip', 'flash-reveal', 'settle', 'cards-on-table',
);
const completedArb = fc.oneof(
  fc.integer({ min: -3, max: 5 }),
  fc.constantFrom(NaN, Infinity, -Infinity, 0.5),
);
const msArb = fc.integer({ min: 0, max: 6000 });
const inputArb = fc.record({
  ceremoniesCompleted: completedArb,
  phase: phaseArb,
  phaseElapsedMs: msArb,
  phaseDurationMs: msArb,
  reduceMotion: fc.boolean(),
  alreadyCompressed: fc.boolean(),
});

describe('skipPolicy', () => {
  it('only ever answers none or compress', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(['none', 'compress']).toContain(skipPolicy(input));
      }),
    );
  });

  it('never shows a skip under reduce motion, on a first ceremony, or twice', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        if (input.reduceMotion || !(input.ceremoniesCompleted >= 1) || input.alreadyCompressed) {
          expect(skipPolicy(input)).toBe('none');
        }
      }),
    );
    fc.assert(
      fc.property(msArb, msArb, (elapsed, duration) => {
        expect(
          skipPolicy({
            ceremoniesCompleted: 0,
            phase: 'tear-flip',
            phaseElapsedMs: elapsed,
            phaseDurationMs: duration,
            reduceMotion: false,
            alreadyCompressed: false,
          }),
        ).toBe('none');
      }),
    );
    expect(
      skipPolicy({
        ceremoniesCompleted: NaN,
        phase: 'tear-flip',
        phaseElapsedMs: 100,
        phaseDurationMs: 200,
        reduceMotion: false,
        alreadyCompressed: false,
      }),
    ).toBe('none');
  });

  it('keeps swipe, approach, settle and the table under the CTA', () => {
    const ctaPhases: CeremonyPhase[] = ['swipe', 'approach', 'settle', 'cards-on-table'];
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(...ctaPhases),
        msArb,
        msArb,
        (completed, phase, elapsed, duration) => {
          expect(
            skipPolicy({
              ceremoniesCompleted: completed,
              phase,
              phaseElapsedMs: elapsed,
              phaseDurationMs: duration,
              reduceMotion: false,
              alreadyCompressed: false,
            }),
          ).toBe('none');
        },
      ),
    );
  });

  it('opens the fast-forward at sixty percent of hold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), msArb, msArb, (completed, elapsed, duration) => {
        const r = skipPolicy({
          ceremoniesCompleted: completed,
          phase: 'hold',
          phaseElapsedMs: elapsed,
          phaseDurationMs: duration,
          reduceMotion: false,
          alreadyCompressed: false,
        });
        const expected = elapsed >= FAST_FORWARD_FROM_HOLD_FRACTION * duration ? 'compress' : 'none';
        expect(r).toBe(expected);
      }),
    );
    const hold = (phaseElapsedMs: number, phaseDurationMs: number): SkipPolicyInput => ({
      ceremoniesCompleted: 1,
      phase: 'hold',
      phaseElapsedMs,
      phaseDurationMs,
      reduceMotion: false,
      alreadyCompressed: false,
    });
    const holdRAR = DEVICE.single.hold.RAR; // 620
    expect(skipPolicy(hold(372, holdRAR))).toBe('compress');
    expect(skipPolicy(hold(371, holdRAR))).toBe('none');
    const holdLEG = DEVICE.multi.hold.LEG; // 1100
    expect(skipPolicy(hold(660, holdLEG))).toBe('compress');
    expect(skipPolicy(hold(659, holdLEG))).toBe('none');
  });

  it('compresses tear and flash on a repeat ceremony', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom<CeremonyPhase>('tear-flip', 'flash-reveal'),
        msArb,
        msArb,
        (completed, phase, elapsed, duration) => {
          expect(
            skipPolicy({
              ceremoniesCompleted: completed,
              phase,
              phaseElapsedMs: elapsed,
              phaseDurationMs: duration,
              reduceMotion: false,
              alreadyCompressed: false,
            }),
          ).toBe('compress');
        },
      ),
    );
  });

  it('is monotone in elapsed time during hold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), msArb, msArb, msArb, (completed, duration, a, b) => {
        const e1 = Math.min(a, b);
        const e2 = Math.max(a, b);
        const at = (phaseElapsedMs: number): SkipPolicyInput => ({
          ceremoniesCompleted: completed,
          phase: 'hold',
          phaseElapsedMs,
          phaseDurationMs: duration,
          reduceMotion: false,
          alreadyCompressed: false,
        });
        if (skipPolicy(at(e1)) === 'compress') expect(skipPolicy(at(e2))).toBe('compress');
      }),
    );
  });
});
