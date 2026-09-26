// mobile/src/sync/drawStateSync.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiJson } from '../api/apiClient';
import { getUserScopedKey } from '../review/storage';
import {
  adoptAnonDrawState,
  listDrawStateSlugs,
  loadDrawState,
  saveDrawState,
  type AnonDrawStateAdoption,
} from '../features/gacha/draw/drawStateStore';
import {
  adoptAnonRewardWallet,
  loadRewardWalletState,
  saveRewardWalletState,
  type AnonWalletAdoption,
  type RewardWalletState,
} from '../features/gacha/rewards/rewardWallet';
import { adoptAnonNewCardLedger, type AnonLedgerAdoption } from '../features/gacha/rewards/newCardLedger';
import type { PityState } from '../features/gacha/draw/pity';
import { setDrawStateSyncInFlight } from './syncActivity';

/**
 * ============================
 *  Draw state sync (collection / pity / wallet)
 * ============================
 *
 * Review progress has synced for a long time; everything the gacha side owns
 * did not. A new handset restored the reviews that earned the collection and
 * none of the collection. This module closes that gap with the smallest thing
 * that can work: one POST that carries a full snapshot up and takes the merged,
 * authoritative snapshot back down.
 *
 * Snapshot, not events, because of what the data is. A review is a fact that
 * happened at a time, so it is an event log. A collection is a set, a pity
 * counter is a position, a wallet is a balance: state, and small state (a deck's
 * owned set is bounded by the deck size). Modelling state as events would buy
 * conflict resolution we can get from an operator per field instead.
 *
 * Operators, one per field, chosen by meaning (the same rule the server merge
 * uses, see src_C/Vpc/Runtime/DrawStateMerge.cs):
 *   owned  -> union. A revealed card is revealed forever. Union cannot lose, so
 *             the state users care most about got the operator that cannot go
 *             wrong, and every apply below is a union rather than a replace.
 *   pity   -> last-writer-wins on a client stamp.
 *   wallet -> last-writer-wins on a client stamp. KNOWN LOSS, accepted: two
 *             devices that each spend pulls offline keep only one result, so a
 *             few pulls can come back from the dead. Pull counts are small and
 *             re-grantable; the real fix is a wallet event log (grants and
 *             spends as facts, balance as a projection) and that is a separate
 *             change, deliberately not bolted on here.
 *
 * NOT synced, and this is a decision rather than an omission: the session
 * settlement receipts (`recallsmith:reward-session:<id>`). They are a dedupe
 * ledger meaning "this session was already paid for", and a session id is
 * generated on the device that ran the session. Two devices therefore cannot
 * produce the same session id, so cross-device double settlement is impossible
 * by construction and there is nothing for a shared ledger to prevent. Uploading
 * them would add a way to LOSE money instead: any bug that let one device's
 * receipt answer for another's session would silently swallow a reward, which
 * is exactly the failure the local key partitioning had to fix.
 *
 * Anon adoption runs first: syncDrawStateNow unions the anonymous-period
 * partition (collection, pity, wallet) into the account before it reads local
 * state, so a card drawn before sign-in is pushed in the same run. The adopted
 * wallet pulls fall under the wallet LWW known-loss noted above.
 *
 * Failure policy: this never throws to its caller and never blocks review sync.
 * A skipped run costs a few minutes of staleness; a run that took review sync
 * down with it would cost real reviews.
 */

type ApiOk<T> = {
  success: boolean;
  data: T;
  error: any;
  traceId: string;
  version: string;
};

type RemotePity = { draws: number; threshold: number; updatedAtMs: number };

type RemoteDeck = {
  deckSlug: string;
  owned?: string[] | null;
  pity?: RemotePity | null;
};

type DrawStateSyncResp = {
  serverTimeMs: number;
  decks?: RemoteDeck[] | null;
  wallet?: { availablePulls: number; reservePulls: number; updatedAtMs: number } | null;
  ownedTruncated?: boolean;
};

/**
 * Where the last-writer-wins stamps live.
 *
 * The stamp is NOT stored next to the game state on purpose. Adding a timestamp
 * field to the draw record would put a sync concern inside the one write a draw
 * is allowed to make (see drawStateStore.ts), and every gameplay path that
 * writes pity or the wallet would have to remember to maintain it. Keeping the
 * stamps here means the sync layer owns its own bookkeeping and gameplay code
 * does not change at all.
 *
 * The cost, stated plainly: the stamp records when THIS module first noticed a
 * value differ from the last one it saw, not when the user actually pulled. In
 * practice the two are close, because sync runs on app start, focus and after
 * rating. Where they diverge the effect is bounded to the LWW fields, and the
 * unknown-stamp rule below keeps the divergence from ever destroying data.
 */
