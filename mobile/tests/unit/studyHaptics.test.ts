import { describe, expect, it, vi } from 'vitest';

import { studyHaptic } from '../../src/features/gacha/session/studyHaptics';
import type { ExpoHapticsLike } from '../../src/components/ceremonyHaptics';

function makeFakeHaptics() {
  return {
    impactAsync: vi.fn(async () => {}),
    selectionAsync: vi.fn(async () => {}),
    notificationAsync: vi.fn(async () => {}),
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  };
}

describe('studyHaptics', () => {
  it('fires a selection tick on reveal and pick and a light impact on rating', () => {
    const h = makeFakeHaptics();
    const enabled = () => true;
    studyHaptic('reveal', { haptics: h as unknown as ExpoHapticsLike, enabled });
    studyHaptic('select', { haptics: h as unknown as ExpoHapticsLike, enabled });
    expect(h.selectionAsync).toHaveBeenCalledTimes(2);
    expect(h.impactAsync).not.toHaveBeenCalled();

    studyHaptic('rate', { haptics: h as unknown as ExpoHapticsLike, enabled });
    expect(h.impactAsync).toHaveBeenCalledTimes(1);
    expect(h.impactAsync).toHaveBeenCalledWith('light');
    expect(h.selectionAsync).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the haptics preference is off', () => {
    const h = makeFakeHaptics();
    const enabled = () => false;
    studyHaptic('reveal', { haptics: h as unknown as ExpoHapticsLike, enabled });
    studyHaptic('select', { haptics: h as unknown as ExpoHapticsLike, enabled });
    studyHaptic('rate', { haptics: h as unknown as ExpoHapticsLike, enabled });
    expect(h.selectionAsync).not.toHaveBeenCalled();
    expect(h.impactAsync).not.toHaveBeenCalled();

    // No module → also a no-op, and never throws even when a promise rejects.
    expect(() => studyHaptic('reveal', { haptics: null, enabled: () => true })).not.toThrow();
    const throwing = {
      ...makeFakeHaptics(),
      selectionAsync: vi.fn(() => Promise.reject(new Error('nope'))),
      impactAsync: vi.fn(() => { throw new Error('boom'); }),
    } as unknown as ExpoHapticsLike;
    expect(() => studyHaptic('reveal', { haptics: throwing, enabled: () => true })).not.toThrow();
    expect(() => studyHaptic('rate', { haptics: throwing, enabled: () => true })).not.toThrow();
  });
});
