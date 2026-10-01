import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null] as [string, string | null])),
  },
}));

import { setActiveUserSubForStorage } from '../../src/review/storage';
import { setActiveDeckSlug } from '../../src/content/activeDeck';
import { invalidateDrawStateCache } from '../../src/features/gacha/draw/drawStateCache';
import { saveDrawState } from '../../src/features/gacha/draw/drawStateStore';
import { completeStarterLesson } from '../../src/features/gacha/starter/starterLesson';
import {
  loadRewardWalletState,
  saveRewardWalletState,
} from '../../src/features/gacha/rewards/rewardWallet';
import {
  DECK_WALLETS_KEY,
  adoptAnonDeckWallets,
  consumeDeckPulls,
  ensureDeckBootstrap,
  grantDeckPulls,
  loadDeckWallet,
  loadDeckWallets,
  migrateLegacyWalletIfNeeded,
  refundDeckPulls,
} from '../../src/features/gacha/rewards/deckWallet';

const SCOPE = 'devcards:u:user-a:';
const scoped = (base: string) => `${SCOPE}${base}`;
const walletsKey = scoped(DECK_WALLETS_KEY);
const legacyKey = scoped('recallsmith:reward-wallet:v1');

function ledgerKey(slug: string): string {
  return scoped(`recallsmith:newCardPullPaidUids:${slug}`);
}
function progressKey(slug: string): string {
  return `${SCOPE}deck-progress:${slug}`;
}
function readRecord(): any {
  const raw = store.get(walletsKey);
  return raw ? JSON.parse(raw) : null;
}

