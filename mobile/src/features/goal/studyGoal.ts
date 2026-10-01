import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * R22 shared contract (R22-00 §2): what the learner is preparing for, and when.
 *
 * Local only (no server sync in P0). The exam date is a local calendar day ('YYYY-MM-DD'), never a
 * timestamp, so it means the same day in every time zone the phone visits.
 */
export type StudyGoal = {
  /** Slug of the deck the learner chose, e.g. 'aws-saa-c03'. */
  deckSlug: string;
  /** Local calendar day of the exam, 'YYYY-MM-DD', or null when no date is set. */
  examDate: string | null;
};

export const STUDY_GOAL_KEY = 'recallsmith:study-goal:v1';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight at the start of a 'YYYY-MM-DD' day, or null when the string is not a real date. */
export function localDayStartMs(dateKey: string): number | null {
  const m = DATE_RE.exec(dateKey);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

function normalize(raw: unknown): StudyGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.deckSlug !== 'string' || !SLUG_RE.test(r.deckSlug)) return null;
  const examDate = typeof r.examDate === 'string' && localDayStartMs(r.examDate) != null ? r.examDate : null;
  return { deckSlug: r.deckSlug, examDate };
}

export async function getStudyGoal(): Promise<StudyGoal | null> {
  try {
    const raw = await AsyncStorage.getItem(STUDY_GOAL_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Saves a goal; throws on an invalid slug or date so a UI bug never stores garbage. */
export async function setStudyGoal(goal: StudyGoal): Promise<StudyGoal> {
  const next = normalize(goal);
  if (!next || (goal.examDate != null && next.examDate == null)) throw new Error('invalid study goal');
  await AsyncStorage.setItem(STUDY_GOAL_KEY, JSON.stringify(next));
  return next;
}

export async function clearStudyGoal(): Promise<void> {
  await AsyncStorage.removeItem(STUDY_GOAL_KEY);
}

/** Whole local days from today until the exam day (0 = the exam is today); null when unset or past. */
export function daysUntilExam(examDate: string | null, nowMs: number): number | null {
  if (!examDate) return null;
  const examStart = localDayStartMs(examDate);
  if (examStart == null) return null;
  const now = new Date(nowMs);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((examStart - todayStart) / DAY_MS);
  return days >= 0 ? days : null;
}

/**
 * The latest moment a review may be scheduled for, given an exam date: the start of the local day
 * BEFORE the exam, so the last pass happens the day before. Null (do not cap) when there is no exam
 * date or that moment is not in the future — an exam today or tomorrow must not make every card due
 * at once (Review all / sweep exists for the final cram).
 */
export function examReviewCapMs(examDate: string | null, nowMs: number): number | null {
  if (!examDate) return null;
  const examStart = localDayStartMs(examDate);
  if (examStart == null) return null;
  const dayBefore = new Date(examStart);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const cap = dayBefore.getTime();
  return cap > nowMs ? cap : null;
}

/** Returns progress whose nextReviewAt is pulled back to the exam cap; unchanged when no cap applies. */
export function capNextReviewToExam<T extends { nextReviewAt: number }>(progress: T, examDate: string | null, nowMs: number): T {
  const cap = examReviewCapMs(examDate, nowMs);
  if (cap == null || !(progress.nextReviewAt > cap)) return progress;
  return { ...progress, nextReviewAt: cap };
}
