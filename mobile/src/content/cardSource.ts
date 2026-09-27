import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * K03 — a card's citation, read from the installed raw deck file.
 *
 * The deck mapper in deckRepository.ts builds CardExport from named keys only,
 * so `cards[].source` (written by the deck build, contract §5.4) never reaches
 * DeckExport. This reader looks it up in the file the repository installed,
 * found through the same per-user meta key. The repository is frozen and its
 * helpers are private, so the key and user-key rules are mirrored here;
 * tests/unit/cardSourceContract.test.ts fails if the originals drift.
 */

export const CARD_SOURCE_URL_MAX_LENGTH = 2048;
export const CARD_SOURCE_QUOTE_MAX_LENGTH = 1000;

export type CardSource = { url: string; quote: string | null };

// Mirrors deckRepository.ts DECK_META_PREFIX (+ userKey + ":" + slug).
const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:';
const HTTPS_URL = /^https:\/\/\S+$/;
const MAX_CACHED_DECKS = 4;
const UTF8_ENCODING: any = (FileSystem as any)?.EncodingType?.UTF8 ?? 'utf8';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Contract §5.1. Anything that is not a valid source is null. */
export function parseCardSource(raw: unknown): CardSource | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.url !== 'string') return null;
  const url = raw.url.trim();
  if (url.length > CARD_SOURCE_URL_MAX_LENGTH || !HTTPS_URL.test(url)) return null;

  let quote: string | null;
  if (raw.quote === undefined || raw.quote === null) {
    quote = null;
  } else if (typeof raw.quote === 'string') {
    const trimmed = raw.quote.trim();
    if (trimmed.length > CARD_SOURCE_QUOTE_MAX_LENGTH) return null;
    quote = trimmed || null;
  } else {
    return null;
  }
  return { url, quote };
}

/**
 * The host of an https URL, lower-cased, without one leading "www.". A regex
 * on the authority rather than the global URL: Hermes needs a polyfill for
 * `hostname`.
 */
export function sourceHostLabel(url: string): string {
  const match = /^https:\/\/([^/?#]*)/i.exec(String(url ?? '').trim());
  if (!match) return '';
  const authority = match[1];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const host = hostPort.startsWith('[')
    ? hostPort.slice(0, hostPort.indexOf(']') + 1)
    : hostPort.replace(/:\d*$/, '');
  return host.toLowerCase().replace(/^www\./, '');
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

type CachedDeck = { key: string; sources: Map<string, CardSource> };

// Oldest first; at most MAX_CACHED_DECKS entries.
const cache: CachedDeck[] = [];

function buildSourceMap(text: string): Map<string, CardSource> {
  const sources = new Map<string, CardSource>();
  const parsed: unknown = JSON.parse(text);
  // Flat decks and v1 `{ buildId, deck, cards }` both keep cards[] at the top.
  const cards = isRecord(parsed) && Array.isArray(parsed.cards) ? parsed.cards : [];
  for (const card of cards) {
    if (!isRecord(card) || typeof card.stableUid !== 'string') continue;
    const source = parseCardSource(card.source);
    if (source) sources.set(card.stableUid, source);
  }
  return sources;
}

/** The source of an installed card, or null. Never throws. */
export async function getCardSource(deckSlug: string, stableUid: string): Promise<CardSource | null> {
  try {
    const slug = String(deckSlug ?? '').trim();
    if (!slug || typeof stableUid !== 'string' || !stableUid) return null;

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
      const text = await FileSystem.readAsStringAsync(fileUri, { encoding: UTF8_ENCODING });
      entry = { key, sources: buildSourceMap(text) };
      cache.push(entry);
      while (cache.length > MAX_CACHED_DECKS) cache.shift();
    }
    return entry.sources.get(stableUid) ?? null;
  } catch {
    return null;
  }
}
