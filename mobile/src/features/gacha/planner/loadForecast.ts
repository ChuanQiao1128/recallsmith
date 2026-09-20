import type { CardProgress } from '../../../review/model';
import type { OwnedGate } from '../contracts';
import { buildUpcoming } from '../selectors/progressSelectors';

/** R7 (economy-v2 §2): the forecast fires on the 20th new card learned today … */
export const FORECAST_START = 20;
/** … and on every 10th after it (30, 40, …). */
export const FORECAST_STEP = 10;

export type TomorrowLoad = {
  newCardsLearnedToday: number;
  /** buildUpcoming(progress, now, 2, ownedSet)[1].count (progressSelectors.ts:47-77) — cards whose next
   *  review lands on tomorrow's local day under the current ladder. */
  tomorrowDue: number;
  /** newCardsLearnedToday >= FORECAST_START && (newCardsLearnedToday - FORECAST_START) % FORECAST_STEP === 0 */
  milestone: boolean;
};

export function computeTomorrowLoad(input: {
  progress: CardProgress[];
  now: Date;
  ownedSet?: OwnedGate;
  newCardsLearnedToday: number;
}): TomorrowLoad {
  const { progress, now, ownedSet = null, newCardsLearnedToday } = input;
  const tomorrowDue = buildUpcoming(progress, now, 2, ownedSet)[1]?.count ?? 0;
  const milestone =
    newCardsLearnedToday >= FORECAST_START && (newCardsLearnedToday - FORECAST_START) % FORECAST_STEP === 0;
  return { newCardsLearnedToday, tomorrowDue, milestone };
}

/** milestone ? one line : null. One line, no dialog, never blocks the next card (R7 "不拦截"). */
export function forecastLine(load: TomorrowLoad): string | null {
  if (!load.milestone) return null;
  const n = load.tomorrowDue;
  return `At this pace, about ${n} card${n === 1 ? ' comes' : 's come'} due tomorrow.`;
}
