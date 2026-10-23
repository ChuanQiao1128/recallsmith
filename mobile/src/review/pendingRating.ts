import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RatingRewardStep } from '../features/gacha/rewards/sessionRewards';

function key(sub: string, slug: string, uid: string) {
  return `devcards:u:${sub}:review-intent:v1:${slug}:${uid}`;
}
/** Kept until projection/reward completion; separate from the outbox, whose
 * acknowledged facts may already have been removed when a projection fails. */
export async function readPendingRating<T extends { sub: string; uid: string; eventId: string; now: Date }>(
  sub: string, slug: string, uid: string,
): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key(sub, slug, uid));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (value.sub !== sub || value.uid !== uid || typeof value.eventId !== 'string' ||
      !Number.isFinite(Date.parse(value.now))) throw new Error('Invalid pending review');
  return { ...value, now: new Date(value.now) } as T;
}
export async function writePendingRating<T extends { sub: string; uid: string }>(slug: string, intent: T): Promise<void> {
  await AsyncStorage.setItem(key(intent.sub, slug, intent.uid), JSON.stringify(intent));
}
export async function clearPendingRating(sub: string, slug: string, uid: string): Promise<void> {
  await AsyncStorage.removeItem(key(sub, slug, uid));
}

export function hasCommittedRatingReward(reward: RatingRewardStep | undefined): reward is RatingRewardStep {
  return reward != null && reward.skipped !== 'storage-error' && (reward.pulls === 0 || reward.walletAfter != null);
}

/** A projected card may already be due tomorrow and absent from the next session's queue. */
export async function readPendingRatings<T extends { sub: string; uid: string; eventId: string; now: Date }>(
  sub: string, slug: string,
): Promise<T[]> {
  const prefix = key(sub, slug, '');
  const intents: T[] = [];
  for (const storedKey of await AsyncStorage.getAllKeys()) {
    if (!storedKey.startsWith(prefix)) continue;
    const intent = await readPendingRating<T>(sub, slug, storedKey.slice(prefix.length));
    if (intent) intents.push(intent);
  }
  return intents;
}
