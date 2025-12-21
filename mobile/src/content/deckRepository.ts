// mobile/src/content/deckRepository.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { fetchAuthSession } from 'aws-amplify/auth';

import type { DeckExport } from '../types/deckExport';
import { getIsPremiumUser } from '../premium/premiumStore';
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
const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:'; // + userKey + ":" + slug

// Runtime-safe "utf8" encoding without relying on FileSystem.EncodingType types
const UTF8_ENCODING: any = (FileSystem as any)?.EncodingType?.UTF8 ?? 'utf8';

/**
 * User isolation:
 * - deck files stored under: <docDir>/devcards-decks-v2/<userKey>/<slug>.json
 * - meta stored under: devcards:content:deckmeta:v2:<userKey>:<slug>
 */
function sanitizeUserKey(s: string): string {
  const x = String(s || 'anon').trim();
  if (!x) return 'anon';
  return x.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'anon';
}

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

function getDeckDirForUser(userKey: string): string {
  const base = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory;
  if (!base || typeof base !== 'string') {
    throw new Error('expo-file-system: no writable directory (documentDirectory/cacheDirectory)');
  }
  const u = sanitizeUserKey(userKey);
  return `${base}devcards-decks-v2/${u}/`;
}

async function getDeckDir(): Promise<string> {
  const userKey = await getCurrentUserKey();
  return getDeckDirForUser(userKey);
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

    // ✅ premium preview fields (optional)
    previewCards?: number | null;
    previewVersion?: string | number | null;
    previewBuildId?: number | string | null;
    previewPath?: string | null;
    previewSha256?: string | null;
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
  remoteVersion: string | null; // manifest version/buildId (or previewVersion for premium preview)
  hasUpdate: boolean;

  remoteUrl: string | null; // full URL for deck.json (public or premium preview for non-premium)
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
 * For premium decks:
 *  - premium users: no direct url (full requires presigned URL later)
 *  - non-premium users: expose previewPath as remoteUrl if present
 * Also:
 *  - premium users should still get hasUpdate=true when versions differ (even if remoteUrl=null)
 */
export async function checkManifestForUpdates(
  _isPremiumUser: boolean = false,
): Promise<Record<string, UpdateInfo>> {
  const manifest = await loadManifestPreferRemote();
  if (!manifest) return {};

  const userKey = await getCurrentUserKey();
  const out: Record<string, UpdateInfo> = {};

  for (const d of manifest.decks) {
    const slug = String(d.slug || '').trim();
    if (!slug) continue;

    const meta = await getDeckMeta(slug, userKey);
    const installed = meta?.buildId || null;

    // full version/buildId from manifest
    const fullRemoteVersion = normalizeVersion(d.version ?? d.buildId) ?? null;

    const mode = String(d.downloadMode || '').toLowerCase();
    const tier = String((d as any).tier || '').toLowerCase();

    // public path
    const path = typeof d.path === 'string' && d.path.trim().length > 0 ? d.path.trim() : null;

    // premium preview fields
    const previewPath =
      typeof (d as any).previewPath === 'string' && String((d as any).previewPath).trim()
        ? String((d as any).previewPath).trim()
        : null;

    const previewVersion =
      normalizeVersion((d as any).previewVersion ?? (d as any).previewBuildId) ?? null;

    const previewSha256 =
      (d as any).previewSha256 ? String((d as any).previewSha256) : null;

    // Decide which URL/version/sha to expose
    let remoteUrl: string | null = null;
    let effectiveRemoteVersion: string | null = fullRemoteVersion;
    let effectiveRemoteSha256: string | null = (d.sha256 ?? null) ? String(d.sha256) : null;

    // Public deck: direct download
    if (mode === 'public' && path) {
      remoteUrl =
        /^https?:\/\//i.test(path)
          ? path
          : joinUrl(CONTENT_BASE_URL, manifest.prefix, path);
    }

    // Premium deck (non-premium user): allow preview download from CloudFront
    if (!_isPremiumUser && tier === 'premium' && previewPath) {
      remoteUrl =
        /^https?:\/\//i.test(previewPath)
          ? previewPath
          : joinUrl(CONTENT_BASE_URL, manifest.prefix, previewPath);

      effectiveRemoteVersion = previewVersion ?? effectiveRemoteVersion;
      effectiveRemoteSha256 = previewSha256 ?? effectiveRemoteSha256;
    }

    // ✅ hasUpdate rules:
    // - if remoteUrl exists: normal compare
    // - if premium user + premium deck: compare versions even though remoteUrl is null (download uses presigned URL)
    let hasUpdate = false;

    if (remoteUrl && effectiveRemoteVersion) {
      hasUpdate = installed !== effectiveRemoteVersion;
    } else if (_isPremiumUser && tier === 'premium' && effectiveRemoteVersion) {
      // full updates for premium users (remoteUrl intentionally null)
      hasUpdate = installed !== effectiveRemoteVersion;
    }

    out[slug] = {
      slug,
      installedVersion: installed,
      remoteVersion: effectiveRemoteVersion,
      hasUpdate,
      remoteUrl,
      remoteSha256: effectiveRemoteSha256,
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

  // ✅ 你之前那版“按用户隔离”的文件里是有 getCurrentUserKey 的
  const userKey = await getCurrentUserKey();

  const meta = await getDeckMeta(safeSlug, userKey);
  if (!meta?.fileUri || !meta?.buildId) return null;

  // ✅ NEW: premium 硬拦截（即使缓存存在也不允许打开）
  // 依据：manifest.cached 里的 tier/previewVersion
  const isPremiumUser = await getIsPremiumUser();

  const manifest = await loadManifestCached();
  const entry = (manifest?.decks || []).find((d) => String(d.slug || '').trim() === safeSlug) as any;

  const tier = String(entry?.tier || '').toLowerCase();

  if (tier === 'premium' && !isPremiumUser) {
    // 非 premium 用户：只允许打开“previewVersion”对应的本地文件（如果你有做 preview）
    const previewVersion =
      normalizeVersion(entry?.previewVersion ?? entry?.previewBuildId) ?? null;

    // 没有 previewVersion：直接锁死（并清理缓存）
    if (!previewVersion || meta.buildId !== previewVersion) {
      try {
        await FileSystem.deleteAsync(meta.fileUri, { idempotent: true });
      } catch {}
      await removeDeckMeta(safeSlug, userKey);
      return null;
    }
  }

  const info = await FileSystem.getInfoAsync(meta.fileUri);
  if (!info.exists) {
    await removeDeckMeta(safeSlug, userKey);
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

  const userKey = await getCurrentUserKey();
  const isPremiumUser = await getIsPremiumUser();
  const manifest = await loadManifestCached();
  const entry = (manifest?.decks || []).find((d) => String(d.slug || '').trim() === safeSlug) as any;
  const tier = String(entry?.tier || '').toLowerCase();

  const previewVersion = normalizeVersion(entry?.previewVersion ?? entry?.previewBuildId) ?? null;
  const existing = await getDeckMeta(safeSlug, userKey);
  if (existing?.buildId && remoteVersion && existing.buildId === remoteVersion) {
    return true;
  }

  const dir = getDeckDirForUser(userKey);
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
    // ✅ FINAL gate: 非会员 premium 只能安装 previewVersion（不依赖 remoteVersion 是否传入）
    if (tier === 'premium' && !isPremiumUser) {
      if (!previewVersion || finalBuildId !== previewVersion) {
        return false;
      }
    }
    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });

    const meta: DeckInstallMeta = {
      slug: safeSlug,
      buildId: finalBuildId,
      installedAtMs: Date.now(),
      fileUri: finalPath,
      cardCount,
    };

    await AsyncStorage.setItem(deckMetaKey(safeSlug, userKey), JSON.stringify(meta));
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

function deckMetaKey(slug: string, userKey: string) {
  const u = sanitizeUserKey(userKey);
  return `${DECK_META_PREFIX}${u}:${slug}`;
}

async function getDeckMeta(slug: string, userKey?: string): Promise<DeckInstallMeta | null> {
  const u = userKey ?? (await getCurrentUserKey());
  try {
    const raw = await AsyncStorage.getItem(deckMetaKey(slug, u));
    if (!raw) return null;
    const meta = JSON.parse(raw) as DeckInstallMeta;
    if (!meta?.buildId || !meta?.fileUri) return null;
    return meta;
  } catch {
    return null;
  }
}

async function removeDeckMeta(slug: string, userKey?: string) {
  const u = userKey ?? (await getCurrentUserKey());
  try {
    await AsyncStorage.removeItem(deckMetaKey(slug, u));
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