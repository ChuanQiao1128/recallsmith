import AsyncStorage from '@react-native-async-storage/async-storage';

export const MANIFEST_CACHE_KEY = 'devcards:content:manifest:v2';
export const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:';

export function sanitizeUserKey(sub: string): string {
  return String(sub || 'anon').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'anon';
}

/** Local truth only. Unknown must never authorize a grant or a sync apply.
 * Caller holds the draw lock; this must not resolve a deck or trigger a purge. */
export async function readDeckEligibilityUnderLock(slug: string): Promise<'active' | 'retired' | 'unknown'> {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_CACHE_KEY);
    if (raw == null) return 'unknown';
    const manifest = JSON.parse(raw);
    if (!Array.isArray(manifest?.decks)) return 'unknown';
    const entry = manifest.decks.find((d: any) => d?.slug === slug);
    if (!entry) return 'unknown';
    const availability = String(entry.availability || '').toLowerCase();
    if (availability === 'retired') return 'retired';
    // Older manifests omit availability; installed live content stays usable offline.
    return !availability || availability === 'live' ? 'active' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** A retained UI snapshot can only grant from this account's installed build. */
export async function isInstalledDrawDeckEligibleUnderLock(slug: string, userSub: string, version: unknown): Promise<boolean> {
  if (await readDeckEligibilityUnderLock(slug) !== 'active') return false;
  try {
    const raw = await AsyncStorage.getItem(`${DECK_META_PREFIX}${sanitizeUserKey(userSub)}:${slug}`);
    if (raw == null) return false;
    const meta = JSON.parse(raw);
    return typeof meta?.fileUri === 'string' && meta.fileUri.length > 0
      && typeof meta.buildId === 'string' && meta.buildId.length > 0 && meta.buildId === version;
  } catch {
    return false;
  }
}