describe('deckWallet per-pack wallets', () => {
  beforeEach(async () => {
    store.clear();
    invalidateDrawStateCache();
    setActiveUserSubForStorage('user-a');
    await setActiveDeckSlug(null);
  });

  it('keeps each pack wallet separate and caps each pack at 60 + 5', async () => {
    await grantDeckPulls('aws', 5);
    await grantDeckPulls('csharp', 2);
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 5, reservePulls: 0 });
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 2, reservePulls: 0 });

    // Overflow one pack past the cap; the other pack is untouched.
    const grant = await grantDeckPulls('aws', 100);
    expect(grant.walletAfter).toEqual({ availablePulls: 60, reservePulls: 5 });
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 60, reservePulls: 5 });
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 2, reservePulls: 0 });
  });

  it('spends and refunds only the pack that was opened', async () => {
    await grantDeckPulls('aws', 10);
    await grantDeckPulls('csharp', 4);

    const spend = await consumeDeckPulls('aws', 3);
    expect(spend.spent).toBe(3);
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 7, reservePulls: 0 });
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 4, reservePulls: 0 });

    const refunded = await refundDeckPulls('aws', 3);
    expect(refunded).toEqual({ availablePulls: 10, reservePulls: 0 });
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 4, reservePulls: 0 });
  });

  it('serializes concurrent pack wallet writes so none is lost', async () => {
    await grantDeckPulls('aws', 10);
    await Promise.all([
      grantDeckPulls('aws', 5),
      grantDeckPulls('aws', 4),
      consumeDeckPulls('aws', 3),
      grantDeckPulls('aws', 2),
    ]);
    // 10 + 5 + 4 - 3 + 2 = 18, exactly, with no lost update.
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 18, reservePulls: 0 });
  });

  it('bootstraps 3 pulls once for a pack with no owned cards, no pity and no pulls', async () => {
    const first = await ensureDeckBootstrap('aws');
    expect(first.granted).toBe(3);
    expect(first.wallet).toEqual({ availablePulls: 3, reservePulls: 0 });

    // Spend them, then re-run: it never grants a second time.
    await consumeDeckPulls('aws', 3);
    const second = await ensureDeckBootstrap('aws');
    expect(second.granted).toBe(0);
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 0, reservePulls: 0 });
  });

  // R22 §4: the first pack is the reward for the starter lesson, so no pack bootstraps while it is open
  // (Home, Draw and Library all call ensureDeckBootstrap); completing the lesson grants the 3 pulls.
  it('grants the bootstrap only after the starter lesson completes', async () => {
    store.set('recallsmith:onboarding:stage:v1', 'starter');
    store.set('recallsmith:starter-lesson:v1', JSON.stringify({ slug: 'aws', uids: ['s1'] }));

    expect(await ensureDeckBootstrap('aws')).toEqual({ granted: 0, wallet: { availablePulls: 0, reservePulls: 0 } });
    expect((await ensureDeckBootstrap('csharp')).granted).toBe(0);
    // Refused, not spent: the pack is not marked, so it still bootstraps once the lesson is done.
    expect(readRecord()?.bootstrappedAtMs?.aws).toBeUndefined();

    const done = await completeStarterLesson('aws');
    expect(done).toMatchObject({ completed: true, granted: 3 });
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 3, reservePulls: 0 });
    expect(store.get('recallsmith:onboarding:stage:v1')).toBe('done');
    expect(store.get('notifications:permission-prompt:pending:v1')).toBe('1');

    // Net 3 pulls, as before the lesson existed: a second completion grants nothing.
    expect((await completeStarterLesson('aws')).granted).toBe(0);
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 3, reservePulls: 0 });
  });

  it('existing users (stage done) bootstrap exactly as before', async () => {
    store.set('recallsmith:onboarding:stage:v1', 'done');
    expect((await ensureDeckBootstrap('aws')).granted).toBe(3);
    // completeStarterLesson is a no-op for them: no stage change, no prompt armed.
    expect((await completeStarterLesson('aws')).completed).toBe(false);
    expect(store.get('notifications:permission-prompt:pending:v1')).toBeUndefined();
  });

  it('never bootstraps a pack that already has owned cards, pity or pulls', async () => {
    // Owned cards.
    await saveDrawState('owned-deck', { owned: ['c1'], pity: null });
    expect((await ensureDeckBootstrap('owned-deck')).granted).toBe(0);

    // Pity set.
    await saveDrawState('pity-deck', { owned: [], pity: { draws: 2, threshold: 10 } });
    expect((await ensureDeckBootstrap('pity-deck')).granted).toBe(0);

    // Already holds pulls.
    await grantDeckPulls('funded-deck', 1);
    expect((await ensureDeckBootstrap('funded-deck')).granted).toBe(0);
    expect(await loadDeckWallet('funded-deck')).toEqual({ availablePulls: 1, reservePulls: 0 });
  });

  it('migrates the legacy balance in proportion to each pack R1 ledger, remainder to the most recently studied pack', async () => {
    await saveRewardWalletState({ availablePulls: 10, reservePulls: 0 });
    // aws: 3 paid entries plus 2 backfilled 0s (which do not count).
    store.set(ledgerKey('aws'), JSON.stringify({ a1: 100, a2: 200, a3: 300, a4: 0, a5: 0 }));
    // csharp: 1 paid entry.
    store.set(ledgerKey('csharp'), JSON.stringify({ c1: 500 }));
    // csharp was studied most recently.
    store.set(progressKey('aws'), JSON.stringify([{ stableUid: 'a1', lastReviewedAt: 111 }]));
    store.set(progressKey('csharp'), JSON.stringify([{ stableUid: 'c1', lastReviewedAt: 999999 }]));

    const result = await migrateLegacyWalletIfNeeded();
    expect(result.kind).toBe('migrated');
    // floor(10*3/4)=7 to aws, floor(10*1/4)=2 to csharp, remainder 1 to csharp (most recent).
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 7, reservePulls: 0 });
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 3, reservePulls: 0 });
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
    expect(typeof readRecord().migratedAtMs).toBe('number');
  });

  it('migrates the whole legacy balance to the active pack when no pack has a paid ledger entry', async () => {
    await saveRewardWalletState({ availablePulls: 8, reservePulls: 0 });
    await setActiveDeckSlug('aws');

    const result = await migrateLegacyWalletIfNeeded();
    expect(result.kind).toBe('migrated');
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 8, reservePulls: 0 });
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
  });

  it('migrates exactly once and zeroes the legacy wallet', async () => {
    await saveRewardWalletState({ availablePulls: 4, reservePulls: 0 });
    await setActiveDeckSlug('aws');

    const first = await migrateLegacyWalletIfNeeded();
    expect(first.kind).toBe('migrated');
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 4, reservePulls: 0 });

    // A later run with an empty legacy wallet is a no-op: nothing double-grants.
    const second = await migrateLegacyWalletIfNeeded();
    expect(second.kind).toBe('noop');
    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 4, reservePulls: 0 });
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
  });

  it('leaves the legacy wallet untouched when there is no pack to migrate into', async () => {
    await saveRewardWalletState({ availablePulls: 5, reservePulls: 0 });
    // No ledger, no progress, no active deck -> no target.
    const result = await migrateLegacyWalletIfNeeded();
    expect(result.kind).toBe('no-target');
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 5, reservePulls: 0 });
    expect(readRecord()?.migratedAtMs ?? null).toBe(null);
  });

  it('sweeps a legacy balance that reappears after migration into the most recently studied pack', async () => {
    await saveRewardWalletState({ availablePulls: 6, reservePulls: 0 });
    store.set(progressKey('csharp'), JSON.stringify([{ stableUid: 'c1', lastReviewedAt: 999999 }]));

    expect((await migrateLegacyWalletIfNeeded()).kind).toBe('migrated');
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 6, reservePulls: 0 });

    // A 1.6.1 device earns 5 more into the legacy wallet; the next run sweeps it.
    await saveRewardWalletState({ availablePulls: 5, reservePulls: 0 });
    const swept = await migrateLegacyWalletIfNeeded();
    expect(swept.kind).toBe('swept');
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 11, reservePulls: 0 });
    expect(await loadRewardWalletState()).toEqual({ availablePulls: 0, reservePulls: 0 });
  });

  it('adopts anonymous pack pulls into the account per pack under the caps and keeps the anon bootstrap marks', async () => {
    // Account: aws already full so the anon add overflows and is dropped.
    await grantDeckPulls('aws', 100); // -> {60, 5}
    const anonKey = `devcards:u:anon:${DECK_WALLETS_KEY}`;
    store.set(
      anonKey,
      JSON.stringify({
        migratedAtMs: null,
        decks: { aws: { availablePulls: 5, reservePulls: 0 }, csharp: { availablePulls: 3, reservePulls: 0 } },
        bootstrappedAtMs: { aws: 111 },
      }),
    );

    const result = await adoptAnonDeckWallets();
    expect(result.deckWalletDecks).toBe(2);
    expect(result.deckPullsAdded).toBe(3); // csharp 3 added
    expect(result.deckPullsDropped).toBe(5); // aws full, all 5 dropped

    expect(await loadDeckWallet('aws')).toEqual({ availablePulls: 60, reservePulls: 5 });
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 3, reservePulls: 0 });

    // The account keeps the anon bootstrap mark; the anon record is drained but
    // keeps its bootstrap marks so a later signed-out period cannot re-bootstrap.
    const account = readRecord();
    expect(account.bootstrappedAtMs.aws).toBe(111);
    const anon = JSON.parse(store.get(anonKey)!);
    expect(anon.decks).toEqual({});
    expect(anon.bootstrappedAtMs.aws).toBe(111);

    // Idempotent: a second adoption finds the drained anon record and adds nothing.
    const again = await adoptAnonDeckWallets();
    expect(again.deckPullsAdded).toBe(0);
    expect(await loadDeckWallet('csharp')).toEqual({ availablePulls: 3, reservePulls: 0 });
  });
});
