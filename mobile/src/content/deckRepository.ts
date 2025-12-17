import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import type { DeckExport } from '../types/deckExport';

/**
 * v1 Content repository (CloudFront -> manifest.json -> deck.json)
 */

/** =========================
 *  Config
 *  ========================= */
const CONTENT_BASE_URL =
  (process.env.EXPO_PUBLIC_CONTENT_BASE_URL || '').trim() ||
  'https://d1ditdi9jqpy6n.cloudfront.net';

const MANIFEST_URL = joinUrl(CONTENT_BASE_URL, 'content', 'manifest.json');
const MANIFEST_CACHE_KEY = 'devcards:content:manifest:v1';
const DECK_META_PREFIX = 'devcards:content:deckmeta:v1:'; // + slug

// Runtime-safe "utf8" encoding without relying on FileSystem.EncodingType types
const UTF8_ENCODING: any = (FileSystem as any)?.EncodingType?.UTF8 ?? 'utf8';

function getDeckDir(): string {
  const base = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory;
  if (!base || typeof base !== 'string') {
    throw new Error('expo-file-system: no writable directory (documentDirectory/cacheDirectory)');
  }
  return `${base}devcards-decks-v1/`;
}

/** =========================
 *  Types
 *  ========================= */

type RawManifest = {
  schemaVersion: number;
  generatedAtMs: number;
  prefix: string; // e.g. "content/"
  decks: Array<{
    slug: string;
    title?: string;
    locale?: string;
    deckType?: number;
    buildId: string;
    path: string; // e.g. "decks/xxx/builds/<buildId>/deck.json"
    cardCount?: number;
    publishedAtMs?: number;
  }>;
};

export type ManifestDeckEntry = {
  slug: string;
  title?: string;
  locale?: string;
  deckType?: number;

  // v1: version = buildId（用于更新判断/显示）
  version: string;

  // 兼容 Home：totalCards
  totalCards?: number;

  buildId: string;
  path: string;
  cardCount?: number;
  publishedAtMs?: number;
};

export type UpdateInfo = {
  slug: string;

  installedVersion: string | null; // local buildId
  remoteVersion: string | null; // manifest buildId
  hasUpdate: boolean;

  remoteUrl: string | null; // full URL for deck.json
  remoteSha256: string | null; // v1 暂不使用
};

type DeckInstallMeta = {
  slug: string;
  buildId: string;
  installedAtMs: number;
  fileUri: string;
  cardCount: number;
};

type RawDeckJson = {
  schemaVersion: number;
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

export type DeckContent = DeckExport;

/** =========================
 *  Public API
 *  ========================= */

export async function checkManifestForUpdates(): Promise<Record<string, UpdateInfo>> {
  const manifest = await loadManifestPreferRemote();
  if (!manifest) return {};

  const out: Record<string, UpdateInfo> = {};

  for (const d of manifest.decks) {
    const meta = await getDeckMeta(d.slug);
    const installed = meta?.buildId || null;

    const remote = d.buildId || null;
    const hasUpdate = !installed || installed !== remote;

    // ✅ 更健壮：未来如果 manifest 直接给 full url，也能工作
    const remoteUrl =
      typeof d.path === 'string' && /^https?:\/\//i.test(d.path)
        ? d.path
        : remote
          ? joinUrl(CONTENT_BASE_URL, manifest.prefix, d.path)
          : null;

    out[d.slug] = {
      slug: d.slug,
      installedVersion: installed,
      remoteVersion: remote,
      hasUpdate,
      remoteUrl,
      remoteSha256: null,
    };
  }

  return out;
}

export async function listManifestDecks(): Promise<ManifestDeckEntry[]> {
  const manifest = await loadManifestCached();
  if (!manifest) return [];

  return (manifest.decks || []).map((d) => ({
    slug: d.slug,
    title: d.title,
    locale: d.locale,
    deckType: d.deckType ?? 1,

    buildId: d.buildId,
    path: d.path,
    cardCount: d.cardCount,
    publishedAtMs: d.publishedAtMs,

    version: d.buildId,
    totalCards: d.cardCount ?? 0,
  }));
}

export async function resolveDeckBySlug(slug: string): Promise<DeckContent | null> {
  const meta = await getDeckMeta(slug);
  if (!meta?.fileUri || !meta?.buildId) return null;

  const info = await FileSystem.getInfoAsync(meta.fileUri);
  if (!info.exists) {
    await removeDeckMeta(slug);
    return null;
  }

  try {
    const rawText = await FileSystem.readAsStringAsync(meta.fileUri, { encoding: UTF8_ENCODING });
    const raw = JSON.parse(rawText) as RawDeckJson;

    if (!raw || typeof raw.buildId !== 'string') return null;
    if (!raw.deck || raw.deck.slug !== slug) return null;
    if (!Array.isArray(raw.cards)) return null;

    return mapRawDeckToDeckExport(raw);
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
  if (!safeSlug) return false;

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
    await FileSystem.downloadAsync(url, tmpPath);

    const rawText = await FileSystem.readAsStringAsync(tmpPath, { encoding: UTF8_ENCODING });
    const raw = JSON.parse(rawText) as RawDeckJson;

    // Validate schema
    if (!raw || typeof raw.buildId !== 'string') return false;
    if (!raw.deck || typeof raw.deck.slug !== 'string') return false;
    if (raw.deck.slug !== safeSlug) return false;
    if (!Array.isArray(raw.cards)) return false;
    if (raw.cards.some((c) => !c || typeof c.stableUid !== 'string' || !c.stableUid.trim())) return false;

    // Expected buildId check
    if (remoteVersion && raw.buildId !== remoteVersion) return false;

    await FileSystem.deleteAsync(finalPath, { idempotent: true });
    await FileSystem.moveAsync({ from: tmpPath, to: finalPath });

    const meta: DeckInstallMeta = {
      slug: safeSlug,
      buildId: raw.buildId,
      installedAtMs: Date.now(),
      fileUri: finalPath,
      cardCount: raw.cards.length,
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
    if (typeof obj.prefix !== 'string') obj.prefix = 'content/';
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
    if (typeof json.prefix !== 'string') json.prefix = 'content/';

    await AsyncStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(json));
    return json;
  } catch {
    return null;
  }
}

function mapRawDeckToDeckExport(raw: RawDeckJson): DeckExport {
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

      // ✅ 给 “更新卡片提示” / lastSeenRevision 用
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

    Version: raw.buildId, // ✅ buildId 作为版本

    IsFreeStarter: isFreeStarter,
    FreeCardCount: isFreeStarter ? mappedCards.length : 0,

    TotalCards: mappedCards.length,
    Cards: mappedCards as any,
  };

  // 可选字段（如果你的 DeckExport 支持）
  // (deck as any).Author = d.author ?? null;
  // (deck as any).Description = d.description ?? null;

  return deck;
}