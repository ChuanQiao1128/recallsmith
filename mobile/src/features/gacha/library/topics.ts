/** Chip key of the "no topic" group and its label (C00 §2.8.3). */
export const UNTAGGED_TOPIC_KEY = 'untagged';
export const UNTAGGED_TOPIC_LABEL = 'Untagged';

/** string → trim, '' → null; anything else → null. The mapper line in deckRepository.ts does not trim. */
export function normalizeTopic(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** FNV-1a 32-bit over UTF-16 code units, as 8 lowercase hex digits. Pure and dependency-free; it only
 *  has to be deterministic and collision-poor across the handful of topics one deck carries. */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Lowercase, runs of [^a-z0-9] → '-', leading/trailing '-' removed. Used as the chip key and in testIDs.
 *  A slug that is empty or would collide with the reserved keys ('all', UNTAGGED_TOPIC_KEY) is prefixed
 *  with 't-' so a topic literally named "All" or "Untagged" keeps its own chip.
 *
 *  Labels outside ASCII (CJK, Cyrillic, accents) used to collapse: '???' and '中文' both became 't-', and
 *  'Réseau' became 'r-seau' while 'Reseau' became 'reseau' (or, worse, 'Résumé' and 'Resume' met at
 *  'r-sum'). Now: when the slug is empty the key is 't-' + fnv1a32Hex(normalised label); when any
 *  non-ASCII character was dropped by the slug the hash is appended ('r-seau-<8 hex>'), so two labels
 *  that differ only in dropped characters keep distinct chips. Pure-ASCII labels keep exactly the slug
 *  they had, so every existing testID stays stable. */
export function topicKey(topic: string): string {
  const normalised = topic.trim().toLowerCase();
  const slug = normalised.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug === '') return `t-${fnv1a32Hex(normalised)}`;
  if (hasNonAscii(normalised)) return `${slug}-${fnv1a32Hex(normalised)}`;
  return slug === 'all' || slug === UNTAGGED_TOPIC_KEY ? `t-${slug}` : slug;
}

function hasNonAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

/**
 * Chip order: numeric-aware, case-insensitive. "1.2 Secure" < "1.10 Design" < "2.1 Cost", "D1" < "D2" < "D10".
 * Digit runs compare as numbers, everything between them through localeCompare at base sensitivity, so
 * "iam" and "IAM" tie and accents do not jump the queue. Deterministic per engine: no Intl collator options
 * are relied on beyond the default, so Hermes and Node agree on the examples above.
 */
export function compareTopicLabels(a: string, b: string): number {
  const left = a.trim().split(/(\d+)/);
  const right = b.trim().split(/(\d+)/);
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === r) continue;
    const bothNumeric = /^\d+$/.test(l) && /^\d+$/.test(r);
    if (bothNumeric) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff;
      continue;
    }
    const cmp = l.localeCompare(r, 'en', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  }
  return left.length - right.length || a.localeCompare(b, 'en');
}
