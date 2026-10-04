/**
 * U3: the one rule for opening a card's source link from the review screens.
 *
 * The deck contract only ever ships https sources (content/decks/FORMAT.md, BAD_SOURCE_URL, and
 * cardSource.parseCardSource drops anything else), so this is the second lock at the tap: an
 * absolute http(s) URL with a host and no whitespace or control characters. Everything else —
 * javascript:, data:, file:, intent:, app schemes, relative or protocol-relative URLs — is refused.
 */
const OPENABLE_SOURCE_URL = /^https?:\/\/[^\s/?#@\\]+(?:[/?#][^\s]*)?$/i;
// Control characters (C0, DEL, C1) never belong in a URL we hand to the OS.
const CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/;

export function isOpenableSourceUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return false;
  if (url !== url.trim() || CONTROL_CHAR.test(url)) return false;
  return OPENABLE_SOURCE_URL.test(url);
}

type LinkingLike = { openURL?: (url: string) => Promise<unknown> | unknown } | null | undefined;

/**
 * Hands an openable source URL to the system (the browser). Returns false, and does nothing, for
 * anything isOpenableSourceUrl refuses or when Linking is missing. Never throws; a rejected
 * openURL (offline, no handler) is swallowed — the source text stays on screen either way.
 */
export function openCardSourceUrl(url: unknown, linking: LinkingLike): boolean {
  if (!isOpenableSourceUrl(url)) return false;
  try {
    const open = linking?.openURL;
    if (typeof open !== 'function') return false;
    void Promise.resolve(open.call(linking, url)).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
