import AsyncStorage from '@react-native-async-storage/async-storage';

export const MANIFEST_CACHE_KEY = 'devcards:content:manifest:v2';
export const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:';

export function sanitizeUserKey(sub: string): string {
  return String(sub || 'anon').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'anon';
}

/** Local truth only. Unknown must never authorize a grant or a sync apply.
 * Caller holds the draw lock; this must not resolve a deck or trigger a purge. */
async function readManifestEligibility(slug: string): Promise<'active' | 'retired' | 'unknown' | 'absent'> {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_CACHE_KEY);
    if (raw == null) return 'absent';
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

export async function readDeckEligibilityUnderLock(slug: string): Promise<'active' | 'retired' | 'unknown'> {
  const eligibility = await readManifestEligibility(slug);
  return eligibility === 'absent' ? 'unknown' : eligibility;
}

/** A retained UI snapshot can only grant from this account's installed build. */
export async function isInstalledDrawDeckEligibleUnderLock(slug: string, userSub: string, version: unknown): Promise<boolean> {
  const eligibility = await readManifestEligibility(slug);
  if (eligibility !== 'active' && eligibility !== 'absent') return false;
  try {
    const raw = await AsyncStorage.getItem(`${DECK_META_PREFIX}${sanitizeUserKey(userSub)}:${slug}`);
    if (raw == null) return false;
    const meta = JSON.parse(raw);
    if (typeof meta?.fileUri !== 'string' || !meta.fileUri
      || typeof meta.buildId !== 'string' || !meta.buildId || meta.buildId !== version) return false;
    if (eligibility === 'active') return true;
    // Only the actual bundled installer can attest a first-run build before any manifest exists.
    const { STARTER_PACKS } = await import('./starter');
    const pack = Object.prototype.hasOwnProperty.call(STARTER_PACKS, slug)
      ? STARTER_PACKS[slug as keyof typeof STARTER_PACKS] : null;
    const trusted = meta.bundledStarter;
    return !!pack && meta.slug === slug && meta.buildId === pack.version
      && meta.fileUri.endsWith(`/devcards-decks-v2/${sanitizeUserKey(userSub)}/${slug}.json`)
      && trusted?.userSub === userSub && trusted.buildId === meta.buildId && trusted.fileUri === meta.fileUri;
  } catch {
    return false;
  }
}
