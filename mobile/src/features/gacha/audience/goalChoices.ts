import { isHiddenDeck } from '../../../content/hiddenDecks';
import { localDayStartMs } from '../../goal/studyGoal';

/**
 * R22 contract §3: what a new learner can choose to learn, and the optional exam-date step.
 * Pure data + date math (no date-picker dependency): the onboarding goal step renders these.
 */
export type GoalChoice = {
  deckSlug: string;
  label: string;
  /** The first choice is highlighted (the flagship deck). */
  highlighted: boolean;
};

/**
 * Every goal deck, in the 2026-10-14 three-decks order (owner): AWS Architect Basics (the Chinese
 * foundation cards), SAA-C03, Claude CCDV-F. A deck in content/hiddenDecks.ts HIDDEN_DECK_SLUGS
 * (csharp-basics for now) keeps its entry here but is not offered: taking it off that list offers
 * it again, with its label, in onboarding and Settings › Study goal.
 */
const ALL_GOAL_CHOICES: readonly GoalChoice[] = [
  { deckSlug: 'aws-saa-fundamentals', label: 'AWS Architect Basics (Chinese)', highlighted: true },
  { deckSlug: 'aws-saa-c03', label: 'AWS Solutions Architect (SAA-C03)', highlighted: false },
  { deckSlug: 'claude-ccdv-f', label: 'Claude Developer (CCDV-F)', highlighted: false },
  { deckSlug: 'csharp-basics', label: '.NET interview questions', highlighted: false },
];

/** The goal decks onboarding and Settings › Study goal offer, in order; the first is the default. */
export const GOAL_CHOICES: readonly GoalChoice[] = ALL_GOAL_CHOICES.filter((choice) => !isHiddenDeck(choice.deckSlug));

/** The label of a goal deck, offered or hidden; undefined for an unknown slug. */
export function goalChoiceLabel(slug: string): string | undefined {
  return ALL_GOAL_CHOICES.find((choice) => choice.deckSlug === slug)?.label;
}

export const DEFAULT_GOAL_DECK_SLUG = GOAL_CHOICES[0].deckSlug;

/** First, default option of the date step: no exam date (examDate null). */
export const NO_DATE_LABEL = "No date — I'm just learning";

export type DatePresetKey = '2w' | '1m' | '2m' | '3m';

export const DATE_PRESETS: ReadonlyArray<{ key: DatePresetKey; label: string }> = [
  { key: '2w', label: 'In 2 weeks' },
  { key: '1m', label: 'In 1 month' },
  { key: '2m', label: 'In 2 months' },
  { key: '3m', label: 'In 3 months' },
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

/** The local calendar day ('YYYY-MM-DD') a preset points at, counted from today. */
export function examDateForPreset(preset: DatePresetKey, nowMs: number): string {
  const now = new Date(nowMs);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === '2w') return toDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14));
  const months = preset === '1m' ? 1 : preset === '2m' ? 2 : 3;
  return toDateKey(addMonthsClamped(today, months));
}

/** Moves a day by whole weeks (+1 / -1 for the steppers). Returns the input unchanged when it is not a date. */
export function stepExamDate(dateKey: string, weeks: number): string {
  const start = localDayStartMs(dateKey);
  if (start == null) return dateKey;
  const d = new Date(start);
  return toDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + weeks * 7));
}

/** A step is allowed only when the result is still after today (an exam date is always in the future). */
export function canStepExamDate(dateKey: string, weeks: number, nowMs: number): boolean {
  const next = localDayStartMs(stepExamDate(dateKey, weeks));
  if (next == null) return false;
  const now = new Date(nowMs);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return next > todayStart;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Fri, Oct 16, 2026' — fixed English format, so it never depends on the device's Intl support. */
export function formatExamDate(dateKey: string): string {
  const start = localDayStartMs(dateKey);
  if (start == null) return '';
  const d = new Date(start);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
