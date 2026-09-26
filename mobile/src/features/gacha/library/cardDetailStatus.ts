import type { CardProgress } from '../../../review/model';
import { isLearnedProgress, isMasteredProgress } from '../selectors/progressSelectors';

// The chip Library and Home already agree on. masteryStatus() in CardDetail
// used to call stage 3 "Mastered", but Library and Home only count a card as
// mastered at stage >= MASTERY_STAGE_THRESHOLD (4) via isMasteredProgress, so a
// stage-3 card wore a gold "Mastered" chip its dot never earned. Deriving the
// label from the same selectors keeps every surface telling the same story.
export type CardDetailStatus = 'New' | 'Learning' | 'Mastered';

export function cardDetailStatus(progress: CardProgress | null | undefined): CardDetailStatus {
  if (!progress) return 'New';
  if (isMasteredProgress(progress)) return 'Mastered';
  if (isLearnedProgress(progress)) return 'Learning';
  return 'New';
}
