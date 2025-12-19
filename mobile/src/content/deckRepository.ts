import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import type { DeckExport } from '../types/deckExport';

/**
 * v2 Content repository (CloudFront -> manifest.json -> deck.json)
 * - Supports manifest schemaVersion=2
 * - Backward compatible with v1-ish deck json shape
 */

/** =========================
 *  Config
 *  ========================= */
const CONTENT_BASE_URL =
  (process.env.EXPO_PUBLIC_CONTENT_BASE_URL || '').trim() ||
  'https://d1ditdi9jqpy6n.cloudfront.net';

const MANIFEST_URL = joinUrl(CONTENT_BASE_URL, 'content', 'manifest.json');
const MANIFEST_CACHE_KEY = 'devcards:content:manifest:v2';
const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:'; // + slug

// Runtime-safe "utf8" encoding without relying on FileSystem.EncodingType types
const UTF8_ENCODING: any = (FileSystem as any)?.EncodingType?.UTF8 ?? 'utf8';

function getDeckDir(): string {
  const base = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory;
  if (!base || typeof base !== 'string') {
    throw new Error('expo-file-system: no writable directory (documentDirectory/cacheDirectory)');
  }
  return `${base}devcards-decks-v2/`;
}

/** =========================
 *  Types
 *  ========================= */

// Manifest v2 shape (your current publish_mock_content.sh)
type RawManifest = {
  schemaVersion: number;
  generatedAtMs: number;
  prefix: string; // e.g. "content"
  decks: Array<{
    // ✅ NEW: order for Home sorting
    order?: number;

    slug: string;
    title?: string;
    locale?: string;
    deckType?: number;

    tier?: 'free' | 'premium' | string | null;
    availability?: 'live' | 'coming' | string | null;
    eta?: string | null;
    downloadMode?: 'public' | 'auth' | 'none' | string | null;

    totalCards?: number;
    version?: string | number | null;

    buildId?: number | string | null;

    // public decks: path is set
    // premium/auth or coming: path is null
    path?: string | null;

    sha256?: string | null;
  }>;
};

export type ManifestDeckEntry = {
  // ✅ NEW: order for Home sorting
  order?: number;

  slug: string;
  title?: string;
  locale?: string;
  deckType?: number;

  tier?: string | null;
  availability?: string | null;
  eta?: string | null;
  downloadMode?: string | null;

  // v2: version from manifest (usually buildId string), used for display/update check
  version: string;

  totalCards?: number;

  buildId: string | null;
  path: string | null;
  sha256: string | null;
};

export type UpdateInfo = {
  slug: string;

  installedVersion: string | null; // local buildId/version
  remoteVersion: string | null; // manifest version/buildId
  hasUpdate: boolean;

  remoteUrl: string | null; // full URL for deck.json (only for public decks)
  remoteSha256: string | null;
};

type DeckInstallMeta = {
  slug: string;
  buildId: string;
  installedAtMs: number;
  fileUri: string;
  cardCount: number;
};

// Old deck-json format (v1-ish): { buildId, deck:{}, cards:[] }
type RawDeckJsonV1 = {
  schemaVersion?: number;
  buildId: string;
  generatedAtMs?: number;
  deck: {
    slug: string;
    title: string;
    author?: string | null;
    description?: string | null;
    locale: string;
    deckType: number;
    version?: number;
    updatedAt?: string;
  };
  cards: Array<{
    stableUid: string;
    question: string;
    explanation?: string | null;
    codeSnippet?: string | null;
    codeLanguage?: string | null;
    realWorldUsage?: string | null;
    difficulty?: number | null;
    orderInDeck?: number | null;
    revision?: number | null;
    version?: number | null;
    updatedAt?: string | null;
  }>;
};

// New deck-json format (your publish script): { slug,title,locale,deckType,version,totalCards,cards[] }
type RawDeckJsonFlat = {
  slug: string;
  title: string;
  locale: string;
  deckType: number;
  version: string | number;
  totalCards?: number;
  cards: Array<{
    stableUid: string;
    question: string;
    explanation?: string | null;
    codeSnippet?: string | null;
    codeLanguage?: string | null;
    realWorldUsage?: string | null;
    difficulty?: number | null;
    orderInDeck?: number | null;
    revision?: number | null;
    version?: number | null;
    updatedAt?: string | null;
  }>;
};

export type DeckContent = DeckExport;

