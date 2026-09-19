import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    getPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
    requestPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
    scheduleNotificationAsync: vi.fn(async (_req: unknown) => 'notif-1'),
    cancelScheduledNotificationAsync: vi.fn(async () => {}),
    setNotificationChannelAsync: vi.fn(async () => {}),
  };
});

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: any) => styles },
  Pressable: () => null,
  ScrollView: () => null,
  Text: () => null,
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => h.store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      h.store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      h.store.delete(key);
    }),
  },
}));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: h.getPermissionsAsync,
  requestPermissionsAsync: h.requestPermissionsAsync,
  scheduleNotificationAsync: h.scheduleNotificationAsync,
  cancelScheduledNotificationAsync: h.cancelScheduledNotificationAsync,
  setNotificationChannelAsync: h.setNotificationChannelAsync,
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
}));

import { getReminderPrefs, syncDailyReminders } from '../../src/notifications/reminders';
import {
  PERMISSION_PROMPT_PENDING_KEY,
  clearPermissionPromptPending,
  isPermissionPromptPending,
  markPermissionPromptPending,
} from '../../src/screens/PermissionPromptScreen';

const NOW = new Date(2026, 8, 19, 10, 0, 0); // 10:00 local, before the 20:00 evening slot

describe('reminders (R2): sync is read-only on permission', () => {
  beforeEach(() => {
    h.store.clear();
    h.getPermissionsAsync.mockClear();
    h.requestPermissionsAsync.mockClear();
    h.scheduleNotificationAsync.mockClear();
  });

  it('never calls requestPermissionsAsync and schedules nothing while permission is undetermined', async () => {
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    await syncDailyReminders({ remainingDueCount: 3, now: NOW });
    expect(h.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(h.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('granted: schedules exactly one default reminder titled DeveloperCards, still without requesting', async () => {
    await syncDailyReminders({ remainingDueCount: 3, now: NOW });
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(h.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const req = h.scheduleNotificationAsync.mock.calls[0][0] as any;
    expect(req.content.title).toBe('DeveloperCards');
    expect(req.trigger).toMatchObject({ type: 'daily', hour: 9, minute: 0 });
  });

  it('default prefs: morning on, evening off', async () => {
    await expect(getReminderPrefs()).resolves.toMatchObject({
      morningEnabled: true,
      morningTime: '09:00',
      eveningEnabled: false,
      eveningTime: '20:00',
    });
  });
});

describe('permission prompt pending flag', () => {
  beforeEach(() => {
    h.store.clear();
  });

  it('is false until marked, true once marked, false again after clear', async () => {
    await expect(isPermissionPromptPending()).resolves.toBe(false);
    await markPermissionPromptPending();
    expect(h.store.get(PERMISSION_PROMPT_PENDING_KEY)).toBe('1');
    await expect(isPermissionPromptPending()).resolves.toBe(true);
    await clearPermissionPromptPending();
    await expect(isPermissionPromptPending()).resolves.toBe(false);
  });
});