const STAMPS_KEY = 'sync:drawState:v1';

/**
 * The stamp used for a value we are seeing for the first time.
 *
 * Zero, not Date.now(), and this is the single most important line in the file.
 * A fresh install has a local wallet (the starter grant) and no idea when it was
 * produced; stamping it "now" would make an empty device outrank a server row
 * holding a real balance, and the reinstall that was supposed to restore state
 * would erase it instead. Zero says "I cannot vouch for when this happened", so
 * any server value wins, and only a change observed by this module afterwards
 * gets a real timestamp. Owned cards are unaffected either way, since union
 * never loses.
 */
const UNKNOWN_STAMP_MS = 0;

/**
 * How stale the authoritative snapshot may get when nothing changed locally.
 *
 * Without this, every rating-triggered sync round would add a POST that says
 * nothing new. With it, a quiet device still refreshes every few minutes, which
 * is the interval that matters for "I pulled on my iPad, now open my phone".
 */
const MIN_IDLE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

type DeckStamp = {
  // The pity value this stamp describes. Kept so a change can be DETECTED:
  // without the previous value there is no way to tell "the user pulled" from
  // "we are looking at the same state again".
  pity: PityState | null;
  // The size of the owned set last seen. A count is enough because the set only
  // grows, and it exists purely to notice a reveal that did not move pity (the
  // non-draw paths that mark cards owned) so the idle throttle does not sit on
  // a new card for five minutes. No timestamp: union has nothing to arbitrate.
  ownedCount: number;
  updatedAtMs: number;
};

type Stamps = {
  decks: Record<string, DeckStamp>;
  wallet: { value: RewardWalletState; updatedAtMs: number } | null;
  lastSyncedAtMs: number;
};

function emptyStamps(): Stamps {
  return { decks: {}, wallet: null, lastSyncedAtMs: 0 };
}

