import AsyncStorage from '@react-native-async-storage/async-storage';

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
