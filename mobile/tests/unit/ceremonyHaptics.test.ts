import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HAPTIC_RATE_LIMIT,
  createCeremonyHapticsController,
  createHapticLimiter,
  getCeremonyHaptics,
  useCeremonyHaptics,
  type ExpoHapticsLike,
} from '../../src/components/ceremonyHaptics';

function makeFakeHaptics() {
  return {
    impactAsync: vi.fn(async () => {}),
    selectionAsync: vi.fn(async () => {}),
    notificationAsync: vi.fn(async () => {}),
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ceremonyHaptics', () => {
  it('HAPTIC_RATE_LIMIT is 3 events per 1000 ms', () => {
    expect(HAPTIC_RATE_LIMIT).toEqual({ maxEvents: 3, windowMs: 1000 });
  });

  it('limiter allows 3 events per rolling window', () => {
    let t = 0;
    const lim = createHapticLimiter(() => t);
    expect(lim.allow()).toBe(true);
    expect(lim.allow()).toBe(true);
    expect(lim.allow()).toBe(true);
    expect(lim.allow()).toBe(false);
    t = 999;
    expect(lim.allow()).toBe(false);
    t = 1000;
    expect(lim.allow()).toBe(true);
    lim.reset();
    expect(lim.allow()).toBe(true);
  });

  it('impact maps the style to the Capitalised feedback constant', () => {
    const h = makeFakeHaptics();
    let t = 0;
    const c = createCeremonyHapticsController({ haptics: h, now: () => t });
    c.impact();
    expect(h.impactAsync).toHaveBeenLastCalledWith('medium');
    c.impact('heavy');
    expect(h.impactAsync).toHaveBeenLastCalledWith('heavy');
    c.impact('rigid');
    expect(h.impactAsync).toHaveBeenLastCalledWith('rigid');
  });

  it('rate limits across every kind of event', () => {
    const h = makeFakeHaptics();
    let t = 0;
    const c = createCeremonyHapticsController({ haptics: h, now: () => t });
    // tick and impact share the one 3/1000 ms window; success is exempt and neither checks
    // nor consumes a slot, so it does not fill the window that tick/impact draw from.
    c.tick();
    c.impact('light');
    c.impact('medium');
    c.success();
    expect(h.selectionAsync).toHaveBeenCalledTimes(1);
    expect(h.impactAsync).toHaveBeenCalledTimes(2);
    expect(h.notificationAsync).toHaveBeenCalledTimes(1);
    t = 10;
    c.impact('soft');
    expect(h.impactAsync).toHaveBeenCalledTimes(2);
    t = 1000;
    c.impact('soft');
    expect(h.impactAsync).toHaveBeenCalledTimes(3);
  });

  it('success is exempt from the rate limiter so the LEG climax always fires', () => {
    const h = makeFakeHaptics();
    let t = 0;
    const c = createCeremonyHapticsController({ haptics: h, now: () => t });
    // Fill the whole 3/1000 ms window with impacts (as the tell/tear/flash climax does)...
    c.impact('light');
    c.impact('medium');
    c.impact('heavy');
    expect(h.impactAsync).toHaveBeenCalledTimes(3);
    // ...the success cue still fires: it does not consult the limiter.
    c.success();
    expect(h.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('success fires at most once per reset', () => {
    const h = makeFakeHaptics();
    let t = 0;
    const c = createCeremonyHapticsController({ haptics: h, now: () => t });
    c.success();
    c.success();
    expect(h.notificationAsync).toHaveBeenCalledTimes(1);
    c.reset();
    c.success();
    expect(h.notificationAsync).toHaveBeenCalledTimes(2);
  });

  it('reduce motion allows one light, soft and a single success', () => {
    const h = makeFakeHaptics();
    let t = 0;
    const c = createCeremonyHapticsController({ haptics: h, now: () => t });
    c.reset({ reduceMotion: true });
    c.impact('light');
    c.impact('light');
    expect(h.impactAsync).toHaveBeenCalledTimes(1);
    expect(h.impactAsync).toHaveBeenLastCalledWith('light');
    c.impact('medium');
    c.impact('heavy');
    c.impact('rigid');
    expect(h.impactAsync).toHaveBeenCalledTimes(1);
    c.tick();
    expect(h.selectionAsync).not.toHaveBeenCalled();
    c.impact('soft');
    expect(h.impactAsync).toHaveBeenCalledTimes(2);
    c.impact('soft');
    expect(h.impactAsync).toHaveBeenCalledTimes(3);
    // success is exempt: it fires even with the impact window already full.
    c.success();
    expect(h.notificationAsync).toHaveBeenCalledTimes(1);
    t = 10;
    c.impact('soft');
    expect(h.impactAsync).toHaveBeenCalledTimes(3);
    t = 1000;
    c.impact('soft');
    expect(h.impactAsync).toHaveBeenCalledTimes(4);
  });

  it('dropped calls do not consume limiter slots under reduce motion', () => {
    const h = makeFakeHaptics();
    let t = 0;
    const c = createCeremonyHapticsController({ haptics: h, now: () => t });
    c.reset({ reduceMotion: true });
    for (let i = 0; i < 5; i += 1) c.impact('heavy');
    for (let i = 0; i < 3; i += 1) c.impact('soft');
    expect(h.impactAsync).toHaveBeenCalledTimes(3);
  });

  it('no-ops without a module and never throws on native failure', async () => {
    const none = createCeremonyHapticsController({ haptics: null });
    expect(none.available).toBe(false);
    expect(none.tick()).toBeUndefined();
    expect(none.impact()).toBeUndefined();
    expect(none.success()).toBeUndefined();
    none.reset();

    const throwing = {
      ...makeFakeHaptics(),
      impactAsync: vi.fn(() => { throw new Error('boom'); }),
      selectionAsync: vi.fn(() => Promise.reject(new Error('nope'))),
    } as unknown as ExpoHapticsLike;
    const c = createCeremonyHapticsController({ haptics: throwing });
    expect(() => c.impact()).not.toThrow();
    expect(() => c.tick()).not.toThrow();
    await Promise.resolve();
  });

  it('exposes a stable singleton and hook', async () => {
    expect(getCeremonyHaptics()).toBe(getCeremonyHaptics());
    const sink: Array<ReturnType<typeof useCeremonyHaptics>> = [];
    function Probe() {
      sink.push(useCeremonyHaptics());
      return null;
    }
    await act(async () => {
      renderer.create(React.createElement(Probe));
    });
    expect(sink[0]).toBe(getCeremonyHaptics());
  });
});
