// mobile/src/sync/clientCapabilities.ts
/**
 * What this client can do, sent once per push batch next to clientVersion
 * (progressSync.ts, the two signed envelope lines). Wave C ships no feature
 * tokens; the update id lets analytics tell a post-OTA 1.6.0 device from a
 * pre-OTA one, which app_version cannot.
 *
 * expo-updates is loaded with a guarded dynamic import() inside a function:
 * a static import would drag react-native Image and requireNativeModule into
 * every suite that imports progressSync (B00 §9 #13). Any failure → {}.
 */
export type ClientCapabilities = { clientFeatures?: string[]; updateId?: string };

/** Wave C ships this empty; Wave D appends 'mcq' when flags.mcq.enabled at call time. */
export const CLIENT_FEATURES: readonly string[] = [];

export const MAX_CLIENT_FEATURES = 16;
export const MAX_UPDATE_ID_LENGTH = 64;
const FEATURE_TOKEN = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * Strings only; trimmed and lower-cased; must match FEATURE_TOKEN; deduplicated;
 * sorted (ordinal); at most MAX_CLIENT_FEATURES. Pure, never throws.
 */
export function normalizeClientFeatures(input: readonly unknown[]): string[] {
  const set = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const token = raw.trim().toLowerCase();
    if (FEATURE_TOKEN.test(token)) set.add(token);
  }
  return [...set].sort().slice(0, MAX_CLIENT_FEATURES);
}

// Resolved once per process (including the "unavailable" outcome) and reused.
let cachedUpdateId: { value: string | undefined } | null = null;

/**
 * Guarded dynamic import() of the updates package inside the function (B00 §9
 * #13: a static import breaks ≥ 9 unit suites — Updates.js:1-3 pulls
 * react-native Image and ExpoUpdates.js:5 calls requireNativeModule). Accepts only a
 * non-blank string of ≤ MAX_UPDATE_ID_LENGTH chars; any failure → undefined.
 */
async function readUpdateId(): Promise<string | undefined> {
  try {
    const mod = (await import('expo-updates')) as
      | { updateId?: unknown; default?: { updateId?: unknown } }
      | undefined;
    const raw = mod?.updateId ?? mod?.default?.updateId;
    if (typeof raw !== 'string') return undefined;
    const id = raw.trim().toLowerCase();
    return id.length > 0 && id.length <= MAX_UPDATE_ID_LENGTH ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cached after the first resolve; never throws; any failure → {}. Keys are
 * added only when defined (no undefined-valued keys are ever present either).
 */
export async function getClientCapabilities(): Promise<ClientCapabilities> {
  try {
    if (cachedUpdateId === null) {
      cachedUpdateId = { value: await readUpdateId() };
    }
    const caps: ClientCapabilities = {};
    const features = normalizeClientFeatures(CLIENT_FEATURES);
    if (features.length > 0) caps.clientFeatures = features;
    if (cachedUpdateId.value !== undefined) caps.updateId = cachedUpdateId.value;
    return caps;
  } catch {
    return {};
  }
}

export function resetClientCapabilitiesForTests(): void {
  cachedUpdateId = null;
}
