import type { CardSource } from './cardSourceParse';
import { getInstalledDeckIndex } from './installedDeckIndex';

/**
 * K03 — a card's citation, read from the installed raw deck file.
 *
 * The deck mapper in deckRepository.ts builds CardExport from named keys only,
 * so `cards[].source` (written by the deck build, contract §5.4) never reaches
 * DeckExport. The installed deck reader (installedDeckIndex.ts) looks it up in
 * the file the repository installed; the shape rule is cardSourceParse.ts.
 */

export {
  CARD_SOURCE_QUOTE_MAX_LENGTH,
  CARD_SOURCE_URL_MAX_LENGTH,
  parseCardSource,
  type CardSource,
} from './cardSourceParse';

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

/** The source of an installed card, or null. Never throws. */
export async function getCardSource(deckSlug: string, stableUid: string): Promise<CardSource | null> {
  try {
    if (typeof stableUid !== 'string' || !stableUid) return null;
    return (await getInstalledDeckIndex(deckSlug))?.sources.get(stableUid) ?? null;
  } catch {
    return null;
  }
}
