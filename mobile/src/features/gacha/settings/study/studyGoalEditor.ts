import { daysUntilExam, localDayStartMs, type StudyGoal } from '../../../goal/studyGoal';
import {
  DEFAULT_GOAL_DECK_SLUG,
  GOAL_CHOICES,
  examDateForPreset,
  formatExamDate,
  type DatePresetKey,
} from '../../audience/goalChoices';

/**
 * U4 (user-perspective review 2026-10-04): Settings › Study › Study goal edits the same goal the
 * onboarding goal step writes — same deck choices, same date presets and ±1 week steps (goalChoices),
 * same storage and validation (studyGoal.setStudyGoal). Pure helpers for the row and its editor.
 */
export type GoalDateChoice =
  | { kind: 'none' }
  /** `preset` is the chip that produced the date, or null for a stored date / a stepped one. */
  | { kind: 'date'; examDate: string; preset: DatePresetKey | null };

export type GoalDraft = { deckSlug: string; date: GoalDateChoice };

export const STUDY_GOAL_COPY = {
  title: 'Study goal',
  notSet: 'Not set',
  notSetBody: 'Pick what you are learning and, if you have one, your exam date.',
  noDate: 'No exam date',
  change: 'Change',
  set: 'Set goal',
  deckHeading: 'What you are learning',
  dateHeading: 'Exam date',
  dateBody: 'With a date, reviews finish the day before your exam.',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  clear: 'Remove goal',
  deviceOnly: 'Kept on this device.',
  saveError: "Couldn't save your goal. Please try again.",
} as const;

/** The onboarding label for a goal deck; an unknown slug shows as itself. */
export function goalDeckLabel(slug: string): string {
  return GOAL_CHOICES.find((choice) => choice.deckSlug === slug)?.label ?? slug;
}

/**
 * The editor's starting point: the stored goal, or (no goal yet, e.g. a learner who finished
 * onboarding before R22) the active deck when it is one of the goal choices, else the default.
 */
export function draftFromGoal(goal: StudyGoal | null, fallbackDeckSlug: string | null): GoalDraft {
  if (goal) {
    return {
      deckSlug: goal.deckSlug,
      date: goal.examDate ? { kind: 'date', examDate: goal.examDate, preset: null } : { kind: 'none' },
    };
  }
  const fallback = GOAL_CHOICES.some((choice) => choice.deckSlug === fallbackDeckSlug) ? fallbackDeckSlug! : DEFAULT_GOAL_DECK_SLUG;
  return { deckSlug: fallback, date: { kind: 'none' } };
}

export function draftWithPreset(draft: GoalDraft, preset: DatePresetKey, nowMs: number): GoalDraft {
  return { ...draft, date: { kind: 'date', examDate: examDateForPreset(preset, nowMs), preset } };
}

/** The goal Save writes. setStudyGoal still validates it. */
export function goalFromDraft(draft: GoalDraft): StudyGoal {
  return { deckSlug: draft.deckSlug, examDate: draft.date.kind === 'date' ? draft.date.examDate : null };
}

/** The row's second line: 'Exam Fri, Oct 16, 2026 · in 12 days', '… · today', '… · passed', or 'No exam date'. */
export function describeGoalDate(examDate: string | null, nowMs: number): string {
  if (!examDate || localDayStartMs(examDate) == null) return STUDY_GOAL_COPY.noDate;
  const days = daysUntilExam(examDate, nowMs);
  const when = days == null ? 'passed' : days === 0 ? 'today' : `in ${days} ${days === 1 ? 'day' : 'days'}`;
  return `Exam ${formatExamDate(examDate)} · ${when}`;
}
