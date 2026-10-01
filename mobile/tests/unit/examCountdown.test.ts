import { describe, expect, it } from 'vitest';
import { buildExamCountdownLabel } from '../../src/features/gacha/home/examCountdown';

const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();

describe('buildExamCountdownLabel (R22 §5)', () => {
  it('is null with no exam date, so Home says nothing about exams', () => {
    expect(buildExamCountdownLabel(null, at(2026, 10, 2))).toBeNull();
  });

  it('is null for a past or invalid exam date', () => {
    expect(buildExamCountdownLabel('2026-09-30', at(2026, 10, 2))).toBeNull();
    expect(buildExamCountdownLabel('2026-02-30', at(2026, 10, 2))).toBeNull();
  });

  it('reads "Exam in N days" from daysUntilExam', () => {
    expect(buildExamCountdownLabel('2026-10-14', at(2026, 10, 2))).toBe('Exam in 12 days');
    expect(buildExamCountdownLabel('2026-10-14', at(2026, 10, 2, 23))).toBe('Exam in 12 days');
  });

  it('uses the singular the day before and says today on the day', () => {
    expect(buildExamCountdownLabel('2026-10-03', at(2026, 10, 2))).toBe('Exam in 1 day');
    expect(buildExamCountdownLabel('2026-10-02', at(2026, 10, 2))).toBe('Exam today');
  });
});
