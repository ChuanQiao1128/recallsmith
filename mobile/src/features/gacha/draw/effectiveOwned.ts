import type { CardProgress } from '../../../review/model';
import { isLearnedProgress } from '../selectors/progressSelectors';
import { loadDrawState } from './drawStateStore';

/**
 * Which cards this account is allowed to study: everything it drew, plus
 * everything it has already studied.
 *
 * The union is a standing rule, not a migration, and that choice is the whole
 * point of this function. The obvious alternative -- walk every deck once at
 * upgrade time, fold learned-but-undrawn cards into the owned set, and let the
 * gate read `owned` alone afterwards -- is cheaper at read time and wrong
 * against the fleet we actually have. 1.4.0 clients are still in the field and
 * still ungated; every day they keep rating cards and progressSync keeps
 * delivering that progress to this device. A one-shot migration seals the door
 * behind the cards that existed on migration day and leaves every later
 * arrival locked out of its own history. Re-running the union on each read
 * costs a set build over the progress array the caller already holds, and it
 * cannot go stale.
 *
 * What the gate therefore blocks is exactly one thing: a card nobody on this
 * account has ever seen. Anything a user has studied stays studiable, which is
 * the PRD's intent -- the gate exists to make a draw feel like it grants
 * something, not to take back work someone already did.
 *
 * Not synchronous, though the issue's sketch was: `slug` means a storage read,
 * and AsyncStorage has no synchronous door. The read model behind
 * loadDrawState is what keeps that affordable now that a per-render caller
 * exists. Callers that already hold a DrawStateRecord should union it
 * themselves rather than paying a second lookup for the same answer.
 */
export async function resolveEffectiveOwned(
  slug: string,
  progress: readonly CardProgress[],
): Promise<Set<string>> {
  const { owned } = await loadDrawState(slug);
  const effective = new Set(owned);

  for (const entry of progress) {
    // isLearnedProgress is the same predicate the Library and the planner use
    // to call a card "learning". Grandfathering has to agree with whatever the
    // rest of the app already shows the user as studied, or the gate starts
    // locking cards that the Library is at that moment listing as Learning.
    if (!entry?.stableUid) continue;
    if (isLearnedProgress(entry)) effective.add(entry.stableUid);
  }

  return effective;
}
