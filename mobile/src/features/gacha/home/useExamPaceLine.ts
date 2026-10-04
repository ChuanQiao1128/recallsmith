import { useEffect, useState } from 'react';

import { buildExamPace, examPaceDayKey, examPaceLabel } from '../../goal/examPace';
import { resolveDayStartLearned } from '../../goal/examPaceAnchor';

export type ExamPaceLineInput = {
  /** The study goal's deck and exam date; null fields mean "no goal" / "no date". */
  deckSlug: string | null;
  examDate: string | null;
  /** The goal deck's card count and learned count from Home's deck summary; null when the deck is unknown. */
  totalCards: number | null;
  learnedCards: number | null;
};

/**
 * U5: Home's one-line daily target ("≈ 18 cards/day to be ready by Oct 21"), or null.
 *
 * The line waits for today's starting point (examPaceAnchor) before it shows, so it never flashes
 * a live number and then the day's number. It re-runs when the goal, the counts or the local day
 * change; Home re-renders on every focus, which is how a new day reaches it.
 */
export function useExamPaceLine(input: ExamPaceLineInput): string | null {
  const { deckSlug, examDate, totalCards, learnedCards } = input;
  const [line, setLine] = useState<string | null>(null);
  const dayKey = examPaceDayKey(Date.now());

  useEffect(() => {
    if (!deckSlug || !examDate || totalCards == null || learnedCards == null) {
      setLine(null);
      return undefined;
    }
    let cancelled = false;
    const nowMs = Date.now();
    const base = { examDate, totalCards, learnedCards, nowMs };
    const live = buildExamPace(base);
    if (live.kind !== 'pace') {
      // Nothing day-dependent to anchor: say it now, and write nothing.
      setLine(examPaceLabel(live));
      return undefined;
    }
    void resolveDayStartLearned({ deckSlug, examDate, learned: learnedCards, nowMs }).then((dayStart) => {
      if (cancelled) return;
      setLine(examPaceLabel(buildExamPace({ ...base, learnedAtDayStart: dayStart })));
    });
    return () => {
      cancelled = true;
    };
  }, [deckSlug, examDate, totalCards, learnedCards, dayKey]);

  return line;
}
