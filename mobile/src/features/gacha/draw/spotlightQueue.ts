// spotlightQueue — the pure model for the multi-pull reveal sequence (I05). No React / react-
// native imports: the reducer, the reveal/summary orderings and the grid layout are all
// deterministic so DrawCeremonyScreen (the sequence) and DrawSummaryGrid (the layout) read the
// same numbers and the whole thing is unit tested in isolation. Type-only import keeps it OTA-safe.
//
// The reducer drives one spotlight at a time: table taps and "Reveal all" enqueue uids, the
// spotlight advances through them carrying the current uid (so a stale timer can never skip a
// card), and a revealed card can be opened again for inspection once nothing is being revealed.

import type { PeakRarity } from './ceremonyTimings';

/**
 * How long a landed spotlight card holds before it auto-advances to the next one. COM moves on
 * after a beat, RAR after about a second, LEG waits until it is tapped (`null`).
 */
export const SPOTLIGHT_AUTO_ADVANCE_MS: Readonly<Record<PeakRarity, number | null>> = Object.freeze({
  COM: 350,
  RAR: 900,
  LEG: null,
});

export type SpotlightQueueState = {
  current: string | null;
  mode: 'reveal' | 'inspect';
  queue: string[];
  shown: string[];
};

export const INITIAL_SPOTLIGHT_QUEUE: SpotlightQueueState = {
  current: null,
  mode: 'reveal',
  queue: [],
  shown: [],
};

export type SpotlightQueueAction =
  | { type: 'enqueue'; uid: string }
  | { type: 'enqueueAll'; uids: string[] }
  | { type: 'advance'; uid: string }
  | { type: 'open'; uid: string }
  | { type: 'skipAll' };

/** Pure reducer — never mutates its input. */
export function spotlightQueueReducer(state: SpotlightQueueState, action: SpotlightQueueAction): SpotlightQueueState {
  switch (action.type) {
    case 'enqueue': {
      const { uid } = action;
      // Ignore a uid that is already current, already queued, or already shown.
      if (uid === state.current || state.queue.includes(uid) || state.shown.includes(uid)) {
        return state;
      }
      if (state.current === null) {
        // Nothing is being revealed: this uid takes the spotlight immediately.
        return { current: uid, mode: 'reveal', queue: [...state.queue], shown: [...state.shown, uid] };
      }
      return { ...state, queue: [...state.queue, uid] };
    }
    case 'enqueueAll': {
      let next = state;
      for (const uid of action.uids) {
        next = spotlightQueueReducer(next, { type: 'enqueue', uid });
      }
      return next;
    }
    case 'advance': {
      // Only the card that is actually current can be advanced, so a double advance (a stale
      // auto-advance timer plus a tap, say) can never skip the next card.
      if (action.uid !== state.current) {
        return state;
      }
      const [nextUid, ...rest] = state.queue;
      if (nextUid === undefined) {
        return { ...state, current: null, mode: 'reveal', queue: [] };
      }
      return { current: nextUid, mode: 'reveal', queue: rest, shown: [...state.shown, nextUid] };
    }
    case 'open': {
      // Opening a revealed card for inspection is ignored while a reveal is in flight.
      if (state.mode === 'reveal' && state.current !== null) {
        return state;
      }
      return { ...state, current: action.uid, mode: 'inspect' };
    }
    case 'skipAll': {
      return { ...state, current: null, queue: [] };
    }
    default:
      return state;
  }
}

const REVEAL_RANK: Readonly<Record<PeakRarity, number>> = { COM: 0, RAR: 1, LEG: 2 };
const SUMMARY_RANK: Readonly<Record<PeakRarity, number>> = { LEG: 0, RAR: 1, COM: 2 };

/**
 * The uids that are not yet face up, lowest rarity first (COM → RAR → LEG), stable by draw index,
 * so a "Reveal all" walk builds to the best card in the pull.
 */
export function revealAllOrder(
  cards: ReadonlyArray<{ stableUid: string; rarity: PeakRarity }>,
  faceUp: ReadonlySet<string>,
): string[] {
  return cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !faceUp.has(card.stableUid))
    .sort((a, b) => REVEAL_RANK[a.card.rarity] - REVEAL_RANK[b.card.rarity] || a.index - b.index)
    .map(({ card }) => card.stableUid);
}

/** The summary grid order: LEG, then RAR, then COM, stable by draw index. */
export function summaryGridOrder<T extends { rarity: PeakRarity }>(cards: ReadonlyArray<T>): T[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => SUMMARY_RANK[a.card.rarity] - SUMMARY_RANK[b.card.rarity] || a.index - b.index)
    .map(({ card }) => card);
}

/**
 * The summary grid is always sized for five columns (so a small pull does not balloon its cells):
 * up to five per row, cells sized to fit the width with an 8-pt gap, at a 5:7 aspect.
 */
export function summaryGridLayout(
  count: number,
  width: number,
): { columns: number; rows: number; cellWidth: number; cellHeight: number; gap: number } {
  const gap = 8;
  const columns = Math.min(5, Math.max(1, count));
  const rows = Math.ceil(count / 5);
  const cellWidth = Math.floor((width - 4 * gap) / 5);
  const cellHeight = Math.round(cellWidth * 1.4);
  return { columns, rows, cellWidth, cellHeight, gap };
}
