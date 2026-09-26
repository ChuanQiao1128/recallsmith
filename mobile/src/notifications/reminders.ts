// mobile/src/notifications/reminders.ts
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { mapPermissionResponse, type NotificationPermissionState } from './permissionState';

export type { NotificationPermissionState };

const ANDROID_CHANNEL_ID = 'reminders';

// ====== storage keys (keep old ones for backward compat) ======
const KEY_MORNING_ID = 'notifications:morning:daily9:id'; // legacy key (we still use it)
const KEY_MORNING_TIME = 'notifications:morning:daily:time:v1';

const KEY_EVENING_STATE = 'notifications:evening:state:v2'; // upgrade from old KEY_EVENING_STATE

const KEY_PREFS = 'notifications:reminders:prefs:v1';
const KEY_LAST_DUE = 'notifications:reminders:last_due_count:v1';

export type ReminderPrefs = {
  morningEnabled: boolean;
  morningTime: string; // "09:00"
  eveningEnabled: boolean;
  eveningTime: string; // "20:00"
};

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  morningEnabled: true,
  morningTime: '09:00',
  eveningEnabled: false,
  eveningTime: '20:00',
};

type EveningStateV2 = {
  id: string;
  dateKey: string; // YYYY-MM-DD
  hour: number;
  minute: number;
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayAt(now: Date, hour: number, minute: number): Date {
  const d = new Date(now.getTime());
  d.setHours(hour, minute, 0, 0);
  return d;
}

function pad2(n: number) {
  return `${n}`.padStart(2, '0');
}

function parseTimeHHMM(v: string | null | undefined): { hour: number; minute: number } | null {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeTime(v: string, fallback: string) {
  const t = parseTimeHHMM(v) ?? parseTimeHHMM(fallback);
  if (!t) return fallback;
  return `${pad2(t.hour)}:${pad2(t.minute)}`;
}

async function readPrefs(): Promise<ReminderPrefs> {
  const raw = await AsyncStorage.getItem(KEY_PREFS);
  if (!raw) return DEFAULT_REMINDER_PREFS;

  try {
    const obj = JSON.parse(raw);
    const morningEnabled = typeof obj?.morningEnabled === 'boolean' ? obj.morningEnabled : DEFAULT_REMINDER_PREFS.morningEnabled;
    const eveningEnabled = typeof obj?.eveningEnabled === 'boolean' ? obj.eveningEnabled : DEFAULT_REMINDER_PREFS.eveningEnabled;

    const morningTime = normalizeTime(String(obj?.morningTime ?? DEFAULT_REMINDER_PREFS.morningTime), DEFAULT_REMINDER_PREFS.morningTime);
    const eveningTime = normalizeTime(String(obj?.eveningTime ?? DEFAULT_REMINDER_PREFS.eveningTime), DEFAULT_REMINDER_PREFS.eveningTime);

    return { morningEnabled, morningTime, eveningEnabled, eveningTime };
  } catch {
    return DEFAULT_REMINDER_PREFS;
  }
}

export async function getReminderPrefs(): Promise<ReminderPrefs> {
  return readPrefs();
}

export async function setReminderPrefs(patch: Partial<ReminderPrefs>): Promise<ReminderPrefs> {
  const cur = await readPrefs();
  const next: ReminderPrefs = {
    morningEnabled: typeof patch.morningEnabled === 'boolean' ? patch.morningEnabled : cur.morningEnabled,
    eveningEnabled: typeof patch.eveningEnabled === 'boolean' ? patch.eveningEnabled : cur.eveningEnabled,
    morningTime: patch.morningTime ? normalizeTime(patch.morningTime, cur.morningTime) : cur.morningTime,
    eveningTime: patch.eveningTime ? normalizeTime(patch.eveningTime, cur.eveningTime) : cur.eveningTime,
  };

  await AsyncStorage.setItem(KEY_PREFS, JSON.stringify(next));
  return next;
}

// Read-only: syncDailyReminders never asks the OS. The permission request is
// only triggered by explicit user actions (PermissionPromptScreen and
// Settings > Reminders via requestNotificationPermission). syncDailyReminders
// runs on every Home refresh (deckActionResolver.ts:251), so requesting here
// would re-prompt users who had just tapped "Not now".
async function hasPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/**
 * Read the current notification permission without prompting. Any throw
 * (native module unavailable, jsdom, etc.) is treated as `'undetermined'`.
 */
export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  try {
    const res = await Notifications.getPermissionsAsync();
    return mapPermissionResponse(res);
  } catch {
    return 'undetermined';
  }
}

/**
 * Ask the OS for notification permission and map the answer. Only called from
 * explicit user actions (PermissionPrompt, Settings > Reminders);
 * syncDailyReminders stays read-only. Any throw → `'undetermined'`.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    const res = await Notifications.requestPermissionsAsync();
    return mapPermissionResponse(res);
  } catch {
    return 'undetermined';
  }
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function cancelMorningIfAny(): Promise<void> {
  const existingId = await AsyncStorage.getItem(KEY_MORNING_ID);
  if (existingId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(existingId);
    } catch {}
  }
  await AsyncStorage.removeItem(KEY_MORNING_ID);
  await AsyncStorage.removeItem(KEY_MORNING_TIME);
}

async function ensureMorningDaily(prefs: ReminderPrefs): Promise<void> {
  // disabled -> cancel
  if (!prefs.morningEnabled) {
    await cancelMorningIfAny();
    return;
  }

  const desired = parseTimeHHMM(prefs.morningTime) ?? { hour: 9, minute: 0 };
  const desiredKey = `${pad2(desired.hour)}:${pad2(desired.minute)}`;

  const existingId = await AsyncStorage.getItem(KEY_MORNING_ID);
  const existingTime = await AsyncStorage.getItem(KEY_MORNING_TIME);

  // already scheduled with same time
  if (existingId && existingTime === desiredKey) return;

  // time changed or missing -> cancel old then reschedule
  if (existingId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(existingId);
    } catch {}
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'DeveloperCards',
      body: 'Good morning — time for a quick review to keep your recall sharp.',
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: desired.hour,
      minute: desired.minute,
    },
  });

  await AsyncStorage.setItem(KEY_MORNING_ID, id);
  await AsyncStorage.setItem(KEY_MORNING_TIME, desiredKey);
}

async function readEveningState(): Promise<EveningStateV2 | null> {
  const raw = await AsyncStorage.getItem(KEY_EVENING_STATE);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj?.id || !obj?.dateKey) return null;

    const hour = typeof obj.hour === 'number' ? obj.hour : 20;
    const minute = typeof obj.minute === 'number' ? obj.minute : 0;

    return { id: String(obj.id), dateKey: String(obj.dateKey), hour, minute };
  } catch {
    return null;
  }
}

async function writeEveningState(state: EveningStateV2 | null): Promise<void> {
  if (!state) {
    await AsyncStorage.removeItem(KEY_EVENING_STATE);
    return;
  }
  await AsyncStorage.setItem(KEY_EVENING_STATE, JSON.stringify(state));
}

async function cancelEveningIfAny(state: EveningStateV2 | null): Promise<void> {
  if (!state) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(state.id);
  } catch {}
  await writeEveningState(null);
}

async function syncEveningSmart(prefs: ReminderPrefs, remainingDueCount: number, now: Date): Promise<void> {
  const todayKey = toDateKey(now);

  // disabled -> cancel
  if (!prefs.eveningEnabled) {
    const existing = await readEveningState();
    if (existing) await cancelEveningIfAny(existing);
    return;
  }

  const desired = parseTimeHHMM(prefs.eveningTime) ?? { hour: 20, minute: 0 };
  const target = todayAt(now, desired.hour, desired.minute);

  const existing = await readEveningState();

  // cleanup old date
  if (existing && existing.dateKey !== todayKey) {
    await cancelEveningIfAny(existing);
  }

  // no due -> cancel today's
  if (remainingDueCount <= 0) {
    const cur = await readEveningState();
    if (cur?.dateKey === todayKey) await cancelEveningIfAny(cur);
    return;
  }

  // already past time -> do nothing
  if (now.getTime() >= target.getTime()) return;

  const refreshed = await readEveningState();
  const alreadyTodaySameTime =
    refreshed?.dateKey === todayKey && refreshed.hour === desired.hour && refreshed.minute === desired.minute;

  if (alreadyTodaySameTime) return;

  // if exists but wrong time, cancel then schedule
  if (refreshed?.dateKey === todayKey) {
    await cancelEveningIfAny(refreshed);
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Evening check‑in',
      body: "You still have cards due today. Finish a quick run to stay on track.",
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: target,
    },
  });

  await writeEveningState({ id, dateKey: todayKey, hour: desired.hour, minute: desired.minute });
}

/**
 * 对外入口：每次你拿到“今日剩余 due 数”后调用即可。
 */
export async function syncDailyReminders(args: { remainingDueCount: number; now?: Date }): Promise<void> {
  try {
    const now = args.now ?? new Date();
    const remainingDueCount = Number.isFinite(args.remainingDueCount) ? Math.max(0, args.remainingDueCount) : 0;

    // cache last due for "apply now" use
    await AsyncStorage.setItem(KEY_LAST_DUE, String(remainingDueCount));

    const ok = await hasPermission();
    if (!ok) return;

    await ensureAndroidChannel();

    const prefs = await readPrefs();
    await ensureMorningDaily(prefs);
    await syncEveningSmart(prefs, remainingDueCount, now);
  } catch {
    // don't block main flow
  }
}

/**
 * Settings 改完 prefs 后调用：尽量立刻应用。
 * 如果缓存里还没有 due count，会以 0 处理（晚间提醒可能在下次 Home 刷新时更新）。
 */
export async function refreshDailyRemindersFromCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_DUE);
    const n = raw ? Number(raw) : 0;
    const remainingDueCount = Number.isFinite(n) ? Math.max(0, n) : 0;
    await syncDailyReminders({ remainingDueCount, now: new Date() });
  } catch {
    // ignore
  }
}
