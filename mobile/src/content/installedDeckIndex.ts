import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { fetchAuthSession } from 'aws-amplify/auth';

import { parseCardSource, type CardSource } from './cardSourceParse';
import { parseCardTranslations, type CardTranslations } from './cardTranslation';

/**
 * The card fields the deck mapper leaves out, read from the installed raw deck file.
 *
 * deckRepository.ts builds CardExport from named keys only, so `cards[].source`
 * (K03, contract §5.4) and `cards[].translations` (card translations contract
 * §1) never reach DeckExport. This reader parses the file the repository
 * installed — found through the same per-user meta key — once per installed
 * build, and keeps both lookups from that one parse. The repository is frozen
 * and its helpers are private, so the key, user-key and deck-file rules are
 * mirrored here; tests/unit/cardSourceContract.test.ts fails if the originals
 * drift.
 */

export type InstalledDeckIndex = {
  /** Valid sources by stableUid. */
  sources: ReadonlyMap<string, CardSource>;
  /** Cards with at least one valid translation entry, by stableUid. */
  translations: ReadonlyMap<string, CardTranslations>;
};

// Mirrors deckRepository.ts DECK_META_PREFIX (+ userKey + ":" + slug).
const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:';
const MAX_CACHED_DECKS = 4;
const UTF8_ENCODING: any = (FileSystem as any)?.EncodingType?.UTF8 ?? 'utf8';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Mirrors deckRepository.ts sanitizeUserKey.
function sanitizeUserKey(s: string): string {
  const x = String(s || 'anon').trim();
  if (!x) return 'anon';
  return x.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'anon';
}

// Mirrors deckRepository.ts getCurrentUserKey.
async function getCurrentUserKey(): Promise<string> {
  try {
    const session: any = await fetchAuthSession();
    const sub =
      session?.userSub ??
      session?.tokens?.idToken?.payload?.sub ??
      session?.tokens?.accessToken?.payload?.sub ??
      null;
    return sanitizeUserKey(sub || 'anon');
  } catch {
    return 'anon';
  }
}

// Mirrors deckRepository.ts currentDeckFileUri (getDeckDirForUser + slugToFileName).
function currentDeckFileUri(userKey: string, slug: string): string | null {
  const base = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory;
  if (!base || typeof base !== 'string') return null;
  return `${base}devcards-decks-v2/${sanitizeUserKey(userKey)}/${slug.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`;
}

// A binary update moves the app's data container, so the meta's absolute fileUri can name the
// previous one until deckRepository's next read repoints it (locateInstalledDeckFile). Same rule:
// a file missing at the stored URI is read from the same name in this launch's deck directory.
async function readInstalledDeckText(userKey: string, slug: string, fileUri: string): Promise<string> {
  try {
    return await FileSystem.readAsStringAsync(fileUri, { encoding: UTF8_ENCODING });
  } catch (err) {
    const current = currentDeckFileUri(userKey, slug);
    if (!current || current === fileUri || !fileUri.endsWith(current.slice(current.lastIndexOf('/')))) throw err;
    return await FileSystem.readAsStringAsync(current, { encoding: UTF8_ENCODING });
  }
}

// The pending parse is cached, not just its result: the study view asks for a source and the
// session screen for translations of the same deck at the same moment, and both share one read.
type CachedDeck = { key: string; index: Promise<InstalledDeckIndex> };

// Oldest first; at most MAX_CACHED_DECKS entries. A failed read is dropped, so the next call retries.
const cache: CachedDeck[] = [];

function buildIndex(text: string): InstalledDeckIndex {
  const sources = new Map<string, CardSource>();
  const translations = new Map<string, CardTranslations>();
  const parsed: unknown = JSON.parse(text);
  // Flat decks and v1 `{ buildId, deck, cards }` both keep cards[] at the top.
  const cards = isRecord(parsed) && Array.isArray(parsed.cards) ? parsed.cards : [];
  for (const card of cards) {
    if (!isRecord(card) || typeof card.stableUid !== 'string') continue;
    const source = parseCardSource(card.source);
    if (source) sources.set(card.stableUid, source);
    const translated = parseCardTranslations(card.translations);
    if (translated) translations.set(card.stableUid, translated);
  }
  return { sources, translations };
}

/** The index of a deck's installed file, or null (not installed, unreadable, corrupt). Never throws. */
export async function getInstalledDeckIndex(deckSlug: string): Promise<InstalledDeckIndex | null> {
  try {
    const slug = String(deckSlug ?? '').trim();
    if (!slug) return null;

    const userKey = await getCurrentUserKey();
    const rawMeta = await AsyncStorage.getItem(`${DECK_META_PREFIX}${userKey}:${slug}`);
    if (!rawMeta) return null;
    const meta: unknown = JSON.parse(rawMeta);
    if (!isRecord(meta)) return null;
    const { buildId, fileUri } = meta;
    if (typeof buildId !== 'string' || !buildId || typeof fileUri !== 'string' || !fileUri) return null;

    const key = JSON.stringify([slug, fileUri, buildId]);
    let entry = cache.find((c) => c.key === key);
    if (!entry) {
      const created: CachedDeck = { key, index: readInstalledDeckText(userKey, slug, fileUri).then(buildIndex) };
      created.index.catch(() => {
        const at = cache.indexOf(created);
        if (at >= 0) cache.splice(at, 1);
      });
      entry = created;
      cache.push(entry);
      while (cache.length > MAX_CACHED_DECKS) cache.shift();
    }
    return await entry.index;
  } catch {
    return null;
  }
}

/** The installed deck's translations by stableUid, or null. Never throws. */
export async function getDeckTranslations(deckSlug: string): Promise<ReadonlyMap<string, CardTranslations> | null> {
  return (await getInstalledDeckIndex(deckSlug))?.translations ?? null;
}