/** =========================
 *  Public API
 *  ========================= */

/**
 * ✅ NEW signature:
 * We accept isPremiumUser so Home can call checkManifestForUpdates(isPremiumUser)
 * (Right now we still only provide remoteUrl for public decks to keep premium protected.)
 */
export async function checkManifestForUpdates(
  _isPremiumUser: boolean = false,
): Promise<Record<string, UpdateInfo>> {
  const manifest = await loadManifestPreferRemote();
  if (!manifest) return {};

  const out: Record<string, UpdateInfo> = {};

  for (const d of manifest.decks) {
    const slug = String(d.slug || '').trim();
    if (!slug) continue;

    const meta = await getDeckMeta(slug);
    const installed = meta?.buildId || null;

    const remoteVersion = normalizeVersion(d.version ?? d.buildId) ?? null;

    // Only public + path can be downloaded directly
    const isPublic = String(d.downloadMode || '').toLowerCase() === 'public';
    const path = typeof d.path === 'string' && d.path.trim().length > 0 ? d.path.trim() : null;

    const remoteUrl =
      isPublic && path
        ? /^https?:\/\//i.test(path)
          ? path
          : joinUrl(CONTENT_BASE_URL, manifest.prefix, path)
        : null;

    const hasUpdate = !!remoteUrl && !!remoteVersion && installed !== remoteVersion;

    out[slug] = {
      slug,
      installedVersion: installed,
      remoteVersion,
      hasUpdate,
      remoteUrl,
      remoteSha256: (d.sha256 ?? null) ? String(d.sha256) : null,
    };
  }

  return out;
}

export async function listManifestDecks(): Promise<ManifestDeckEntry[]> {
  const manifest = await loadManifestCached();
  if (!manifest) return [];

  return (manifest.decks || []).map((d) => {
    const buildId = normalizeVersion(d.buildId) ?? null;
    const version = normalizeVersion(d.version ?? d.buildId) ?? (buildId ?? 'unknown');

    return {
      // ✅ NEW: order pass-through
      order: typeof (d as any).order === 'number' ? (d as any).order : undefined,

      slug: String(d.slug),
      title: d.title,
      locale: d.locale,
      deckType: d.deckType ?? 1,

      tier: (d.tier ?? null) as any,
      availability: (d.availability ?? null) as any,
      eta: (d.eta ?? null) as any,
      downloadMode: (d.downloadMode ?? null) as any,

      version,
      totalCards: typeof d.totalCards === 'number' ? d.totalCards : undefined,

      buildId,
      path: typeof d.path === 'string' ? d.path : null,
      sha256: (d.sha256 ?? null) ? String(d.sha256) : null,
    };
  });
}

export async function resolveDeckBySlug(slug: string): Promise<DeckContent | null> {
  const safeSlug = String(slug).trim();
  if (!safeSlug) return null;

  const meta = await getDeckMeta(safeSlug);
  if (!meta?.fileUri || !meta?.buildId) return null;

  const info = await FileSystem.getInfoAsync(meta.fileUri);
  if (!info.exists) {
    await removeDeckMeta(safeSlug);
    return null;
  }

  try {
    const rawText = await FileSystem.readAsStringAsync(meta.fileUri, { encoding: UTF8_ENCODING });
    const parsed = JSON.parse(rawText);

    // v1-ish
    if (isRawDeckV1(parsed)) {
      if (parsed.deck?.slug !== safeSlug) return null;
      if (!Array.isArray(parsed.cards)) return null;
      return mapRawDeckV1ToDeckExport(parsed);
    }

    // flat v2
    if (isRawDeckFlat(parsed)) {
      if (parsed.slug !== safeSlug) return null;
      if (!Array.isArray(parsed.cards)) return null;
      return mapRawDeckFlatToDeckExport(parsed);
    }

    return null;
  } catch {
    return null;
  }
}