function toFiniteInt(v: any, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/** Union that preserves the local order and appends what is new. */
export function unionOwned(local: string[], remote: string[]): string[] {
  const seen = new Set(local);
  const out = [...local];
  for (const uid of remote) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

export function samePity(a: PityState | null, b: PityState | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.draws === b.draws && a.threshold === b.threshold;
}

export function sameWallet(a: RewardWalletState | null, b: RewardWalletState | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.availablePulls === b.availablePulls && a.reservePulls === b.reservePulls;
}

async function readStamps(): Promise<Stamps> {
  try {
    const raw = await AsyncStorage.getItem(await getUserScopedKey(STAMPS_KEY));
    if (!raw) return emptyStamps();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyStamps();
    return {
      decks: parsed.decks && typeof parsed.decks === 'object' ? parsed.decks : {},
      wallet: parsed.wallet ?? null,
      lastSyncedAtMs: toFiniteInt(parsed.lastSyncedAtMs, 0),
    };
  } catch {
    return emptyStamps();
  }
}

async function writeStamps(stamps: Stamps): Promise<void> {
  try {
    await AsyncStorage.setItem(await getUserScopedKey(STAMPS_KEY), JSON.stringify(stamps));
  } catch {
    // A lost stamp file costs one round of LWW precedence, never data: the
    // unknown-stamp rule makes the next run defer to the server.
  }
}

// One run at a time. The trigger points (app start, focus, token set, user
// change, post-rating flush) can overlap, and two runs would push the same
// snapshot twice and then race each other applying two answers.
let _inFlight = false;

export type DrawStateSyncResult = {
  ran: boolean;
  pushedDecks: number;
  appliedOwned: number;
  appliedPity: number;
  appliedWallet: boolean;
};

const SKIPPED: DrawStateSyncResult = {
  ran: false,
  pushedDecks: 0,
  appliedOwned: 0,
  appliedPity: 0,
  appliedWallet: false,
};

export type AnonGachaAdoption = AnonDrawStateAdoption & AnonWalletAdoption & AnonLedgerAdoption;

// One adoption at a time. Two callers race in production: the sign-in path in
// authStore calls adoptAnonGachaState directly, and the 'user_changed' progress
// sync that setActiveUserSub schedules reaches syncDrawStateNow (which calls it
// again). Without coalescing the wallet add could land twice, once per caller.
let _adopting: Promise<AnonGachaAdoption> | null = null;

/**
 * Adopts the anonymous-period partition into the account that just signed in:
 * union the anon collection and pity, add the anon wallet under the caps, then
 * clear the anon keys. Idempotent (a second run finds nothing) and never throws.
 * Concurrent callers share one in-flight run.
 */
export function adoptAnonGachaState(): Promise<AnonGachaAdoption> {
  if (_adopting) return _adopting;
  _adopting = (async () => {
    const draw = await adoptAnonDrawState();
    const wallet = await adoptAnonRewardWallet();
    const ledger = await adoptAnonNewCardLedger();
    return { ...draw, ...wallet, ...ledger };
  })().finally(() => {
    _adopting = null;
  });
  return _adopting;
}

/**
 * Push local gamification state, then adopt the server's verdict.
 *
 * Returns a summary for tests and debugging; callers in the app ignore it. Never
 * throws: every failure path returns a skipped result.
 */
export async function syncDrawStateNow(accessToken: string | null): Promise<DrawStateSyncResult> {
  const token = accessToken && accessToken.trim() ? accessToken.trim() : null;
  if (!token) return SKIPPED;
  if (_inFlight) return SKIPPED;

  _inFlight = true;
  setDrawStateSyncInFlight(true);
  try {
    // Adopt any anonymous-period state into this account BEFORE reading local
    // state, so an adopted deck is new to stamps.decks and is pushed with
    // UNKNOWN_STAMP_MS in this same run -- this is what makes the anon
    // collection reach the server's union on the first sync.
    await adoptAnonGachaState();
    const stamps = await readStamps();
    const nowMs = Date.now();

    // 1) Read the local state and stamp whatever changed since the last look.
    //    This happens BEFORE the network call so that an offline device still
    //    records when its own changes were noticed, instead of collapsing a
    //    week of offline play into whatever moment the network came back.
    const slugs = await listDrawStateSlugs();
    const localDecks = new Map<string, { owned: string[]; pity: PityState | null }>();
    let localChanged = false;

    for (const slug of slugs) {
      const record = await loadDrawState(slug);
      localDecks.set(slug, { owned: record.owned, pity: record.pity });

      const prev = stamps.decks[slug];
      if (!prev) {
        // A deck we have never pushed. Its owned set is unsent by definition, so
        // this counts as a local change even though nothing moved just now.
        stamps.decks[slug] = {
          pity: record.pity,
          ownedCount: record.owned.length,
          updatedAtMs: UNKNOWN_STAMP_MS,
        };
        localChanged = true;
      } else if (!samePity(prev.pity, record.pity)) {
        stamps.decks[slug] = {
          pity: record.pity,
          ownedCount: record.owned.length,
          updatedAtMs: nowMs,
        };
        localChanged = true;
      } else if (prev.ownedCount !== record.owned.length) {
        // Owned moved on its own. The stamp is left alone deliberately: it dates
        // the pity snapshot, and touching it here would hand this device an LWW
        // win it did not earn.
        stamps.decks[slug] = { ...prev, ownedCount: record.owned.length };
        localChanged = true;
      }
    }

    const localWallet = await loadRewardWalletState();
    if (!stamps.wallet) {
      stamps.wallet = { value: localWallet, updatedAtMs: UNKNOWN_STAMP_MS };
    } else if (!sameWallet(stamps.wallet.value, localWallet)) {
      stamps.wallet = { value: localWallet, updatedAtMs: nowMs };
      localChanged = true;
    }

    await writeStamps(stamps);

    if (!localChanged && nowMs - stamps.lastSyncedAtMs < MIN_IDLE_SYNC_INTERVAL_MS) {
      return SKIPPED;
    }

    // 2) Push. Decks with nothing in them are left out: an empty owned set and a
    //    null pity carry no information, and sending them would only grow the
    //    request on devices that never played that deck.
    const pushDecks: Array<{
      deckSlug: string;
      owned: string[];
      pity?: { draws: number; threshold: number; updatedAtMs: number };
    }> = [];

    for (const [slug, local] of localDecks.entries()) {
      if (local.owned.length === 0 && local.pity == null) continue;
      const stamp = stamps.decks[slug]?.updatedAtMs ?? UNKNOWN_STAMP_MS;
      pushDecks.push({
        deckSlug: slug,
        owned: local.owned,
        ...(local.pity
          ? { pity: { draws: local.pity.draws, threshold: local.pity.threshold, updatedAtMs: stamp } }
          : {}),
      });
    }

    const resp = await apiJson<ApiOk<DrawStateSyncResp>>('/api/v1/draw-state/sync', {
      method: 'POST',
      accessToken: token,
      body: {
        decks: pushDecks,
        wallet: {
          availablePulls: localWallet.availablePulls,
          reservePulls: localWallet.reservePulls,
          updatedAtMs: stamps.wallet?.updatedAtMs ?? UNKNOWN_STAMP_MS,
        },
      },
      timeoutMs: 15000,
    });

    const data = resp?.data;
    const remoteDecks = Array.isArray(data?.decks) ? data!.decks! : [];

    let appliedOwned = 0;
    let appliedPity = 0;

    // 3) Apply the answer. Every write below re-reads local state first, because
    //    the user can pull a card while the request is in flight. Owned is a
    //    union so a concurrent reveal survives either way; pity and the wallet
    //    are compare-and-set against what we pushed, and a mismatch means the
    //    local value moved on and the server has not heard about it yet. Skipping
    //    is right there: the next run pushes the newer value and the server
    //    arbitrates. Overwriting would let the server's answer to an older
    //    question undo the user's most recent pull.
    for (const remote of remoteDecks) {
      const slug = String(remote?.deckSlug ?? '').trim();
      if (!slug) continue;

      const remoteOwned = Array.isArray(remote?.owned)
        ? remote.owned!.filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
        : [];

      const current = await loadDrawState(slug);
      const mergedOwned = unionOwned(current.owned, remoteOwned);
      const ownedGrew = mergedOwned.length !== current.owned.length;

      const pushedPity = localDecks.get(slug)?.pity ?? null;
      let nextPity = current.pity;
      let pityChanged = false;

      let nextStamp: DeckStamp = stamps.decks[slug] ?? {
        pity: current.pity,
        ownedCount: current.owned.length,
        updatedAtMs: UNKNOWN_STAMP_MS,
      };
      nextStamp = { ...nextStamp, ownedCount: mergedOwned.length };

      const remotePity = remote?.pity;
      if (remotePity && samePity(current.pity, pushedPity)) {
        const adopted: PityState = {
          draws: toFiniteInt(remotePity.draws, 0),
          threshold: toFiniteInt(remotePity.threshold, 0),
        };
        if (!samePity(current.pity, adopted)) {
          nextPity = adopted;
          pityChanged = true;
        }
        // Adopt the server's stamp along with its value. Keeping our own stamp
        // here would make this device claim authorship of a decision another
        // device made, and it would win the next merge with it.
        nextStamp = { ...nextStamp, pity: adopted, updatedAtMs: toFiniteInt(remotePity.updatedAtMs, 0) };
      }

      stamps.decks[slug] = nextStamp;

      if (ownedGrew || pityChanged) {
        await saveDrawState(slug, { owned: mergedOwned, pity: nextPity });
        if (ownedGrew) appliedOwned += mergedOwned.length - current.owned.length;
        if (pityChanged) appliedPity += 1;
      }
    }

    let appliedWallet = false;
    const remoteWallet = data?.wallet;
    if (remoteWallet) {
      const currentWallet = await loadRewardWalletState();
      if (sameWallet(currentWallet, localWallet)) {
        const adopted: RewardWalletState = {
          availablePulls: toFiniteInt(remoteWallet.availablePulls, 0),
          reservePulls: toFiniteInt(remoteWallet.reservePulls, 0),
        };
        if (!sameWallet(currentWallet, adopted)) {
          await saveRewardWalletState(adopted);
          appliedWallet = true;
        }
        stamps.wallet = { value: adopted, updatedAtMs: toFiniteInt(remoteWallet.updatedAtMs, 0) };
      }
    }

    stamps.lastSyncedAtMs = Date.now();
    await writeStamps(stamps);

    return {
      ran: true,
      pushedDecks: pushDecks.length,
      appliedOwned,
      appliedPity,
      appliedWallet,
    };
  } catch {
    // Offline, a 500, a malformed body: all the same answer. The state is still
    // whole locally and the next trigger retries. Gamification sync is never
    // allowed to be the reason a review sync looks failed.
    return SKIPPED;
  } finally {
    _inFlight = false;
    setDrawStateSyncInFlight(false);
  }
}
