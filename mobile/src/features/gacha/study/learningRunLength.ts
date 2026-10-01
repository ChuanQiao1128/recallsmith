// R22 §5, §6: how many recall checks a run will add, known when the run is planned.
//
// Each never-reviewed Q/A card the planner deals is studied and then re-asked as a recall check
// at the end of the run, one extra card per study. The header reads "Card X of Y"; counting
// only the checks already earned made Y grow by one at every Got it ("Card 2 of 6", "Card 3 of
// 7"…) on the first-run surface. This replays the planner's deal for the run's slots, the same
// way the screen deals (each dealt card leaves the pool, the MCQ rotation advances), and counts
// the cards that will open on the study view.
//
// It is a projection: a card rated Again can come back within the run and change what the
// planner deals next. The screen therefore never shows fewer checks than it has already queued
// and uses the exact count once the planner's slots are used up.

import type { FeatureFlags } from '../../../config/featureFlags';
import type { CardProgress } from '../../../review/model';
import type { CardExport, DeckExport } from '../../../types/deckExport';
import type { OwnedGate } from '../contracts';
import { buildKindHint, EMPTY_MCQ_RUN_STATE, noteServedCard } from '../mcq/mcqRotation';
import { resolveMcq } from '../mcq/normalizeMcq';
import { pickNextCard } from '../planner/sessionPlanner';
import { isLearnedProgress } from '../selectors/progressSelectors';

export function projectLearningChecks(params: {
  deck: DeckExport;
  progress: CardProgress[];
  now: Date;
  mode: 'review-due' | 'learn-new' | 'mixed' | 'sweep';
  /** The run's planned slots (the planner's route length). */
  limit: number;
  index?: { cards: CardExport[]; cardMap: Map<string, CardExport> } | null;
  ownedSet?: OwnedGate;
  flags: Pick<FeatureFlags, 'mcq'>;
}): number {
  const { deck, progress, now, mode, limit, index = null, ownedSet = null, flags } = params;
  const dealt = new Set<string>();
  let run = EMPTY_MCQ_RUN_STATE;
  let checks = 0;
  for (let slot = 0; slot < limit; slot += 1) {
    const next = pickNextCard({
      deck,
      progress,
      now,
      mode,
      avoidUid: null,
      index,
      ownedSet,
      kindHint: buildKindHint(run, flags),
      excludeUids: dealt,
    });
    if (!next) break;
    const isMcq = resolveMcq(next.card, flags) !== null;
    if (!isMcq && !isLearnedProgress(next.progress)) checks += 1;
    dealt.add(next.card.StableUid);
    run = noteServedCard(run, next.progress, isMcq);
  }
  return checks;
}