export async function installDeckFromUrl(
  slug: string,
  url: string,
  remoteVersion: string | null,
  _remoteSha256: string | null,
): Promise<boolean> {
  const safeSlug = String(slug).trim();
  const safeUrl = String(url || '').trim();
  if (!safeSlug || !safeUrl) return false;

  const existing = await getDeckMeta(safeSlug);
  if (existing?.buildId && remoteVersion && existing.buildId === remoteVersion) {
    return true;
  }

  const dir = getDeckDir();
  await ensureDir(dir);

  const finalPath = `${dir}${slugToFileName(safeSlug)}.json`;
  const tmpPath = `${dir}${slugToFileName(safeSlug)}.tmp.json`;

  try {
    await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    await FileSystem.downloadAsync(safeUrl, tmpPath);

    const rawText = await FileSystem.readAsStringAsync(tmpPath, { encoding: UTF8_ENCODING });
    const parsed = JSON.parse(rawText);

    // Accept both shapes
    let resolvedBuildId: string | null = null;
    let cardCount = 0;

    if (isRawDeckV1(parsed)) {
      if (!parsed.deck || parsed.deck.slug !== safeSlug) return false;
      if (!Array.isArray(parsed.cards)) return false;
      if (parsed.cards.some((c) => !c || typeof c.stableUid !== 'string' || !c.stableUid.trim())) return false;

      resolvedBuildId = String(parsed.buildId || '').trim() || null;
      cardCount = parsed.cards.length;

      if (remoteVersion && resolvedBuildId && resolvedBuildId !== remoteVersion) return false;
    } else if (isRawDeckFlat(parsed)) {
      if (parsed.slug !== safeSlug) return false;
      if (!Array.isArray(parsed.cards)) return false;
      if (parsed.cards.some((c) => !c || typeof c.stableUid !== 'string' || !c.stableUid.trim())) return false;

      resolvedBuildId = normalizeVersion(parsed.version) ?? null;
      cardCount = parsed.cards.length;

      if (remoteVersion && resolvedBuildId && resolvedBuildId !== remoteVersion) return false;
    } else {
      return false;
    }

    const finalBuildId = (remoteVersion && remoteVersion.trim()) || resolvedBuildId;
    if (!finalBuildId) return false;

    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });

    const meta: DeckInstallMeta = {
      slug: safeSlug,
      buildId: finalBuildId,
      installedAtMs: Date.now(),
      fileUri: finalPath,
      cardCount,
    };

    await AsyncStorage.setItem(deckMetaKey(safeSlug), JSON.stringify(meta));
    return true;
  } catch {
    try {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    } catch {}
    return false;
  }
}

/** =========================
 *  Internals
 *  ========================= */

function normalizeVersion(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function joinUrl(base: string, ...parts: Array<string | null | undefined>): string {
  let out = String(base || '').trim();
  out = out.replace(/\/+$/, '');
  for (const p of parts) {
    if (!p) continue;
    let s = String(p).trim();
    if (!s) continue;
    s = s.replace(/^\/+/, '');
    s = s.replace(/\/+$/, '');
    if (!s) continue;
    out += '/' + s;
  }
  return out;
}

function slugToFileName(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function ensureDir(dir: string) {
  const info = await FileSystem.getInfoAsync(dir);
  if (info.exists && info.isDirectory) return;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

function deckMetaKey(slug: string) {
  return `${DECK_META_PREFIX}${slug}`;
}

async function getDeckMeta(slug: string): Promise<DeckInstallMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(deckMetaKey(slug));
    if (!raw) return null;
    const meta = JSON.parse(raw) as DeckInstallMeta;
    if (!meta?.buildId || !meta?.fileUri) return null;
    return meta;
  } catch {
    return null;
  }
}

async function removeDeckMeta(slug: string) {
  try {
    await AsyncStorage.removeItem(deckMetaKey(slug));
  } catch {}
}

async function loadManifestPreferRemote(): Promise<RawManifest | null> {
  const remote = await fetchRemoteManifest();
  if (remote) return remote;
  return await loadManifestCached();
}

async function loadManifestCached(): Promise<RawManifest | null> {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as RawManifest;
    if (!obj || !Array.isArray(obj.decks)) return null;

    if (typeof obj.prefix !== 'string' || !obj.prefix.trim()) obj.prefix = 'content';
    obj.prefix = obj.prefix.replace(/^\/+/, '').replace(/\/+$/, '');

    return obj;
  } catch {
    return null;
  }
}

async function fetchRemoteManifest(): Promise<RawManifest | null> {
  try {
    const resp = await fetch(MANIFEST_URL, {
      method: 'GET',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!resp.ok) return null;

    const json = (await resp.json()) as RawManifest;
    if (!json || !Array.isArray(json.decks)) return null;

    if (typeof json.prefix !== 'string' || !json.prefix.trim()) json.prefix = 'content';
    json.prefix = json.prefix.replace(/^\/+/, '').replace(/\/+$/, '');

    await AsyncStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(json));
    return json;
  } catch {
    return null;
  }
}

