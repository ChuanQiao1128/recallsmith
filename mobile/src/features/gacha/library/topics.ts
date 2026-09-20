/** Chip key of the "no topic" group and its label (C00 §2.8.3). */
export const UNTAGGED_TOPIC_KEY = 'untagged';
export const UNTAGGED_TOPIC_LABEL = 'Untagged';

/** string → trim, '' → null; anything else → null. The mapper line in deckRepository.ts does not trim. */
export function normalizeTopic(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Lowercase, runs of [^a-z0-9] → '-', leading/trailing '-' removed. Used as the chip key and in testIDs.
 *  A slug that is empty or would collide with the reserved keys ('all', UNTAGGED_TOPIC_KEY) is prefixed
 *  with 't-' so a topic literally named "All" or "Untagged" keeps its own chip. */
export function topicKey(topic: string): string {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' || slug === 'all' || slug === UNTAGGED_TOPIC_KEY ? `t-${slug}` : slug;
}
