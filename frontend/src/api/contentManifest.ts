export type ManifestDeckEntry = {
  slug: string;
  version: string;
  title?: string;
  locale?: string;
  deckType?: number;
  isFreeStarter?: boolean;
  totalCards?: number;
  freeCardCount?: number;
  path?: string;
  sha256?: string;
};

export type ManifestIndex = {
  schemaVersion?: number;
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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function normalizeDeckEntry(raw: unknown): ManifestDeckEntry | null {
  if (!isObject(raw)) return null;

  const slug = raw.Slug ?? raw.slug;
  const version = raw.Version ?? raw.version;

  if (!isNonEmptyString(slug) || !isNonEmptyString(version)) return null;

  const title = raw.Title ?? raw.title;
  const locale = raw.Locale ?? raw.locale;

  const deckType = raw.DeckType ?? raw.deckType;
  const isFreeStarter = raw.IsFreeStarter ?? raw.isFreeStarter;
  const totalCards = raw.TotalCards ?? raw.totalCards;
  const freeCardCount = raw.FreeCardCount ?? raw.freeCardCount;
  const path = raw.Path ?? raw.path;
  const sha256 = raw.Sha256 ?? raw.sha256 ?? raw.SHA256;

  return {
    slug: String(slug).trim(),
    version: String(version).trim(),
    ...(isNonEmptyString(title) ? { title: title.trim() } : {}),
    ...(isNonEmptyString(locale) ? { locale: locale.trim() } : {}),
    ...(isFiniteNumber(deckType) ? { deckType } : {}),
    ...(typeof isFreeStarter === 'boolean' ? { isFreeStarter } : {}),
    ...(isFiniteNumber(totalCards) ? { totalCards } : {}),
    ...(isFiniteNumber(freeCardCount) ? { freeCardCount } : {}),
    ...(isNonEmptyString(path) ? { path: path.trim() } : {}),
    ...(isNonEmptyString(sha256) ? { sha256: sha256.trim() } : {}),
  };
}

function normalizeManifest(raw: unknown): ManifestIndex | null {
  if (!isObject(raw)) return null;

  const schemaVersion = raw.SchemaVersion ?? raw.schemaVersion;
  const publishedAt = raw.PublishedAt ?? raw.publishedAt;
  const generatedAt = raw.GeneratedAt ?? raw.generatedAt;

  const decksRaw = raw.Decks ?? raw.decks;
  const decksArr = Array.isArray(decksRaw) ? decksRaw : null;
  if (!decksArr) return null;

  const decks: ManifestDeckEntry[] = [];
  for (const item of decksArr) {
    const normalized = normalizeDeckEntry(item);
    if (normalized) decks.push(normalized);
  }

  return {
    ...(isFiniteNumber(schemaVersion) ? { schemaVersion } : {}),
    ...(isNonEmptyString(publishedAt) ? { publishedAt: publishedAt.trim() } : {}),
    ...(isNonEmptyString(generatedAt) ? { generatedAt: generatedAt.trim() } : {}),
    decks,
  };
}

export function getContentManifestUrl(): string {
  // 优先用环境变量（方便以后切到 S3 / CloudFront）
  const fromEnv =
    import.meta.env.VITE_CONTENT_MANIFEST_URL ??
    import.meta.env.VITE_MANIFEST_URL ??
    '';

  if (isNonEmptyString(fromEnv)) {
    return fromEnv.trim();
  }

  // 本地 / dev 默认：public/manifest/index.json
  return '/manifest/index.json';
}

export async function fetchContentManifest(opts?: {
  signal?: AbortSignal;
  bustCache?: boolean;
}): Promise<Ok<ManifestIndex> | Err> {
  const url = getContentManifestUrl();
  if (!url) {
    return { ok: false, error: 'VITE_CONTENT_MANIFEST_URL is not set.' };
  }

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