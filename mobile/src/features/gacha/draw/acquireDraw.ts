import { isInstalledDrawDeckEligibleUnderLock } from '../../../content/deckEligibility';
import { captureProgressUserSub } from '../../../review/storage';
import { purchaseDeckCards } from '../rewards/deckWallet';
import { withDrawStateLock, drawStateGeneration } from './drawStateLock';
import { commitDrawUnderLock, resolveDrawDeck, MAX_COMMIT_DRAW_COUNT, type CommitDrawOptions } from './drawCommit';

/** The production open entry: capture scope, serialize, re-read, grant, debit. */
export async function acquireDraw(slug: string, requested: number, options?: CommitDrawOptions) {
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_COMMIT_DRAW_COUNT) throw new RangeError('Invalid pack size');
  const generation = drawStateGeneration();
  const userSub = await captureProgressUserSub(true);
  const deck = await resolveDrawDeck(slug, options?.deck);
  const scopeCurrent = async () => generation === drawStateGeneration() && await captureProgressUserSub(true) === userSub
    && await isInstalledDrawDeckEligibleUnderLock(slug, userSub, deck?.Version);
  return withDrawStateLock(async () => {
    if (!await scopeCurrent()) throw new Error('Account or installed deck changed; retry opening the pack');
    return purchaseDeckCards(slug, requested, userSub, count => commitDrawUnderLock(slug, count, { ...options, deck, scopeCurrent }, userSub), scopeCurrent);
  });
}
