import type { CardProgress } from '../../../review/model';
import type { FeatureFlags } from '../../../config/featureFlags';
import { isNewProgress } from '../selectors/progressSelectors';

/** What the planner may do with the NEW bucket this pick (D00 §2.3). Absent/null hint = the planner as it is today. */
export type McqKindHint = { mcqAllowed: boolean; preferMcq: boolean };

/** Per-run counter the screen keeps in a ref (D05). `served` = MCQ cards set current this run, from ANY bucket
 *  (plan §5.7 "本场已出 MCQ 数"); `lastNewKind` = the kind of the last card dealt from the NEW bucket. */
export type McqRunState = { served: number; lastNewKind: 'mcq' | 'qa' | null };

export const EMPTY_MCQ_RUN_STATE: McqRunState = Object.freeze({ served: 0, lastNewKind: null });

/** flags.mcq.enabled === false → null (kill switch, D00 §0: no hint at all).
 *  Else { mcqAllowed: served < maxPerRun, preferMcq: mcqAllowed && lastNewKind !== 'mcq' }.
 *  maxPerRun 0 ⇒ mcqAllowed false ⇒ preferMcq false. Pure; never throws. */
export function buildKindHint(state: McqRunState, flags: Pick<FeatureFlags, 'mcq'>): McqKindHint | null {
  if (flags.mcq.enabled === false) return null;
  const mcqAllowed = state.served < flags.mcq.maxPerRun;
  return { mcqAllowed, preferMcq: mcqAllowed && state.lastNewKind !== 'mcq' };
}

/** New state after a card was set current: served + (isMcq ? 1 : 0); lastNewKind becomes 'mcq' / 'qa' only when
 *  the card came from the new bucket (isNewProgress(progress), progress = the row BEFORE the rating), else unchanged.
 *  Returns a new object; never mutates `state`. */
export function noteServedCard(state: McqRunState, progress: CardProgress, isMcq: boolean): McqRunState {
  return {
    served: state.served + (isMcq ? 1 : 0),
    lastNewKind: isNewProgress(progress) ? (isMcq ? 'mcq' : 'qa') : state.lastNewKind,
  };
}
