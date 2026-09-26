import { describe, expect, it, vi } from 'vitest';
import {
  createOtaUpdateChecker,
  OTA_CHECK_THROTTLE_MS,
  type UpdatesLike,
} from '../../src/updates/otaUpdateCheck';

function fakeUpdates(over: Partial<UpdatesLike> = {}): UpdatesLike {
  return {
    isEnabled: true,
    checkForUpdateAsync: vi.fn(async () => ({ isAvailable: true })),
    fetchUpdateAsync: vi.fn(async () => ({ isNew: true })),
    reloadAsync: vi.fn(async () => {}),
    ...over,
  };
}

describe('createOtaUpdateChecker', () => {
  it('does nothing when expo-updates is disabled or missing', async () => {
    const missing = createOtaUpdateChecker({ updates: null });
    expect(await missing.onForeground(() => 'Home')).toBe('disabled');

    const updates = fakeUpdates({ isEnabled: false });
    const disabled = createOtaUpdateChecker({ updates });
    expect(await disabled.onForeground(() => 'Home')).toBe('disabled');
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('fetches and reloads on foreground when a new update is available on a safe route', async () => {
    const updates = fakeUpdates();
    const checker = createOtaUpdateChecker({ updates, now: () => 0 });
    expect(await checker.onForeground(() => 'Home')).toBe('reloaded');
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('defers the reload off a safe route and applies it on the next safe foreground', async () => {
    const updates = fakeUpdates();
    let t = 0;
    const checker = createOtaUpdateChecker({ updates, now: () => t });

    // In a review session: fetch happens, but no reload.
    expect(await checker.onForeground(() => 'Review')).toBe('deferred');
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).not.toHaveBeenCalled();

    // Next foreground on a safe route reloads the already-pending update without
    // a second network check.
    t += OTA_CHECK_THROTTLE_MS * 2;
    expect(await checker.onForeground(() => 'Home')).toBe('reloaded');
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('throttles checks to one per OTA_CHECK_THROTTLE_MS', async () => {
    const updates = fakeUpdates({
      checkForUpdateAsync: vi.fn(async () => ({ isAvailable: false })),
    });
    let t = 1_000;
    const checker = createOtaUpdateChecker({ updates, now: () => t });

    // First call is never throttled.
    expect(await checker.onForeground(() => 'Home')).toBe('no-update');
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);

    // Within the window: throttled, no new check.
    t += OTA_CHECK_THROTTLE_MS - 1;
    expect(await checker.onForeground(() => 'Home')).toBe('throttled');
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);

    // Past the window: checks again.
    t += 2;
    expect(await checker.onForeground(() => 'Home')).toBe('no-update');
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  });

  it('returns error and never throws when checkForUpdateAsync rejects', async () => {
    const updates = fakeUpdates({
      checkForUpdateAsync: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const checker = createOtaUpdateChecker({ updates, now: () => 0 });
    await expect(checker.onForeground(() => 'Home')).resolves.toBe('error');
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });
});