function isRawDeckV1(x: any): x is RawDeckJsonV1 {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.buildId === 'string' &&
    !!x.deck &&
    typeof x.deck === 'object' &&
    typeof x.deck.slug === 'string' &&
    Array.isArray(x.cards)
  );
}

function isRawDeckFlat(x: any): x is RawDeckJsonFlat {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.slug === 'string' &&
    typeof x.title === 'string' &&
    typeof x.locale === 'string' &&
    typeof x.deckType === 'number' &&
    (typeof x.version === 'string' || typeof x.version === 'number') &&
    Array.isArray(x.cards)
  );
}

function mapRawDeckV1ToDeckExport(raw: RawDeckJsonV1): DeckExport {
  const d = raw.deck;
  const cards = Array.isArray(raw.cards) ? raw.cards : [];

  const deckType = d.deckType ?? 1;
  const isFreeStarter = deckType === 1;

  const mappedCards = cards.map((c, idx) => {
    const order =
      typeof c.orderInDeck === 'number' && Number.isFinite(c.orderInDeck) && c.orderInDeck > 0
        ? c.orderInDeck
        : idx + 1;

    const difficulty =
      typeof c.difficulty === 'number' && Number.isFinite(c.difficulty) && c.difficulty > 0
        ? c.difficulty
        : 2;

    const revision =
      typeof c.revision === 'number' && Number.isFinite(c.revision) && c.revision > 0
        ? c.revision
        : 1;

    const version =
      typeof c.version === 'number' && Number.isFinite(c.version) && c.version > 0
        ? c.version
        : 1;

    return {
      StableUid: c.stableUid,
      Question: c.question,
      Explanation: c.explanation ?? null,
      CodeSnippet: c.codeSnippet ?? null,
      CodeLanguage: c.codeLanguage ?? null,
      RealWorldUsage: c.realWorldUsage ?? null,
      Difficulty: difficulty,
      OrderInDeck: order,

      Revision: revision,
      Version: version,
      UpdatedAt: c.updatedAt ?? null,
    } as any;
  });

  const deck: DeckExport = {
    Slug: d.slug,
    Title: d.title,
    Locale: d.locale,
    DeckType: deckType,

    Version: raw.buildId,

    IsFreeStarter: isFreeStarter,
    FreeCardCount: isFreeStarter ? mappedCards.length : 0,

    TotalCards: mappedCards.length,
    Cards: mappedCards as any,
  };

  return deck;
}

function mapRawDeckFlatToDeckExport(raw: RawDeckJsonFlat): DeckExport {
  const cards = Array.isArray(raw.cards) ? raw.cards : [];

  const deckType = raw.deckType ?? 1;
  const isFreeStarter = deckType === 1;

  const mappedCards = cards.map((c, idx) => {
    const order =
      typeof c.orderInDeck === 'number' && Number.isFinite(c.orderInDeck) && c.orderInDeck > 0
        ? c.orderInDeck
        : idx + 1;

    const difficulty =
      typeof c.difficulty === 'number' && Number.isFinite(c.difficulty) && c.difficulty > 0
        ? c.difficulty
        : 2;

    const revision =
      typeof c.revision === 'number' && Number.isFinite(c.revision) && c.revision > 0
        ? c.revision
        : 1;

    const version =
      typeof c.version === 'number' && Number.isFinite(c.version) && c.version > 0
        ? c.version
        : 1;

    return {
      StableUid: c.stableUid,
      Question: c.question,
      Explanation: c.explanation ?? null,
      CodeSnippet: c.codeSnippet ?? null,
      CodeLanguage: c.codeLanguage ?? null,
      RealWorldUsage: c.realWorldUsage ?? null,
      Difficulty: difficulty,
      OrderInDeck: order,

      Revision: revision,
      Version: version,
      UpdatedAt: c.updatedAt ?? null,
    } as any;
  });

  const deck: DeckExport = {
    Slug: raw.slug,
    Title: raw.title,
    Locale: raw.locale,
    DeckType: deckType,

    Version: normalizeVersion(raw.version) ?? 'unknown',

    IsFreeStarter: isFreeStarter,
    FreeCardCount: isFreeStarter ? mappedCards.length : 0,

    TotalCards: mappedCards.length,
    Cards: mappedCards as any,
  };

  return deck;
}