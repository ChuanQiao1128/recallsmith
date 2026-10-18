/**
 * K03 — the shape rule for a card's citation (contract §5.1). Pure: no storage,
 * no file system, no session. cardSource.ts re-exports it, and the installed
 * deck reader (installedDeckIndex.ts) applies it while it parses a deck file.
 */

export const CARD_SOURCE_URL_MAX_LENGTH = 2048;
export const CARD_SOURCE_QUOTE_MAX_LENGTH = 1000;

export type CardSource = { url: string; quote: string | null };

const HTTPS_URL = /^https:\/\/\S+$/;

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
