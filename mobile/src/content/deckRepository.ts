// mobile/src/content/deckRepository.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { fetchAuthSession } from 'aws-amplify/auth';

import type { DeckExport } from '../types/deckExport';
import { getIsPremiumUser } from '../premium/premiumStore';

/**
 * v2 Content repository (CloudFront -> manifest.json -> deck.json)
 * - Supports manifest schemaVersion=2
 * - Supports incremental updates via delta patch chain:
 *    - public decks: `patches`
 *    - ✅ premium preview decks: `previewPatches`
 * - Backward compatible with v1-ish deck json shape
 */

/** =========================
 *  Config
 *  ========================= */
const CONTENT_BASE_URL =
  (process.env.EXPO_PUBLIC_CONTENT_BASE_URL || '').trim() ||
  'https://d1ditdi9jqpy6n.cloudfront.net';

const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim() ||
  (process.env.EXPO_PUBLIC_API_BASE || '').trim() ||
  'https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com';

const MANIFEST_URL = joinUrl(CONTENT_BASE_URL, 'content', 'manifest.json');
const MANIFEST_CACHE_KEY = 'devcards:content:manifest:v2';
const DECK_META_PREFIX = 'devcards:content:deckmeta:v2:'; // + userKey + ":" + slug

// Runtime-safe "utf8" encoding without relying on FileSystem.EncodingType types
const UTF8_ENCODING: any = (FileSystem as any)?.EncodingType?.UTF8 ?? 'utf8';

// Patch constraints (client-side safety)
const MAX_PATCH_HOPS = 4;
const DECK_REPO_IMPL = 'deckRepository-2025-12-26-v2';
try {
  console.log('[deckRepository] impl', DECK_REPO_IMPL);
} catch {}

/**
 * ✅ Single-flight / in-flight dedupe for installs
 * Key includes: userKey + slug + remoteVersion (or url hash fallback)
 */
const _installInFlight = new Map<string, Promise<boolean>>();

function hash8(s: string): string | null {
  try {
    // use a tiny hash to avoid huge keys
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex').slice(0, 8);
  } catch {
    // fallback: length-based
    const t = String(s || '');
    return t ? String(t.length) : null;
  }
}

function makeInstallKey(userKey: string, slug: string, remoteVersion: string | null, url: string): string {
  const u = sanitizeUserKey(userKey);
  const s = slugToFileName(String(slug || ''));
  const rv = normalizeVersion(remoteVersion);
  const urlKey = rv ? rv : `url:${hash8(url) ?? 'na'}`;
  return `${u}:${s}:${urlKey}`;
}

function makeTmpPath(dir: string, slug: string, remoteVersion: string | null, kind: 'full' | 'patch'): string {
  const base = slugToFileName(slug);
  const v = normalizeVersion(remoteVersion) ?? 'na';
  const rnd = Math.random().toString(16).slice(2);
  const ts = Date.now();
  const suffix = kind === 'patch' ? 'patch.tmp.json' : 'tmp.json';
  return `${dir}${base}.${v}.${ts}.${rnd}.${suffix}`;
}

// ✅ DEV debug: trace who deletes deck files (helps diagnose accidental purges)
try {
  const _del: any = (FileSystem as any).deleteAsync?.bind(FileSystem);
  if (typeof _del === 'function' && !(FileSystem as any).__devcardsDeletePatched) {
    (FileSystem as any).__devcardsDeletePatched = true;
    (FileSystem as any).deleteAsync = async (uri: any, opts: any) => {
      try {
        const s = String(uri || '');
        if (s.includes('devcards-decks-v2') && s.endsWith('.json') && !s.includes('.tmp.') && !s.endsWith('.patch.tmp.json')) {
          const st = new Error().stack || '';
          console.warn('[fs] deleteAsync deck file', {
            uri: s,
            impl: DECK_REPO_IMPL,
            stackTop: st.split('\n').slice(0, 8).join(' | '),
          });
        }
      } catch {}
      return await _del(uri, opts);
    };
  }
} catch {}

