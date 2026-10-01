import { daysUntilExam } from '../../goal/studyGoal';

/**
 * R22 §5: Home's exam line, read from the shared study goal (§2). Null when no exam date is set
 * (or it is past), so a learner who is just learning sees nothing about exams.
 */
export function buildExamCountdownLabel(examDate: string | null, nowMs: number): string | null {
  const days = daysUntilExam(examDate, nowMs);
  if (days == null) return null;
  if (days === 0) return 'Exam today';
  return `Exam in ${days} ${days === 1 ? 'day' : 'days'}`;
}
