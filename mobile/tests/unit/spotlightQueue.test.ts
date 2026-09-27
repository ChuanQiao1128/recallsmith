// I05 — pure-model coverage for the multi-pull spotlight queue, its reveal / summary orderings
// and the grid layout. No React, no native mocks: the reducer maths and the sort/layout helpers
// are pinned independently of the ceremony wiring.
import { describe, it, expect } from 'vitest';

import {
  INITIAL_SPOTLIGHT_QUEUE,
  SPOTLIGHT_AUTO_ADVANCE_MS,
  revealAllOrder,
  spotlightQueueReducer,
  summaryGridLayout,
  summaryGridOrder,
  type SpotlightQueueState,
} from '../../src/features/gacha/draw/spotlightQueue';

function run(actions: Parameters<typeof spotlightQueueReducer>[1][], from: SpotlightQueueState = INITIAL_SPOTLIGHT_QUEUE): SpotlightQueueState {
  return actions.reduce((state, action) => spotlightQueueReducer(state, action), from);
}

describe('spotlightQueue reducer', () => {
  it('queues table taps and reveals them one at a time in tap order', () => {
    // The first tap takes the spotlight; the rest queue up behind it in tap order.
    let state = run([
      { type: 'enqueue', uid: 'a' },
      { type: 'enqueue', uid: 'b' },
      { type: 'enqueue', uid: 'c' },
    ]);
    expect(state.current).toBe('a');
    expect(state.mode).toBe('reveal');
    expect(state.queue).toEqual(['b', 'c']);
    expect(state.shown).toEqual(['a']);

    // Re-enqueuing the current, a queued or an already-shown uid is ignored.
    state = run([
      { type: 'enqueue', uid: 'a' },
      { type: 'enqueue', uid: 'b' },
    ], state);
    expect(state.queue).toEqual(['b', 'c']);

    state = spotlightQueueReducer(state, { type: 'advance', uid: 'a' });
    expect(state.current).toBe('b');
    expect(state.queue).toEqual(['c']);
    expect(state.shown).toEqual(['a', 'b']);

    state = spotlightQueueReducer(state, { type: 'advance', uid: 'b' });
    expect(state.current).toBe('c');
    state = spotlightQueueReducer(state, { type: 'advance', uid: 'c' });
    expect(state.current).toBeNull();
    expect(state.queue).toEqual([]);
    expect(state.shown).toEqual(['a', 'b', 'c']);
  });

  it('reveal all queues the face-down cards lowest rarity first', () => {
    const cards = [
      { stableUid: '1', rarity: 'LEG' as const },
      { stableUid: '2', rarity: 'COM' as const },
      { stableUid: '3', rarity: 'RAR' as const },
      { stableUid: '4', rarity: 'COM' as const },
    ];
    // COM (draw order), then RAR, then LEG — the pull builds to its best card.
    const order = revealAllOrder(cards, new Set());
    expect(order).toEqual(['2', '4', '3', '1']);

    const state = spotlightQueueReducer(INITIAL_SPOTLIGHT_QUEUE, { type: 'enqueueAll', uids: order });
    expect(state.current).toBe('2');
    expect(state.queue).toEqual(['4', '3', '1']);

    // Cards already face up are skipped.
    expect(revealAllOrder(cards, new Set(['2', '4']))).toEqual(['3', '1']);
  });

  it('ignores a stale or repeated advance so no card is ever skipped', () => {
    let state = run([
      { type: 'enqueue', uid: 'a' },
      { type: 'enqueue', uid: 'b' },
      { type: 'enqueue', uid: 'c' },
    ]);
    // A stale timer fires advance('a') twice; the second is a no-op because 'a' is no longer current.
    state = spotlightQueueReducer(state, { type: 'advance', uid: 'a' });
    expect(state.current).toBe('b');
    const before = state;
    state = spotlightQueueReducer(state, { type: 'advance', uid: 'a' });
    expect(state).toBe(before); // unchanged reference — 'b' was not skipped
    expect(state.current).toBe('b');
    expect(state.queue).toEqual(['c']);
  });

  it('skip all empties the queue and the spotlight', () => {
    let state = run([
      { type: 'enqueue', uid: 'a' },
      { type: 'enqueue', uid: 'b' },
      { type: 'enqueue', uid: 'c' },
    ]);
    const shownBefore = state.shown;
    state = spotlightQueueReducer(state, { type: 'skipAll' });
    expect(state.current).toBeNull();
    expect(state.queue).toEqual([]);
    // shown is left untouched.
    expect(state.shown).toEqual(shownBefore);
  });

  it('opens a revealed card for inspection only when nothing is being revealed', () => {
    // While a reveal is in flight, open is ignored.
    let state = run([{ type: 'enqueue', uid: 'a' }, { type: 'enqueue', uid: 'b' }]);
    const during = spotlightQueueReducer(state, { type: 'open', uid: 'b' });
    expect(during).toBe(state); // ignored

    // Drain the queue so nothing is being revealed, then open a shown card for inspection.
    state = run([
      { type: 'advance', uid: 'a' },
      { type: 'advance', uid: 'b' },
    ], state);
    expect(state.current).toBeNull();

    const shownBefore = state.shown;
    state = spotlightQueueReducer(state, { type: 'open', uid: 'a' });
    expect(state.current).toBe('a');
    expect(state.mode).toBe('inspect');
    expect(state.shown).toEqual(shownBefore); // inspect does not touch shown

    // A tap closes it (advance on the inspected uid drains to null).
    state = spotlightQueueReducer(state, { type: 'advance', uid: 'a' });
    expect(state.current).toBeNull();
  });

  it('never mutates its input', () => {
    const start = INITIAL_SPOTLIGHT_QUEUE;
    spotlightQueueReducer(start, { type: 'enqueue', uid: 'a' });
    expect(start).toEqual({ current: null, mode: 'reveal', queue: [], shown: [] });
    expect(SPOTLIGHT_AUTO_ADVANCE_MS).toEqual({ COM: 350, RAR: 900, LEG: null });
  });
});

describe('summary grid helpers', () => {
  it('orders the summary grid Legendary first, then Rare, then Common, stable within a rarity', () => {
    const cards = [
      { stableUid: '1', rarity: 'COM' as const },
      { stableUid: '2', rarity: 'RAR' as const },
      { stableUid: '3', rarity: 'LEG' as const },
      { stableUid: '4', rarity: 'RAR' as const },
      { stableUid: '5', rarity: 'COM' as const },
    ];
    // LEG, then the two RAR in draw order, then the two COM in draw order.
    expect(summaryGridOrder(cards).map((c) => c.stableUid)).toEqual(['3', '2', '4', '1', '5']);
  });

  it('lays the summary grid out as rows of five that fit the width', () => {
    // Always sized for five columns, an 8-pt gap, 5:7 cells.
    const ten = summaryGridLayout(10, 358);
    expect(ten.gap).toBe(8);
    expect(ten.columns).toBe(5);
    expect(ten.rows).toBe(2);
    expect(ten.cellWidth).toBe(Math.floor((358 - 4 * 8) / 5));
    expect(ten.cellHeight).toBe(Math.round(ten.cellWidth * 1.4));
    // Five cells plus four gaps fit inside the width.
    expect(ten.cellWidth * 5 + ten.gap * 4).toBeLessThanOrEqual(358);

    // A small pull is still sized for five columns (cells do not balloon), one row.
    const three = summaryGridLayout(3, 358);
    expect(three.columns).toBe(3);
    expect(three.rows).toBe(1);
    expect(three.cellWidth).toBe(ten.cellWidth);
  });
});
