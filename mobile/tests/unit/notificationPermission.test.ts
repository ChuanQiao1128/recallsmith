import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mapPermissionResponse } from '../../src/notifications/permissionState';

const h = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  scheduleNotificationAsync: vi.fn(async () => 'notif-1'),
  cancelScheduledNotificationAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => {}),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: any) => styles },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
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

import { requestNotificationPermission } from '../../src/notifications/reminders';

describe('mapPermissionResponse', () => {
  it('maps a denied response to denied (MACCT-09 regression)', () => {
    // The old `res?.status ?? res?.granted ? 'granted' : …` expression let `??`
    // bind tighter than `?:`, collapsing 'denied' to 'granted'.
    expect(mapPermissionResponse({ status: 'denied' })).toBe('denied');
    expect(mapPermissionResponse({ status: 'denied', granted: false })).toBe('denied');
  });

  it('maps granted and undetermined responses', () => {
    expect(mapPermissionResponse({ status: 'granted' })).toBe('granted');
    expect(mapPermissionResponse({ granted: true })).toBe('granted');
    expect(mapPermissionResponse({ status: 'undetermined' })).toBe('undetermined');
    expect(mapPermissionResponse(null)).toBe('undetermined');
    expect(mapPermissionResponse(undefined)).toBe('undetermined');
    expect(mapPermissionResponse('nope')).toBe('undetermined');
  });
});

describe('requestNotificationPermission', () => {
  beforeEach(() => {
    h.requestPermissionsAsync.mockClear();
    h.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('requestNotificationPermission asks the OS and maps the answer', async () => {
    h.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(requestNotificationPermission()).resolves.toBe('denied');
    expect(h.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    h.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    await expect(requestNotificationPermission()).resolves.toBe('granted');
  });
});
