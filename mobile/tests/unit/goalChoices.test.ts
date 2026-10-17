import { describe, expect, it } from 'vitest';
import {
  DATE_PRESETS,
  DEFAULT_GOAL_DECK_SLUG,
  GOAL_CHOICES,
  NO_DATE_LABEL,
  canStepExamDate,
  examDateForPreset,
  formatExamDate,
  goalChoiceLabel,
  stepExamDate,
} from '../../src/features/gacha/audience/goalChoices';

// 2026-10-02 at 15:00 local time.
const NOW = new Date(2026, 9, 2, 15, 0, 0).getTime();

describe('goal choices (R22 contract §3)', () => {
  it('offers exactly the three decks, AWS Architect Basics first, highlighted and the default', () => {
    // 2026-10-14 three decks: fundamentals, SAA-C03, Claude; csharp-basics is hidden, so not offered.
    expect(GOAL_CHOICES.map((c) => c.deckSlug)).toEqual(['aws-saa-fundamentals', 'aws-saa-c03', 'claude-ccdv-f']);
    expect(GOAL_CHOICES.map((c) => c.label)).toEqual([
      'AWS Architect Basics (Chinese)',
      'AWS Solutions Architect (SAA-C03)',
      'Claude Developer (CCDV-F)',
    ]);
    expect(GOAL_CHOICES.some((c) => c.deckSlug === 'csharp-basics')).toBe(false);
    expect(GOAL_CHOICES[0].highlighted).toBe(true);
    expect(GOAL_CHOICES.slice(1).every((c) => !c.highlighted)).toBe(true);
    expect(DEFAULT_GOAL_DECK_SLUG).toBe('aws-saa-fundamentals');
  });

  it('keeps the label of a hidden goal deck, so un-hiding it offers it again unchanged', () => {
    expect(goalChoiceLabel('csharp-basics')).toBe('.NET interview questions');
    expect(goalChoiceLabel('aws-saa-c03')).toBe('AWS Solutions Architect (SAA-C03)');
    expect(goalChoiceLabel('no-such-deck')).toBeUndefined();
  });

  it("puts 'No date — I'm just learning' first, then the four presets", () => {
    expect(NO_DATE_LABEL).toBe("No date — I'm just learning");
    expect(DATE_PRESETS.map((p) => p.label)).toEqual(['In 2 weeks', 'In 1 month', 'In 2 months', 'In 3 months']);
  });

  it('turns each preset into a local calendar day', () => {
    expect(examDateForPreset('2w', NOW)).toBe('2026-10-16');
    expect(examDateForPreset('1m', NOW)).toBe('2026-11-02');
    expect(examDateForPreset('2m', NOW)).toBe('2026-12-02');
    expect(examDateForPreset('3m', NOW)).toBe('2027-01-02');
  });

  it('clamps a month preset to the last day of a shorter month', () => {
    const jan31 = new Date(2027, 0, 31, 9, 0, 0).getTime();
    expect(examDateForPreset('1m', jan31)).toBe('2027-02-28');
  });

  it('steps the chosen day by one week and never into today or the past', () => {
    expect(stepExamDate('2026-10-16', 1)).toBe('2026-10-23');
    expect(stepExamDate('2026-10-16', -1)).toBe('2026-10-09');
    expect(canStepExamDate('2026-10-16', -1, NOW)).toBe(true);
    expect(canStepExamDate('2026-10-09', -1, NOW)).toBe(false);
    expect(canStepExamDate('2026-10-09', 1, NOW)).toBe(true);
  });

  it('formats a day for display without a date library', () => {
    expect(formatExamDate('2026-10-16')).toBe('Fri, Oct 16, 2026');
    expect(formatExamDate('not-a-date')).toBe('');
  });
});