// ✅ More reliable than FileSystem.downloadAsync for very long/presigned URLs on iOS
async function downloadToFileViaFetch(url: string, fileUri: string): Promise<void> {
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'cache-control': 'no-cache',
      accept: 'application/json',
    },
  });

  const text = await resp.text();

  console.log('[installDeckFromUrl] fetch', {
    status: resp.status,
    ok: resp.ok,
    urlLen: url.length,
    ct: resp.headers.get('content-type'),
    bytes: text.length,
    fileUri,
  });

  if (!resp.ok) {
    const head = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`download_failed_http_${resp.status}: ${head}`);
  }

  await FileSystem.writeAsStringAsync(fileUri, text, { encoding: UTF8_ENCODING });
}

// ✅ Premium cache (best-effort) to avoid calling /entitlements too often
let _premiumServerCache = { atMs: 0, value: false };
const PREMIUM_SERVER_CACHE_TTL_MS = 60_000;

function tokenToStringAny(t: any): string | null {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (typeof t?.toString === 'function') return String(t.toString());
  return null;
}

async function getIsPremiumUserWithServerFallback(): Promise<boolean> {
  // 1) local store (may lag)
  try {
    const local = await getIsPremiumUser();
    if (local) return true;
  } catch {
    // ignore
  }

  // 2) short TTL cache
  const now = Date.now();
  if (now - _premiumServerCache.atMs < PREMIUM_SERVER_CACHE_TTL_MS) {
    return _premiumServerCache.value;
  }

  // 3) server truth via /api/v1/entitlements
  try {
    const session: any = await fetchAuthSession();
    const at = tokenToStringAny(session?.tokens?.accessToken) ?? null;
    if (!at || !at.trim()) {
      _premiumServerCache = { atMs: now, value: false };
      return false;
    }

    const u = new URL('/api/v1/entitlements', API_BASE_URL);
    const resp = await fetch(u.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${at.trim()}`,
        accept: 'application/json',
        'cache-control': 'no-cache',
      },
    });

    const json = await resp.json().catch(() => null);
    const tier = String(json?.data?.tier || '').toLowerCase();
    const ok = resp.ok && tier === 'premium';

    _premiumServerCache = { atMs: now, value: ok };
    return ok;
  } catch {
    _premiumServerCache = { atMs: now, value: false };
    return false;
  }
}

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

/** =========================
 *  Types
 *  ========================= */

export type PatchEdge = {
  fromVersion: string;
  toVersion: string;
  path: string; // relative to prefix OR absolute URL
  sha256?: string | null;
};

type RawManifest = {
  schemaVersion: number;
  generatedAtMs: number;
  prefix: string; // e.g. "content"
  decks: Array<{
    order?: number;

    slug: string;
    title?: string;
    locale?: string;
    deckType?: number;

    tier?: 'free' | 'premium' | string | null;
    availability?: 'live' | 'coming' | 'retired' | string | null;
    retiredAtMs?: number | null;
    eta?: string | null;
    downloadMode?: 'public' | 'auth' | 'none' | string | null;

    totalCards?: number;
    version?: string | number | null;

    buildId?: number | string | null;

    // public decks: path is set
    // premium/auth or coming: path is null
    path?: string | null;

    sha256?: string | null;

    // ✅ v2 incremental patches for public decks
    patches?: PatchEdge[] | null;

    // ✅ premium preview fields (optional)
    previewCards?: number | null;
    previewVersion?: string | number | null;
    previewBuildId?: string | number | null;
    previewPath?: string | null;
    previewSha256?: string | null;

    // ✅ v2 incremental patches for premium previews
    previewPatches?: PatchEdge[] | null;
  }>;
};

export type ManifestDeckEntry = {
  order?: number;

  slug: string;
  title?: string;
  locale?: string;
  deckType?: number;

  tier?: string | null;
  availability?: string | null;
  retiredAtMs?: number | null;
  eta?: string | null;
  downloadMode?: string | null;

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

// New deck-json format (publish script): { slug,title,locale,deckType,version,totalCards,cards[] }
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

// Delta patch shape (from publish script)
type DeckDelta = {
  schemaVersion: number;
  slug: string;
  fromVersion: string;
  toVersion: string;
  generatedAtMs?: number;
  deck?: {
    slug: string;
    title: string;
    locale: string;
    deckType: number;
    version: string | number;
    totalCards?: number;
  };
  added?: RawDeckJsonFlat['cards'];
  updated?: RawDeckJsonFlat['cards'];
  deleted?: string[];
};

export type DeckContent = DeckExport;

/** =========================
 *  Public API
 *  ========================= */

export async function checkManifestForUpdates(
  _isPremiumUser: boolean = false,
): Promise<Record<string, UpdateInfo>> {
  const manifest = await loadManifestPreferRemote();
  if (!manifest) return {};

  // ✅ important: apply retired purges ASAP (before building update list)
  await reconcileRetiredDecks(manifest);

  const userKey = await getCurrentUserKey();
  const out: Record<string, UpdateInfo> = {};

  for (const d of manifest.decks) {
    const slug = String(d.slug || '').trim();
    if (!slug) continue;

    const availability = String(d.availability || '').toLowerCase();
    if (availability === 'retired') {
      continue;
    }

    const meta = await getDeckMeta(slug, userKey);
    const installed = meta?.buildId || null;

    const fullRemoteVersion = normalizeVersion(d.version ?? d.buildId) ?? null;

    const mode = String(d.downloadMode || '').toLowerCase();
    const tier = String((d as any).tier || '').toLowerCase();

    const path = typeof d.path === 'string' && d.path.trim().length > 0 ? d.path.trim() : null;

    const previewPath =
      typeof (d as any).previewPath === 'string' && String((d as any).previewPath).trim()
        ? String((d as any).previewPath).trim()
        : null;

    const previewVersion =
      normalizeVersion((d as any).previewVersion ?? (d as any).previewBuildId) ?? null;

    const previewSha256 = (d as any).previewSha256 ? String((d as any).previewSha256) : null;

    let remoteUrl: string | null = null;
    let effectiveRemoteVersion: string | null = fullRemoteVersion;
    let effectiveRemoteSha256: string | null = (d.sha256 ?? null) ? String(d.sha256) : null;

    if (mode === 'public' && path) {
      remoteUrl =
        /^https?:\/\//i.test(path) ? path : joinUrl(CONTENT_BASE_URL, manifest.prefix, path);
    }

    if (!_isPremiumUser && tier === 'premium' && previewPath) {
      remoteUrl =
        /^https?:\/\//i.test(previewPath)
          ? previewPath
          : joinUrl(CONTENT_BASE_URL, manifest.prefix, previewPath);

      effectiveRemoteVersion = previewVersion ?? effectiveRemoteVersion;
      effectiveRemoteSha256 = previewSha256 ?? effectiveRemoteSha256;
    }

    let hasUpdate = false;

    if (remoteUrl && effectiveRemoteVersion) {
      hasUpdate = installed !== effectiveRemoteVersion;
    } else if (_isPremiumUser && tier === 'premium' && effectiveRemoteVersion) {
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

  await reconcileRetiredDecks(manifest);

  return (manifest.decks || [])
    .filter((d) => String(d.availability || '').toLowerCase() !== 'retired')
    .map((d) => {
      const buildId = normalizeVersion(d.buildId) ?? null;
      const version = normalizeVersion(d.version ?? d.buildId) ?? (buildId ?? 'unknown');

      return {
        order: typeof (d as any).order === 'number' ? (d as any).order : undefined,

        slug: String(d.slug),
        title: d.title,
        locale: d.locale,
        deckType: d.deckType ?? 1,

        tier: (d.tier ?? null) as any,
        availability: (d.availability ?? null) as any,
        retiredAtMs: typeof (d as any).retiredAtMs === 'number' ? (d as any).retiredAtMs : null,
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

  const userKey = await getCurrentUserKey();
  const meta = await getDeckMeta(safeSlug, userKey);
  if (!meta?.fileUri || !meta?.buildId) return null;

  const manifest = await loadManifestCached();
  const entry = (manifest?.decks || []).find((d) => String(d.slug || '').trim() === safeSlug) as any;

  const availability = String(entry?.availability || '').toLowerCase();
  if (availability === 'retired') {
    const rAt =
      typeof entry?.retiredAtMs === 'number' && Number.isFinite(entry.retiredAtMs)
        ? Number(entry.retiredAtMs)
        : null;

    if (rAt == null) {
      console.warn('[content] retiredDeckMissingRetiredAtMsSkipPurge', { slug: safeSlug });
    } else {
      await purgeLocalDeckForRetired(safeSlug, userKey, rAt);
      return null;
    }
  }

  const isPremiumUser = await getIsPremiumUserWithServerFallback();
  const tier = String(entry?.tier || '').toLowerCase();
  const previewVersion = normalizeVersion(entry?.previewVersion ?? entry?.previewBuildId) ?? null;

  if (tier === 'premium' && !isPremiumUser) {
    if (!previewVersion || meta.buildId !== previewVersion) {
      await purgeLocalDeckForGate(safeSlug, userKey);
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

    if (isRawDeckV1(parsed)) {
      if (parsed.deck?.slug !== safeSlug) return null;
      if (!Array.isArray(parsed.cards)) return null;
      return mapRawDeckV1ToDeckExport(parsed);
    }

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

  const fail = (reason: string, extra?: any) => {
    try {
      console.warn('[installDeckFromUrl] fail', {
        reason,
        slug: safeSlug || String(slug || ''),
        remoteVersion,
        urlLen: safeUrl ? safeUrl.length : 0,
        hasQuery: safeUrl ? safeUrl.includes('?') : false,
        ...(extra || {}),
      });
    } catch {}
    return false;
  };

  console.log('[installDeckFromUrl] impl', DECK_REPO_IMPL);
  console.log('[installDeckFromUrl] enter', {
    impl: DECK_REPO_IMPL,
    slug: safeSlug || String(slug || ''),
    remoteVersion,
    urlLen: safeUrl ? safeUrl.length : 0,
    hasQuery: safeUrl ? safeUrl.includes('?') : false,
  });

  if (!safeSlug || !safeUrl) return fail('missing_slug_or_url');

  const userKey = await getCurrentUserKey();
  const inKey = makeInstallKey(userKey, safeSlug, remoteVersion, safeUrl);

  const existingInFlight = _installInFlight.get(inKey);
  if (existingInFlight) {
    console.log('[installDeckFromUrl] join_in_flight', { slug: safeSlug, remoteVersion, userKey });
    return await existingInFlight;
  }

  const runner = (async (): Promise<boolean> => {
    const isPremiumUser = await getIsPremiumUserWithServerFallback();
    const manifest = await loadManifestCached();

    const entry = (manifest?.decks || []).find((d) => String(d.slug || '').trim() === safeSlug) as any;

    if (!manifest) console.warn('[installDeckFromUrl] manifest_missing');
    if (!entry) console.warn('[installDeckFromUrl] manifest_entry_missing', { slug: safeSlug });

    const availability = String(entry?.availability || '').toLowerCase();
    if (availability === 'retired') {
      const rAt =
        typeof entry?.retiredAtMs === 'number' && Number.isFinite(entry.retiredAtMs)
          ? Number(entry.retiredAtMs)
          : null;

      if (rAt == null) {
        console.warn('[installDeckFromUrl] retired_missing_retiredAtMs_skip_purge', { slug: safeSlug });
      } else {
        await purgeLocalDeckForRetired(safeSlug, userKey, rAt);
      }

      return fail('retired');
    }

    const tier = String(entry?.tier || '').toLowerCase();
    const isPreviewInstall = tier === 'premium' && !isPremiumUser;
    const previewVersion = normalizeVersion(entry?.previewVersion ?? entry?.previewBuildId) ?? null;

    console.log('[installDeckFromUrl] start', {
      slug: safeSlug,
      tier,
      remoteVersion,
      isPremiumUser,
      previewVersion,
      urlLen: safeUrl.length,
      hasQuery: safeUrl.includes('?'),
    });

    const existing = await getDeckMeta(safeSlug, userKey);

    if (existing?.buildId && remoteVersion && existing.buildId === remoteVersion) {
      console.log('[installDeckFromUrl] already_up_to_date', { slug: safeSlug, buildId: existing.buildId });
      return true;
    }

    const dir = getDeckDirForUser(userKey);
    await ensureDir(dir);

    const finalPath = `${dir}${slugToFileName(safeSlug)}.json`;

    // Patch update path (kept)
    if (existing?.buildId && existing?.fileUri && remoteVersion && manifest) {
      const patchEdges: PatchEdge[] = (isPreviewInstall ? entry?.previewPatches : entry?.patches) || [];
      if (Array.isArray(patchEdges) && patchEdges.length > 0) {
        const patchRes = await tryPatchUpdate({
          slug: safeSlug,
          fromVersion: existing.buildId,
          toVersion: remoteVersion,
          fileUri: existing.fileUri,
          outFileUri: finalPath,
          prefix: String(manifest.prefix || 'content'),
          edges: patchEdges,
          userKey,
        });

        if (patchRes.ok) {
          console.log('[installDeckFromUrl] patch_applied', {
            slug: safeSlug,
            fromVersion: existing.buildId,
            toVersion: remoteVersion,
            hops: patchRes.hops,
          });
          return true;
        }

        console.log('[installDeckFromUrl] patch_fallback_to_full', {
          slug: safeSlug,
          fromVersion: existing.buildId,
          toVersion: remoteVersion,
        });
      }
    }

    // ====== Full download (with unique tmp) ======
    const tmpPath = makeTmpPath(dir, safeSlug, remoteVersion, 'full');

    const cleanupTmp = async () => {
      try {
        await FileSystem.deleteAsync(tmpPath, { idempotent: true });
      } catch {}
    };

    try {
      // no delete needed (unique tmp), but keep defensive cleanup
      await cleanupTmp();

      if (safeUrl.includes('?') || safeUrl.length > 900) {
        await downloadToFileViaFetch(safeUrl, tmpPath);
      } else {
        await FileSystem.downloadAsync(safeUrl, tmpPath);
      }

      const rawText = await FileSystem.readAsStringAsync(tmpPath, { encoding: UTF8_ENCODING });
      const parsed = JSON.parse(rawText);

      let resolvedBuildId: string | null = null;
      let cardCount = 0;

      if (isRawDeckV1(parsed)) {
        if (!parsed.deck || parsed.deck.slug !== safeSlug) {
          await cleanupTmp();
          return fail('v1_slug_mismatch', { got: parsed?.deck?.slug });
        }
        if (!Array.isArray(parsed.cards)) {
          await cleanupTmp();
          return fail('v1_cards_not_array');
        }
        if (parsed.cards.some((c) => !c || typeof c.stableUid !== 'string' || !c.stableUid.trim())) {
          await cleanupTmp();
          return fail('v1_bad_stable_uid');
        }

        resolvedBuildId = String(parsed.buildId || '').trim() || null;
        cardCount = parsed.cards.length;

        if (remoteVersion && resolvedBuildId && resolvedBuildId !== remoteVersion) {
          await cleanupTmp();
          return fail('v1_remote_version_mismatch', { resolvedBuildId, remoteVersion });
        }
      } else if (isRawDeckFlat(parsed)) {
        if (parsed.slug !== safeSlug) {
          await cleanupTmp();
          return fail('flat_slug_mismatch', { got: parsed?.slug });
        }
        if (!Array.isArray(parsed.cards)) {
          await cleanupTmp();
          return fail('flat_cards_not_array');
        }
        if (parsed.cards.some((c) => !c || typeof c.stableUid !== 'string' || !c.stableUid.trim())) {
          await cleanupTmp();
          return fail('flat_bad_stable_uid');
        }

        resolvedBuildId = normalizeVersion(parsed.version) ?? null;
        cardCount = parsed.cards.length;

        if (remoteVersion && resolvedBuildId && resolvedBuildId !== remoteVersion) {
          await cleanupTmp();
          return fail('flat_remote_version_mismatch', {
            resolvedBuildId,
            remoteVersion,
            parsedVersion: parsed?.version,
          });
        }
      } else {
        await cleanupTmp();
        return fail('unknown_deck_shape', { keys: Object.keys(parsed || {}).slice(0, 20) });
      }

      const finalBuildId = (remoteVersion && remoteVersion.trim()) || resolvedBuildId;
      if (!finalBuildId) {
        await cleanupTmp();
        return fail('missing_final_build_id', { resolvedBuildId, remoteVersion });
      }

      if (tier === 'premium' && !isPremiumUser) {
        const okPreview = !!previewVersion && finalBuildId === previewVersion;
        if (!okPreview) {
          await cleanupTmp();
          return fail('reject_non_premium_full', { finalBuildId, previewVersion });
        }
      }

      // atomic-ish replace
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

      console.log('[installDeckFromUrl] success', { slug: safeSlug, buildId: finalBuildId, cardCount });
      return true;
    } catch (e: any) {
      await cleanupTmp();

      console.error('[installDeckFromUrl] full download failed', {
        slug: safeSlug,
        urlLen: safeUrl.length,
        hasQuery: safeUrl.includes('?'),
        message: e?.message ?? String(e),
      });

      return false;
    }
  })();

  _installInFlight.set(inKey, runner);
  try {
    return await runner;
  } finally {
    _installInFlight.delete(inKey);
  }
}

/** =========================
 *  Patch update internals
 *  ========================= */

async function tryPatchUpdate(args: {
  slug: string;
  fromVersion: string;
  toVersion: string;
  fileUri: string;
  outFileUri: string;
  prefix: string;
  edges: PatchEdge[];
  userKey: string;
}): Promise<{ ok: boolean; hops: number }> {
  const { slug, fromVersion, toVersion, fileUri, outFileUri, prefix, edges, userKey } = args;

  if (!slug || !fromVersion || !toVersion) return { ok: false, hops: 0 };
  if (fromVersion === toVersion) return { ok: true, hops: 0 };

  const chain = resolvePatchChain(edges, fromVersion, toVersion, MAX_PATCH_HOPS);
  if (!chain) return { ok: false, hops: 0 };

  console.log('[content] patchUpdateAttempt', {
    slug,
    fromVersion,
    toVersion,
    hops: chain.length,
  });

  let deck: RawDeckJsonFlat | null = null;
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) return { ok: false, hops: 0 };

    const rawText = await FileSystem.readAsStringAsync(fileUri, { encoding: UTF8_ENCODING });
    const parsed = JSON.parse(rawText);

    if (!isRawDeckFlat(parsed)) {
      return { ok: false, hops: 0 };
    }

    if (String(parsed.slug).trim() !== slug) return { ok: false, hops: 0 };

    deck = parsed;
  } catch {
    return { ok: false, hops: 0 };
  }

  try {
    let cur = fromVersion;

    for (const edge of chain) {
      const deltaUrl =
        /^https?:\/\//i.test(edge.path) ? edge.path : joinUrl(CONTENT_BASE_URL, prefix, edge.path);

      const resp = await fetch(deltaUrl, {
        method: 'GET',
        headers: { 'cache-control': 'no-cache' },
      });

      if (!resp.ok) return { ok: false, hops: 0 };

      const delta = (await resp.json()) as DeckDelta;
      if (!isDeckDelta(delta)) return { ok: false, hops: 0 };

      if (String(delta.slug).trim() !== slug) return { ok: false, hops: 0 };
      if (String(delta.fromVersion).trim() !== cur) return { ok: false, hops: 0 };
      if (String(delta.toVersion).trim() !== String(edge.toVersion).trim()) return { ok: false, hops: 0 };

      deck = applyDelta(deck!, delta);
      cur = delta.toVersion;
    }

    if (String(cur).trim() !== String(toVersion).trim()) return { ok: false, hops: 0 };

    const dir = getDeckDirForUser(userKey);
    await ensureDir(dir);

    const patchTmp = makeTmpPath(dir, slug, toVersion, 'patch');

    try {
      await FileSystem.deleteAsync(patchTmp, { idempotent: true });
    } catch {}

    await FileSystem.writeAsStringAsync(patchTmp, JSON.stringify(deck, null, 2), {
      encoding: UTF8_ENCODING,
    });

    await FileSystem.deleteAsync(outFileUri, { idempotent: true });
    await FileSystem.moveAsync({ from: patchTmp, to: outFileUri });

    const meta: DeckInstallMeta = {
      slug,
      buildId: String(toVersion),
      installedAtMs: Date.now(),
      fileUri: outFileUri,
      cardCount: Array.isArray(deck.cards) ? deck.cards.length : 0,
    };
    await AsyncStorage.setItem(deckMetaKey(slug, userKey), JSON.stringify(meta));
    return { ok: true, hops: chain.length };
  } catch {
    return { ok: false, hops: 0 };
  }
}

function resolvePatchChain(
  edges: PatchEdge[],
  fromVersion: string,
  toVersion: string,
  maxHops: number,
): PatchEdge[] | null {
  const from = String(fromVersion).trim();
  const to = String(toVersion).trim();
  if (!from || !to) return null;
  if (from === to) return [];

  const adj = new Map<string, PatchEdge[]>();
  for (const e of edges || []) {
    const fv = String(e?.fromVersion || '').trim();
    const tv = String(e?.toVersion || '').trim();
    const p = String(e?.path || '').trim();
    if (!fv || !tv || !p) continue;

    const list = adj.get(fv) || [];
    list.push({ fromVersion: fv, toVersion: tv, path: p, sha256: e.sha256 ?? null });
    adj.set(fv, list);
  }

  const q: string[] = [];
  const visited = new Set<string>();
  const prev = new Map<string, { v: string; edge: PatchEdge }>();

  q.push(from);
  visited.add(from);

  while (q.length) {
    const v = q.shift()!;
    if (v === to) break;

    const outs = adj.get(v) || [];
    for (const e of outs) {
      const next = e.toVersion;
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, { v, edge: e });
      q.push(next);
    }
  }

  if (!visited.has(to)) return null;

  const chain: PatchEdge[] = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    chain.push(p.edge);
    cur = p.v;
  }
  chain.reverse();

  if (chain.length <= 0) return null;
  if (chain.length > maxHops) return null;
  return chain;
}

function isDeckDelta(x: any): x is DeckDelta {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.slug === 'string' &&
    typeof x.fromVersion === 'string' &&
    typeof x.toVersion === 'string' &&
    (typeof x.schemaVersion === 'number' || typeof x.schemaVersion === 'string')
  );
}

function applyDelta(deck: RawDeckJsonFlat, delta: DeckDelta): RawDeckJsonFlat {
  const map = new Map<string, RawDeckJsonFlat['cards'][number]>();

  for (const c of deck.cards || []) {
    if (!c || typeof c.stableUid !== 'string' || !c.stableUid.trim()) continue;
    map.set(c.stableUid, c);
  }

  const del = Array.isArray(delta.deleted) ? delta.deleted : [];
  for (const uid of del) {
    const u = String(uid || '').trim();
    if (!u) continue;
    map.delete(u);
  }

  const up = Array.isArray(delta.updated) ? delta.updated : [];
  for (const c of up) {
    if (!c || typeof c.stableUid !== 'string' || !c.stableUid.trim()) continue;
    map.set(c.stableUid, c as any);
  }

  const add = Array.isArray(delta.added) ? delta.added : [];
  for (const c of add) {
    if (!c || typeof c.stableUid !== 'string' || !c.stableUid.trim()) continue;
    map.set(c.stableUid, c as any);
  }

  const cards = Array.from(map.values()).sort((a, b) => {
    const ao = typeof a.orderInDeck === 'number' ? a.orderInDeck : 999999;
    const bo = typeof b.orderInDeck === 'number' ? b.orderInDeck : 999999;
    return ao - bo;
  });

  const newMeta = delta.deck;
  const next: RawDeckJsonFlat = {
    slug: newMeta?.slug || deck.slug,
    title: newMeta?.title || deck.title,
    locale: newMeta?.locale || deck.locale,
    deckType: typeof newMeta?.deckType === 'number' ? newMeta!.deckType : deck.deckType,
    version: delta.toVersion,
    totalCards: typeof newMeta?.totalCards === 'number' ? newMeta!.totalCards : cards.length,
    cards,
  };

  return next;
}

/** =========================
 *  Retired reconcile / purge
 *  ========================= */

async function purgeLocalDeckForGate(slug: string, userKey: string): Promise<void> {
  try {
    const meta = await getDeckMeta(slug, userKey);
    if (meta?.fileUri) {
      try {
        await FileSystem.deleteAsync(meta.fileUri, { idempotent: true });
      } catch {}
    }
    await removeDeckMeta(slug, userKey);
    console.log('[content] gatedDeckLocalState', {
      slug,
      expectedPath: meta?.fileUri ?? null,
      metaExistsAfter: false,
    });
  } catch {}
}

const REVIEW_PROGRESS_PREFIX = 'deck-progress:';
const REVIEW_DAILY_PREFIX = 'deck-daily-stats:';
const REVIEW_META_PREFIX = 'deck-meta:';

async function reconcileRetiredDecks(manifest: RawManifest): Promise<void> {
  try {
    const userKey = await getCurrentUserKey();
    const retired = (manifest.decks || []).filter(
      (d) => String(d.availability || '').toLowerCase() === 'retired',
    );

    for (const d of retired) {
      const slug = String(d.slug || '').trim();
      if (!slug) continue;

      const rAt =
        typeof (d as any).retiredAtMs === 'number' && Number.isFinite((d as any).retiredAtMs)
          ? Number((d as any).retiredAtMs)
          : null;

      if (rAt == null) {
        console.warn('[content] retiredDeckReconcileSkipMissingRetiredAtMs', { slug });
        continue;
      }

      await purgeLocalDeckForRetired(slug, userKey, rAt);
    }
  } catch {}
}

async function purgeLocalDeckForRetired(
  slug: string,
  userKey: string,
  retiredAtMs: number | null,
): Promise<void> {
  try {
    const stack = new Error().stack || '';
    console.warn('[content] purgeLocalDeckForRetired_call', {
      slug,
      retiredAtMs: retiredAtMs ?? null,
      impl: DECK_REPO_IMPL,
      stackTop: stack.split('\n').slice(0, 6).join(' | '),
    });
  } catch {}

  if (retiredAtMs == null) {
    console.warn('[content] retiredDeckLocalState', {
      slug,
      retiredAtMs: null,
      skipped: true,
      impl: DECK_REPO_IMPL,
    });
    return;
  }

  const retiredAt = Number(retiredAtMs);
  try {
    const meta = await getDeckMeta(slug, userKey);
    if (meta?.fileUri) {
      try {
        await FileSystem.deleteAsync(meta.fileUri, { idempotent: true });
      } catch {}
    }

    await removeDeckMeta(slug, userKey);

    const exactKeys = [
      `${REVIEW_PROGRESS_PREFIX}${slug}`,
      `${REVIEW_DAILY_PREFIX}${slug}`,
      `${REVIEW_META_PREFIX}${slug}`,
    ];

    const allKeys = await AsyncStorage.getAllKeys();

    const legacyProgressPrefix = `${REVIEW_PROGRESS_PREFIX}${slug}:`;
    const legacyDailyPrefix = `${REVIEW_DAILY_PREFIX}${slug}:`;

    const legacyProgressKeys = allKeys.filter((k) => k.startsWith(legacyProgressPrefix));
    const legacyDailyKeys = allKeys.filter((k) => k.startsWith(legacyDailyPrefix));

    const purgeKeys = [...exactKeys, ...legacyProgressKeys, ...legacyDailyKeys];

    const devcardsKeys = allKeys.filter(
      (k) =>
        k.startsWith('devcards:') &&
        (k.includes(`:${slug}`) || k.endsWith(`/${slug}`) || k.includes(`/${slug}:`)),
    );

    const allPurge = Array.from(new Set([...purgeKeys, ...devcardsKeys]));
    if (allPurge.length) {
      await AsyncStorage.multiRemove(allPurge);
    }

    console.log('[content] retiredDeckLocalState_v3', {
      slug,
      retiredAtMs: retiredAt,
      expectedPath: meta?.fileUri ?? null,
      expectedFileExistsAfter: false,
      metaExistsAfter: false,
      impl: DECK_REPO_IMPL,
    });
  } catch {}
}

/** =========================
 *  Storage helpers
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

/**
 * ✅ makeDirectoryAsync is safer than getInfo+make in concurrent situations
 * If folder already exists, ignore errors.
 */
async function ensureDir(dir: string) {
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    return;
  } catch {
    // If it exists already, we're good
    try {
      const info = await FileSystem.getInfoAsync(dir);
      if (info.exists && info.isDirectory) return;
    } catch {}
    // If we still can't confirm, rethrow a meaningful error
    throw new Error(`ensureDir_failed: ${dir}`);
  }
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
      typeof c.version === 'number' && Number.isFinite(c.version) && c.version > 0 ? c.version : 1;

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
      typeof c.version === 'number' && Number.isFinite(c.version) && c.version > 0 ? c.version : 1;

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