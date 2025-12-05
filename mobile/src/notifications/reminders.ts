import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const MORNING_HOUR = 9;
const MORNING_MINUTE = 0;

const EVENING_HOUR = 20;
const EVENING_MINUTE = 0;

const ANDROID_CHANNEL_ID = 'reminders';

const KEY_MORNING_ID = 'notifications:morning:daily9:id';
const KEY_EVENING_STATE = 'notifications:evening:20:state';

type EveningState = {
  id: string;
  dateKey: string; // YYYY-MM-DD
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

async function ensurePermission(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function ensureMorning9am(): Promise<void> {
  const existingId = await AsyncStorage.getItem(KEY_MORNING_ID);
  if (existingId) return;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'DevCards',
      body: 'Good morning — time for a quick review to keep your recall sharp.',
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: MORNING_HOUR,
      minute: MORNING_MINUTE,
    },
  });

  await AsyncStorage.setItem(KEY_MORNING_ID, id);
}

async function readEveningState(): Promise<EveningState | null> {
  const raw = await AsyncStorage.getItem(KEY_EVENING_STATE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EveningState;
  } catch {
    return null;
  }
}

async function writeEveningState(state: EveningState | null): Promise<void> {
  if (!state) {
    await AsyncStorage.removeItem(KEY_EVENING_STATE);
    return;
  }
  await AsyncStorage.setItem(KEY_EVENING_STATE, JSON.stringify(state));
}

async function cancelEveningIfAny(state: EveningState | null): Promise<void> {
  if (!state) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(state.id);
  } catch {
    // 已触发/已取消都无所谓
  }
  await writeEveningState(null);
}

/**
 * 同步“20:00 仅当仍有剩余任务才提醒”：
 * - remainingDueCount <= 0：取消当天 20:00（若存在）
 * - remainingDueCount > 0 且 now < 20:00：确保当天 20:00 有一个 one-shot
 */
async function syncEvening20(remainingDueCount: number, now: Date): Promise<void> {
  const todayKey = toDateKey(now);
  const target = todayAt(now, EVENING_HOUR, EVENING_MINUTE);

  const existing = await readEveningState();

  // 清理“前一天遗留”的 state
  if (existing && existing.dateKey !== todayKey) {
    await cancelEveningIfAny(existing);
  }

  // 如果今天没剩余任务：取消今天的 20:00
  if (remainingDueCount <= 0) {
    const current = await readEveningState();
    if (current?.dateKey === todayKey) {
      await cancelEveningIfAny(current);
    }
    return;
  }

  // 如果已经过了 20:00：不再补发
  if (now.getTime() >= target.getTime()) return;

  // 如果今天已经安排过 20:00：保持即可
  const refreshed = await readEveningState();
  if (refreshed?.dateKey === todayKey) return;

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

  await writeEveningState({ id, dateKey: todayKey });
}

/**
 * 对外入口：每次你拿到“今日剩余 due 数”后调用即可。
 */
export async function syncDailyReminders(args: {
  remainingDueCount: number;
  now?: Date;
}): Promise<void> {
  try {
    const now = args.now ?? new Date();

    const ok = await ensurePermission();
    if (!ok) return;

    await ensureAndroidChannel();
    await ensureMorning9am();
    await syncEvening20(args.remainingDueCount, now);
  } catch {
    // 不让通知问题影响主流程
  }
}