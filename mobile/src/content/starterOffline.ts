// R24-00 §2.2: the offline first run. A fresh install with no network installs the bundled starter
// pack (src/content/starter, O01) through the normal deckRepository install seam, and a later
// online moment swaps it for the full deck through the normal manifest install path.
//
// deckRepository.ts is frozen. The starter pack goes in through installDeckAndInvalidate with a
// local file:// URL (iOS downloadAsync copies local files), so every existing validation and the
// meta write apply unchanged. Progress, the owned set and the lesson record are keyed by slug and
// stableUid, and the pack's cards are a verbatim prefix of the live build, so neither install
// touches them.
//
// expo-file-system is read through a guarded dynamic import: screen suites mock deckRepository
// but not the file system, and a static edge would drag the native module into their graph. A
// failed import simply means "no starter pack" there, which is today's behaviour.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { checkManifestForUpdates, type ManifestDeckEntry } from './deckRepository';
import { getCachedDeck, installDeckAndInvalidate } from './deckCache';
import { STARTER_PACKS, type StarterSlug } from './starter';

export type StarterInstallResult = 'installed-starter' | 'already-installed' | 'unavailable';

/** Every starter pack's version ends with this (O01: "<buildId>-starter"). */
export const STARTER_VERSION_SUFFIX = '-starter';

/** At most one upgrade attempt per slug in this window. */
export const STARTER_UPGRADE_BACKOFF_MS = 5 * 60 * 1000;

// Mirrors deckRepository.ts DECK_META_PREFIX (+ userKey + ":" + slug); see cardSource.ts for the
// same mirror and tests/unit/cardSourceContract.test.ts for the guard on the original.
const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:';

export function hasStarterPack(slug: string | null | undefined): slug is StarterSlug {
  const safe = String(slug ?? '').trim();
  return Object.prototype.hasOwnProperty.call(STARTER_PACKS, safe);
}

export function isStarterVersion(version: unknown): boolean {
  return typeof version === 'string' && version.trim().endsWith(STARTER_VERSION_SUFFIX);
}

type FileSystemLike = {
  cacheDirectory?: string | null;
  writeAsStringAsync: (uri: string, content: string) => Promise<void>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
};

async function loadFileSystem(): Promise<FileSystemLike | null> {
  try {
    return (await import('expo-file-system/legacy')) as unknown as FileSystemLike;
  } catch {
    return null;
  }
}

const installInFlight = new Map<string, Promise<StarterInstallResult>>();

async function installStarterPack(slug: StarterSlug): Promise<StarterInstallResult> {
  const pack = STARTER_PACKS[slug];
  const FileSystem = await loadFileSystem();
  const dir = FileSystem?.cacheDirectory;
  if (!FileSystem || typeof dir !== 'string' || !dir) return 'unavailable';

  const fileUri = `${dir}starter-${slug}-${Date.now()}.json`;
  try {
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(pack));
    const ok = await installDeckAndInvalidate(slug, fileUri, pack.version, null);
    if (!ok) return 'unavailable';
    return (await getCachedDeck(slug)) ? 'installed-starter' : 'unavailable';
  } catch {
    return 'unavailable';
  } finally {
    // The install copied the file into the deck directory; the cache copy is spent either way.
    try {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    } catch {}
  }
}

/**
 * Installs the bundled starter pack for `slug` when no deck is installed for it. Callers use it
 * after the normal install failed or the device is offline. Never throws.
 */
export async function ensureStarterDeckInstalled(slug: string): Promise<StarterInstallResult> {
  const safe = String(slug ?? '').trim();
  if (!hasStarterPack(safe)) return 'unavailable';
  try {
    if (await getCachedDeck(safe)) return 'already-installed';
  } catch {
    // An unreadable install is treated as missing: the starter install replaces it.
  }
  const existing = installInFlight.get(safe);
  if (existing) return existing;
  const run = installStarterPack(safe).finally(() => {
    installInFlight.delete(safe);
  });
  installInFlight.set(safe, run);
  return run;
}

const lastUpgradeAttemptMs = new Map<string, number>();
let upgradeInFlight: Promise<string[]> | null = null;

export type StarterUpgradeListener = (upgradedSlugs: string[]) => void;
const upgradeListeners = new Set<StarterUpgradeListener>();

/**
 * Calls `listener` with the upgraded slugs after every upgrade run that replaced at least one
 * starter deck, whoever started it (App on foreground, or Home on focus). Home uses it to reload a
 * shelf that is already showing. Returns the unsubscribe function.
 */
