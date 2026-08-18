// src/features/deckList/deckListManifest.ts
//
// Turning the published content manifest into something the deck table can
// render.
//
// The manifest is produced by a different service in a different language, and
// what arrives has been every one of: a bare array, { decks }, { Decks },
// { manifest: { decks } } and { data: { manifest: { decks } } }, with keys in
// both casings and numbers arriving as strings. These twelve functions absorb
// all of that so the page above them can assume one shape.
//
// They lived inside DeckListPage.tsx until now, where nothing could test them
// without mounting a 1355-line component: the only page-level test that existed
// signed in as a super admin against the paginated endpoint, so this entire
// path ran in production and in no test. Nothing here reads component state or
// calls a hook, which is what makes the file movable at all.
//
// statusBadge and typeBadge stayed behind on purpose. They return JSX, which
// would make this a .tsx file, and they hold no logic worth an assertion — a
// Tailwind class string and nothing else.

import type { Deck } from '../../types/deck';
import type { DeckStatus } from './deckListPagination';

export type ManifestDeckLite = {
  slug: string;
  title?: string;
  locale?: string;

  availability?: string;
  tier?: string;
  downloadMode?: string;

  version?: string;
  buildId?: string | null;

  totalCards?: number | null;

  path?: string | null;

  previewCards?: number | null;
  previewBuildId?: string | null;
  previewPath?: string | null;
};

export type ManifestMeta = {
  schemaVersion?: number;
  prefix?: string;
  generatedAtMs?: number;
  publishedAt?: string;
  generatedAt?: string;
  deckCount?: number;
};

export function safeDateTime(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function toOptionalString(v: unknown): string | undefined {
  if (!isNonEmptyString(v)) return undefined;
  return v.trim();
}

export function toOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function toOptionalNullableNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = toOptionalNumber(v);
  return n === undefined ? null : n;
}

export function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in o) return o[k];
  }
  return undefined;
}

// Strips the outer { manifest: { ... } } wrapper when the payload carries one.
export function getManifestTarget(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.manifest)) return raw.manifest as Record<string, unknown>;
  if (isRecord(raw.data) && isRecord(raw.data.manifest)) return raw.data.manifest as Record<string, unknown>;
  if (isRecord(raw.data)) return raw.data as Record<string, unknown>;
  return raw;
}

export function extractDecksArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;

  const target = getManifestTarget(raw);
  const decks = target['decks'] ?? target['Decks'];
  if (Array.isArray(decks)) return decks;
  return [];
}

export function toManifestDeckLite(input: unknown): ManifestDeckLite | null {
  if (!isRecord(input)) return null;

  const slugV = pick(input, ['slug', 'Slug']);
  const slug = toOptionalString(slugV) ?? '';
  if (!slug) return null;

  const title = toOptionalString(pick(input, ['title', 'Title']));
  const locale = toOptionalString(pick(input, ['locale', 'Locale']));

  const availability = toOptionalString(pick(input, ['availability', 'Availability']));
  const tier = toOptionalString(pick(input, ['tier', 'Tier']));
  const downloadMode = toOptionalString(pick(input, ['downloadMode', 'DownloadMode']));

  const version = toOptionalString(pick(input, ['version', 'Version']));

  const buildIdRaw = pick(input, ['buildId', 'BuildId']);
  const buildId =
    buildIdRaw === null ? null : isNonEmptyString(buildIdRaw) ? String(buildIdRaw).trim() : undefined;

  const pathRaw = pick(input, ['path', 'Path']);
  const path = pathRaw === null ? null : isNonEmptyString(pathRaw) ? String(pathRaw).trim() : undefined;

  const totalCards = toOptionalNullableNumber(pick(input, ['totalCards', 'TotalCards']));

  const previewCards = toOptionalNullableNumber(pick(input, ['previewCards', 'PreviewCards']));

  const previewBuildIdRaw = pick(input, ['previewBuildId', 'PreviewBuildId']);
  const previewBuildId =
    previewBuildIdRaw === null
      ? null
      : isNonEmptyString(previewBuildIdRaw)
        ? String(previewBuildIdRaw).trim()
        : undefined;

  const previewPathRaw = pick(input, ['previewPath', 'PreviewPath']);
  const previewPath =
    previewPathRaw === null
      ? null
      : isNonEmptyString(previewPathRaw)
        ? String(previewPathRaw).trim()
        : undefined;

  return {
    slug,
    ...(title ? { title } : {}),
    ...(locale ? { locale } : {}),

    ...(availability ? { availability } : {}),
    ...(tier ? { tier } : {}),
    ...(downloadMode ? { downloadMode } : {}),

    ...(version ? { version } : {}),
    ...(buildId !== undefined ? { buildId } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(totalCards !== undefined ? { totalCards } : {}),

    ...(previewCards !== undefined ? { previewCards } : {}),
    ...(previewBuildId !== undefined ? { previewBuildId } : {}),
    ...(previewPath !== undefined ? { previewPath } : {}),
  };
}

export function parseManifestMeta(raw: unknown): ManifestMeta {
  const target = getManifestTarget(raw);

  const schemaVersion = toOptionalNumber(pick(target, ['schemaVersion', 'SchemaVersion']));
  const prefix = toOptionalString(pick(target, ['prefix', 'Prefix']));
  const generatedAtMs = toOptionalNumber(pick(target, ['generatedAtMs', 'GeneratedAtMs']));
  const publishedAt = toOptionalString(pick(target, ['publishedAt', 'PublishedAt']));
  const generatedAt = toOptionalString(pick(target, ['generatedAt', 'GeneratedAt']));

  const decksRaw = pick(target, ['decks', 'Decks']);
  const deckCount = Array.isArray(decksRaw) ? decksRaw.length : undefined;

  return {
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ...(prefix ? { prefix } : {}),
    ...(generatedAtMs !== undefined ? { generatedAtMs } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(generatedAt ? { generatedAt } : {}),
    ...(deckCount !== undefined ? { deckCount } : {}),
  };
}

export function getDeckStatusFromManifest(deck: Deck, m?: ManifestDeckLite, cardCount?: number): DeckStatus {
  const isPublished = !!(m && (m.buildId || m.path));
  const count = cardCount ?? deck.totalCards ?? 0;

  if (isPublished) return 'published';
  if (count > 0) return 'needs_publish';
  
  return 'unpublished';
}
