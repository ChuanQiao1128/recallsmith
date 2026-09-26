import { beforeEach, describe, expect, it, vi } from 'vitest';

const alertMock = vi.fn();
const loadAllProgressMock = vi.fn(async () => ({}) as Record<string, any[]>);
const resetAllReviewSchedulesMock = vi.fn(async (_now?: Date) => {});

vi.mock('react-native', () => ({
  Alert: { alert: (...args: any[]) => alertMock(...args) },
}));

vi.mock('../../src/review/storage', () => ({
  loadAllProgress: () => loadAllProgressMock(),
  resetAllReviewSchedules: (now: Date) => resetAllReviewSchedulesMock(now),
}));

import { confirmResetReviewSchedule } from '../../src/features/gacha/settings/account/accountActions';

beforeEach(() => {
  alertMock.mockReset();
  loadAllProgressMock.mockReset();
  loadAllProgressMock.mockResolvedValue({});
  resetAllReviewSchedulesMock.mockReset();
  resetAllReviewSchedulesMock.mockResolvedValue(undefined);
});

describe('confirmResetReviewSchedule', () => {
  it('names the real effect and counts the learned cards before confirming', async () => {
    loadAllProgressMock.mockResolvedValueOnce({
      a: [{ lastReviewedAt: 5 }, { lastReviewedAt: 0 }],
      b: [{ lastReviewedAt: 9 }],
    });

    await confirmResetReviewSchedule({ onConfirm: async () => {} });

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [title, message] = alertMock.mock.calls[0];
    expect(title).toBe('Make all learned cards due today?');
    expect(message).toContain('2 learned cards');
  });

  it('uses a destructive confirm button', async () => {
    loadAllProgressMock.mockResolvedValueOnce({ a: [{ lastReviewedAt: 5 }] });

    await confirmResetReviewSchedule({ onConfirm: async () => {} });

    const buttons = alertMock.mock.calls[0][2];
    expect(buttons[1]).toMatchObject({ text: 'Make due now', style: 'destructive' });
  });

  it('skips the reset when nothing has been studied', async () => {
    loadAllProgressMock.mockResolvedValueOnce({ a: [{ lastReviewedAt: 0 }] });
    const onConfirm = vi.fn(async () => {});

    await confirmResetReviewSchedule({ onConfirm });

    expect(alertMock).toHaveBeenCalledWith('Nothing to reset', 'You have not studied any cards yet.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('still confirms with generic copy when the count cannot be read', async () => {
    loadAllProgressMock.mockRejectedValueOnce(new Error('storage down'));

    await confirmResetReviewSchedule({ onConfirm: async () => {} });

    const message = alertMock.mock.calls[0][1];
    expect(message).toMatch(/^Every learned card/);
  });
});
