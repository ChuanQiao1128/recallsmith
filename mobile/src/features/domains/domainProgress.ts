import type { CardExport } from '../../types/deckExport';
import { isDue, type CardProgress } from '../../review/model';
import type { OwnedGate } from '../gacha/contracts';
import { compareTopicLabels, normalizeTopic, topicKey } from '../gacha/library/topics';
import type { MistakeEntry } from '../gacha/mistakes/mistakeBook';
import { isLearnedProgress, isMasteredProgress } from '../gacha/selectors/progressSelectors';
import { domainsForDeck } from './examDomains';

/** Group of the cards with no topic; always listed last. */
export const OTHER_DOMAIN_KEY = 'other';
export const OTHER_DOMAIN_TITLE = 'Other';

/** Prefix of the key of a group made from a topic that matches no exam domain. */
const TOPIC_GROUP_PREFIX = 'topic:';

export type DomainProgress = {
  key: string;
  title: string;
  /** The exam's share of the domain ("30%"), or null for topic groups and decks without weights. */
  examWeight: string | null;
  total: number;
  /** Cards in the effective owned set; every card when the gate is null. */
  collected: number;
  learned: number;
  mastered: number;
  dueNow: number;
  /** Cards of the domain with an active Mistake Book entry for this deck. */
  mistakes: number;
  /** The domain's cards in deck order (OrderInDeck). */
  uids: string[];
};

type Group = { key: string; title: string; examWeight: string | null; cards: CardExport[] };

/**
 * Per-domain counts for one deck (R24 contract §1.2). Pure: no storage, no clock unless `now` is omitted.
 *
 * Order: the deck's exam domains in exam order (only those with cards), then every topic that matches no
 * domain as its own group sorted like the Library chips, then "Other" for untagged cards.
 *
 * `activeMistakes` is the Mistake Book's active list (activeMistakes()); entries of other decks and
 * repeats of the same card are ignored.
 */
export function computeDomainProgress(
  slug: string,
  cards: readonly CardExport[],
  progress: readonly CardProgress[],
  owned: OwnedGate,
  activeMistakes: readonly MistakeEntry[],
  now: Date = new Date(),
): DomainProgress[] {
  const domains = domainsForDeck(slug);
  const domainGroups: Group[] = domains.map((d) => ({
    key: d.key,
    title: d.title,
    examWeight: d.examWeight ?? null,
    cards: [],
  }));
  const topicGroups = new Map<string, Group>();
  const other: Group = { key: OTHER_DOMAIN_KEY, title: OTHER_DOMAIN_TITLE, examWeight: null, cards: [] };

  for (const card of cards) {
    const topic = normalizeTopic(card.Topic);
    if (topic === null) {
      other.cards.push(card);
      continue;
    }
    const index = domains.findIndex((d) => d.match(topic));
    if (index >= 0) {
      domainGroups[index].cards.push(card);
      continue;
    }
    const key = `${TOPIC_GROUP_PREFIX}${topicKey(topic)}`;
    let group = topicGroups.get(key);
    if (!group) {
      group = { key, title: topic, examWeight: null, cards: [] };
      topicGroups.set(key, group);
    }
    group.cards.push(card);
  }

  const progressByUid = new Map(progress.map((p) => [p.stableUid, p]));
  const mistakeUids = new Set(activeMistakes.filter((m) => m.deckSlug === slug).map((m) => m.stableUid));

  const ordered = [
    ...domainGroups,
    ...[...topicGroups.values()].sort((a, b) => compareTopicLabels(a.title, b.title)),
    other,
  ];

  return ordered.filter((g) => g.cards.length > 0).map((g) => summarise(g, progressByUid, owned, mistakeUids, now));
}

function summarise(
  group: Group,
  progressByUid: ReadonlyMap<string, CardProgress>,
  owned: OwnedGate,
  mistakeUids: ReadonlySet<string>,
  now: Date,
): DomainProgress {
  const sorted = [...group.cards].sort((a, b) => a.OrderInDeck - b.OrderInDeck);
  const out: DomainProgress = {
    key: group.key,
    title: group.title,
    examWeight: group.examWeight,
    total: sorted.length,
    collected: 0,
    learned: 0,
    mastered: 0,
    dueNow: 0,
    mistakes: 0,
    uids: sorted.map((c) => c.StableUid),
  };
  for (const uid of out.uids) {
    if (!owned || owned.has(uid)) out.collected += 1;
    if (mistakeUids.has(uid)) out.mistakes += 1;
    const p = progressByUid.get(uid);
    if (!p) continue;
    if (isLearnedProgress(p)) out.learned += 1;
    if (isMasteredProgress(p)) out.mastered += 1;
    if (isDue(p, now)) out.dueNow += 1;
  }
  return out;
}
