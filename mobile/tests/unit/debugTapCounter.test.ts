import { describe, expect, it } from 'vitest';

import {
  DEBUG_MENU_TAP_COUNT,
  DEBUG_MENU_TAP_WINDOW_MS,
  createDebugTapCounter,
} from '../../src/features/gacha/settings/debug/debugTapCounter';

describe('debugTapCounter', () => {
  it('opens on the 7th tap inside 3 s and resets afterwards', () => {
    expect(DEBUG_MENU_TAP_COUNT).toBe(7);
    expect(DEBUG_MENU_TAP_WINDOW_MS).toBe(3000);
    let t = 10_000;
    const counter = createDebugTapCounter(() => t);
    for (let i = 1; i < DEBUG_MENU_TAP_COUNT; i += 1) {
      expect(counter.tap()).toBe(false);
      expect(counter.count()).toBe(i);
      t += 300; // 6 taps over 1.8 s
    }
    expect(counter.tap()).toBe(true);
    expect(counter.count()).toBe(0);
    // A fresh sequence is needed for the next opening.
    for (let i = 1; i < DEBUG_MENU_TAP_COUNT; i += 1) expect(counter.tap()).toBe(false);
    expect(counter.tap()).toBe(true);
  });

  it('forgets taps older than the window, so slow tapping never opens', () => {
    let t = 0;
    const counter = createDebugTapCounter(() => t);
    for (let i = 0; i < 20; i += 1) {
      expect(counter.tap()).toBe(false); // one tap every 600 ms → at most 5 inside any 3 s window
      t += 600;
    }
    expect(counter.count()).toBeLessThanOrEqual(5);
    // Burst after a pause: only the burst counts.
    t += 10_000;
    for (let i = 1; i < DEBUG_MENU_TAP_COUNT; i += 1) expect(counter.tap()).toBe(false);
    expect(counter.tap()).toBe(true);
  });

  it('reset clears the sequence and the options are honoured', () => {
    let t = 0;
    const counter = createDebugTapCounter(() => t, { taps: 3, windowMs: 100 });
    counter.tap();
    counter.tap();
    counter.reset();
    expect(counter.count()).toBe(0);
    expect(counter.tap()).toBe(false);
    expect(counter.tap()).toBe(false);
    expect(counter.tap()).toBe(true);
    counter.tap();
    t += 100; // exactly the window: the earlier tap has expired
    expect(counter.count()).toBe(0);
  });
});
