// mobile/src/content/deckRepository.ts
// Step 2~4: manifest 读取 + 更新对比 + 下载校验 + 本地缓存 + deck resolver

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeckExport, CardExport } from '../types/deckExport';
import { CONTENT_BASE_URL, MANIFEST_URL } from './contentConfig';

export type ManifestDeckEntry = {
  slug: string;
  version: string;
  url: string; // can be absolute or relative
  sha256?: string;
  updatedAt?: string;
  title?: string;
  locale?: string;
  deckType?: number;
  isFreeStarter?: boolean;
  totalCards?: number;
  freeCardCount?: number;
};

export type ManifestIndex = {
  generatedAt?: string;
  decks: ManifestDeckEntry[];
};

export type DeckMeta = {
  installedVersion: string;
  installedAt: number;
  sourceUrl: string;
  sha256?: string;
};

export type UpdateInfo = {
  hasUpdate: boolean;
  installedVersion?: string;
  remoteVersion?: string;
  remoteUrl?: string;
  remoteSha256?: string;
};

const keyContent = (slug: string) => `deck-content:${slug}`;
const keyMeta = (slug: string) => `deck-meta:${slug}`;

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null;
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function absolutizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${CONTENT_BASE_URL}${url.replace(/^\/+/, '')}`;
}

function withCacheBuster(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Date.now()}`;
}

function normalizeManifest(raw: unknown): ManifestIndex | null {
  if (!isObject(raw)) return null;

  const decksRaw = (raw as any).decks ?? (raw as any).Decks;
  if (!Array.isArray(decksRaw)) return null;

  const decks: ManifestDeckEntry[] = [];
  for (const it of decksRaw) {
    if (!isObject(it)) continue;

    const slug = (it as any).slug ?? (it as any).Slug;
    const version = (it as any).version ?? (it as any).Version;
    const url =
      (it as any).url ??
      (it as any).Url ??
      (it as any).path ??
      (it as any).Path; // S3 manifest uses Path

    if (!isNonEmptyString(slug) || !isNonEmptyString(version) || !isNonEmptyString(url)) continue;

    decks.push({
      slug,
      version,
      url,
      sha256: (it as any).sha256 ?? (it as any).Sha256,
      updatedAt: (it as any).updatedAt ?? (it as any).UpdatedAt,
      title: (it as any).title ?? (it as any).Title,
      locale: (it as any).locale ?? (it as any).Locale,
      deckType: (it as any).deckType ?? (it as any).DeckType,
      isFreeStarter: (it as any).isFreeStarter ?? (it as any).IsFreeStarter,
      totalCards: (it as any).totalCards ?? (it as any).TotalCards,
      freeCardCount: (it as any).freeCardCount ?? (it as any).FreeCardCount,
    });
  }

  return {
    generatedAt: (raw as any).generatedAt ?? (raw as any).GeneratedAt,
    decks,
  };
}

/**
 * Step 3: 最基本校验（Slug/Version/Cards[].StableUid/OrderInDeck）+ 兼容大小写字段
 */
export function validateDeckExport(raw: unknown): DeckExport | null {
  if (!isObject(raw)) return null;

  const slug = (raw as any).Slug ?? (raw as any).slug;
  const version = (raw as any).Version ?? (raw as any).version;
  const title = (raw as any).Title ?? (raw as any).title;
  const locale = (raw as any).Locale ?? (raw as any).locale;
  const deckType = (raw as any).DeckType ?? (raw as any).deckType;
  const isFreeStarter = (raw as any).IsFreeStarter ?? (raw as any).isFreeStarter;
  const totalCards = (raw as any).TotalCards ?? (raw as any).totalCards;
  const freeCardCount = (raw as any).FreeCardCount ?? (raw as any).freeCardCount;
  const cardsRaw = (raw as any).Cards ?? (raw as any).cards;

  if (!isNonEmptyString(slug) || !isNonEmptyString(version) || !Array.isArray(cardsRaw)) return null;

  const seenUid = new Set<string>();
  const seenOrder = new Set<number>();
  const cards: CardExport[] = [];

  for (const c of cardsRaw) {
    if (!isObject(c)) return null;

    const uid = (c as any).StableUid ?? (c as any).stableUid;
    const order = (c as any).OrderInDeck ?? (c as any).orderInDeck;

    if (!isNonEmptyString(uid) || !isFiniteNumber(order)) return null;
    if (seenUid.has(uid)) return null;
    if (seenOrder.has(order)) return null;

    seenUid.add(uid);
    seenOrder.add(order);

    const revision = (c as any).Revision ?? (c as any).revision;
    const difficulty = (c as any).Difficulty ?? (c as any).difficulty;

    cards.push({
      StableUid: uid,
      OrderInDeck: order,
      Difficulty: isFiniteNumber(difficulty) ? difficulty : 2,
      Question: isNonEmptyString((c as any).Question ?? (c as any).question)
        ? ((c as any).Question ?? (c as any).question)
        : '',
      Explanation: ((c as any).Explanation ?? (c as any).explanation) ?? null,
      CodeSnippet: ((c as any).CodeSnippet ?? (c as any).codeSnippet) ?? null,
      RealWorldUsage: (c as any).RealWorldUsage ?? (c as any).realWorldUsage,
      CodeLanguage: ((c as any).CodeLanguage ?? (c as any).codeLanguage) ?? null,
      Revision: isFiniteNumber(revision) ? revision : undefined,
    });
  }

  const normalizedDeckType = isFiniteNumber(deckType) ? deckType : 1;

  return {
    Slug: slug,
    Version: version,
    Title: isNonEmptyString(title) ? title : slug,
    Locale: isNonEmptyString(locale) ? locale : 'en-US',
    DeckType: normalizedDeckType,
    IsFreeStarter: typeof isFreeStarter === 'boolean' ? isFreeStarter : normalizedDeckType === 1,
    TotalCards: isFiniteNumber(totalCards) ? totalCards : cards.length,
    FreeCardCount: isFiniteNumber(freeCardCount) ? freeCardCount : cards.length,
    Cards: cards,
  };
}

