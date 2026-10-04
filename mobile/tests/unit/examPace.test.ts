import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildExamPace, examPaceDayKey, examPaceLabel, formatPaceDay } from '../../src/features/goal/examPace';

// U5: Home's daily target. Every case builds its clock from local wall-clock times (like
// studyGoal.test.ts), and the whole suite runs again in three time zones: one far east of UTC with
// DST in the southern spring, one west of UTC with DST ending in November, and one with a
// half-hour offset and no DST. Node re-reads process.env.TZ when it is assigned.
const ZONES = [
  { tz: 'Pacific/Auckland', januaryOffsetMinutes: -13 * 60 },
  { tz: 'America/New_York', januaryOffsetMinutes: 5 * 60 },
  { tz: 'Asia/Kolkata', januaryOffsetMinutes: -(5 * 60 + 30) },
] as const;

const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe.each(ZONES)('exam pace in $tz', ({ tz, januaryOffsetMinutes }) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('runs in the zone it names', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(januaryOffsetMinutes);
  });

  it('spreads the cards left over the days before the review cap (the day before the exam)', () => {
    // Exam Thu Oct 22; cap Wed Oct 21; Oct 4 .. Oct 20 is 17 learning days. 371 - 65 = 306 → 18/day.
    const pace = buildExamPace({ examDate: '2026-10-22', totalCards: 371, learnedCards: 65, nowMs: at(2026, 10, 4, 9) });
    expect(pace).toEqual({ kind: 'pace', perDay: 18, learningDays: 17, remaining: 306, leftToday: 18, readyBy: '2026-10-21' });
    expect(examPaceLabel(pace)).toBe('≈ 18 cards/day to be ready by Oct 21');
  });

  it('counts the same days at one minute past midnight and one minute before the next', () => {
    const early = buildExamPace({ examDate: '2026-10-22', totalCards: 100, learnedCards: 0, nowMs: at(2026, 10, 4, 0, 1) });
    const late = buildExamPace({ examDate: '2026-10-22', totalCards: 100, learnedCards: 0, nowMs: at(2026, 10, 4, 23, 59) });
    expect(early).toEqual(late);
    expect(early).toMatchObject({ kind: 'pace', learningDays: 17, perDay: 6 });
  });

  it('counts whole days across a DST change in either hemisphere', () => {
    // Auckland moves its clocks on Sep 27 2026, New York on Nov 1 2026; Kolkata never does.
    expect(buildExamPace({ examDate: '2026-10-10', totalCards: 40, learnedCards: 0, nowMs: at(2026, 9, 20, 22) })).toMatchObject({
      kind: 'pace',
      learningDays: 19, // Sep 20 .. Oct 8, cap Oct 9
      perDay: 3,
      readyBy: '2026-10-09',
    });
    expect(buildExamPace({ examDate: '2026-11-10', totalCards: 15, learnedCards: 0, nowMs: at(2026, 10, 25, 1) })).toMatchObject({
      kind: 'pace',
      learningDays: 15, // Oct 25 .. Nov 8, cap Nov 9
      perDay: 1,
      readyBy: '2026-11-09',
    });
  });

  it('is recalculated daily: today’s target holds while the learner works, and moves the next day', () => {
    const exam = '2026-10-22';
    const morning = at(2026, 10, 4, 8);
    const start = buildExamPace({ examDate: exam, totalCards: 371, learnedCards: 65, nowMs: morning });
    expect(start).toMatchObject({ perDay: 18, leftToday: 18 });

    // 10 learned since the morning: the anchor (65 learned at day start) keeps the target at 18.
    const midday = buildExamPace({ examDate: exam, totalCards: 371, learnedCards: 75, nowMs: at(2026, 10, 4, 13), learnedAtDayStart: 65 });
    expect(midday).toMatchObject({ kind: 'pace', perDay: 18, remaining: 296, leftToday: 8 });
    expect(examPaceLabel(midday)).toBe('≈ 18 cards/day to be ready by Oct 21');

    // Today's share done: the line says so instead of a shrinking number.
    const evening = buildExamPace({ examDate: exam, totalCards: 371, learnedCards: 85, nowMs: at(2026, 10, 4, 21), learnedAtDayStart: 65 });
    expect(evening).toMatchObject({ perDay: 18, leftToday: 0 });
    expect(examPaceLabel(evening)).toBe("Today's 18 done · on track for Oct 21");

    // Next day, new anchor: 286 left over 16 days → 18/day.
    expect(buildExamPace({ examDate: exam, totalCards: 371, learnedCards: 85, nowMs: at(2026, 10, 5, 8) })).toMatchObject({
      perDay: 18,
      learningDays: 16,
      leftToday: 18,
    });
  });

  it('counts nothing as done today when the anchor is above the learned count (progress was reset)', () => {
    const pace = buildExamPace({ examDate: '2026-10-22', totalCards: 400, learnedCards: 0, nowMs: at(2026, 10, 4), learnedAtDayStart: 65 });
    expect(pace).toMatchObject({ remaining: 400, perDay: 24, leftToday: 24 });
  });

  it('does not count a deck update as today’s work: only cards learned since the anchor are', () => {
    const exam = '2026-10-22';
    const nowMs = at(2026, 10, 4, 15);
    // Morning: 371 cards, 65 learned → 18/day. 10 learned since, then an update retires 50 unlearned cards.
    const shrunk = buildExamPace({ examDate: exam, totalCards: 321, learnedCards: 75, nowMs, learnedAtDayStart: 65 });
    // 246 left now + 10 done today = 256 at the day's start against today's deck → 16/day, 6 still to go.
    expect(shrunk).toMatchObject({ kind: 'pace', remaining: 246, perDay: 16, leftToday: 6 });
    expect(examPaceLabel(shrunk)).toBe('≈ 16 cards/day to be ready by Oct 21');
    // An update that adds 29 unlearned cards raises the day's target; the 10 done still count.
    const grown = buildExamPace({ examDate: exam, totalCards: 400, learnedCards: 75, nowMs, learnedAtDayStart: 65 });
    expect(grown).toMatchObject({ kind: 'pace', remaining: 325, perDay: 20, leftToday: 10 });
  });

  it('asks for everything on the last learning day, and says "final review" once the cap has passed', () => {
    // Exam Oct 22: Oct 20 is the last learning day; Oct 21 (cap day) and Oct 22 (exam day) are final review.
    expect(buildExamPace({ examDate: '2026-10-22', totalCards: 50, learnedCards: 20, nowMs: at(2026, 10, 20, 23, 30) })).toMatchObject({
      kind: 'pace',
      learningDays: 1,
      perDay: 30,
    });
    for (const nowMs of [at(2026, 10, 21, 0, 1), at(2026, 10, 22, 7)]) {
      const pace = buildExamPace({ examDate: '2026-10-22', totalCards: 50, learnedCards: 20, nowMs });
      expect(pace).toEqual({ kind: 'final', remaining: 30 });
      expect(examPaceLabel(pace)).toBe('Final review: go over the cards you know');
    }
  });

  it('shows nothing for a past exam, no date, an invalid date or an empty deck', () => {
    const now = at(2026, 10, 4);
    for (const examDate of [null, '2026-10-03', '2026-02-30', 'soon']) {
      const pace = buildExamPace({ examDate, totalCards: 100, learnedCards: 10, nowMs: now });
      expect(pace).toEqual({ kind: 'none' });
      expect(examPaceLabel(pace)).toBeNull();
    }
    expect(buildExamPace({ examDate: '2026-10-22', totalCards: 0, learnedCards: 0, nowMs: now })).toEqual({ kind: 'none' });
    expect(buildExamPace({ examDate: '2026-10-22', totalCards: Number.NaN, learnedCards: 0, nowMs: now })).toEqual({ kind: 'none' });
    expect(buildExamPace({ examDate: '2026-10-22', totalCards: 10, learnedCards: -1, nowMs: now })).toEqual({ kind: 'none' });
  });

  it('says the deck is finished when every card is learned, before or on the exam day', () => {
    for (const nowMs of [at(2026, 10, 4), at(2026, 10, 22, 8)]) {
      const pace = buildExamPace({ examDate: '2026-10-22', totalCards: 217, learnedCards: 217, nowMs });
      expect(pace).toEqual({ kind: 'finished', totalCards: 217 });
      expect(examPaceLabel(pace)).toBe('Every card learned · keep up your reviews');
    }
    // A learned count above the deck size (cards retired from the deck) is still finished.
    expect(buildExamPace({ examDate: '2026-10-22', totalCards: 210, learnedCards: 217, nowMs: at(2026, 10, 4) })).toEqual({
      kind: 'finished',
      totalCards: 210,
    });
  });

  it('never asks for fewer than one card a day, and says "card" for one', () => {
    const pace = buildExamPace({ examDate: '2027-01-30', totalCards: 10, learnedCards: 9, nowMs: at(2026, 10, 4) });
    expect(pace).toMatchObject({ kind: 'pace', perDay: 1 });
    expect(examPaceLabel(pace)).toBe('≈ 1 card/day to be ready by Jan 29');
  });

  it('keys the day and formats the ready-by day on the local calendar', () => {
    expect(examPaceDayKey(at(2026, 10, 4, 0, 1))).toBe('2026-10-04');
    expect(examPaceDayKey(at(2026, 10, 4, 23, 59))).toBe('2026-10-04');
    expect(formatPaceDay('2026-10-21')).toBe('Oct 21');
    expect(formatPaceDay('2026-13-01')).toBe('');
  });
});
