import { describe, expect, it, vi } from 'vitest';

import { createAppStateSyncHandler, FOREGROUND_SYNC_MIN_INTERVAL_MS } from '../../src/sync/appStateSync';

describe('createAppStateSyncHandler', () => {
  it('pushes on background and ignores inactive', () => {
    const schedule = vi.fn();
    const handler = createAppStateSyncHandler({ schedule });

    handler('background');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith({ delayMs: 0, reason: 'app_background' });

    schedule.mockClear();
    handler('inactive');
    expect(schedule).not.toHaveBeenCalled();
  });

  it('pulls on active at most once per minimum interval', () => {
    let clock = 1_000;
    const schedule = vi.fn();
    const handler = createAppStateSyncHandler({
      schedule,
      now: () => clock,
      minForegroundIntervalMs: FOREGROUND_SYNC_MIN_INTERVAL_MS,
    });

    handler('active');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenLastCalledWith({ delayMs: 0, reason: 'app_foreground' });

    // Still inside the interval — no second pull.
    clock += FOREGROUND_SYNC_MIN_INTERVAL_MS - 1;
    handler('active');
    expect(schedule).toHaveBeenCalledTimes(1);

    // Interval elapsed — pull again.
    clock += 1;
    handler('active');
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenLastCalledWith({ delayMs: 0, reason: 'app_foreground' });
  });

  it('always pulls on the first active', () => {
    const schedule = vi.fn();
    const handler = createAppStateSyncHandler({ schedule, now: () => 0 });

    handler('active');
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith({ delayMs: 0, reason: 'app_foreground' });
  });
});
