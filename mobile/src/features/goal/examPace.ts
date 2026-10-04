import { daysUntilExam, examReviewCapMs, localDayStartMs } from './studyGoal';

/**
 * U5 (user-perspective review 2026-10-04): Home's daily target when the study goal has an exam
 * date. Deterministic and offline: the cards of the goal deck not learned yet, spread over the
 * local days left before the review cap (examReviewCapMs, the day before the exam), so the last
 * day is left for the final review pass.
 *
 * "Recalculated daily": the target is worked out from how many cards were learned at the start of
 * the local day (`learnedAtDayStart`, recorded per account partition by examPaceAnchor.ts on Home's
 * first look that day), so it holds still while the learner works through today's cards and moves
 * only when the day changes. The anchor is a learned count, not a remaining count, so a deck update
 * that adds or retires unlearned cards changes what is left without being counted as today's work.
 *
 * It does not touch the draw economy: the target says how many cards to learn, not how to get them.
 */
export type ExamPaceInput = {
  /** The study goal's exam day, 'YYYY-MM-DD' (local calendar day), or null. */
  examDate: string | null;
  /** Cards in the goal deck. */
  totalCards: number;
  /** Cards of the goal deck the learner has learned (reviewed at least once). */
  learnedCards: number;
  nowMs: number;
  /** Cards of the goal deck that were learned at the start of today, when recorded earlier today. */
  learnedAtDayStart?: number | null;
};

export type ExamPace =
  /** No exam date, an invalid or past one, or no deck to measure: Home shows nothing. */
  | { kind: 'none' }
  /** Every card of the goal deck is learned. */
  | { kind: 'finished'; totalCards: number }
  /** The review cap has passed (the exam is today or tomorrow): no learning day is left. */
  | { kind: 'final'; remaining: number }
  | {
      kind: 'pace';
      /** Cards to learn per day, from today's starting point. At least 1. */
      perDay: number;
      /** Local days left for learning, today included and the cap day excluded. At least 1. */
      learningDays: number;
      /** Cards not learned yet, right now. */
      remaining: number;
      /** Cards of today's target still to learn today (0 once today's share is done). */
      leftToday: number;
      /** The cap day, 'YYYY-MM-DD': the day by which every card should be learned. */
      readyBy: string;
    };

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTodayStartMs(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function wholeCount(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** The local calendar day of `nowMs`, 'YYYY-MM-DD' (the key the day-start anchor is stored under). */
export function examPaceDayKey(nowMs: number): string {
  return dayKeyOf(nowMs);
}

export function buildExamPace(input: ExamPaceInput): ExamPace {
  const { examDate, nowMs } = input;
  const total = wholeCount(input.totalCards);
  const learned = wholeCount(input.learnedCards);
  if (!examDate || localDayStartMs(examDate) == null || !Number.isFinite(nowMs)) return { kind: 'none' };
  if (daysUntilExam(examDate, nowMs) == null) return { kind: 'none' }; // the exam is past
  if (total == null || learned == null || total === 0) return { kind: 'none' };

  const remaining = Math.max(0, total - learned);
  if (remaining === 0) return { kind: 'finished', totalCards: total };

  const cap = examReviewCapMs(examDate, nowMs);
  if (cap == null) return { kind: 'final', remaining };

  // Whole local days from today to the cap day. Both ends are local midnights, so rounding absorbs
  // a 23- or 25-hour day at a DST change.
  const learningDays = Math.max(1, Math.round((cap - localTodayStartMs(nowMs)) / DAY_MS));
  // Cards learned today: the learned count only ever goes up during a day, so an anchor above
  // "now" (progress was reset, learned cards were retired) no longer describes today and counts as
  // nothing done. Today's starting point is what is left now plus what was learned today, against
  // the deck as it is now.
  const anchor = wholeCount(input.learnedAtDayStart);
  const doneToday = anchor != null && anchor <= learned ? learned - anchor : 0;
  const dayStart = remaining + doneToday;
  const perDay = Math.max(1, Math.ceil(dayStart / learningDays));
  const leftToday = Math.max(0, perDay - doneToday);
  return { kind: 'pace', perDay, learningDays, remaining, leftToday, readyBy: dayKeyOf(cap) };
}

/** 'Oct 21' — the app's fixed English month-day order (goalChoices.formatExamDate), no Intl. */
export function formatPaceDay(dateKey: string): string {
  const start = localDayStartMs(dateKey);
  if (start == null) return '';
  const d = new Date(start);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Home's one short line for a pace, or null when there is nothing to say. */
export function examPaceLabel(pace: ExamPace): string | null {
  switch (pace.kind) {
    case 'pace': {
      const day = formatPaceDay(pace.readyBy);
      if (pace.leftToday === 0) return `Today's ${pace.perDay} done · on track for ${day}`;
      return `≈ ${pace.perDay} ${pace.perDay === 1 ? 'card' : 'cards'}/day to be ready by ${day}`;
    }
    case 'finished':
      return 'Every card learned · keep up your reviews';
    case 'final':
      return 'Final review: go over the cards you know';
    default:
      return null;
  }
}
