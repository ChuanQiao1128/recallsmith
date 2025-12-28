// src/api/contentManifest.ts

export type ManifestTier = 'free' | 'premium';
export type ManifestAvailability = 'live' | 'coming' | 'retired';
export type ManifestDownloadMode = 'public' | 'auth' | 'none';

export type ManifestDeckEntry = {
  slug: string;
  version: string;

  // v2 fields
  order?: number;
  title?: string;
  locale?: string;
  deckType?: number;

  tier?: ManifestTier;
  availability?: ManifestAvailability;
  eta?: string | null;
  retiredAtMs?: number | null;

  downloadMode?: ManifestDownloadMode;

  totalCards?: number;
  buildId?: string | null;
  path?: string | null;

  previewCards?: number | null;
  previewBuildId?: string | null;
  previewPath?: string | null;
  previewVersion?: string | null;

  sha256?: string | null;
  previewSha256?: string | null;
};

export type ManifestIndex = {
  schemaVersion?: number;
  prefix?: string;

  // v2: generatedAtMs
  generatedAtMs?: number;

  // legacy: strings
  publishedAt?: string;
  generatedAt?: string;

  decks: ManifestDeckEntry[];
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function toOptionalString(v: unknown): string | undefined {
  if (!isNonEmptyString(v)) return undefined;
  return v.trim();
}

function toOptionalNullableString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!isNonEmptyString(v)) return null;
  return v.trim();
}

function toOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toOptionalNullableNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = toOptionalNumber(v);
  return n === undefined ? null : n;
}

function normalizeDeckEntry(raw: unknown): ManifestDeckEntry | null {
  if (!isObject(raw)) return null;

  const slug = raw.Slug ?? raw.slug;
  const version = raw.Version ?? raw.version;

  if (!isNonEmptyString(slug) || !isNonEmptyString(version)) return null;

  const out: ManifestDeckEntry = {
    slug: String(slug).trim(),
    version: String(version).trim(),
  };

  const order = toOptionalNumber(raw.order ?? raw.Order);
  if (order !== undefined) out.order = order;

  const title = toOptionalString(raw.title ?? raw.Title);
  if (title) out.title = title;

  const locale = toOptionalString(raw.locale ?? raw.Locale);
  if (locale) out.locale = locale;

  const deckType = toOptionalNumber(raw.deckType ?? raw.DeckType);
  if (deckType !== undefined) out.deckType = deckType;

  const tier = toOptionalString(raw.tier ?? raw.Tier);
  if (tier === 'free' || tier === 'premium') out.tier = tier;

  const availability = toOptionalString(raw.availability ?? raw.Availability);
  if (availability === 'live' || availability === 'coming' || availability === 'retired') out.availability = availability;

  const downloadMode = toOptionalString(raw.downloadMode ?? raw.DownloadMode);
  if (downloadMode === 'public' || downloadMode === 'auth' || downloadMode === 'none') out.downloadMode = downloadMode;

  const eta = toOptionalNullableString(raw.eta ?? raw.ETA);
  if (eta !== undefined) out.eta = eta;

  const retiredAtMs = toOptionalNullableNumber(raw.retiredAtMs ?? raw.RetiredAtMs);
  if (retiredAtMs !== undefined) out.retiredAtMs = retiredAtMs;

  const totalCards = toOptionalNumber(raw.totalCards ?? raw.TotalCards);
  if (totalCards !== undefined) out.totalCards = totalCards;

  const buildId = raw.buildId ?? raw.BuildId;
  if (buildId === null) out.buildId = null;
  else if (isNonEmptyString(buildId)) out.buildId = String(buildId).trim();

  const path = raw.path ?? raw.Path;
  if (path === null) out.path = null;
  else if (isNonEmptyString(path)) out.path = String(path).trim();

  const previewCards = toOptionalNullableNumber(raw.previewCards ?? raw.PreviewCards);
  if (previewCards !== undefined) out.previewCards = previewCards;

  const previewBuildId = raw.previewBuildId ?? raw.PreviewBuildId;
  if (previewBuildId === null) out.previewBuildId = null;
  else if (isNonEmptyString(previewBuildId)) out.previewBuildId = String(previewBuildId).trim();

  const previewPath = raw.previewPath ?? raw.PreviewPath;
  if (previewPath === null) out.previewPath = null;
  else if (isNonEmptyString(previewPath)) out.previewPath = String(previewPath).trim();

  const previewVersion = raw.previewVersion ?? raw.PreviewVersion;
  if (previewVersion === null) out.previewVersion = null;
  else if (isNonEmptyString(previewVersion)) out.previewVersion = String(previewVersion).trim();

  const sha256 = raw.sha256 ?? raw.Sha256 ?? raw.SHA256;
  if (sha256 === null) out.sha256 = null;
  else if (isNonEmptyString(sha256)) out.sha256 = String(sha256).trim();

  const previewSha256 = raw.previewSha256 ?? raw.PreviewSha256;
  if (previewSha256 === null) out.previewSha256 = null;
  else if (isNonEmptyString(previewSha256)) out.previewSha256 = String(previewSha256).trim();

  return out;
}

function normalizeManifest(raw: unknown): ManifestIndex | null {
  if (!isObject(raw)) return null;

  const decksRaw = raw.Decks ?? raw.decks;
  if (!Array.isArray(decksRaw)) return null;

  const decks: ManifestDeckEntry[] = [];
  for (const item of decksRaw) {
    const n = normalizeDeckEntry(item);
    if (n) decks.push(n);
  }

  const schemaVersion = toOptionalNumber(raw.SchemaVersion ?? raw.schemaVersion);
  const prefix = toOptionalString(raw.prefix ?? raw.Prefix);

  const generatedAtMs = toOptionalNumber(raw.generatedAtMs ?? raw.GeneratedAtMs);

  const publishedAt = toOptionalString(raw.publishedAt ?? raw.PublishedAt);
  const generatedAt = toOptionalString(raw.generatedAt ?? raw.GeneratedAt);

  return {
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ...(prefix ? { prefix } : {}),
    ...(generatedAtMs !== undefined ? { generatedAtMs } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(generatedAt ? { generatedAt } : {}),
    decks,
  };
}

export function getContentManifestUrl(): string {
  const fromEnv =
    import.meta.env.VITE_CONTENT_MANIFEST_URL ??
    import.meta.env.VITE_MANIFEST_URL ??
    '';

  if (isNonEmptyString(fromEnv)) return fromEnv.trim();

  // 本地默认（你也可以改成 /content/manifest.json）
  return '/manifest/index.json';
}

export async function fetchContentManifest(opts?: {
  signal?: AbortSignal;
  bustCache?: boolean;
}): Promise<Ok<ManifestIndex> | Err> {
  const url = getContentManifestUrl();
  if (!url) return { ok: false, error: 'VITE_CONTENT_MANIFEST_URL is not set.' };

  const finalUrl = opts?.bustCache ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;

  try {
    const resp = await fetch(finalUrl, {
      method: 'GET',
      signal: opts?.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: `Manifest request failed (HTTP ${resp.status}): ${text}` };
    }

    const json = (await resp.json()) as unknown;
    const normalized = normalizeManifest(json);
    if (!normalized) return { ok: false, error: 'Manifest JSON format is invalid.' };

    return { ok: true, data: normalized };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error.' };
  }
}