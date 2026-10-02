import { isDue, type CardProgress } from '../../review/model';
import type { OwnedGate } from '../gacha/contracts';
import type { MistakeEntry } from '../gacha/mistakes/mistakeBook';
import { isLearnedProgress } from '../gacha/selectors/progressSelectors';

/** Most cards one domain Practice session hands to SessionCard's focus run (R24 contract §1.3). */
export const DOMAIN_PRACTICE_LIMIT = 15;

type Candidate = { uid: string; index: number; mistake: boolean; due: boolean; stage: number; lastReviewedAt: number };

/**
 * The focus cards of a domain's Practice button (R24 contract §1.3). Pure.
 *
 * Only owned (null gate = every card), learned cards of the domain qualify. Order: active Mistake Book
 * entries of this deck first, then due cards, then lowest stage, then longest since review, then deck
 * order (`uids` as computeDomainProgress lists them). An empty result means the button stays disabled.
 */
export function pickDomainPracticeUids(input: {
  slug: string;
  uids: readonly string[];
  progress: readonly CardProgress[];
  owned: OwnedGate;
  activeMistakes: readonly MistakeEntry[];
  now: Date;
  limit?: number;
}): string[] {
  const { slug, uids, progress, owned, activeMistakes, now, limit = DOMAIN_PRACTICE_LIMIT } = input;
  const progressByUid = new Map(progress.map((p) => [p.stableUid, p]));
  const mistakeUids = new Set(activeMistakes.filter((m) => m.deckSlug === slug).map((m) => m.stableUid));

  const candidates: Candidate[] = [];
  uids.forEach((uid, index) => {
    if (owned && !owned.has(uid)) return;
    const p = progressByUid.get(uid);
    if (!p || !isLearnedProgress(p)) return;
    candidates.push({
      uid,
      index,
      mistake: mistakeUids.has(uid),
      due: isDue(p, now),
      stage: p.stage ?? 0,
      lastReviewedAt: p.lastReviewedAt ?? 0,
    });
  });

  candidates.sort(
    (a, b) =>
      Number(b.mistake) - Number(a.mistake) ||
      Number(b.due) - Number(a.due) ||
      a.stage - b.stage ||
      a.lastReviewedAt - b.lastReviewedAt ||
      a.index - b.index,
  );
  return candidates.slice(0, Math.max(0, limit)).map((c) => c.uid);
}
