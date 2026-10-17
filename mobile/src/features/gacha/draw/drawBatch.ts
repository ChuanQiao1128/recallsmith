// drawBatch — the pure plan behind the Draw screen's open buttons (2026-10-17 batch open).
//
// Opening one card at a time was tedious, and the old "Open 10" almost never lit up: the study
// loop is 1:1 (one draw per newly learned card, plus one a day per pack for clearing its due
// cards), so a learner rarely holds ten draws in one pack. The screen now offers what the learner
// can actually open in one go, up to MAX_BATCH_OPEN cards in a single ceremony, and "Open 1"
// beside it.
//
// The number the plan works from is n = min(draws held in this pack, cards in this pack not yet
// owned): a draw you cannot spend on a missing card buys nothing, and a missing card you hold no
// draw for cannot be opened. The plan deliberately says nothing about the next batch size (no
// "Open 5 when you have 5 draws" hint): that would read as a reason to stop studying and save up.
//
// No React / react-native imports, so it is unit tested on its own.

/** The largest batch the Draw screen offers in one ceremony. */
export const MAX_BATCH_OPEN = 5;

export type DrawButtonPlan = {
  /** n = min(held, undrawn): how many cards the learner could open right now. */
  openable: number;
  /** The primary button's batch size (2..MAX_BATCH_OPEN), or null when there is no batch button. */
  batch: number | null;
  /** True when an "Open 1" button is offered. */
  single: boolean;
};

function toCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * The open buttons for a pack, from the draws held in its wallet and its cards not yet owned:
 * - n = 0: no open button (the screen shows its empty states instead);
 * - n = 1: a single "Open 1";
 * - n >= 2: a primary "Open {min(n, 5)}" and a secondary "Open 1".
 */
export function drawButtonPlan(input: { held: number; undrawn: number }): DrawButtonPlan {
  const openable = Math.min(toCount(input.held), toCount(input.undrawn));
  if (openable <= 0) return { openable: 0, batch: null, single: false };
  if (openable === 1) return { openable: 1, batch: null, single: true };
  return { openable, batch: Math.min(openable, MAX_BATCH_OPEN), single: true };
}

/**
 * How many cards a press may actually open: the requested count, cut to the draws the pack holds
 * at the moment of the press and to the cards still missing from it. 0 means "open nothing".
 * The request itself is capped at MAX_BATCH_OPEN, so no press can ask for more than one batch.
 */
export function clampOpenCount(input: { requested: number; held: number; undrawn: number }): number {
  return Math.min(Math.min(toCount(input.requested), MAX_BATCH_OPEN), toCount(input.held), toCount(input.undrawn));
}