export async function readDeckMeta(slug: string): Promise<DeckMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(keyMeta(slug));
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!isObject(j)) return null;
    if (!isNonEmptyString((j as any).installedVersion)) return null;
    if (!isFiniteNumber((j as any).installedAt)) return null;
    if (!isNonEmptyString((j as any).sourceUrl)) return null;
    return j as DeckMeta;
  } catch {
    return null;
  }
}

export async function getInstalledDeckVersion(
  slug: string,
  fallbackVersion?: string,
): Promise<string | null> {
  const meta = await readDeckMeta(slug);
  if (meta?.installedVersion) return meta.installedVersion;
  return fallbackVersion ?? null;
}

/** Step 2: 读取 manifest（多路径兜底，以便 bucket 里文件名不同也能读到） */
export async function fetchManifestIndex(): Promise<ManifestIndex | null> {
  const candidates = Array.from(
    new Set([
      MANIFEST_URL,
      `${CONTENT_BASE_URL}manifest.json`,
      `${CONTENT_BASE_URL}manifest/index.json`,
    ]),
  );

  for (const url of candidates) {
    try {
      const res = await fetch(withCacheBuster(url), {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const normalized = normalizeManifest(json);
      if (normalized) return normalized;
    } catch {
      // try next candidate
    }
  }

  return null;
}

/** 读取 manifest 的 deck 列表（无则空数组） */
export async function listManifestDecks(): Promise<ManifestDeckEntry[]> {
  const manifest = await fetchManifestIndex();
  return manifest?.decks ?? [];
}

/** Step 2: 对比 remote.version !== localInstalledVersion */
export async function checkForDeckUpdates(
  localDecks: Array<{ Slug: string; Version: string }>,
): Promise<Record<string, UpdateInfo>> {
  const out: Record<string, UpdateInfo> = {};

  const manifest = await fetchManifestIndex();
  if (!manifest) return out;

  const remoteBySlug = new Map(manifest.decks.map(d => [d.slug, d]));

  await Promise.all(
    localDecks.map(async d => {
      const installedVersion = await getInstalledDeckVersion(d.Slug, d.Version);
      const remote = remoteBySlug.get(d.Slug);

      if (!remote) {
        out[d.Slug] = { hasUpdate: false, installedVersion: installedVersion ?? d.Version };
        return;
      }

      const remoteUrl = absolutizeUrl(remote.url);
      const hasUpdate = isNonEmptyString(installedVersion)
        ? remote.version !== installedVersion
        : remote.version !== d.Version;

      out[d.Slug] = {
        hasUpdate,
        installedVersion: installedVersion ?? d.Version,
        remoteVersion: remote.version,
        remoteUrl,
        remoteSha256: remote.sha256,
      };
    }),
  );

  return out;
}

/** 基于 manifest 列表对比（即使本地没有 stub 也会返回 hasUpdate=true 以便首次安装） */
export async function checkManifestForUpdates(): Promise<Record<string, UpdateInfo>> {
  const out: Record<string, UpdateInfo> = {};

  const manifest = await fetchManifestIndex();
  if (!manifest) return out;

  await Promise.all(
    manifest.decks.map(async d => {
      const installedVersion = await getInstalledDeckVersion(d.slug);
      const remoteUrl = absolutizeUrl(d.url);
      const hasUpdate = installedVersion ? d.version !== installedVersion : true; // 未安装视作需要安装

      out[d.slug] = {
        hasUpdate,
        installedVersion: installedVersion ?? undefined,
        remoteVersion: d.version,
        remoteUrl,
        remoteSha256: d.sha256,
      };
    }),
  );

  return out;
}

/**
 * Step 3: 下载 deck.json → 校验 → 写入本地缓存
 * 失败不覆盖旧内容
 */
export async function installDeckFromUrl(
  slug: string,
  remoteUrl: string,
  expectedVersion?: string,
  remoteSha256?: string,
): Promise<boolean> {
  try {
    const abs = absolutizeUrl(remoteUrl);
    const res = await fetch(withCacheBuster(abs), {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return false;

    const text = await res.text();

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return false;
    }

    const deck = validateDeckExport(raw);
    if (!deck) return false;
    if (deck.Slug !== slug) return false;
    if (expectedVersion && deck.Version !== expectedVersion) return false;

    // ✅ 校验通过再写入（保证失败不动旧内容）
    await AsyncStorage.setItem(keyContent(slug), text);

    const meta: DeckMeta = {
      installedVersion: deck.Version,
      installedAt: Date.now(),
      sourceUrl: abs,
      sha256: remoteSha256,
    };
    await AsyncStorage.setItem(keyMeta(slug), JSON.stringify(meta));

    return true;
  } catch {
    return false;
  }
}

/**
 * Step 4: Deck/Review 数据源：优先本地下载版（AsyncStorage），没有就 fallback mock
 */
export async function resolveDeckBySlug(
  slug: string | undefined | null,
): Promise<DeckExport | undefined> {
  if (!slug) return undefined;

  const cached = await AsyncStorage.getItem(keyContent(slug));
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      const deck = validateDeckExport(parsed);
      if (deck && deck.Slug === slug) return deck;

      // 缓存坏了就清掉（避免每次都 parse 崩）
      await AsyncStorage.multiRemove([keyContent(slug), keyMeta(slug)]);
    } catch {
      await AsyncStorage.multiRemove([keyContent(slug), keyMeta(slug)]);
    }
  }

  return undefined;
}