export function subscribeStarterUpgrades(listener: StarterUpgradeListener): () => void {
  upgradeListeners.add(listener);
  return () => {
    upgradeListeners.delete(listener);
  };
}

function notifyUpgraded(slugs: string[]): void {
  if (slugs.length === 0) return;
  for (const listener of [...upgradeListeners]) {
    try {
      listener([...slugs]);
    } catch {
      // A listener's failure is its own; the others still hear about the upgrade.
    }
  }
}

/** Test seam: the backoff map is module state and vitest shares modules within a file. */
export function resetStarterUpgradeBackoff(): void {
  lastUpgradeAttemptMs.clear();
}

async function runStarterUpgrade(): Promise<string[]> {
  const nowMs = Date.now();
  const due: StarterSlug[] = [];
  for (const slug of Object.keys(STARTER_PACKS) as StarterSlug[]) {
    let deck: Awaited<ReturnType<typeof getCachedDeck>> = null;
    try {
      deck = await getCachedDeck(slug);
    } catch {
      deck = null;
    }
    if (!deck || !isStarterVersion(deck.Version)) continue;
    const last = lastUpgradeAttemptMs.get(slug);
    if (last !== undefined && nowMs - last < STARTER_UPGRADE_BACKOFF_MS) continue;
    due.push(slug);
  }
  if (due.length === 0) return [];

  for (const slug of due) lastUpgradeAttemptMs.set(slug, nowMs);

  let updates: Awaited<ReturnType<typeof checkManifestForUpdates>>;
  try {
    updates = await checkManifestForUpdates();
  } catch {
    return [];
  }

  const upgraded: string[] = [];
  for (const slug of due) {
    const info = updates?.[slug];
    if (!info?.remoteUrl || !info.remoteVersion || isStarterVersion(info.remoteVersion)) continue;
    try {
      const ok = await installDeckAndInvalidate(slug, info.remoteUrl, info.remoteVersion, info.remoteSha256 ?? null);
      if (ok) upgraded.push(slug);
    } catch {
      // The next window retries.
    }
  }
  return upgraded;
}

/**
 * Replaces each installed starter deck (Version ending "-starter") with the full deck from the
 * manifest, through the normal install path. One attempt per slug per STARTER_UPGRADE_BACKOFF_MS;
 * concurrent callers share one run. Returns the slugs that were upgraded and tells the
 * subscribeStarterUpgrades listeners about them. Never throws.
 */
export function upgradeStarterDecks(): Promise<string[]> {
  if (upgradeInFlight) return upgradeInFlight;
  const run = runStarterUpgrade()
    .catch(() => [] as string[])
    .then((upgraded) => {
      notifyUpgraded(upgraded);
      return upgraded;
    })
    .finally(() => {
      upgradeInFlight = null;
    });
  upgradeInFlight = run;
  return run;
}

/**
 * Home's shelf when no manifest is available: one entry per deck installed for the current user,
 * read from the installed deck metas and the decks themselves. Never throws.
 */
export async function listInstalledDeckEntries(): Promise<ManifestDeckEntry[]> {
  let keys: readonly string[] = [];
  try {
    keys = (await AsyncStorage.getAllKeys()) ?? [];
  } catch {
    return [];
  }
  const slugs = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(DECK_META_PREFIX)) continue;
    const rest = key.slice(DECK_META_PREFIX.length);
    const sep = rest.indexOf(':');
    const slug = sep >= 0 ? rest.slice(sep + 1).trim() : '';
    if (slug) slugs.add(slug);
  }

  const entries: ManifestDeckEntry[] = [];
  // Metas of other users' decks are skipped here: getCachedDeck reads the current user's only.
  for (const slug of [...slugs].sort()) {
    let deck: Awaited<ReturnType<typeof getCachedDeck>> = null;
    try {
      deck = await getCachedDeck(slug);
    } catch {
      deck = null;
    }
    if (!deck) continue;
    // A starter pack holds a prefix; the shelf shows the full deck's size, which the pack carries.
    const totalCards =
      hasStarterPack(slug) && isStarterVersion(deck.Version) ? STARTER_PACKS[slug].totalCards : (deck.Cards?.length ?? 0);
    entries.push({
      slug,
      title: deck.Title ?? slug,
      locale: deck.Locale ?? 'en-US',
      deckType: deck.DeckType ?? 1,
      tier: null,
      availability: 'live',
      retiredAtMs: null,
      eta: null,
      downloadMode: null,
      version: String(deck.Version ?? 'unknown'),
      totalCards,
      buildId: null,
      path: null,
      sha256: null,
    });
  }
  return entries;
}
